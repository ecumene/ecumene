import type { EditorModel, Peer } from "@reductoai/docx-editor/model";
import type { CollabChange, Outgoing } from "@reductoai/docx/collab";
import type { Presence } from "@reductoai/docx/editor";

import {
  emptyChat,
  type AgentState,
  type ChatMessage,
  type ChatPeer,
  type ChatState,
} from "./chat-types";

export type Connection = {
  status: "connecting" | "opening" | "online" | "offline" | "error";
  pending: boolean;
  seq: number;
  peers: Peer[];
  message?: string;
};

type ServerMessage =
  | {
      type: "snapshot";
      roomId: string;
      name: string;
      block: number;
      seq: number;
      bytes: string;
      peers: Peer[];
    }
  | { type: "ready"; seq: number; block: number; peers: Peer[] }
  | { type: "change"; seq: number; clientId: string; opId: string; change: CollabChange }
  | { type: "peers"; peers: Peer[] }
  | { type: "chatHistory"; messages: ChatMessage[] }
  | { type: "chat"; message: ChatMessage }
  | { type: "chatError"; messageId: string; message: string }
  | { type: "typing"; peers: ChatPeer[] }
  | { type: "agentState"; agent: AgentState }
  | { type: "error"; code: string; message: string; retryable?: boolean };

/** One model, one writer identity, one ordered WebSocket stream. The SDK owns OT. */
export function connectRoom(
  model: EditorModel,
  roomId: string,
  name: string,
  notify: (state: Connection) => void,
  notifyChat: (state: ChatState) => void = () => {},
) {
  const clientId = crypto.randomUUID();
  let socket: WebSocket | undefined;
  let disposed = false;
  let initialized = false;
  let fatal = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let backoff = 400;
  let inflight: { opId: string; out: Outgoing } | undefined;
  let queue = Promise.resolve();
  let state: Connection = { status: "connecting", pending: false, seq: 0, peers: [] };
  let displayName = name.trim().slice(0, 40) || "Guest";
  let lastPresence: Presence | undefined;
  let chat: ChatState = { ...emptyChat };
  let history: ChatMessage[] = [];
  const pendingChat = new Map<string, ChatMessage>();
  let typingTimer: ReturnType<typeof setTimeout> | undefined;
  let typingActive = false;
  let lastTypingAt = 0;

  const update = (patch: Partial<Connection>) => {
    state = { ...state, ...patch };
    notify(state);
  };
  const send = (data: unknown) => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(data));
  };
  const updateChat = (patch: Partial<ChatState> = {}) => {
    chat = {
      ...chat,
      ...patch,
      messages: [...history, ...pendingChat.values()],
      pendingIds: [...pendingChat.keys()],
    };
    notifyChat(chat);
  };
  const sendChatMessage = (message: ChatMessage) =>
    send({ type: "chat", messageId: message.id, text: message.text, name: message.name });
  const setTyping = (active: boolean) => {
    clearTimeout(typingTimer);
    if (state.status !== "online") {
      typingActive = false;
      return;
    }
    if (active !== typingActive || (active && Date.now() - lastTypingAt >= 1000)) {
      send({ type: "typing", active, name: displayName });
      lastTypingAt = Date.now();
    }
    typingActive = active;
    if (active) typingTimer = setTimeout(() => setTyping(false), 2500);
  };
  const fail = (error: unknown) => {
    fatal = true;
    model.readOnly = true;
    clearTimeout(typingTimer);
    typingActive = false;
    updateChat({ typing: [], agent: null });
    update({ status: "error", message: error instanceof Error ? error.message : String(error) });
    socket?.close();
  };
  const sendEdit = (out: Outgoing) => {
    // Reconnect resends the same logical operation with the same deduplication key.
    inflight ??= { opId: crypto.randomUUID(), out };
    inflight.out = out;
    update({ pending: true });
    send({ type: "submit", opId: inflight.opId, ...out });
  };
  const setPeers = (peers: Peer[]) => {
    model.collabPeers(peers);
    update({ peers });
  };

  async function receive(message: ServerMessage) {
    if (disposed) return;
    if (message.type === "chatHistory") {
      history = message.messages.slice(-200);
      for (const entry of history) if (entry.clientId === clientId) pendingChat.delete(entry.id);
      updateChat();
      // A message may have committed just before the socket closed; its original ID makes retry safe.
      for (const pending of pendingChat.values()) sendChatMessage(pending);
      return;
    }
    if (message.type === "chat") {
      const entry = message.message;
      if (entry.clientId === clientId) pendingChat.delete(entry.id);
      if (
        !history.some(
          (existing) => existing.id === entry.id && existing.clientId === entry.clientId,
        )
      )
        history = [...history, entry].slice(-200);
      updateChat();
      return;
    }
    if (message.type === "chatError") {
      const pending = pendingChat.get(message.messageId);
      pendingChat.delete(message.messageId);
      updateChat({ error: message.message + (pending ? `\nYour message: ${pending.text}` : "") });
      return;
    }
    if (message.type === "typing") {
      updateChat({ typing: message.peers });
      return;
    }
    if (message.type === "agentState") {
      updateChat({ agent: message.agent });
      return;
    }
    if (message.type === "error") {
      fail(new Error(message.message));
      return;
    }
    if (message.type === "snapshot") {
      if (initialized)
        throw new Error(
          "The server cannot resume this session. Download your local copy before reloading.",
        );
      update({ status: "opening", seq: message.seq });
      const bytes = Uint8Array.from(atob(message.bytes), (char) => char.charCodeAt(0));
      if (!(await model.open(bytes, message.name)))
        throw new Error(model.error || "The document could not be opened.");
      if (disposed) return;
      model.setRevisionAuthor(displayName);
      await model.startCollab({
        seq: message.seq,
        block: message.block,
        send: sendEdit,
        onError: fail,
        presence: (presence) => {
          lastPresence = presence;
          send({ type: "presence", presence, name: displayName });
        },
      });
      if (disposed) return;
      initialized = true;
      setPeers(message.peers);
      model.readOnly = false;
      update({ status: "online" });
      return;
    }
    if (message.type === "change") {
      if (message.seq <= state.seq) return;
      if (message.seq !== state.seq + 1)
        throw new Error(
          "A document update is missing. Keep this tab open and download your local copy.",
        );
      update({ seq: message.seq });
      if (message.clientId === clientId) {
        if (!inflight || message.opId !== inflight.opId)
          throw new Error("Unexpected acknowledgement. Your local copy has been preserved.");
        inflight = undefined;
        update({ pending: false });
        model.collabAck(message.seq);
      } else model.collabRemote(message.change, message.seq);
      return;
    }
    if (message.type === "ready") {
      if (message.seq !== state.seq) throw new Error("Reconnect replay was incomplete.");
      setPeers(message.peers);
      model.collabResend();
      model.readOnly = false;
      update({ status: "online", message: undefined });
      return;
    }
    if (message.type === "peers") setPeers(message.peers);
  }

  function openSocket() {
    if (disposed || fatal) return;
    model.readOnly = true;
    update({ status: initialized ? "offline" : "connecting" });
    const url = new URL("/collab", location.href);
    url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const current = new WebSocket(url);
    socket = current;
    current.onopen = () => {
      backoff = 400;
      send({
        type: "join",
        roomId,
        clientId,
        name: displayName,
        ...(initialized ? { afterSeq: state.seq } : {}),
      });
    };
    current.onmessage = (event) => {
      if (current !== socket || disposed) return;
      queue = queue
        .then(() => receive(JSON.parse(String(event.data)) as ServerMessage))
        .catch(fail);
    };
    current.onclose = () => {
      if (disposed || fatal || current !== socket) return;
      // Finish an initial snapshot/replay before deciding which sequence to resume.
      void queue.then(() => {
        if (disposed || fatal || current !== socket) return;
        model.readOnly = true;
        update({ status: "offline", peers: [] });
        clearTimeout(typingTimer);
        typingActive = false;
        updateChat({ typing: [], agent: null });
        model.collabPeers([]);
        retry = setTimeout(openSocket, backoff);
        backoff = Math.min(backoff * 2, 5000);
      });
    };
    current.onerror = () => {
      /* close owns the reconnect transition */
    };
  }
  openSocket();
  return {
    stopAgent(runId: string): boolean {
      if (
        disposed ||
        state.status !== "online" ||
        socket?.readyState !== WebSocket.OPEN ||
        chat.agent?.status !== "working" ||
        chat.agent.runId !== runId ||
        !runId
      )
        return false;
      // The server checks this identity too; an old Stop click must never stop a newer run.
      send({ type: "agentStop", runId });
      return true;
    },
    sendChat(text: string): boolean {
      const body = text.trim();
      if (state.status !== "online" || socket?.readyState !== WebSocket.OPEN) {
        updateChat({ error: "Reconnect to send your message. Your draft is still here." });
        return false;
      }
      if (!body || body.length > 2000 || pendingChat.size >= 10) {
        updateChat({
          error:
            pendingChat.size >= 10
              ? "Wait for your earlier messages to send."
              : "Write a message of 1–2,000 characters.",
        });
        return false;
      }
      const message: ChatMessage = {
        id: crypto.randomUUID(),
        clientId,
        name: displayName,
        text: body,
        sentAt: new Date().toISOString(),
      };
      pendingChat.set(message.id, message);
      updateChat({ error: null });
      setTyping(false);
      sendChatMessage(message);
      return true;
    },
    setTyping,
    rename(next: string) {
      displayName = next.trim().slice(0, 40) || "Guest";
      model.setRevisionAuthor(displayName);
      if (lastPresence) send({ type: "presence", presence: lastPresence, name: displayName });
    },
    destroy() {
      setTyping(false);
      disposed = true;
      clearTimeout(retry);
      clearTimeout(typingTimer);
      socket?.close(1000);
      model.collabPeers([]);
    },
  };
}
