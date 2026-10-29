import { readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { portableCjkFontPath, portableFontPaths } from "@reductoai/portable-fonts";
import type { LanguageModel } from "ai";
import { WebSocketServer, WebSocket } from "ws";

import { AGENT_CLIENT_ID } from "../shared/agent.ts";
import { createCoworker } from "./coworker.ts";
import {
  ChatError,
  cleanName,
  parseMessage,
  RequestError,
  type Peer,
  type Presence,
} from "./protocol.ts";
import { RoomStore, validateDocx, welcomeBytes, type Room } from "./rooms.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const fontFiles = {
  ...portableFontPaths,
  [path.basename(portableCjkFontPath)]: portableCjkFontPath,
};
type Participant = {
  socket: WebSocket;
  room: Room;
  id: string;
  name: string;
  presence: Presence;
  typingUntil: number;
  lastTypingSignal: number;
  typingTimer?: ReturnType<typeof setTimeout>;
};
export type ServerOptions = {
  dataDir?: string;
  defaultDocx?: string;
  dev?: boolean;
  maxUploadBytes?: number;
  maxRooms?: number;
  maxOperations?: number;
  agentModel?: LanguageModel;
  agentModelId?: string;
};

function reply(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

function publicError(error: unknown) {
  if (error instanceof RequestError) return { code: error.code, message: error.message };
  console.error(
    "Document operation failed:",
    error instanceof Error ? error.message : "Unknown error",
  );
  return {
    code: "SERVER_ERROR",
    message: "The server could not save this operation. Your local copy has been preserved.",
  };
}

async function readBody(request: IncomingMessage, limit: number): Promise<Buffer> {
  if (Number(request.headers["content-length"]) > limit)
    throw new RequestError("UPLOAD_TOO_LARGE", "The upload exceeds the server limit.", 413);
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit)
      throw new RequestError("UPLOAD_TOO_LARGE", "The upload exceeds the server limit.", 413);
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function createAppServer(options: ServerOptions = {}) {
  const maxUploadBytes = options.maxUploadBytes ?? 10 * 1024 * 1024;
  const store = new RoomStore(
    options.dataDir ?? path.join(root, ".data"),
    options.maxRooms,
    options.maxOperations,
  );
  await store.init();
  const templatePath =
    options.defaultDocx ?? path.join(store.directory, "templates", "default.docx");
  let template: { name: string; bytes: Uint8Array } | undefined;
  try {
    const bytes = await readFile(templatePath);
    await validateDocx(bytes, maxUploadBytes);
    template = { name: path.basename(templatePath), bytes };
  } catch (error) {
    // The portable source archive omits private templates. Explicit configuration must exist.
    if (
      options.defaultDocx !== undefined ||
      !(error instanceof Error && "code" in error && error.code === "ENOENT")
    )
      throw error;
  }
  const participants = new Map<WebSocket, Participant>();
  const ws = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 * 1024 });
  const vite = options.dev
    ? await (
        await import("vite")
      ).createServer({ root, server: { middlewareMode: true }, appType: "spa" })
    : undefined;
  const server = createServer((request, response) => {
    void handleHttp(request, response).catch((error) => {
      if (!response.headersSent)
        reply(response, error instanceof RequestError ? error.status : 500, publicError(error));
      else response.end();
    });
  });

  const send = (socket: WebSocket, message: unknown) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > 16 * 1024 * 1024) {
      socket.close(1013, "Connection is too slow");
      return;
    }
    socket.send(JSON.stringify(message));
  };
  const peers = (participant: Participant): Peer[] => {
    const people = [...participants.values()]
      .filter((other) => other.room === participant.room && other.socket !== participant.socket)
      .map((other) => ({ id: other.id, name: other.name, presence: other.presence }));
    const bot = coworker.peer(participant.room);
    return bot ? [...people, bot] : people;
  };
  const broadcastPeers = (room: Room) => {
    for (const participant of participants.values())
      if (participant.room === room)
        send(participant.socket, { type: "peers", peers: peers(participant) });
  };
  const broadcastTyping = (room: Room) => {
    const active = [...participants.values()].filter(
      (participant) => participant.room === room && participant.typingUntil > Date.now(),
    );
    for (const participant of participants.values())
      if (participant.room === room)
        send(participant.socket, {
          type: "typing",
          peers: active
            .filter((other) => other !== participant)
            .map((other) => ({ id: other.id, name: other.name })),
        });
  };
  const clearTyping = (participant: Participant) => {
    clearTimeout(participant.typingTimer);
    participant.typingTimer = undefined;
    const wasTyping = participant.typingUntil > 0;
    participant.typingUntil = 0;
    if (wasTyping) broadcastTyping(participant.room);
  };
  const renameParticipant = (participant: Participant, name: string | undefined) => {
    if (name === undefined) return;
    const next = cleanName(name, participant.name);
    if (next === participant.name) return;
    participant.name = next;
    broadcastPeers(participant.room);
    if (participant.typingUntil > Date.now()) broadcastTyping(participant.room);
  };
  const coworker = createCoworker({
    store,
    model: options.agentModel,
    modelId: options.agentModelId,
    broadcast: (room, message) => {
      for (const participant of participants.values())
        if (participant.room === room) send(participant.socket, message);
    },
    presenceChanged: broadcastPeers,
  });

  server.on("upgrade", (request, socket, head) => {
    if (new URL(request.url ?? "/", "http://localhost").pathname !== "/collab") {
      if (!vite) socket.destroy();
      return;
    }
    // Capability rooms are deliberately public to link holders, but cross-site requests are not needed.
    const origin = request.headers.origin;
    let allowed = true;
    try {
      allowed = !origin || new URL(origin).host === request.headers.host;
    } catch {
      allowed = false;
    }
    if (!allowed) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    ws.handleUpgrade(request, socket, head, (connection) =>
      ws.emit("connection", connection, request),
    );
  });

  ws.on("connection", (socket) => {
    let chain = Promise.resolve();
    let closed = false;
    const joinTimeout = setTimeout(() => {
      if (!participants.has(socket)) socket.close(1008, "Join a room first");
    }, 10_000);
    socket.on("error", () => {});
    socket.on("message", (data, binary) => {
      chain = chain
        .then(async () => {
          if (closed) return;
          if (binary) throw new RequestError("INVALID_MESSAGE", "Use JSON messages.");
          const message = parseMessage(data.toString());
          if (message.type === "join") {
            if (message.clientId === AGENT_CLIENT_ID)
              throw new RequestError("RESERVED_ID", "This writer identity belongs to Clippy.");
            if (participants.has(socket))
              throw new RequestError(
                "ALREADY_JOINED",
                "This connection has already joined a room.",
              );
            const room = store.get(message.roomId);
            await room.run(async () => {
              if (closed) return;
              if (
                message.afterSeq !== undefined &&
                (message.afterSeq > room.seq ||
                  !Object.hasOwn(room.record.blocks, message.clientId))
              )
                throw new RequestError(
                  "RESUME_UNAVAILABLE",
                  "This session cannot be resumed. Download your local copy before reloading.",
                );
              const active = [...participants.values()].filter((peer) => peer.room === room);
              const previous = active.find((peer) => peer.id === message.clientId);
              if (active.length >= 32 && !previous)
                throw new RequestError(
                  "PEER_LIMIT",
                  "This room already has 32 connected editors.",
                  409,
                );
              const block = await room.blockFor(message.clientId);
              if (closed) return;
              if (previous) {
                clearTimeout(previous.typingTimer);
                participants.delete(previous.socket);
                previous.socket.close(4001, "Session reconnected");
              }
              const participant: Participant = {
                socket,
                room,
                id: message.clientId,
                name: cleanName(message.name),
                presence: { seq: room.seq, anchor: 0, focus: 0 },
                typingUntil: 0,
                lastTypingSignal: 0,
              };
              participants.set(socket, participant);
              clearTimeout(joinTimeout);
              if (message.afterSeq === undefined)
                send(socket, {
                  type: "snapshot",
                  roomId: room.record.id,
                  name: room.record.name,
                  clientId: message.clientId,
                  seq: room.seq,
                  block,
                  bytes: room.record.bytes,
                  peers: peers(participant),
                });
              else {
                for (const event of room.record.history.slice(message.afterSeq))
                  send(socket, event);
                send(socket, { type: "ready", seq: room.seq, block, peers: peers(participant) });
              }
              send(socket, { type: "chatHistory", messages: room.record.chat });
              send(socket, { type: "agentState", agent: coworker.state(room) });
              broadcastPeers(room);
              broadcastTyping(room);
            });
            return;
          }
          const participant = participants.get(socket);
          if (!participant) {
            if (message.type === "chat" || message.type === "typing")
              throw new ChatError(
                message.type === "chat" ? message.messageId : "",
                "Join a room before chatting.",
              );
            throw new RequestError("NOT_JOINED", "Join a room before sending changes.");
          }
          if (message.type === "agentStop") {
            const transition = await participant.room.run(() =>
              participants.get(socket) === participant && !closed
                ? participant.room.stopAgent(message.runId, {
                    clientId: participant.id,
                    name: participant.name,
                  })
                : { changed: false, message: undefined },
            );
            if (transition.message)
              for (const other of participants.values())
                if (other.room === participant.room)
                  send(other.socket, { type: "chat", message: transition.message });
            if (transition.changed) coworker.changed(participant.room);
            return;
          }
          if (message.type === "chat" || message.type === "typing") {
            try {
              await participant.room.run(async () => {
                if (participants.get(socket) !== participant || closed) return;
                renameParticipant(participant, message.name);
                if (message.type === "typing") {
                  if (!message.active) {
                    clearTyping(participant);
                    return;
                  }
                  const now = Date.now();
                  if (now - participant.lastTypingSignal < 500) return;
                  participant.lastTypingSignal = now;
                  participant.typingUntil = now + 5000;
                  clearTimeout(participant.typingTimer);
                  participant.typingTimer = setTimeout(() => clearTyping(participant), 5000);
                  participant.typingTimer.unref();
                  broadcastTyping(participant.room);
                  return;
                }
                const accepted = await participant.room.addChat(
                  participant.id,
                  message.messageId,
                  participant.name,
                  message.text,
                );
                clearTyping(participant);
                const event = { type: "chat", message: accepted.message };
                if (accepted.duplicate) send(socket, event);
                else
                  for (const other of participants.values())
                    if (other.room === participant.room) send(other.socket, event);
                if (accepted.agentMessage)
                  for (const other of participants.values())
                    if (other.room === participant.room)
                      send(other.socket, { type: "chat", message: accepted.agentMessage });
                if (accepted.agentChanged) coworker.changed(participant.room);
              });
            } catch (error) {
              throw new ChatError(
                message.type === "chat" ? message.messageId : "",
                error instanceof RequestError
                  ? error.message
                  : "The chat message could not be saved. Please try again.",
              );
            }
            return;
          }
          await participant.room.run(async () => {
            if (participants.get(socket) !== participant || closed) return;
            if (message.type === "submit") {
              const { event, duplicate } = await participant.room.submit(
                participant.id,
                message.opId,
                message.base,
                message.change,
              );
              if (duplicate) send(socket, event);
              else
                for (const other of participants.values())
                  if (other.room === participant.room) send(other.socket, event);
            } else {
              if (message.presence.seq > participant.room.seq)
                throw new RequestError(
                  "INVALID_PRESENCE",
                  "The cursor refers to a future revision.",
                );
              participant.presence = message.presence;
              if (message.name !== undefined) participant.name = cleanName(message.name);
              broadcastPeers(participant.room);
            }
          });
        })
        .catch((error) => {
          if (error instanceof ChatError) {
            send(socket, { type: "chatError", messageId: error.messageId, message: error.message });
            return;
          }
          closed = true;
          send(socket, { type: "error", ...publicError(error), retryable: false });
          socket.close(1008, "Operation rejected");
        });
    });
    socket.on("close", () => {
      closed = true;
      clearTimeout(joinTimeout);
      const participant = participants.get(socket);
      if (!participant) return;
      clearTimeout(participant.typingTimer);
      participants.delete(socket);
      broadcastPeers(participant.room);
      broadcastTyping(participant.room);
    });
  });

  async function handleHttp(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? "/", "http://localhost");
    const route = url.pathname;
    response.setHeader("X-Content-Type-Options", "nosniff");
    if (request.method === "GET" && route === "/api/health") {
      reply(response, 200, { ok: true });
      return;
    }
    if (request.method === "POST" && route === "/api/rooms") {
      const origin = request.headers.origin;
      if (origin && new URL(origin).host !== request.headers.host)
        throw new RequestError("ORIGIN_REJECTED", "This origin cannot create rooms.", 403);
      const json = request.headers["content-type"]?.includes("application/json");
      const body = await readBody(request, json ? 4096 : maxUploadBytes);
      let bytes: Uint8Array;
      let name: unknown;
      if (json) {
        let settings: { name?: string; blank?: boolean };
        try {
          settings = JSON.parse(body.toString());
          if (!settings || typeof settings !== "object") throw new Error();
        } catch {
          throw new RequestError("INVALID_JSON", "Provide a JSON room request.");
        }
        const blank = settings.blank === true;
        bytes = blank ? await welcomeBytes(true) : (template?.bytes ?? (await welcomeBytes()));
        name = settings.name ?? (blank ? "Untitled.docx" : (template?.name ?? "Welcome.docx"));
      } else {
        await validateDocx(body, maxUploadBytes);
        bytes = body;
        name = request.headers["x-document-name"] ?? "Uploaded.docx";
        if (typeof name === "string") {
          try {
            name = decodeURIComponent(name);
          } catch {
            /* plain header is also accepted */
          }
        }
      }
      const room = await store.create(name, bytes);
      reply(response, 201, { roomId: room.record.id, name: room.record.name });
      return;
    }
    const download = /^\/api\/rooms\/([A-Za-z0-9_-]{1,80})\/download$/.exec(route);
    if (request.method === "GET" && download) {
      const room = store.get(download[1]);
      await room.run(() => {
        response.writeHead(200, {
          "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "Content-Disposition": `attachment; filename="document.docx"; filename*=UTF-8''${encodeURIComponent(room.record.name)}`,
          "Cache-Control": "no-store",
          "X-Document-Sequence": String(room.seq),
        });
        response.end(room.bytes);
      });
      return;
    }
    if (request.method === "GET" && route.startsWith("/fonts/")) {
      const filename = decodeURIComponent(route.slice("/fonts/".length));
      if (!Object.hasOwn(fontFiles, filename))
        throw new RequestError("NOT_FOUND", "Font not found.", 404);
      response.writeHead(200, {
        "Content-Type": "font/ttf",
        "Cache-Control": "public, max-age=86400",
      });
      response.end(await readFile(fontFiles[filename]));
      return;
    }
    if (route.startsWith("/api/") || route === "/collab")
      throw new RequestError("NOT_FOUND", "Route not found.", 404);
    if (vite) {
      vite.middlewares(request, response);
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD")
      throw new RequestError("METHOD_NOT_ALLOWED", "Method not allowed.", 405);
    const dist = path.join(root, "dist");
    let filename = path.resolve(dist, `.${decodeURIComponent(route)}`);
    if (!filename.startsWith(`${dist}${path.sep}`) && filename !== dist)
      throw new RequestError("NOT_FOUND", "File not found.", 404);
    if (!(await stat(filename).catch(() => undefined))?.isFile())
      filename = path.join(dist, "index.html");
    const content = await readFile(filename).catch(() => {
      throw new RequestError(
        "NOT_BUILT",
        "Run npm run build before starting the production server.",
        503,
      );
    });
    const types: Record<string, string> = {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript",
      ".css": "text/css",
      ".svg": "image/svg+xml",
      ".png": "image/png",
      ".ico": "image/x-icon",
      ".woff2": "font/woff2",
    };
    response.writeHead(200, {
      "Content-Type": types[path.extname(filename)] ?? "application/octet-stream",
      "Cache-Control": path.extname(filename) === ".html" ? "no-cache" : "public, max-age=3600",
    });
    response.end(request.method === "HEAD" ? undefined : content);
  }

  return {
    server,
    store,
    async close() {
      await coworker.close();
      for (const socket of ws.clients) socket.terminate();
      await new Promise<void>((resolve) => ws.close(() => resolve()));
      await vite?.close();
      if (server.listening)
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
    },
  };
}
