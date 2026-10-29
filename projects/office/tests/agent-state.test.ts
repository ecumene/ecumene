import assert from "node:assert/strict";
import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { DocxSession, SessionReplica } from "@reductoai/docx/editor";
import { WordDocument } from "@reductoai/docx/officejs";

import { parseMessage } from "../server/protocol.ts";
import { RoomStore, welcomeBytes, type Room } from "../server/rooms.ts";
import { AGENT_CLIENT_ID } from "../shared/agent.ts";

async function fixture() {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "wordpad-agent-state-"));
  const directory = path.join(temporary, "rooms");
  const store = new RoomStore(directory);
  await store.init();
  const room = await store.create("Synthetic.docx", await welcomeBytes(true));
  return {
    temporary,
    directory,
    store,
    room,
    cleanup: () => rm(temporary, { recursive: true, force: true }),
  };
}

async function request(
  room: Room,
  id = "request-1",
  text = "@Clippy add a heading",
  clientId = "alice",
  name = "Alice",
) {
  return room.run(() => room.addChat(clientId, id, name, text));
}

async function edit(room: Room, text: string) {
  const replica = await SessionReplica.start(
    await DocxSession.fromBytes(room.bytes),
    room.seq,
    (bytes) => DocxSession.fromBytes(bytes),
  );
  WordDocument.from(replica.session).body.paragraphs.items[0].insertText(text, "End");
  const change = await replica.commit();
  assert.ok(change);
  return change;
}

test("chat acceptance and exclusive agent claim are durable and duplicate requests do not restart work", async () => {
  const f = await fixture();
  try {
    assert.equal(f.room.agentState("test-model").status, "idle");
    const accepted = await request(f.room);
    assert.equal(accepted.agentChanged, true);
    const runId = f.room.record.agent!.runId;
    const disk = JSON.parse(
      await readFile(path.join(f.directory, `${f.room.record.id}.json`), "utf8"),
    );
    assert.equal(disk.chat[0].id, "request-1");
    assert.equal(disk.agent.runId, runId);
    assert.equal(disk.agent.status, "queued");
    assert.deepEqual(await request(f.room), { message: accepted.message, duplicate: true });
    assert.equal(f.room.record.agentGeneration, 1);
    const claims = await Promise.all([
      f.room.run(() => f.room.claimAgent(runId, "test-model")),
      f.room.run(() => f.room.claimAgent(runId, "test-model")),
    ]);
    assert.deepEqual(claims, [true, false]);
    assert.equal(f.room.isAgentCurrent(runId), true);
    assert.deepEqual(f.room.agentState("fallback"), {
      status: "working",
      runId,
      activity: "Reading the document and group chat…",
      requestedBy: "Alice",
      model: "test-model",
    });
    await request(f.room, "ordinary", "Just discussing the draft.");
    assert.equal(f.room.record.agent!.runId, runId);
    assert.equal(parseMessage('{"type":"agentStop","runId":"clippy-1"}').type, "agentStop");
    const untrusted = parseMessage(
      '{"type":"chat","messageId":"role-test","text":"Hello","role":"assistant"}',
    );
    assert.equal("role" in untrusted, false, "human chat cannot acquire the assistant badge");
  } finally {
    await f.cleanup();
  }
});

test("queued steering fences every stale worker write and a stale stop cannot cancel the newer request", async () => {
  const f = await fixture();
  try {
    await request(f.room);
    const oldRun = f.room.record.agent!.runId;
    await f.room.run(() => f.room.claimAgent(oldRun, "test-model"));
    const oldChange = await edit(f.room, "Old plan");
    // Queue steering first: the stale edit must recheck ownership when its turn arrives.
    const steering = request(
      f.room,
      "steer-1",
      "@clippy make it a short paragraph instead",
      "bob",
      "Bob",
    );
    const staleEdit = f.room.run(() => f.room.submitAgent(oldRun, "tool-1", 0, oldChange));
    assert.equal((await steering).agentChanged, true);
    assert.deepEqual(await staleEdit, { stale: true });
    const current = f.room.record.agent!.runId;
    assert.notEqual(current, oldRun);
    assert.equal(f.room.record.agentHistory.at(-1)!.status, "superseded");
    assert.equal(f.room.record.agentHistory.at(-1)!.instruction, "add a heading");
    assert.equal(f.room.record.agent!.requestedBy.name, "Bob");
    assert.equal(await f.room.run(() => f.room.progressAgent(oldRun, "Stale progress")), false);
    assert.equal(
      await f.room.run(() =>
        f.room.recordAgentTool(oldRun, { toolCallId: "late", toolName: "read", result: "stale" }),
      ),
      false,
    );
    assert.equal(
      await f.room.run(() => f.room.postAgentMessage(oldRun, "late-chat", "Stale reply")),
      null,
    );
    assert.deepEqual(
      await f.room.run(() => f.room.finishAgent(oldRun, "completed", "Stale finish", "Done")),
      { changed: false },
    );
    assert.deepEqual(
      await f.room.run(() => f.room.stopAgent(oldRun, { clientId: "alice", name: "Alice" })),
      { changed: false },
    );
    assert.equal(f.room.record.agent!.status, "queued");
    assert.equal(f.room.seq, 0);
    assert.equal(await f.room.run(() => f.room.claimAgent(current, "test-model")), true);
    assert.equal(
      await f.room.run(() => f.room.progressAgent(current, "Reading the new request")),
      true,
    );
  } finally {
    await f.cleanup();
  }
});

test("agent edits require the current snapshot, deduplicate stable tool IDs and namespace IDs across runs", async () => {
  const f = await fixture();
  try {
    await request(f.room);
    const runId = f.room.record.agent!.runId;
    await f.room.run(() => f.room.claimAgent(runId, "test-model"));
    const candidate = await edit(f.room, "Agent stale");
    await f.room.run(() =>
      f.room.submit("human", "human-op", 0, { body: [{ i: [{ k: "c", v: "H", a: { r: "1" } }] }] }),
    );
    assert.deepEqual(await f.room.run(() => f.room.submitAgent(runId, "tool-1", 0, candidate)), {
      stale: true,
    });
    const fresh = await edit(f.room, " Agent one");
    const accepted = await f.room.run(() => f.room.submitAgent(runId, "tool-1", 1, fresh));
    assert.ok("event" in accepted);
    assert.equal(accepted.event.clientId, AGENT_CLIENT_ID);
    assert.equal(accepted.event.seq, 2);
    const repeated = await f.room.run(() => f.room.submitAgent(runId, "tool-1", 1, fresh));
    assert.ok("event" in repeated);
    assert.equal(repeated.duplicate, true);
    assert.deepEqual(repeated.event, accepted.event);
    assert.equal(f.room.seq, 2);
    const finished = await f.room.run(() =>
      f.room.finishAgent(runId, "completed", "Saved one edit", "The edit is saved."),
    );
    assert.equal(finished.changed, true);
    assert.equal(finished.message?.role, "assistant");
    assert.deepEqual(await f.room.run(() => f.room.submitAgent(runId, "tool-late", 2, fresh)), {
      stale: true,
    });
    await request(f.room, "request-2", "@Clippy add another sentence");
    const nextRun = f.room.record.agent!.runId;
    await f.room.run(() => f.room.claimAgent(nextRun, "test-model"));
    const next = await f.room.run(async () =>
      f.room.submitAgent(nextRun, "tool-1", f.room.seq, await edit(f.room, " Agent two")),
    );
    assert.ok("event" in next);
    assert.notEqual(next.event.opId, accepted.event.opId);
    assert.equal(f.room.seq, 3);
    const text = WordDocument.from(await DocxSession.fromBytes(f.room.bytes)).body.paragraphs
      .items[0].text;
    assert.equal(text, "H Agent one Agent two");
  } finally {
    await f.cleanup();
  }
});

test("tool checkpoints are bounded and idempotent; stop commits a notice and blocks later completion", async () => {
  const f = await fixture();
  try {
    await request(f.room);
    const runId = f.room.record.agent!.runId;
    await f.room.run(() => f.room.claimAgent(runId, "test-model"));
    for (let i = 0; i < 22; i++)
      await f.room.run(() =>
        f.room.recordAgentTool(runId, {
          toolCallId: `tool-${i}`,
          toolName: "inspect",
          result: `${i}: ${"x".repeat(13_000)}`,
        }),
      );
    assert.equal(f.room.record.agentTools.length, 20);
    assert.equal(f.room.record.agentTools[0].toolCallId, "tool-2");
    assert.equal(f.room.record.agentTools[0].result.length, 12_000);
    const last = f.room.record.agentTools.at(-1)!;
    await f.room.run(() =>
      f.room.recordAgentTool(runId, {
        toolCallId: last.toolCallId,
        toolName: "inspect",
        result: "duplicate result cannot replace the checkpoint",
      }),
    );
    assert.deepEqual(f.room.record.agentTools.at(-1), last);
    const stop = await request(f.room, "stop-1", "@Clippy stop", "bob", "Bob");
    assert.equal(stop.agentChanged, true);
    assert.equal(stop.agentMessage?.role, "assistant");
    assert.equal(f.room.record.agent!.status, "cancelled");
    assert.equal(f.room.agentState("test-model").status, "cancelled");
    assert.deepEqual(
      await f.room.run(() => f.room.finishAgent(runId, "completed", "Late answer", "Ignored")),
      { changed: false },
    );
    const count = f.room.record.chat.length;
    await request(f.room, "stop-1", "@Clippy stop", "bob", "Bob");
    assert.equal(f.room.record.chat.length, count);
    assert.equal(
      f.room.record.chat.some((message) => message.text === "Ignored"),
      false,
    );
    await request(f.room, "request-again", "@Clippy inspect again");
    const nextRun = f.room.record.agent!.runId;
    const directStop = await f.room.run(() =>
      f.room.stopAgent(nextRun, { clientId: "carol", name: "Carol" }),
    );
    assert.equal(directStop.changed, true, "a queued run can also be stopped");
    assert.equal(await f.room.run(() => f.room.claimAgent(nextRun, "test-model")), false);
  } finally {
    await f.cleanup();
  }
});

test("startup interrupts queued and running work once, preserving committed changes and checkpoints", async () => {
  const f = await fixture();
  try {
    await request(f.room);
    const queuedRun = f.room.record.agent!.runId;
    const reload = new RoomStore(f.directory);
    await reload.init();
    const recovered = reload.get(f.room.record.id);
    assert.equal(recovered.record.agent!.status, "interrupted");
    assert.equal(recovered.record.agent!.runId, queuedRun);
    assert.equal(
      recovered.record.chat.filter((message) => message.id === `${queuedRun}-interrupted`).length,
      1,
    );
    assert.equal(await recovered.run(() => recovered.claimAgent(queuedRun, "test-model")), false);
    await request(recovered, "restart-task", "@Clippy continue");
    const activeRun = recovered.record.agent!.runId;
    await recovered.run(() => recovered.claimAgent(activeRun, "test-model"));
    const change = await edit(recovered, "Saved before restart");
    await recovered.run(() => recovered.submitAgent(activeRun, "saved-tool", 0, change));
    await recovered.run(() =>
      recovered.recordAgentTool(activeRun, {
        toolCallId: "saved-tool",
        toolName: "edit",
        result: "Saved the text.",
      }),
    );
    const afterCrash = new RoomStore(f.directory);
    await afterCrash.init();
    const room = afterCrash.get(f.room.record.id);
    assert.equal(room.record.agent!.status, "interrupted");
    assert.equal(room.seq, 1);
    assert.equal(room.record.agentTools.at(-1)!.toolCallId, "saved-tool");
    assert.equal(
      WordDocument.from(await DocxSession.fromBytes(room.bytes)).body.paragraphs.items[0].text,
      "Saved before restart",
    );
    const anotherRestart = new RoomStore(f.directory);
    await anotherRestart.init();
    assert.equal(
      anotherRestart
        .get(room.record.id)
        .record.chat.filter((message) => message.id === `${activeRun}-interrupted`).length,
      1,
    );
  } finally {
    await f.cleanup();
  }
});

test("a failed persistence attempt does not claim the request or finish the active run, and old rooms migrate", async () => {
  const f = await fixture();
  const displaced = path.join(f.temporary, "displaced");
  let moved = false;
  try {
    const filename = path.join(f.directory, `${f.room.record.id}.json`);
    const original = JSON.parse(await readFile(filename, "utf8"));
    for (const key of ["agent", "agentGeneration", "agentHistory", "agentTools"])
      delete original[key];
    await writeFile(filename, JSON.stringify(original));
    const migrated = new RoomStore(f.directory);
    await migrated.init();
    const room = migrated.get(f.room.record.id);
    assert.equal(room.agentState("test-model").status, "idle");
    await rename(f.directory, displaced);
    moved = true;
    await assert.rejects(request(room));
    assert.equal(room.record.chat.length, 0);
    assert.equal(room.record.agent, null);
    await rename(displaced, f.directory);
    moved = false;
    await request(room);
    const runId = room.record.agent!.runId;
    assert.equal(room.record.agentGeneration, 1);
    await room.run(() => room.claimAgent(runId, "test-model"));
    await rename(f.directory, displaced);
    moved = true;
    await assert.rejects(room.run(() => room.finishAgent(runId, "completed", "Done", "Finished")));
    assert.equal(room.record.agent!.status, "running");
    assert.equal(
      room.record.chat.some((message) => message.text === "Finished"),
      false,
    );
    await rename(displaced, f.directory);
    moved = false;
    assert.equal(
      (await room.run(() => room.finishAgent(runId, "completed", "Done", "Finished"))).changed,
      true,
    );
  } finally {
    if (moved) await rename(displaced, f.directory);
    await f.cleanup();
  }
});
