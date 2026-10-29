import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { DocxSession, SessionReplica } from "@reductoai/docx/editor";
import { WordDocument } from "@reductoai/docx/officejs";
import WebSocket from "ws";

import { createAppServer } from "../server/app.ts";
import type { ChatMessage } from "../server/protocol.ts";
import { RoomStore } from "../server/rooms.ts";

type Message = {
  type: string;
  message?: ChatMessage | string;
  messageId?: string;
  messages?: ChatMessage[];
  peers?: { id: string; name: string }[];
  seq?: number;
  block?: number;
  bytes?: string;
};

class ChatClient {
  readonly messages: Message[] = [];
  constructor(readonly socket: WebSocket) {
    socket.on("message", (data) => this.messages.push(JSON.parse(data.toString()) as Message));
  }
  send(message: unknown) {
    this.socket.send(JSON.stringify(message));
  }
  async next(type: string, predicate: (message: Message) => boolean = () => true) {
    const deadline = Date.now() + 7000;
    while (Date.now() < deadline) {
      const index = this.messages.findIndex(
        (message) => message.type === type && predicate(message),
      );
      if (index >= 0) return this.messages.splice(index, 1)[0];
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`Timed out waiting for ${type}: ${JSON.stringify(this.messages)}`);
  }
}

async function start(dataDir: string) {
  const app = await createAppServer({ dataDir });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  const origin = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  return {
    ...app,
    origin,
    async create() {
      const response = await fetch(`${origin}/api/rooms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: '{"blank":true}',
      });
      assert.equal(response.status, 201);
      return ((await response.json()) as { roomId: string }).roomId;
    },
    async join(roomId: string, clientId: string, name = clientId, afterSeq?: number) {
      const socket = new WebSocket(`${origin.replace("http:", "ws:")}/collab`);
      const client = new ChatClient(socket);
      await once(socket, "open");
      client.send({
        type: "join",
        roomId,
        clientId,
        name,
        ...(afterSeq === undefined ? {} : { afterSeq }),
      });
      const snapshot = await client.next(afterSeq === undefined ? "snapshot" : "ready");
      const history = await client.next("chatHistory");
      await client.next("typing");
      return { client, snapshot, history };
    },
  };
}

async function fixture() {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "wordpad-chat-"));
  const directory = path.join(temporary, "rooms");
  const app = await start(directory);
  return {
    ...app,
    directory,
    temporary,
    async cleanup() {
      await app.close();
      await rm(temporary, { recursive: true, force: true });
    },
  };
}

const sent = (event: Message) => event.message as ChatMessage;

test("chat is room-scoped, attributed to the current name, persisted before delivery, and separate from DOCX", async () => {
  const app = await fixture();
  try {
    const roomId = await app.create(),
      otherRoom = await app.create();
    const { client: alice } = await app.join(roomId, "alice", "Alice");
    const { client: bob } = await app.join(roomId, "bob", "Bob");
    const { client: outsider } = await app.join(otherRoom, "outsider");
    const before = app.store.get(roomId).bytes;
    alice.send({
      type: "chat",
      messageId: "hello",
      text: "  Hello, room!\nSecond line.  ",
      name: "  Alice Renamed\u0000  ",
    });
    const event = await alice.next("chat");
    assert.deepEqual(event, await bob.next("chat"));
    assert.deepEqual(
      { ...sent(event), sentAt: undefined },
      {
        id: "hello",
        clientId: "alice",
        name: "Alice Renamed",
        text: "Hello, room!\nSecond line.",
        sentAt: undefined,
      },
    );
    assert.ok(Number.isFinite(Date.parse(sent(event).sentAt)));
    const record = JSON.parse(await readFile(path.join(app.directory, `${roomId}.json`), "utf8"));
    assert.deepEqual(record.chat, [sent(event)], "the message is on disk before recipients see it");
    assert.equal(app.store.get(roomId).seq, 0);
    assert.deepEqual(app.store.get(roomId).bytes, before);
    const downloaded = await (
      await fetch(`${app.origin}/api/rooms/${roomId}/download`)
    ).arrayBuffer();
    assert.deepEqual(Buffer.from(downloaded), before);
    assert.equal(
      outsider.messages.some((message) => message.type === "chat"),
      false,
    );
    const later = await app.join(roomId, "carol");
    assert.deepEqual(later.history.messages, [sent(event)]);
    assert.deepEqual((await app.join(otherRoom, "dave")).history.messages, []);
  } finally {
    await app.cleanup();
  }
});

test("chat retries deduplicate by client and message ID across reconnects and server restart", async () => {
  const app = await fixture();
  let restarted: Awaited<ReturnType<typeof start>> | undefined;
  try {
    const roomId = await app.create();
    const { client: alice } = await app.join(roomId, "alice");
    const { client: bob } = await app.join(roomId, "bob");
    const original = { type: "chat", messageId: "retry-id", text: "Delivered once." };
    alice.send(original);
    alice.send(original);
    const first = await alice.next("chat");
    assert.deepEqual(await alice.next("chat"), first);
    assert.deepEqual(await bob.next("chat"), first);
    assert.equal(bob.messages.filter((message) => message.type === "chat").length, 0);
    alice.socket.terminate();
    const resumed = await app.join(roomId, "alice", "New Alice", 0);
    assert.deepEqual(resumed.history.messages, [sent(first)]);
    resumed.client.send({
      ...original,
      text: "A retry cannot rewrite history.",
      name: "New Alice",
    });
    assert.deepEqual(await resumed.client.next("chat"), first);
    bob.send({ ...original, text: "Same ID from another writer is a separate message." });
    assert.equal(sent(await bob.next("chat")).clientId, "bob");
    assert.equal(app.store.get(roomId).record.chat.length, 2);
    await app.close();
    restarted = await start(app.directory);
    const afterRestart = await restarted.join(roomId, "alice", "New Alice", 0);
    assert.equal(afterRestart.history.messages?.length, 2);
    afterRestart.client.send(original);
    assert.deepEqual(await afterRestart.client.next("chat"), first);
    assert.equal(restarted.store.get(roomId).record.chat.length, 2);
    assert.equal(restarted.store.get(roomId).seq, 0);
  } finally {
    await restarted?.close();
    await app.cleanup();
  }
});

test("invalid chat and rate limits preserve the socket and subsequent document edits", async () => {
  const app = await fixture();
  try {
    const roomId = await app.create();
    const { client, snapshot } = await app.join(roomId, "alice");
    for (const invalid of [
      { messageId: "blank", text: "  \n\t" },
      { messageId: "long", text: "x".repeat(2001) },
      { messageId: "wrong-name", text: "Text", name: 4 },
      { messageId: "bad/id", text: "Text" },
    ]) {
      client.send({ type: "chat", ...invalid });
      assert.equal((await client.next("chatError")).messageId, invalid.messageId);
      assert.equal(client.socket.readyState, WebSocket.OPEN);
    }
    for (let i = 0; i < 10; i++) {
      client.send({
        type: "chat",
        messageId: `burst-${i}`,
        text: i === 0 ? "x".repeat(2000) : `Message ${i}`,
      });
      assert.equal(sent(await client.next("chat")).id, `burst-${i}`);
    }
    client.send({ type: "chat", messageId: "rate-limit", text: "Please slow down." });
    assert.match(String((await client.next("chatError")).message), /wait/i);
    client.send({ type: "chat", messageId: "burst-0", text: "Retry is exempt from rate limit." });
    assert.equal(sent(await client.next("chat")).text, "x".repeat(2000));
    const replica = await SessionReplica.start(
      await DocxSession.fromBytes(Buffer.from(snapshot.bytes!, "base64")),
      0,
      (bytes) => DocxSession.fromBytes(bytes),
      snapshot.block,
    );
    WordDocument.from(replica.session).body.paragraphs.items[0].insertText(
      "Document still works.",
      "Start",
    );
    client.send({ type: "submit", opId: "still-editing", base: 0, change: await replica.commit() });
    assert.equal((await client.next("change")).seq, 1);
    assert.equal(app.store.get(roomId).record.chat.length, 10);
    assert.equal(client.socket.readyState, WebSocket.OPEN);
  } finally {
    await app.cleanup();
  }
});

test("typing is transient, room-scoped, excludes self, and clears on stop, send, disconnect and timeout", async () => {
  const app = await fixture();
  try {
    const roomId = await app.create(),
      otherRoom = await app.create();
    const { client: alice } = await app.join(roomId, "alice");
    const { client: bob } = await app.join(roomId, "bob");
    const { client: outsider } = await app.join(otherRoom, "outsider");
    alice.messages.length = bob.messages.length = outsider.messages.length = 0;
    alice.send({ type: "typing", active: true, name: "Alice Typing" });
    assert.deepEqual((await bob.next("typing", (message) => !!message.peers?.length)).peers, [
      { id: "alice", name: "Alice Typing" },
    ]);
    assert.deepEqual((await alice.next("typing")).peers, []);
    assert.equal(
      outsider.messages.some(
        (message) =>
          message.type === "typing" && message.peers?.some((peer) => peer.id === "alice"),
      ),
      false,
    );
    bob.messages.length = 0;
    alice.send({ type: "typing", active: false });
    assert.deepEqual((await bob.next("typing", (message) => !message.peers?.length)).peers, []);

    bob.send({ type: "typing", active: true });
    await alice.next("typing", (message) => !!message.peers?.length);
    alice.messages.length = 0;
    bob.send({ type: "chat", messageId: "send-clears-typing", text: "Finished typing." });
    await alice.next("chat");
    assert.deepEqual((await alice.next("typing", (message) => !message.peers?.length)).peers, []);
    const { client: carol } = await app.join(roomId, "carol");
    alice.messages.length = 0;
    carol.send({ type: "typing", active: true });
    await alice.next(
      "typing",
      (message) => message.peers?.some((peer) => peer.id === "carol") ?? false,
    );
    alice.messages.length = 0;
    carol.socket.terminate();
    assert.deepEqual((await alice.next("typing", (message) => !message.peers?.length)).peers, []);

    const { client: dave } = await app.join(roomId, "dave");
    alice.messages.length = 0;
    dave.send({ type: "typing", active: true });
    await alice.next(
      "typing",
      (message) => message.peers?.some((peer) => peer.id === "dave") ?? false,
    );
    alice.messages.length = 0;
    const began = Date.now();
    await alice.next("typing", (message) => !message.peers?.length);
    assert.ok(Date.now() - began >= 4500, "typing should expire around the five-second TTL");
    const saved = JSON.parse(await readFile(path.join(app.directory, `${roomId}.json`), "utf8"));
    assert.equal("typing" in saved, false);
    assert.equal(app.store.get(roomId).seq, 0);
  } finally {
    await app.cleanup();
  }
});

test("only 200 chat bodies are retained, pruned IDs cannot repost, and old rooms migrate without DOCX changes", async () => {
  const app = await fixture();
  let restarted: Awaited<ReturnType<typeof start>> | undefined;
  try {
    const roomId = await app.create();
    const filename = path.join(app.directory, `${roomId}.json`);
    const original = JSON.parse(await readFile(filename, "utf8"));
    delete original.chat;
    delete original.chatReceipts;
    await app.close();
    await writeFile(filename, JSON.stringify(original));
    restarted = await start(app.directory);
    const room = restarted.store.get(roomId);
    assert.equal(room.record.chat.length, 0);
    for (let i = 0; i < 202; i++)
      await room.run(() =>
        room.addChat(`writer-${i}`, `message-${i}`, "Synthetic Writer", `Synthetic message ${i}`),
      );
    assert.equal(room.record.chat.length, 200);
    assert.equal(room.record.chat[0].id, "message-2");
    assert.equal(room.record.chat.at(-1)!.id, "message-201");
    assert.equal(room.record.bytes, original.bytes);
    assert.deepEqual(room.record.history, original.history);
    const reload = new RoomStore(app.directory);
    await reload.init();
    assert.equal(reload.get(roomId).record.chat.length, 200);
    const joined = await restarted.join(roomId, "writer-0");
    assert.equal(joined.history.messages?.length, 200);
    joined.client.send({
      type: "chat",
      messageId: "message-0",
      text: "An ancient retry must not repost.",
    });
    assert.match(String((await joined.client.next("chatError")).message), /already delivered/);
    assert.equal(room.record.chat.length, 200);
    assert.equal(joined.client.socket.readyState, WebSocket.OPEN);
    assert.equal(
      JSON.stringify(room.record).includes('Synthetic message 0"'),
      false,
      "pruned message text is gone, only its receipt remains",
    );
  } finally {
    await restarted?.close();
    await app.cleanup();
  }
});

test("a failed chat save does not publish or consume its ID, and retry succeeds without reconnecting", async () => {
  const app = await fixture();
  const moved = path.join(app.temporary, "rooms-moved");
  let displaced = false;
  try {
    const roomId = await app.create();
    const { client: alice } = await app.join(roomId, "alice");
    const { client: bob } = await app.join(roomId, "bob");
    await rename(app.directory, moved);
    displaced = true;
    const message = {
      type: "chat",
      messageId: "save-retry",
      text: "Only publish after persistence.",
    };
    alice.send(message);
    await alice.next("chatError");
    assert.equal(app.store.get(roomId).record.chat.length, 0);
    assert.equal(
      bob.messages.some((event) => event.type === "chat"),
      false,
    );
    assert.equal(alice.socket.readyState, WebSocket.OPEN);
    await rename(moved, app.directory);
    displaced = false;
    alice.send(message);
    const event = await alice.next("chat");
    assert.deepEqual(await bob.next("chat"), event);
    assert.equal(app.store.get(roomId).record.chat.length, 1);
  } finally {
    if (displaced) await rename(moved, app.directory);
    await app.cleanup();
  }
});
