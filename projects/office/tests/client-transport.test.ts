import assert from "node:assert/strict";
import test from "node:test";

import type { EditorModel } from "@reductoai/docx-editor/model";

import type { AgentState, ChatState } from "../src/chat-types.ts";
import { connectRoom, type Connection } from "../src/collaboration.ts";

class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 0;
  sent: any[] = [];
  onopen?: () => void;
  onclose?: () => void;
  onmessage?: (event: { data: string }) => void;
  constructor(public url: URL) {
    Socket.instances.push(this);
  }
  send(value: string) {
    this.sent.push(JSON.parse(value));
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(value: unknown) {
    this.onmessage?.({ data: JSON.stringify(value) });
  }
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
async function until(check: () => boolean) {
  const end = Date.now() + 2000;
  while (!check()) {
    assert.ok(Date.now() < end, "Condition timed out");
    await tick();
  }
}
function setup(open = async () => true) {
  Socket.instances = [];
  Object.defineProperty(globalThis, "WebSocket", { value: Socket, configurable: true });
  Object.defineProperty(globalThis, "location", {
    value: { href: "http://localhost:3000/?room=example", protocol: "http:" },
    configurable: true,
  });
  let options: any;
  let pending: any;
  const calls: any[] = [];
  const model = {
    readOnly: false,
    open,
    setRevisionAuthor: (name: string) => calls.push(["author", name]),
    startCollab: async (value: any) => {
      options = value;
    },
    collabPeers: (peers: unknown) => calls.push(["peers", peers]),
    collabAck: (seq: number) => {
      pending = undefined;
      calls.push(["ack", seq]);
    },
    collabRemote: (change: unknown, seq: number) => calls.push(["remote", seq, change]),
    collabResend: () => {
      if (pending) options.send(pending);
    },
  };
  const states: Connection[] = [];
  const chats: ChatState[] = [];
  const client = connectRoom(
    model as unknown as EditorModel,
    "example",
    "Alice",
    (state) => states.push(state),
    (chat) => chats.push(chat),
  );
  return {
    model,
    client,
    calls,
    states,
    chats,
    options: () => options,
    edit(out: unknown) {
      pending = out;
      options.send(out);
    },
  };
}
const snapshot = {
  type: "snapshot",
  roomId: "example",
  name: "Example.docx",
  block: 7,
  seq: 0,
  bytes: btoa("synthetic"),
  peers: [],
};

test("transport keeps operation identity through reconnect and paints peer selections", async () => {
  const t = setup();
  try {
    const first = Socket.instances[0];
    first.open();
    first.receive(snapshot);
    await until(() => t.states.at(-1)?.status === "online");
    assert.equal(t.options().block, 7);
    const clientId = first.sent[0].clientId;
    t.edit({ base: 0, change: { body: [{ i: [{ k: "c", v: "A", a: {} }] }] } });
    const original = first.sent.find((x) => x.type === "submit");
    first.close();
    await until(() => Socket.instances.length === 2);
    const resumed = Socket.instances[1];
    resumed.open();
    assert.equal(resumed.sent[0].afterSeq, 0);
    resumed.receive({ type: "ready", seq: 0, block: 7, peers: [] });
    await until(() => resumed.sent.some((x) => x.type === "submit"));
    assert.equal(resumed.sent.find((x) => x.type === "submit").opId, original.opId);
    resumed.receive({
      type: "change",
      seq: 1,
      clientId,
      opId: original.opId,
      change: original.change,
    });
    resumed.receive({
      type: "change",
      seq: 1,
      clientId,
      opId: original.opId,
      change: original.change,
    });
    resumed.receive({ type: "change", seq: 2, clientId: "bob", opId: "b1", change: {} });
    const peers = [{ id: "bob", name: "Bob", presence: { seq: 2, anchor: 1, focus: 4 } }];
    resumed.receive({ type: "peers", peers });
    await until(() => t.states.at(-1)?.seq === 2 && t.states.at(-1)?.peers.length === 1);
    assert.deepEqual(
      t.calls.filter((x) => x[0] === "ack"),
      [["ack", 1]],
    );
    assert.equal(t.calls.filter((x) => x[0] === "remote").length, 1);
    assert.deepEqual(t.calls.filter((x) => x[0] === "peers").at(-1), ["peers", peers]);
    assert.equal(t.states.at(-1)?.pending, false);
    t.options().presence({ seq: 2, anchor: 2, focus: 5 });
    assert.deepEqual(resumed.sent.at(-1), {
      type: "presence",
      presence: { seq: 2, anchor: 2, focus: 5 },
      name: "Alice",
    });
  } finally {
    t.client.destroy();
  }
});

test("disconnect while opening waits for the snapshot before choosing resume sequence", async () => {
  let finish!: (value: boolean) => void;
  const opening = new Promise<boolean>((resolve) => {
    finish = resolve;
  });
  const t = setup(() => opening);
  try {
    const first = Socket.instances[0];
    first.open();
    first.receive({ ...snapshot, seq: 12 });
    await until(() => t.states.at(-1)?.status === "opening");
    first.close();
    await tick();
    assert.equal(Socket.instances.length, 1);
    finish(true);
    await until(() => Socket.instances.length === 2);
    const resumed = Socket.instances[1];
    resumed.open();
    assert.equal(resumed.sent[0].afterSeq, 12);
    assert.equal(t.model.readOnly, true);
  } finally {
    t.client.destroy();
  }
});

test("a sequence gap locks editing without reopening or discarding the local document", async () => {
  const t = setup();
  try {
    const socket = Socket.instances[0];
    socket.open();
    socket.receive(snapshot);
    await until(() => t.states.at(-1)?.status === "online");
    socket.receive({ type: "change", seq: 3, clientId: "bob", opId: "b1", change: {} });
    await until(() => t.states.at(-1)?.status === "error");
    assert.equal(t.model.readOnly, true);
    assert.match(t.states.at(-1)?.message || "", /missing/);
    assert.equal(t.calls.filter((x) => x[0] === "remote").length, 0);
  } finally {
    t.client.destroy();
  }
});

test("chat survives reconnect with stable IDs and does not enter document history", async () => {
  const t = setup();
  try {
    const first = Socket.instances[0];
    first.open();
    first.receive(snapshot);
    first.receive({ type: "chatHistory", messages: [] });
    await until(() => t.states.at(-1)?.status === "online" && t.chats.length > 0);
    t.client.rename("Alice Chat");
    assert.equal(t.client.sendChat("Hello from Alice"), true);
    const sent = first.sent.find((x) => x.type === "chat");
    assert.equal(sent.name, "Alice Chat");
    assert.deepEqual(t.chats.at(-1)?.pendingIds, [sent.messageId]);
    t.client.setTyping(true);
    assert.equal(first.sent.at(-1).type, "typing");
    first.close();
    await until(() => t.states.at(-1)?.status === "offline");
    assert.equal(t.client.sendChat("Keep this unsent draft"), false);
    await until(() => Socket.instances.length === 2);
    const second = Socket.instances[1];
    second.open();
    second.receive({ type: "ready", seq: 0, block: 7, peers: [] });
    second.receive({ type: "chatHistory", messages: [] });
    await until(() => second.sent.some((x) => x.type === "chat"));
    assert.equal(second.sent.find((x) => x.type === "chat").messageId, sent.messageId);
    const entry = {
      id: sent.messageId,
      clientId: first.sent[0].clientId,
      name: sent.name,
      text: sent.text,
      sentAt: new Date().toISOString(),
    };
    second.receive({ type: "chat", message: entry });
    second.receive({ type: "chat", message: entry });
    second.receive({ type: "typing", peers: [{ id: "bob", name: "Bob" }] });
    await until(
      () => t.chats.at(-1)?.pendingIds.length === 0 && t.chats.at(-1)?.typing.length === 1,
    );
    assert.equal(t.chats.at(-1)?.messages.length, 1);
    assert.equal(t.states.at(-1)?.seq, 0);
    assert.equal(t.calls.filter((x) => x[0] === "remote" || x[0] === "ack").length, 0);
    assert.equal(t.client.sendChat("A rejected message"), true);
    const last = second.sent.filter((x) => x.type === "chat").at(-1);
    second.receive({ type: "chatError", messageId: last.messageId, message: "Slow down." });
    await until(() => t.chats.at(-1)?.error?.includes("A rejected message") === true);
    assert.equal(t.chats.at(-1)?.pendingIds.length, 0);
    assert.equal(t.states.at(-1)?.status, "online");
  } finally {
    t.client.destroy();
  }
});

test("reconnect history acknowledges delivered chat before considering a retry", async () => {
  const t = setup();
  try {
    const socket = Socket.instances[0];
    socket.open();
    socket.receive(snapshot);
    await until(() => t.states.at(-1)?.status === "online");
    t.client.sendChat("Already delivered");
    const message = socket.sent.find((x) => x.type === "chat");
    const accepted = {
      id: message.messageId,
      clientId: socket.sent[0].clientId,
      name: "Alice",
      text: message.text,
      sentAt: new Date().toISOString(),
    };
    socket.receive({ type: "chatHistory", messages: [accepted] });
    await until(() => t.chats.at(-1)?.pendingIds.length === 0);
    assert.equal(socket.sent.filter((x) => x.type === "chat").length, 1);
    assert.deepEqual(t.chats.at(-1)?.messages, [accepted]);
  } finally {
    t.client.destroy();
  }
});

test("Clippy state resets on disconnect, resumes from the server, and Stop targets the current run only", async () => {
  const t = setup();
  const idle: AgentState = {
    status: "idle",
    runId: null,
    activity: "Ready for a task",
    requestedBy: null,
    model: "claude-sonnet-5-5",
  };
  const working: AgentState = {
    ...idle,
    status: "working",
    runId: "run-one",
    activity: "Reading the document",
    requestedBy: "Bob",
  };
  try {
    assert.equal(t.client.stopAgent("run-one"), false);
    const first = Socket.instances[0];
    first.open();
    first.receive(snapshot);
    first.receive({ type: "agentState", agent: idle });
    await until(
      () => t.states.at(-1)?.status === "online" && t.chats.at(-1)?.agent?.status === "idle",
    );
    assert.equal(t.client.stopAgent("run-one"), false);
    first.receive({ type: "agentState", agent: working });
    await until(() => t.chats.at(-1)?.agent?.runId === "run-one");
    assert.equal(t.client.stopAgent("a-stale-run"), false);
    assert.equal(first.sent.filter((message) => message.type === "agentStop").length, 0);
    // Anyone in the room may stop a run; Alice need not be its requester Bob.
    assert.equal(t.client.stopAgent("run-one"), true);
    assert.deepEqual(first.sent.at(-1), { type: "agentStop", runId: "run-one" });
    assert.equal(
      t.chats.at(-1)?.agent?.status,
      "working",
      "Stop is a request, not an invented completion",
    );
    first.close();
    await until(() => t.states.at(-1)?.status === "offline");
    assert.equal(
      t.chats.at(-1)?.agent,
      null,
      "Do not keep displaying stale progress after disconnect",
    );
    assert.equal(t.client.stopAgent("run-one"), false);
    await until(() => Socket.instances.length === 2);
    const resumed = Socket.instances[1];
    resumed.open();
    const next = {
      ...working,
      runId: "run-two",
      activity: "Updating a paragraph",
      requestedBy: "Carol",
    };
    resumed.receive({ type: "agentState", agent: next });
    await until(() => t.chats.at(-1)?.agent?.runId === "run-two");
    assert.equal(
      t.client.stopAgent("run-two"),
      false,
      "Wait for document resume before enabling controls",
    );
    resumed.receive({ type: "ready", seq: 0, block: 7, peers: [] });
    await until(() => t.states.at(-1)?.status === "online");
    assert.equal(t.client.stopAgent("run-one"), false);
    assert.equal(t.client.stopAgent("run-two"), true);
    assert.deepEqual(resumed.sent.at(-1), { type: "agentStop", runId: "run-two" });
    resumed.receive({
      type: "agentState",
      agent: { ...next, status: "cancelled", activity: "Stopped by Alice" },
    });
    await until(() => t.chats.at(-1)?.agent?.status === "cancelled");
    assert.equal(t.client.stopAgent("run-two"), false);
    assert.equal(t.states.at(-1)?.seq, 0);
    assert.ok(
      t.calls.filter((call) => call[0] === "peers").every((call) => call[1].length === 0),
      "Idle bot state must not invent a document selection",
    );
  } finally {
    t.client.destroy();
  }
});

test("assistant attribution and bot typing remain distinct from a human named Clippy", async () => {
  const t = setup();
  try {
    const socket = Socket.instances[0];
    socket.open();
    socket.receive(snapshot);
    await until(() => t.states.at(-1)?.status === "online");
    const base = {
      id: "message-one",
      name: "Clippy",
      text: "A message",
      sentAt: "2026-10-28T12:00:00Z",
    };
    const assistant = { ...base, clientId: "clippy", role: "assistant" as const };
    const human = { ...base, clientId: "human-named-clippy" };
    socket.receive({ type: "chatHistory", messages: [assistant, human] });
    socket.receive({ type: "chat", message: assistant });
    socket.receive({ type: "typing", peers: [{ id: "clippy", name: "Clippy" }] });
    await until(() => t.chats.at(-1)?.typing.length === 1);
    assert.deepEqual(t.chats.at(-1)?.messages, [assistant, human]);
    assert.deepEqual(t.chats.at(-1)?.typing, [{ id: "clippy", name: "Clippy" }]);
    assert.equal(t.client.sendChat("@Clippy please review this paragraph"), true);
    const sent = socket.sent.find((message) => message.type === "chat");
    assert.equal(sent.name, "Alice");
    assert.equal(sent.role, undefined, "Browser chat never assigns assistant attribution");
    assert.equal(t.chats.at(-1)?.messages.at(-1)?.role, undefined);
    assert.equal(t.calls.filter((call) => call[0] === "remote" || call[0] === "ack").length, 0);
  } finally {
    t.client.destroy();
  }
});
