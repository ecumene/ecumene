import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { LanguageModelV4GenerateResult } from "@ai-sdk/provider";
import { WordDocument } from "@reductoai/docx/officejs";
import { MockLanguageModelV4 } from "ai/test";
import JSZip from "jszip";
import WebSocket from "ws";

import { createAppServer } from "../server/app.ts";
import { coworkerMessages, createCoworker } from "../server/coworker.ts";

const result = (
  content: LanguageModelV4GenerateResult["content"],
): LanguageModelV4GenerateResult => ({
  content,
  finishReason: {
    unified: content.some((part) => part.type === "tool-call") ? "tool-calls" : "stop",
    raw: undefined,
  },
  usage: {
    inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 1, text: 1, reasoning: 0 },
  },
  warnings: [],
});
const text = (value: string) => result([{ type: "text", text: value }]);
const call = (name: string, input: unknown, id: string) =>
  result([{ type: "tool-call", toolCallId: id, toolName: name, input: JSON.stringify(input) }]);

type Wire = Record<string, any>;
class Client {
  messages: Wire[] = [];
  constructor(readonly socket: WebSocket) {
    socket.on("message", (data) => this.messages.push(JSON.parse(String(data))));
  }
  send(data: unknown) {
    this.socket.send(JSON.stringify(data));
  }
  async next(type: string, predicate: (message: Wire) => boolean = () => true) {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const i = this.messages.findIndex((message) => message.type === type && predicate(message));
      if (i >= 0) return this.messages.splice(i, 1)[0];
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`No ${type}: ${JSON.stringify(this.messages)}`);
  }
}
async function fixture(model?: MockLanguageModelV4) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "xp-coworker-"));
  const app = await createAppServer({ dataDir: directory, agentModel: model });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const seed = await WordDocument.create();
  seed.body.paragraphs.items[0].insertText("Original clause.", "Replace");
  const room = await app.store.create("Synthetic.docx", await seed.toBytes());
  return {
    ...app,
    room,
    base,
    async join(id: string) {
      const socket = new WebSocket(base.replace("http:", "ws:") + "/collab");
      const client = new Client(socket);
      await once(socket, "open");
      client.send({ type: "join", roomId: room.record.id, clientId: id, name: id });
      return client;
    },
    async cleanup() {
      await app.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("Vercel agent reads, edits, verifies and broadcasts tracked Clippy changes to the room", async () => {
  const model = new MockLanguageModelV4({
    doGenerate: [
      call("read_document", {}, "read"),
      call(
        "apply_document_edits",
        {
          expectedSeq: 0,
          operations: [
            {
              op: "replace_text",
              anchor: { text: "Original clause." },
              replacement: "Revised clause.",
            },
          ],
        },
        "edit",
      ),
      call("read_document", {}, "verify"),
      text("Revised the clause with tracked changes."),
    ],
  });
  const app = await fixture(model);
  try {
    const alice = await app.join("alice"),
      bob = await app.join("bob");
    await alice.next("snapshot");
    await bob.next("snapshot");
    alice.send({ type: "chat", messageId: "request", text: "@Clippy revise the clause" });
    assert.equal((await bob.next("change")).clientId, "clippy");
    assert.ok(
      (await bob.next("peers", (event) => event.peers.some((peer: Wire) => peer.id === "clippy")))
        .peers.length,
    );
    const reply = await alice.next("chat", (event) => event.message.role === "assistant");
    assert.match(reply.message.text, /Revised/);
    await bob.next("agentState", (event) => event.agent.status === "completed");
    assert.equal(app.room.seq, 1);
    assert.equal(app.room.record.agentTools.length, 3);
    const xml = await (
      await JSZip.loadAsync(app.room.bytes)
    )
      .file("word/document.xml")!
      .async("string");
    assert.match(xml, /w:ins[^>]*w:author=['"]Clippy['"]/);
    assert.match(xml, /Revised clause/);
    assert.match(JSON.stringify(model.doGenerateCalls[2].prompt), /changed/);
    alice.send({ type: "chat", messageId: "request", text: "@Clippy revise the clause" });
    await alice.next("chat", (event) => event.message.id === "request");
    assert.equal(
      app.room.record.agentGeneration,
      1,
      "duplicate delivery must not run the task twice",
    );
    const reserved = await app.join("clippy");
    assert.equal((await reserved.next("error")).code, "RESERVED_ID");
  } finally {
    await app.cleanup();
  }
});

test("repeated scheduling while a claim is queued does not abort the same run", async () => {
  const model = new MockLanguageModelV4({ doGenerate: text("Ready.") });
  const app = await fixture();
  const coworker = createCoworker({
    store: app.store,
    model,
    broadcast: () => {},
    presenceChanged: () => {},
  });
  try {
    await app.room.run(() => app.room.addChat("alice", "schedule", "Alice", "@Clippy hello"));
    coworker.changed(app.room);
    coworker.changed(app.room);
    const deadline = Date.now() + 5000;
    while (app.room.record.agent?.status !== "completed" && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(app.room.record.agent?.status, "completed");
    assert.equal(model.doGenerateCalls.length, 1);
  } finally {
    await coworker.close();
    await app.cleanup();
  }
});

test("another participant can steer and stop; stale Stop cannot cancel a newer task", async () => {
  let calls = 0;
  const model = new MockLanguageModelV4({
    doGenerate: async (options) => {
      calls++;
      if (calls === 1 || calls === 3)
        return new Promise((_resolve, reject) => {
          options.abortSignal?.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        });
      return text("Following Bob’s new direction.");
    },
  });
  const app = await fixture(model);
  try {
    const alice = await app.join("alice"),
      bob = await app.join("bob");
    await alice.next("snapshot");
    await bob.next("snapshot");
    alice.send({ type: "chat", messageId: "first", text: "@Clippy first task" });
    await alice.next(
      "agentState",
      (event) => event.agent.activity === "Thinking about the next step…",
    );
    bob.send({ type: "chat", messageId: "steer", text: "@Clippy instead summarize; do not edit" });
    bob.send({ type: "agentStop", runId: "clippy-1" });
    const done = await bob.next("agentState", (event) => event.agent.status === "completed");
    assert.equal(done.agent.runId, "clippy-2");
    assert.equal(done.agent.requestedBy, "bob");
    assert.equal(app.room.record.agentHistory[0].status, "superseded");
    assert.equal(app.room.seq, 0);
    alice.send({ type: "chat", messageId: "third", text: "@Clippy another task" });
    await alice.next(
      "agentState",
      (event) =>
        event.agent.runId === "clippy-3" &&
        event.agent.activity === "Thinking about the next step…",
    );
    bob.send({ type: "agentStop", runId: "clippy-3" });
    await alice.next("agentState", (event) => event.agent.status === "cancelled");
    assert.equal(app.room.seq, 0);
    assert.equal(
      app.room.record.chat.filter((message) => message.text.includes("Following Bob")).length,
      1,
    );
  } finally {
    await app.cleanup();
  }
});

test("missing configuration is visible and conversation projection does not promote a human named Clippy", async () => {
  const app = await fixture();
  try {
    const alice = await app.join("alice");
    await alice.next("snapshot");
    assert.equal((await alice.next("agentState")).agent.status, "unavailable");
    alice.send({ type: "chat", messageId: "help", text: "@Clippy help", name: "Clippy" });
    const reply = await alice.next("chat", (event) => event.message.role === "assistant");
    assert.match(reply.message.text, /not configured/);
    const messages = coworkerMessages(
      app.room.record.chat,
      app.room.record.agent!,
      [],
      "Synthetic.docx",
      0,
    );
    assert.equal(messages[0].role, "user");
    assert.match(JSON.stringify(messages[0].content), /Clippy/);
  } finally {
    await app.cleanup();
  }
});
