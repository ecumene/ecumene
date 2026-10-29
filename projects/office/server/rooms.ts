import { createHash, randomBytes } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, unlink } from "node:fs/promises";
import path from "node:path";

import { CollabServer, type CollabChange } from "@reductoai/docx/collab";
import { DocxSession, SessionReplica } from "@reductoai/docx/editor";
import { WordDocument } from "@reductoai/docx/officejs";
import JSZip from "jszip";

import { AGENT_CLIENT_ID, AGENT_NAME, type AgentState } from "../shared/agent.ts";
import {
  cleanName,
  identifier,
  RequestError,
  type ChangeEvent,
  type ChatMessage,
} from "./protocol.ts";

export type AgentActor = { clientId: string; name: string };
type AgentRunBase = {
  runId: string;
  generation: number;
  instruction: string;
  requestedBy: AgentActor;
  triggerMessageId: string;
  model: string;
  activity: string;
  createdAt: string;
  updatedAt: string;
};
export type AgentRun = AgentRunBase &
  (
    | { status: "queued" }
    | { status: "running"; startedAt: string }
    | {
        status: "completed" | "cancelled" | "failed" | "interrupted" | "superseded";
        finishedAt: string;
      }
  );
export type AgentToolResult = {
  runId: string;
  toolCallId: string;
  toolName: string;
  result: string;
  seq: number;
  at: string;
};
export type AgentTransition = { changed: boolean; message?: ChatMessage };

const activeAgent = (run: AgentRun | null): boolean =>
  run?.status === "queued" || run?.status === "running";
const activityText = (value: string) => value.trim().slice(0, 500);

function appendChat(record: RoomRecord, message: ChatMessage): RoomRecord {
  return {
    ...record,
    chat: [...record.chat, message].slice(-200),
    chatReceipts: { ...record.chatReceipts, [`${message.clientId}:${message.id}`]: true },
  };
}

function assistantMessage(id: string, text: string): ChatMessage {
  return {
    id,
    clientId: AGENT_CLIENT_ID,
    name: AGENT_NAME,
    text: text.trim().slice(0, 2000),
    sentAt: new Date().toISOString(),
    role: "assistant",
  };
}

function terminal(
  run: AgentRun,
  status: "completed" | "cancelled" | "failed" | "interrupted" | "superseded",
  activity: string,
): AgentRun {
  const {
    startedAt: _startedAt,
    finishedAt: _finishedAt,
    ...base
  } = run as AgentRun & { startedAt?: string; finishedAt?: string };
  const now = new Date().toISOString();
  return { ...base, status, activity: activityText(activity), updatedAt: now, finishedAt: now };
}

type RoomRecord = {
  version: 1;
  id: string;
  name: string;
  bytes: string;
  history: ChangeEvent[];
  blocks: Record<string, number>;
  chat: ChatMessage[];
  /** Receipts retain IDs only, so pruned chat bodies cannot be posted twice by an old retry. */
  chatReceipts: Record<string, true>;
  agentGeneration: number;
  agent: AgentRun | null;
  /** Previous terminal runs retain the instruction being steered; never duplicate the current run. */
  agentHistory: AgentRun[];
  agentTools: AgentToolResult[];
};

export class Room {
  private tail: Promise<unknown> = Promise.resolve();
  private chatWindows = new Map<string, number[]>();
  constructor(
    public record: RoomRecord,
    private persist: (record: RoomRecord) => Promise<void>,
    private maxOperations: number,
  ) {}
  get seq() {
    return this.record.history.length;
  }
  get bytes() {
    return Buffer.from(this.record.bytes, "base64");
  }

  agentState(model: string): AgentState {
    const run = this.record.agent;
    return {
      status: !run
        ? "idle"
        : activeAgent(run)
          ? "working"
          : run.status === "superseded"
            ? "cancelled"
            : (run.status as AgentState["status"]),
      runId: run?.runId ?? null,
      activity: run?.activity ?? "Ready to help. Mention @Clippy in the group chat.",
      requestedBy: run?.requestedBy.name ?? null,
      model: run?.model || model,
    };
  }

  isAgentCurrent(runId: string): boolean {
    const run = this.record.agent;
    return (
      run?.runId === runId &&
      run.status === "running" &&
      run.generation === this.record.agentGeneration
    );
  }

  /** All joins, changes and downloads observe the same serialized commit boundary. */
  run<T>(work: () => Promise<T> | T): Promise<T> {
    const task = this.tail.then(work);
    this.tail = task.catch(() => {});
    return task;
  }

  async blockFor(clientId: string): Promise<number> {
    if (Object.hasOwn(this.record.blocks, clientId)) return this.record.blocks[clientId];
    const count = Object.keys(this.record.blocks).length;
    if (count >= 10_000)
      throw new RequestError(
        "WRITER_LIMIT",
        "This room has reached its writer limit. Download it and start a new room.",
        409,
      );
    const block = count + 1;
    const next = { ...this.record, blocks: { ...this.record.blocks, [clientId]: block } };
    await this.persist(next);
    this.record = next;
    return block;
  }

  async submit(
    clientId: string,
    opId: string,
    base: number,
    change: CollabChange,
  ): Promise<{ event: ChangeEvent; duplicate: boolean }> {
    const existing = this.record.history.find(
      (event) => event.clientId === clientId && event.opId === opId,
    );
    if (existing) return { event: existing, duplicate: true };
    if (base > this.seq)
      throw new RequestError("INVALID_BASE", "The edit refers to a future document revision.");
    if (this.seq >= this.maxOperations)
      throw new RequestError(
        "HISTORY_LIMIT",
        "This room is full. Download the document and start a new room.",
        409,
      );

    // Stage both the sequencer and document: a parse/apply/disk failure cannot partially commit.
    const sequencer = new CollabServer();
    sequencer.log.push(...this.record.history.map((event) => event.change));
    const accepted = sequencer.receive(base, change);
    const replica = await SessionReplica.start(
      await DocxSession.fromBytes(this.bytes),
      this.seq,
      (bytes) => DocxSession.fromBytes(bytes),
    );
    try {
      await replica.remote(accepted.change, accepted.seq);
    } catch {
      throw new RequestError(
        "INVALID_CHANGE",
        "The document could not apply this edit. Your local copy has been preserved.",
      );
    }
    const bytes = await replica.session.toBytes();
    const event: ChangeEvent = { type: "change", ...accepted, clientId, opId };
    const next = {
      ...this.record,
      bytes: Buffer.from(bytes).toString("base64"),
      history: [...this.record.history, event],
    };
    await this.persist(next);
    this.record = next;
    return { event, duplicate: false };
  }

  async addChat(
    clientId: string,
    id: string,
    name: string,
    text: string,
  ): Promise<{
    message: ChatMessage;
    duplicate: boolean;
    agentChanged?: boolean;
    agentMessage?: ChatMessage;
  }> {
    const existing = this.record.chat.find(
      (message) => message.clientId === clientId && message.id === id,
    );
    if (existing) return { message: existing, duplicate: true };
    const receipt = `${clientId}:${id}`;
    if (Object.hasOwn(this.record.chatReceipts, receipt))
      throw new RequestError(
        "CHAT_ALREADY_DELIVERED",
        "This message was already delivered and is no longer in recent history.",
      );
    if (Object.keys(this.record.chatReceipts).length >= 100_000)
      throw new RequestError(
        "CHAT_LIMIT",
        "This room has reached its chat limit. Start a new room to continue chatting.",
      );
    const now = Date.now();
    const recent = (this.chatWindows.get(clientId) ?? []).filter((at) => at > now - 10_000);
    if (recent.length >= 10)
      throw new RequestError(
        "CHAT_RATE_LIMIT",
        "You are sending messages quickly. Please wait a few seconds.",
      );
    const message: ChatMessage = { id, clientId, name, text, sentAt: new Date(now).toISOString() };
    let next = appendChat(this.record, message);
    let agentChanged = false;
    let agentMessage: ChatMessage | undefined;
    if (clientId !== AGENT_CLIENT_ID && /^\s*@clippy\b/i.test(text)) {
      const instruction = text.replace(/^\s*@clippy\b[\s,:-]*/i, "").trim();
      if (/^(?:stop|cancel)(?:\s+task)?[.!]?$/i.test(instruction)) {
        if (activeAgent(next.agent)) {
          const run = next.agent!;
          agentMessage = assistantMessage(
            `${run.runId}-cancelled`,
            `Stopped at ${name}'s request. Changes already saved remain in the document.`,
          );
          next = appendChat(
            {
              ...next,
              agentGeneration: next.agentGeneration + 1,
              agent: terminal(run, "cancelled", `Stopped by ${name}.`),
            },
            agentMessage,
          );
          agentChanged = true;
        }
      } else {
        const generation = next.agentGeneration + 1;
        const prior = next.agent
          ? activeAgent(next.agent)
            ? terminal(next.agent, "superseded", `Steered by ${name}.`)
            : next.agent
          : null;
        next = {
          ...next,
          agentGeneration: generation,
          agentHistory: prior ? [...next.agentHistory, prior].slice(-10) : next.agentHistory,
          agent: {
            status: "queued",
            runId: `clippy-${generation}`,
            generation,
            instruction: instruction || "Tell the group how you can help with this document.",
            requestedBy: { clientId, name },
            triggerMessageId: id,
            model: "",
            activity: `Preparing to help ${name}…`,
            createdAt: message.sentAt,
            updatedAt: message.sentAt,
          },
        };
        agentChanged = true;
      }
    }
    await this.persist(next);
    this.record = next;
    this.chatWindows.set(clientId, [...recent, now]);
    return {
      message,
      duplicate: false,
      ...(agentChanged ? { agentChanged: true } : {}),
      ...(agentMessage ? { agentMessage } : {}),
    };
  }

  /** Call inside run(); the provider request itself must execute outside that queue. */
  async claimAgent(runId: string, model: string): Promise<boolean> {
    const run = this.record.agent;
    if (
      run?.runId !== runId ||
      run.status !== "queued" ||
      run.generation !== this.record.agentGeneration
    )
      return false;
    const now = new Date().toISOString();
    const next = {
      ...this.record,
      agent: {
        ...run,
        status: "running" as const,
        startedAt: now,
        updatedAt: now,
        model,
        activity: "Reading the document and group chat…",
      },
    };
    await this.persist(next);
    this.record = next;
    return true;
  }

  async progressAgent(runId: string, activity: string): Promise<boolean> {
    if (!this.isAgentCurrent(runId)) return false;
    const next = {
      ...this.record,
      agent: {
        ...this.record.agent!,
        activity: activityText(activity),
        updatedAt: new Date().toISOString(),
      },
    };
    await this.persist(next);
    this.record = next;
    return true;
  }

  async recordAgentTool(
    runId: string,
    tool: { toolCallId: string; toolName: string; result: string },
  ): Promise<boolean> {
    if (!this.isAgentCurrent(runId)) return false;
    if (!tool.toolCallId || tool.toolCallId.length > 160)
      throw new RequestError(
        "INVALID_TOOL_ID",
        "The tool call needs a stable ID of at most 160 characters.",
      );
    if (
      this.record.agentTools.some(
        (result) => result.runId === runId && result.toolCallId === tool.toolCallId,
      )
    )
      return true;
    const result: AgentToolResult = {
      runId,
      toolCallId: tool.toolCallId,
      toolName: tool.toolName.slice(0, 100),
      result: tool.result.slice(0, 12_000),
      seq: this.seq,
      at: new Date().toISOString(),
    };
    const next = { ...this.record, agentTools: [...this.record.agentTools, result].slice(-20) };
    await this.persist(next);
    this.record = next;
    return true;
  }

  async submitAgent(
    runId: string,
    opId: string,
    base: number,
    change: CollabChange,
  ): Promise<{ event: ChangeEvent; duplicate: boolean } | { stale: true }> {
    if (!this.isAgentCurrent(runId)) return { stale: true };
    const scopedOpId = `${runId}-${createHash("sha256").update(opId).digest("hex").slice(0, 32)}`;
    const existing = this.record.history.find(
      (event) => event.clientId === AGENT_CLIENT_ID && event.opId === scopedOpId,
    );
    if (existing) return { event: existing, duplicate: true };
    // A model's paragraph ordinals and quoted text are only valid for the snapshot it read.
    if (base !== this.seq) return { stale: true };
    return this.submit(AGENT_CLIENT_ID, scopedOpId, base, change);
  }

  async postAgentMessage(
    runId: string,
    messageId: string,
    text: string,
  ): Promise<ChatMessage | null> {
    if (!this.isAgentCurrent(runId)) return null;
    const existing = this.record.chat.find(
      (message) => message.clientId === AGENT_CLIENT_ID && message.id === messageId,
    );
    if (existing) return existing;
    if (Object.hasOwn(this.record.chatReceipts, `${AGENT_CLIENT_ID}:${messageId}`)) return null;
    if (!text.trim()) return null;
    const message = assistantMessage(messageId, text);
    const next = appendChat(this.record, message);
    await this.persist(next);
    this.record = next;
    return message;
  }

  async finishAgent(
    runId: string,
    status: "completed" | "failed",
    activity: string,
    reply?: string,
  ): Promise<AgentTransition> {
    if (!this.isAgentCurrent(runId)) return { changed: false };
    let next: RoomRecord = {
      ...this.record,
      agent: terminal(this.record.agent!, status, activity),
    };
    const message = reply?.trim() ? assistantMessage(`${runId}-${status}`, reply) : undefined;
    if (message) next = appendChat(next, message);
    await this.persist(next);
    this.record = next;
    return { changed: true, ...(message ? { message } : {}) };
  }

  async stopAgent(expectedRunId: string, actor: AgentActor): Promise<AgentTransition> {
    const run = this.record.agent;
    if (run?.runId !== expectedRunId || !activeAgent(run)) return { changed: false };
    const name = cleanName(actor.name);
    const message = assistantMessage(
      `${run.runId}-cancelled`,
      `Stopped at ${name}'s request. Changes already saved remain in the document.`,
    );
    const next = appendChat(
      {
        ...this.record,
        agentGeneration: this.record.agentGeneration + 1,
        agent: terminal(run, "cancelled", `Stopped by ${name}.`),
      },
      message,
    );
    await this.persist(next);
    this.record = next;
    return { changed: true, message };
  }

  /** Called once on startup: saved edits remain, but process-local model calls cannot be resumed. */
  async interruptAgent(): Promise<AgentTransition> {
    const run = this.record.agent;
    if (!run || !activeAgent(run)) return { changed: false };
    const activity = "Interrupted by a server restart. Mention @Clippy to continue.";
    const message = assistantMessage(
      `${run.runId}-interrupted`,
      `${activity} Changes already saved remain in the document.`,
    );
    const next = appendChat(
      {
        ...this.record,
        agentGeneration: this.record.agentGeneration + 1,
        agent: terminal(run, "interrupted", activity),
      },
      message,
    );
    await this.persist(next);
    this.record = next;
    return { changed: true, message };
  }
}

export async function validateDocx(bytes: Uint8Array, maxBytes: number): Promise<void> {
  if (bytes.byteLength > maxBytes)
    throw new RequestError("UPLOAD_TOO_LARGE", "The document exceeds the upload limit.", 413);
  try {
    const zip = await JSZip.loadAsync(bytes);
    const files = Object.values(zip.files);
    if (files.length > 3000 || !zip.file("word/document.xml") || !zip.file("[Content_Types].xml"))
      throw new Error("Not a DOCX");
    let expanded = 0;
    for (const file of files) {
      const original =
        (file as typeof file & { unsafeOriginalName?: string }).unsafeOriginalName ?? file.name;
      if (original.startsWith("/") || original.includes("\\") || original.split("/").includes(".."))
        throw new Error("Unsafe entry");
      // Check the ZIP directory before any SDK decompression of uploaded parts.
      expanded +=
        (file as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
      if (expanded > 64 * 1024 * 1024) throw new Error("Expanded document too large");
    }
    await DocxSession.fromBytes(bytes);
  } catch {
    throw new RequestError(
      "INVALID_DOCX",
      "Choose a readable, unencrypted DOCX document (up to 64 MB expanded).",
    );
  }
}

export async function welcomeBytes(blank = false): Promise<Uint8Array> {
  const doc = await WordDocument.create();
  if (blank) return doc.toBytes();
  const title = doc.body.paragraphs.items[0];
  title.insertText("Good ideas travel together.", "Replace");
  title.font.set({ name: "Georgia", size: 24, color: "#173F71", bold: true });
  title.spaceAfter = 18;
  for (const text of [
    "A familiar place to make something new.",
    "Start typing, then share this room with a friend. You can write together and see each other’s cursors and selections as the document takes shape.",
    "Try a heading, make a list, or bring your own Word document. Your work is saved in this room, and you can download a DOCX whenever you like.",
  ]) {
    const paragraph = doc.body.insertParagraph(text, "End");
    paragraph.font.set({ name: "Arial", size: 11, color: "#27384B", bold: false });
    paragraph.spaceAfter = 12;
    paragraph.lineSpacing = 16;
  }
  return doc.toBytes();
}

export class RoomStore {
  readonly rooms = new Map<string, Room>();
  private creation: Promise<unknown> = Promise.resolve();
  constructor(
    readonly directory: string,
    private maxRooms = 100,
    private maxOperations = 10_000,
  ) {}

  async init(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    for (const name of await readdir(this.directory)) {
      if (!name.endsWith(".json")) continue;
      const record = JSON.parse(
        await readFile(path.join(this.directory, name), "utf8"),
      ) as RoomRecord;
      if (
        record.version !== 1 ||
        !identifier(record.id) ||
        name !== `${record.id}.json` ||
        !Array.isArray(record.history) ||
        !record.blocks ||
        typeof record.bytes !== "string"
      )
        throw new Error(`Invalid saved room: ${name}`);
      if (record.history.some((event, index) => event.seq !== index + 1))
        throw new Error(`Non-contiguous saved history: ${name}`);
      record.chat ??= [];
      if (!Array.isArray(record.chat) || record.chat.length > 200)
        throw new Error(`Invalid saved chat: ${name}`);
      record.chatReceipts ??= Object.fromEntries(
        record.chat.map((message) => [`${message.clientId}:${message.id}`, true]),
      );
      record.agent ??= null;
      record.agentGeneration ??= record.agent?.generation ?? 0;
      record.agentHistory ??= [];
      record.agentTools ??= [];
      const room = this.room(record);
      await room.run(() => room.interruptAgent());
      this.rooms.set(record.id, room);
    }
  }

  get(id: string): Room {
    const room = this.rooms.get(id);
    if (!room) throw new RequestError("ROOM_NOT_FOUND", "This document room was not found.", 404);
    return room;
  }

  create(name: unknown, bytes: Uint8Array): Promise<Room> {
    const task = this.creation.then(async () => {
      if (this.rooms.size >= this.maxRooms)
        throw new RequestError("ROOM_LIMIT", "This server has reached its room limit.", 503);
      const id = randomBytes(18).toString("base64url");
      const record: RoomRecord = {
        version: 1,
        id,
        name: cleanName(name, "Welcome.docx"),
        bytes: Buffer.from(bytes).toString("base64"),
        history: [],
        blocks: {},
        chat: [],
        chatReceipts: {},
        agentGeneration: 0,
        agent: null,
        agentHistory: [],
        agentTools: [],
      };
      await this.persist(record);
      const room = this.room(record);
      this.rooms.set(id, room);
      return room;
    });
    this.creation = task.catch(() => {});
    return task;
  }

  private room(record: RoomRecord) {
    return new Room(record, (next) => this.persist(next), this.maxOperations);
  }

  private async persist(record: RoomRecord): Promise<void> {
    const json = JSON.stringify(record);
    if (Buffer.byteLength(json) > 96 * 1024 * 1024)
      throw new RequestError(
        "ROOM_SIZE_LIMIT",
        "This room is full. Download the document and start a new room.",
        409,
      );
    const target = path.join(this.directory, `${record.id}.json`);
    const temporary = `${target}.${randomBytes(6).toString("hex")}.tmp`;
    try {
      const handle = await open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(json);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, target);
      // Persist the rename before acknowledging the write. Syncing only the file
      // does not make the directory entry durable after a host crash.
      const directory = await open(this.directory, "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    } catch (error) {
      await unlink(temporary).catch(() => {});
      throw error;
    }
  }
}
