import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { DocxSession, SessionReplica } from "@reductoai/docx/editor";
import { WordDocument } from "@reductoai/docx/officejs";
import JSZip from "jszip";
import WebSocket from "ws";

import { createAppServer } from "../server/app.ts";
import type { ChangeEvent } from "../server/protocol.ts";
import { RoomStore } from "../server/rooms.ts";

type Snapshot = { type: "snapshot"; seq: number; block: number; bytes: string };
type Message = Snapshot | ChangeEvent | { type: "error"; message: string } | { type: "peers" };

class ReviewClient {
  readonly messages: Message[] = [];
  replica!: SessionReplica;
  tracking = false;
  private operation = 0;

  constructor(
    readonly id: string,
    public name: string,
    readonly socket: WebSocket,
  ) {
    socket.on("message", (data) => this.messages.push(JSON.parse(data.toString()) as Message));
  }

  get document() {
    return WordDocument.from(this.replica.session);
  }

  async next<T extends Message["type"]>(type: T): Promise<Extract<Message, { type: T }>> {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const error = this.messages.find((message) => message.type === "error");
      if (error?.type === "error") throw new Error(error.message);
      const index = this.messages.findIndex((message) => message.type === type);
      if (index >= 0) return this.messages.splice(index, 1)[0] as Extract<Message, { type: T }>;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`Timed out waiting for ${type}`);
  }

  async open(roomId: string) {
    await once(this.socket, "open");
    this.socket.send(JSON.stringify({ type: "join", roomId, clientId: this.id, name: this.name }));
    const snapshot = await this.next("snapshot");
    this.replica = await SessionReplica.start(
      await DocxSession.fromBytes(Buffer.from(snapshot.bytes, "base64")),
      snapshot.seq,
      async (bytes) => {
        const session = await DocxSession.fromBytes(bytes);
        const document = WordDocument.from(session);
        // Raw SessionReplica callers own these session settings. EditorModel's
        // shared-host adapter preserves them itself when remote parts reopen.
        document.revisionAuthor = this.name;
        document.changeTrackingMode = this.tracking ? "TrackAll" : "Off";
        return session;
      },
      snapshot.block,
    );
    this.document.revisionAuthor = this.name;
  }

  setTracking(on: boolean) {
    this.tracking = on;
    this.document.changeTrackingMode = on ? "TrackAll" : "Off";
  }

  rename(name: string) {
    this.name = name;
    this.document.revisionAuthor = name;
  }

  async submit() {
    const base = this.replica.seq;
    const change = await this.replica.commit();
    assert.ok(change, "the review operation must produce a collaboration change");
    this.socket.send(
      JSON.stringify({ type: "submit", opId: `${this.id}-${++this.operation}`, base, change }),
    );
  }

  async receive() {
    const event = await this.next("change");
    assert.equal(event.seq, this.replica.seq + 1);
    if (event.clientId === this.id) this.replica.ack(event.seq);
    else await this.replica.remote(event.change, event.seq);
  }
}

function decodeXml(text: string) {
  const entities: Record<string, string> = { lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" };
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity: string) => {
    if (entity.startsWith("#x")) return String.fromCodePoint(parseInt(entity.slice(2), 16));
    if (entity.startsWith("#")) return String.fromCodePoint(parseInt(entity.slice(1), 10));
    return entities[entity];
  });
}

/** Inspect the serialized OOXML independently of the SDK's review projections. */
async function reviewXml(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes);
  const document = await zip.file("word/document.xml")!.async("string");
  const comments = await zip.file("word/comments.xml")!.async("string");
  const attribute = (xml: string, key: string) =>
    decodeXml(new RegExp(String.raw`\bw:${key}=(["'])(.*?)\1`).exec(xml)?.[2] ?? "");
  const text = (xml: string) =>
    [...xml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)]
      .map((match) => decodeXml(match[1]))
      .join("");
  return {
    comments: [...comments.matchAll(/<w:comment\b([^>]*)>([\s\S]*?)<\/w:comment>/g)]
      .map((match) => ({
        id: attribute(match[1], "id"),
        author: attribute(match[1], "author"),
        text: text(match[2]),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    insertions: [...document.matchAll(/<w:ins\b([^>]*)>([\s\S]*?)<\/w:ins>/g)].map((match) => ({
      author: attribute(match[1], "author"),
      text: text(match[2]),
    })),
    text: text(document),
    commentAnchors: [...document.matchAll(/<w:commentRangeStart\b([^>]*)\/?>(?:)/g)]
      .map((match) => attribute(match[1], "id"))
      .sort(),
  };
}

test("two authors track text and add comments concurrently; rename, remote reopen and download preserve attribution", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "wordpad-review-"));
  const app = await createAppServer({ dataDir: directory });
  try {
    app.server.listen(0, "127.0.0.1");
    await once(app.server, "listening");
    const origin = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    const seed = await WordDocument.create();
    seed.body.paragraphs.items[0].insertText("First paragraph.", "Replace");
    seed.body.insertParagraph("Second paragraph.", "End");
    const created = await fetch(`${origin}/api/rooms`, {
      method: "POST",
      body: Buffer.from(await seed.toBytes()),
    });
    assert.equal(created.status, 201);
    const { roomId } = (await created.json()) as { roomId: string };
    const socketUrl = `${origin.replace("http:", "ws:")}/collab`;
    const alice = new ReviewClient("alice", "Alice & Co", new WebSocket(socketUrl));
    const bob = new ReviewClient("bob", "Bob Writer", new WebSocket(socketUrl));
    await Promise.all([alice.open(roomId), bob.open(roomId)]);
    const receiveAll = async (count = 1) => {
      for (let i = 0; i < count; i++) await Promise.all([alice.receive(), bob.receive()]);
    };

    alice.setTracking(true);
    bob.setTracking(true);
    const aliceParagraph = alice.document.body.paragraphs.items[0];
    aliceParagraph.insertText(" Alice suggestion.", "End");
    aliceParagraph.insertComment("Alice asks for a clearer first paragraph.");
    const bobParagraph = bob.document.body.paragraphs.items[1];
    bobParagraph.insertText(" Bob suggestion.", "End");
    bobParagraph.insertComment("Bob asks for a clearer second paragraph.");
    // Both changes are authored at seq0, including independently allocated comment IDs.
    await Promise.all([alice.submit(), bob.submit()]);
    await receiveAll(2);
    assert.deepEqual(
      await reviewXml(await alice.replica.session.toBytes()),
      await reviewXml(await bob.replica.session.toBytes()),
    );

    bob.rename("Robert Renamed");
    const beforeReopen = bob.replica.session;
    alice.document.body.paragraphs.items[0].insertComment(
      "Alice follows up after Bob renamed himself.",
    );
    await alice.submit();
    await receiveAll();
    assert.notEqual(
      bob.replica.session,
      beforeReopen,
      "a remote comments-part change must exercise the reopen path",
    );
    assert.equal(bob.document.revisionAuthor, "Robert Renamed");
    assert.equal(bob.document.changeTrackingMode, "TrackAll");
    bob.document.body.paragraphs.items[1].insertText(" Renamed suggestion.", "End");
    bob.document.body.paragraphs.items[1].insertComment(
      "Robert comments under the current display name.",
    );
    await bob.submit();
    await receiveAll();

    bob.setTracking(false);
    bob.document.body.paragraphs.items[1].insertText(" Untracked note.", "End");
    await bob.submit();
    await receiveAll();
    const download = await fetch(`${origin}/api/rooms/${roomId}/download`);
    assert.equal(download.status, 200);
    assert.equal(download.headers.get("x-document-sequence"), "5");
    const downloaded = new Uint8Array(await download.arrayBuffer());
    const final = await reviewXml(downloaded);
    assert.deepEqual(final, await reviewXml(await alice.replica.session.toBytes()));
    assert.deepEqual(final, await reviewXml(await bob.replica.session.toBytes()));
    assert.deepEqual(
      final.comments.map((comment) => [comment.author, comment.text]).sort(),
      [
        ["Alice & Co", "Alice asks for a clearer first paragraph."],
        ["Alice & Co", "Alice follows up after Bob renamed himself."],
        ["Bob Writer", "Bob asks for a clearer second paragraph."],
        ["Robert Renamed", "Robert comments under the current display name."],
      ].sort(),
    );
    assert.equal(
      new Set(final.comments.map((comment) => comment.id)).size,
      4,
      "concurrent comments have distinct writer-block IDs",
    );
    assert.deepEqual(final.commentAnchors, final.comments.map((comment) => comment.id).sort());
    for (const [author, expected] of [
      ["Alice & Co", " Alice suggestion."],
      ["Bob Writer", " Bob suggestion."],
      ["Robert Renamed", " Renamed suggestion."],
    ])
      assert.ok(
        final.insertions.some(
          (insertion) => insertion.author === author && insertion.text.includes(expected),
        ),
        `${author}'s tracked text remains attributed`,
      );
    assert.ok(final.text.includes(" Untracked note."));
    assert.ok(
      final.insertions.every((insertion) => !insertion.text.includes("Untracked note.")),
      "turning tracking off produces ordinary text",
    );

    const restored = new RoomStore(directory);
    await restored.init();
    assert.deepEqual(
      await reviewXml(restored.get(roomId).bytes),
      final,
      "the saved room retains review authors and comment anchors",
    );
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
