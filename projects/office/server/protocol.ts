import type { CollabChange, Delta } from "@reductoai/docx/collab";

export class RequestError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

/** Chat errors are recoverable and must not stop the document transport. */
export class ChatError extends Error {
  constructor(
    public messageId: string,
    message: string,
  ) {
    super(message);
  }
}

export type Presence = { seq: number; anchor: number; focus: number };
export type Peer = { id: string; name: string; presence: Presence };
export type ChangeEvent = {
  type: "change";
  seq: number;
  clientId: string;
  opId: string;
  change: CollabChange;
};
export type ChatMessage = {
  id: string;
  clientId: string;
  name: string;
  text: string;
  sentAt: string;
  role?: "assistant";
};
export type ClientMessage =
  | { type: "join"; roomId: string; clientId: string; name?: string; afterSeq?: number }
  | { type: "submit"; opId: string; base: number; change: CollabChange }
  | { type: "presence"; presence: Presence; name?: string }
  | { type: "chat"; messageId: string; text: string; name?: string }
  | { type: "typing"; active: boolean; name?: string }
  | { type: "agentStop"; runId: string };

export const identifier = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(value);
const integer = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const stringMap = (value: unknown, nullable: boolean): boolean =>
  object(value) &&
  Object.values(value).every((v) => typeof v === "string" || (nullable && v === null));
const partName = (name: string) =>
  name.length <= 512 &&
  !name.startsWith("/") &&
  !name.includes("\\") &&
  !name.split("/").includes("..") &&
  !name.includes("\0");

function validDelta(value: unknown): value is Delta {
  if (!Array.isArray(value) || value.length > 100_000) return false;
  let size = 0;
  for (const item of value) {
    if (!object(item)) return false;
    const kinds = ["r", "i", "d"].filter((key) => key in item);
    if (kinds.length !== 1 || Object.keys(item).some((key) => !["r", "i", "d", "a"].includes(key)))
      return false;
    if ("i" in item) {
      if ("a" in item || !Array.isArray(item.i)) return false;
      for (const token of item.i) {
        if (
          !object(token) ||
          !["c", "x", "b", "p", "o", "e"].includes(String(token.k)) ||
          typeof token.v !== "string" ||
          !stringMap(token.a, false)
        )
          return false;
      }
      size += item.i.length;
    } else {
      const count = item.r ?? item.d;
      if (!integer(count) || ("a" in item && (!("r" in item) || !stringMap(item.a, true))))
        return false;
      size += count;
    }
    if (size > 2_000_000) return false;
  }
  return true;
}

function validChange(value: unknown): value is CollabChange {
  if (!object(value) || Object.keys(value).some((key) => !["body", "maps", "parts"].includes(key)))
    return false;
  if ("body" in value && !validDelta(value.body)) return false;
  if (
    "maps" in value &&
    (!object(value.maps) ||
      !Object.entries(value.maps).every(
        ([key, entries]) => partName(key) && stringMap(entries, true),
      ))
  )
    return false;
  if (
    "parts" in value &&
    (!stringMap(value.parts, true) || !Object.keys(value.parts as object).every(partName))
  )
    return false;
  return true;
}

export function cleanName(value: unknown, fallback = "Guest"): string {
  // Strip control characters from user-supplied display names.
  return typeof value === "string"
    ? value
        // eslint-disable-next-line no-control-regex
        .replace(/[\x00-\x1f\x7f]/g, "")
        .trim()
        .slice(0, 80) || fallback
    : fallback;
}

export function parseMessage(raw: string): ClientMessage {
  let message: unknown;
  let unsafeKey = false;
  try {
    // SDK maps use ordinary objects. Never allow a wire key to mutate their prototypes.
    message = JSON.parse(raw, (key, value) => {
      if (["__proto__", "prototype", "constructor"].includes(key)) {
        unsafeKey = true;
        return undefined;
      }
      return value;
    });
  } catch {
    throw new RequestError("INVALID_MESSAGE", "The message is not valid JSON.");
  }
  if (object(message)) {
    const messageId = typeof message.messageId === "string" ? message.messageId.slice(0, 80) : "";
    if (message.type === "chat" || message.type === "typing") {
      if (unsafeKey) throw new ChatError(messageId, "The chat message has an unsupported field.");
      if (message.name !== undefined && typeof message.name !== "string")
        throw new ChatError(messageId, "Use a text display name.");
      if (message.type === "typing") {
        if (typeof message.active !== "boolean")
          throw new ChatError("", "The typing status must be true or false.");
        return message as ClientMessage;
      }
      if (!identifier(message.messageId))
        throw new ChatError(messageId, "The chat message needs a valid message ID.");
      if (typeof message.text !== "string" || !message.text.trim())
        throw new ChatError(messageId, "Type a message before sending.");
      if (message.text.length > 2000)
        throw new ChatError(messageId, "Chat messages can contain up to 2,000 characters.");
      return {
        type: "chat",
        messageId: message.messageId,
        text: message.text.trim(),
        ...(message.name === undefined ? {} : { name: message.name as string }),
      };
    }
    if (unsafeKey)
      throw new RequestError("INVALID_MESSAGE", "The message has an unsupported field.");
    if (message.type === "agentStop" && identifier(message.runId))
      return { type: "agentStop", runId: message.runId };
    if (
      message.type === "join" &&
      identifier(message.roomId) &&
      identifier(message.clientId) &&
      (message.afterSeq === undefined || integer(message.afterSeq))
    )
      return message as ClientMessage;
    if (
      message.type === "submit" &&
      identifier(message.opId) &&
      integer(message.base) &&
      validChange(message.change)
    )
      return message as ClientMessage;
    const presence = message.presence;
    if (
      message.type === "presence" &&
      object(presence) &&
      ["seq", "anchor", "focus"].every((key) => integer(presence[key]))
    )
      return message as ClientMessage;
  }
  throw new RequestError("INVALID_MESSAGE", "The message has an unsupported shape.");
}
