import assert from "node:assert/strict";
import { renameSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { LanguageModelV4GenerateResult } from "@ai-sdk/provider";
import { MockLanguageModelV4 } from "ai/test";

import { coworkerMessages, createCoworker } from "../server/coworker.ts";
import type { ChatMessage } from "../server/protocol.ts";
import { RoomStore, welcomeBytes } from "../server/rooms.ts";
import type { AgentState } from "../shared/agent.ts";

function response(
  value: string,
  finishReason: LanguageModelV4GenerateResult["finishReason"]["unified"] = "stop",
): LanguageModelV4GenerateResult {
  return {
    content: value ? [{ type: "text", text: value }] : [],
    finishReason: { unified: finishReason, raw: undefined },
    usage: {
      inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 1, text: 1, reasoning: 0 },
    },
    warnings: [],
  };
}

async function until(predicate: () => boolean, message: string, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (!predicate() && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(predicate(), message);
}

type Broadcast = { type?: string; message?: ChatMessage; agent?: AgentState };

async function fixture(model: MockLanguageModelV4) {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "wordpad-coworker-failure-"));
  const directory = path.join(temporary, "rooms"),
    unavailable = path.join(temporary, "unavailable");
  const store = new RoomStore(directory);
  await store.init();
  const room = await store.create("Synthetic.docx", await welcomeBytes(true));
  const events: Broadcast[] = [];
  let failFinalization = false,
    failClaim = false,
    storageUnavailable = false,
    claimAttempts = 0;
  const claimAgent = room.claimAgent.bind(room);
  room.claimAgent = async (...args) => {
    claimAttempts++;
    return claimAgent(...args);
  };
  const coworker = createCoworker({
    store,
    model,
    modelId: "mock-model",
    presenceChanged: () => {},
    broadcast: (_room, event) => {
      const message = event as Broadcast;
      events.push(message);
      if (
        (failClaim && message.type === "agentState" && room.record.agent?.status === "queued") ||
        (failFinalization && message.type === "chat" && message.message?.role === "assistant")
      ) {
        failFinalization = false;
        failClaim = false;
        // Inject the outage after the request/reply saves, before claim/terminal persistence.
        renameSync(directory, unavailable);
        storageUnavailable = true;
      }
    },
  });
  function restoreStorage() {
    if (storageUnavailable) {
      renameSync(unavailable, directory);
      storageUnavailable = false;
    }
  }
  return {
    store,
    room,
    coworker,
    events,
    directory,
    failNextFinalization() {
      failFinalization = true;
    },
    failNextClaim() {
      failClaim = true;
    },
    get claimAttempts() {
      return claimAttempts;
    },
    restoreStorage,
    async request(id: string, instruction: string, clientId = "alice") {
      await room.run(() => room.addChat(clientId, id, clientId, `@Clippy ${instruction}`));
      coworker.changed(room);
      return room.record.agent!.runId;
    },
    async cleanup() {
      restoreStorage();
      await coworker.close();
      await rm(temporary, { recursive: true, force: true });
    },
  };
}

test("a failed claim backs off without calling the model and starts once storage recovers", async () => {
  const model = new MockLanguageModelV4({ doGenerate: response("Ready after recovery.") });
  const app = await fixture(model);
  try {
    app.failNextClaim();
    await app.request("claim", "Check the synthetic document.");
    await until(
      () => app.coworker.state(app.room).status === "failed",
      "a claim save failure must be visible",
    );
    assert.equal(
      app.room.record.agent?.status,
      "queued",
      "a failed claim must not become a running task",
    );
    for (let count = 0; count < 5; count++) app.coworker.changed(app.room);
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(app.claimAttempts, 1, "scheduler notifications must not bypass the retry delay");
    assert.equal(model.doGenerateCalls.length, 0, "the model must wait for a durable claim");
    app.restoreStorage();
    await until(
      () => app.room.record.agent?.status === "completed",
      "the delayed claim should succeed after recovery",
    );
    assert.equal(app.claimAttempts, 2);
    assert.equal(model.doGenerateCalls.length, 1);
    assert.equal(app.coworker.state(app.room).status, "completed");
  } finally {
    await app.cleanup();
  }
});

test("steering an unclaimed task clears its failed-save retry without starting the old task", async () => {
  const model = new MockLanguageModelV4({
    doGenerate: response("Following the replacement task."),
  });
  const app = await fixture(model);
  try {
    app.failNextClaim();
    const oldRunId = await app.request("old-claim", "First request.");
    await until(
      () => app.coworker.state(app.room).status === "failed",
      "the initial claim should fail",
    );
    app.restoreStorage();
    const newRunId = await app.request("new-claim", "Replacement request.", "bob");
    await until(
      () => app.room.record.agent?.status === "completed",
      "the replacement task should complete",
    );
    await new Promise((resolve) => setTimeout(resolve, 1200));
    assert.equal(app.claimAttempts, 2, "the cancelled retry must not try to claim again");
    assert.equal(model.doGenerateCalls.length, 1);
    assert.equal(app.coworker.state(app.room).runId, newRunId);
    assert.equal(app.coworker.state(app.room).status, "completed");
    assert.equal(
      app.room.record.agentHistory.find((run) => run.runId === oldRunId)?.status,
      "superseded",
    );
    assert.match(JSON.stringify(model.doGenerateCalls[0].prompt), /Replacement request/);
  } finally {
    await app.cleanup();
  }
});

test("a failed terminal save reports failure immediately and persists it once storage recovers", async () => {
  const app = await fixture(
    new MockLanguageModelV4({ doGenerate: response("The requested check is complete.") }),
  );
  try {
    app.failNextFinalization();
    const runId = await app.request("request", "Check the synthetic document.");
    await until(
      () => app.coworker.state(app.room).status === "failed",
      "a stopped attempt must not remain publicly working",
    );
    assert.equal(
      app.room.record.agent?.status,
      "running",
      "the failed write must not change durable state in memory",
    );
    assert.equal(
      app.room.record.chat.filter((message) => message.id === `${runId}-reply-1-0`).length,
      1,
    );
    assert.ok(
      app.events.some((event) => event.type === "agentState" && event.agent?.status === "failed"),
    );
    assert.equal(
      app.events.some(
        (event) => event.type === "agentState" && event.agent?.status === "completed",
      ),
      false,
    );

    app.restoreStorage();
    await until(
      () => app.room.record.agent?.status === "failed",
      "the background retry should save a terminal failure",
    );
    assert.equal(app.coworker.state(app.room).status, "failed");
    assert.equal(
      app.room.record.chat.filter((message) => message.id === `${runId}-failed`).length,
      1,
    );
    assert.equal(
      app.events.filter((event) => event.type === "chat" && event.message?.id === `${runId}-failed`)
        .length,
      1,
    );
    const saved = JSON.parse(
      await readFile(path.join(app.directory, `${app.room.record.id}.json`), "utf8"),
    );
    assert.equal(saved.agent.status, "failed");
    const restarted = new RoomStore(app.directory);
    await restarted.init();
    assert.equal(restarted.get(app.room.record.id).record.agent?.status, "failed");
    assert.equal(
      restarted
        .get(app.room.record.id)
        .record.chat.some((message) => message.id === `${runId}-interrupted`),
      false,
    );
  } finally {
    await app.cleanup();
  }
});

test("a pending failed-finalization retry cannot overwrite a newer completed task", async () => {
  const model = new MockLanguageModelV4({
    doGenerate: [response("First answer."), response("Following the new direction.")],
  });
  const app = await fixture(model);
  try {
    app.failNextFinalization();
    const oldRunId = await app.request("first", "First request.");
    await until(
      () => app.coworker.state(app.room).status === "failed",
      "the failed save should be projected",
    );
    app.restoreStorage();
    const newRunId = await app.request("second", "Use the new direction.", "bob");
    assert.notEqual(newRunId, oldRunId);
    await until(
      () => app.room.record.agent?.status === "completed",
      "the replacement task should complete",
    );
    // Let the old retry deadline pass so a stale timer would expose an overwrite.
    await new Promise((resolve) => setTimeout(resolve, 1200));
    assert.equal(app.coworker.state(app.room).runId, newRunId);
    assert.equal(app.coworker.state(app.room).status, "completed");
    assert.equal(app.room.record.agent?.status, "completed");
    assert.equal(
      app.room.record.agentHistory.find((run) => run.runId === oldRunId)?.status,
      "superseded",
    );
    assert.equal(
      app.room.record.chat.some((message) => message.id === `${oldRunId}-failed`),
      false,
    );
    assert.equal(model.doGenerateCalls.length, 2);
  } finally {
    await app.cleanup();
  }
});

test("provider error and empty final responses cannot be reported as completed work", async () => {
  for (const outcome of [response("Partial response.", "error"), response("", "stop")]) {
    const app = await fixture(new MockLanguageModelV4({ doGenerate: outcome }));
    try {
      await app.request("incomplete", "Check this document.");
      await until(
        () => app.room.record.agent?.status === "failed",
        `finish reason ${outcome.finishReason.unified} should fail`,
      );
      assert.equal(app.coworker.state(app.room).status, "failed");
      assert.equal(
        app.events.some(
          (event) => event.type === "agentState" && event.agent?.status === "completed",
        ),
        false,
      );
      assert.equal(
        app.room.record.chat.some((message) => message.text === "Finished checking the document."),
        false,
      );
      assert.ok(
        app.room.record.chat.some(
          (message) =>
            message.role === "assistant" &&
            /did not return a complete final response/.test(message.text),
        ),
      );
    } finally {
      await app.cleanup();
    }
  }
});

test("steering keeps earlier task requirements after ordinary chat passes the forty-message window", async () => {
  const app = await fixture(new MockLanguageModelV4({ doGenerate: response("Unused.") }));
  try {
    const original = "Keep Ontario law and preserve the commercial terms.";
    await app.room.run(() => app.room.addChat("alice", "original", "Alice", `@Clippy ${original}`));
    for (let index = 0; index < 41; index++) {
      await app.room.run(() =>
        app.room.addChat(
          `participant-${index}`,
          `ordinary-${index}`,
          "Participant",
          `Ordinary group conversation ${index}.`,
        ),
      );
    }
    await app.room.run(() => app.room.addChat("bob", "steer", "Bob", "@Clippy Make it shorter."));
    assert.equal(
      app.room.record.chat.slice(-40).some((message) => message.text.includes(original)),
      false,
    );
    const projected = coworkerMessages(
      app.room.record.chat,
      app.room.record.agent!,
      [],
      app.room.record.name,
      app.room.seq,
      app.room.record.agentHistory,
    );
    const context = JSON.parse(projected.at(-1)!.content as string);
    assert.equal(context.task, "Make it shorter.");
    assert.equal(context.previousTasks[0].instruction, original);
    assert.equal(context.previousTasks[0].requestedBy.name, "Alice");
    assert.equal(context.previousTasks[0].status, "superseded");
    assert.equal(projected.length, 41, "forty chat messages plus one authoritative task context");
  } finally {
    await app.cleanup();
  }
});
