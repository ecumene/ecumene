import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { transformIndex } from "@reductoai/docx/collab";
import { DocxSession, SessionReplica } from "@reductoai/docx/editor";
import { WordDocument } from "@reductoai/docx/officejs";
import JSZip from "jszip";
import WebSocket from "ws";

import { createAppServer, type ServerOptions } from "../server/app.ts";
import { parseMessage, type ChangeEvent } from "../server/protocol.ts";

type Wire = Record<string, any>;
class Client {
  readonly messages: Wire[] = [];
  constructor(readonly socket: WebSocket) {
    socket.on("message", (data) => this.messages.push(JSON.parse(data.toString())));
  }
  send(value: unknown) {
    this.socket.send(JSON.stringify(value));
  }
  async next(type: string, predicate: (value: Wire) => boolean = () => true): Promise<Wire> {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const index = this.messages.findIndex((value) => value.type === type && predicate(value));
      if (index >= 0) return this.messages.splice(index, 1)[0];
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`Timed out waiting for ${type}; received ${JSON.stringify(this.messages)}`);
  }
  close() {
    this.socket.terminate();
  }
}

async function start(dataDir: string, options: ServerOptions = {}) {
  const app = await createAppServer({ ...options, dataDir });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  return {
    ...app,
    base,
    async create(blank = true) {
      const response = await fetch(`${base}/api/rooms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blank }),
      });
      assert.equal(response.status, 201);
      return (await response.json()) as { roomId: string; name: string };
    },
    async join(roomId: string, clientId: string, afterSeq?: number) {
      const socket = new WebSocket(`${base.replace("http:", "ws:")}/collab`);
      const client = new Client(socket);
      await once(socket, "open");
      client.send({
        type: "join",
        roomId,
        clientId,
        name: clientId,
        ...(afterSeq === undefined ? {} : { afterSeq }),
      });
      return client;
    },
  };
}

async function fixture(options: ServerOptions = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "paper-xp-server-"));
  const app = await start(directory, options);
  return {
    ...app,
    directory,
    async cleanup() {
      await app.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

async function replica(snapshot: Wire) {
  return SessionReplica.start(
    await DocxSession.fromBytes(Buffer.from(snapshot.bytes, "base64")),
    snapshot.seq,
    (bytes) => DocxSession.fromBytes(bytes),
    snapshot.block,
  );
}
const textOf = (session: DocxSession) =>
  WordDocument.from(session)
    .body.paragraphs.items.map((p) => p.text)
    .join("\n");
async function apply(replica: SessionReplica, id: string, event: ChangeEvent) {
  if (event.clientId === id) replica.ack(event.seq);
  else await replica.remote(event.change, event.seq);
}

test("rooms initialize a styled DOCX, upload into new IDs, and serve only allowlisted fonts", async () => {
  const app = await fixture();
  try {
    const first = await app.create(false);
    assert.equal(first.name, "Welcome.docx");
    const download = await fetch(`${app.base}/api/rooms/${first.roomId}/download`);
    assert.equal(download.headers.get("x-document-sequence"), "0");
    const bytes = Buffer.from(await download.arrayBuffer());
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file("word/document.xml")!.async("string");
    assert.match(xml, /Good ideas travel together/);
    assert.match(xml, /173F71/);
    assert.match(xml, /Georgia/);
    const uploaded = await fetch(`${app.base}/api/rooms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "X-Document-Name": encodeURIComponent("Our café.docx"),
      },
      body: bytes,
    });
    assert.equal(uploaded.status, 201);
    const second = (await uploaded.json()) as { roomId: string; name: string };
    assert.notEqual(first.roomId, second.roomId);
    assert.equal(second.name, "Our café.docx");
    assert.equal((await fetch(`${app.base}/fonts/Caladea-Regular.ttf`)).status, 200);
    assert.equal((await fetch(`${app.base}/fonts/package.json`)).status, 404);
    assert.equal(
      (await fetch(`${app.base}/api/rooms`, { method: "POST", body: "not a docx" })).status,
      400,
    );
    assert.equal(app.store.rooms.size, 2);
  } finally {
    await app.cleanup();
  }
});

test("real SDK replicas converge on concurrent insertions and preserve formatting through download", async () => {
  const app = await fixture();
  try {
    const { roomId } = await app.create();
    const a = await app.join(roomId, "alice");
    const b = await app.join(roomId, "bob");
    const sa = await a.next("snapshot");
    const sb = await b.next("snapshot");
    assert.notEqual(sa.block, sb.block);
    const ra = await replica(sa),
      rb = await replica(sb);
    const pa = WordDocument.from(ra.session).body.paragraphs.items[0];
    pa.insertText("Alpha ", "Start");
    pa.font.bold = true;
    const pb = WordDocument.from(rb.session).body.paragraphs.items[0];
    pb.insertText("Beta ", "Start");
    pb.font.italic = true;
    const ca = await ra.commit(),
      cb = await rb.commit();
    assert.ok(ca);
    assert.ok(cb);
    a.send({ type: "submit", opId: "a1", base: 0, change: ca });
    b.send({ type: "submit", opId: "b1", base: 0, change: cb });
    for (let seq = 1; seq <= 2; seq++) {
      const ea = (await a.next("change", (e) => e.seq === seq)) as ChangeEvent;
      const eb = (await b.next("change", (e) => e.seq === seq)) as ChangeEvent;
      assert.deepEqual(ea, eb);
      await apply(ra, "alice", ea);
      await apply(rb, "bob", eb);
    }
    assert.equal(textOf(ra.session), textOf(rb.session));
    assert.match(textOf(ra.session), /Alpha/);
    assert.match(textOf(ra.session), /Beta/);
    const bytes = await (await fetch(`${app.base}/api/rooms/${roomId}/download`)).arrayBuffer();
    assert.equal(textOf(await DocxSession.fromBytes(new Uint8Array(bytes))), textOf(ra.session));
    const zip = await JSZip.loadAsync(bytes);
    const xml = await zip.file("word/document.xml")!.async("string");
    assert.match(xml, /<w:b/);
    assert.match(xml, /<w:i/);
  } finally {
    await app.cleanup();
  }
});

test("lost ACK reconnect replays own and remote events; duplicate retry survives process restart", async () => {
  const app = await fixture();
  let restarted: Awaited<ReturnType<typeof start>> | undefined;
  try {
    const { roomId } = await app.create();
    const a = await app.join(roomId, "alice");
    const b = await app.join(roomId, "bob");
    const snapshot = await a.next("snapshot");
    const rb = await replica(await b.next("snapshot"));
    const ra = await replica(snapshot);
    WordDocument.from(ra.session).body.paragraphs.items[0].insertText("Once", "Start");
    const change = await ra.commit();
    const submit = { type: "submit", opId: "lost-ack", base: 0, change };
    a.send(submit);
    const accepted = (await b.next("change", (e) => e.seq === 1)) as ChangeEvent;
    await rb.remote(accepted.change, accepted.seq);
    a.close(); // deliberately do not acknowledge the accepted event to ra
    WordDocument.from(rb.session).body.paragraphs.items[0].insertText("!", "End");
    b.send({ type: "submit", opId: "remote", base: 1, change: await rb.commit() });
    await b.next("change", (e) => e.seq === 2);
    const reconnected = await app.join(roomId, "alice", 0);
    for (let seq = 1; seq <= 2; seq++)
      await apply(
        ra,
        "alice",
        (await reconnected.next("change", (e) => e.seq === seq)) as ChangeEvent,
      );
    const ready = await reconnected.next("ready");
    assert.equal(ready.block, snapshot.block);
    assert.equal(ready.seq, 2);
    assert.equal(textOf(ra.session), "Once!");
    reconnected.send(submit);
    assert.equal((await reconnected.next("change")).seq, 1);
    assert.equal(app.store.get(roomId).seq, 2);
    await app.close();
    restarted = await start(app.directory);
    const resumed = await restarted.join(roomId, "alice", 2);
    assert.equal((await resumed.next("ready")).block, snapshot.block);
    resumed.send(submit);
    assert.equal((await resumed.next("change")).seq, 1);
    assert.equal(restarted.store.get(roomId).seq, 2);
    assert.equal(textOf(await DocxSession.fromBytes(restarted.store.get(roomId).bytes)), "Once!");
    const fresh = await restarted.join(roomId, "carol");
    const freshSnapshot = await fresh.next("snapshot");
    assert.equal(freshSnapshot.seq, 2);
    assert.ok(freshSnapshot.block > snapshot.block);
  } finally {
    await restarted?.close();
    await app.cleanup();
  }
});

test("presence includes participants before selection, excludes self, and preserves sequenced cursor coordinates", async () => {
  const app = await fixture();
  try {
    const { roomId } = await app.create();
    const a = await app.join(roomId, "alice");
    const ra = await replica(await a.next("snapshot"));
    const b = await app.join(roomId, "bob");
    const snapshot = await b.next("snapshot");
    assert.deepEqual(
      snapshot.peers.map((p: Wire) => p.id),
      ["alice"],
    );
    const joined = await a.next("peers", (e) => e.peers.some((p: Wire) => p.id === "bob"));
    assert.equal(joined.peers[0].presence.seq, 0);
    b.send({ type: "presence", presence: { seq: 0, anchor: 0, focus: 3 }, name: "Bob Writer" });
    const update = await a.next("peers", (e) => e.peers[0]?.name === "Bob Writer");
    assert.deepEqual(update.peers[0].presence, { seq: 0, anchor: 0, focus: 3 });
    WordDocument.from(ra.session).body.paragraphs.items[0].insertText("X", "Start");
    a.send({ type: "submit", opId: "typing", base: 0, change: await ra.commit() });
    const event = await a.next("change");
    assert.equal(transformIndex(update.peers[0].presence.anchor, event.change.body), 1);
    assert.equal(transformIndex(update.peers[0].presence.focus, event.change.body), 4);
    b.close();
    assert.deepEqual((await a.next("peers", (e) => e.peers.length === 0)).peers, []);
  } finally {
    await app.cleanup();
  }
});

test("invalid bases, malformed changes, upload and room limits fail without committing", async () => {
  const app = await fixture({ maxRooms: 1, maxUploadBytes: 100 });
  try {
    const { roomId } = await app.create();
    const a = await app.join(roomId, "alice");
    await a.next("snapshot");
    a.send({ type: "submit", opId: "future", base: 9, change: {} });
    assert.equal((await a.next("error")).code, "INVALID_BASE");
    assert.equal(app.store.get(roomId).seq, 0);
    const b = await app.join(roomId, "bob");
    await b.next("snapshot");
    b.send({ type: "submit", opId: "negative", base: 0, change: { body: [{ d: -1 }] } });
    assert.equal((await b.next("error")).code, "INVALID_MESSAGE");
    assert.equal(app.store.get(roomId).seq, 0);
    assert.equal(
      (await fetch(`${app.base}/api/rooms`, { method: "POST", body: "a".repeat(101) })).status,
      413,
    );
    const capped = await fetch(`${app.base}/api/rooms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(capped.status, 503);
    assert.equal(app.store.rooms.size, 1);
    assert.throws(() =>
      parseMessage(
        '{"type":"submit","base":0,"opId":"bad","change":{"maps":{"__proto__":{"x":"y"}}}}',
      ),
    );
    // DOCX SessionReplica does not implement the shared spreadsheet streams/shifts fields.
    assert.throws(() =>
      parseMessage(
        JSON.stringify({ type: "submit", opId: "unsupported", base: 0, change: { streams: {} } }),
      ),
    );
  } finally {
    await app.cleanup();
  }
});
