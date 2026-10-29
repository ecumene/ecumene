import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";

import type { AgentState, ChatMessage } from "./chat-types";

import "./messenger.css";

export type MessengerProps = {
  open: boolean;
  onClose: () => void;
  name: string;
  peers: readonly { id: string; name: string }[];
  messages: readonly ChatMessage[];
  typing: readonly { id: string; name: string }[];
  connected: boolean;
  onSend: (text: string) => boolean;
  onTyping: (active: boolean) => void;
  pendingIds: readonly string[];
  error: string | null;
  agent?: AgentState | null;
  onStopAgent?: (runId: string) => boolean;
};

const LIMIT = 2000;
const emoticons = [
  ["🙂", "Smile"],
  ["😄", "Big smile"],
  ["😉", "Wink"],
  ["😎", "Cool"],
  ["❤️", "Heart"],
  ["👍", "Thumbs up"],
  ["🎉", "Celebration"],
  ["😮", "Surprised"],
] as const;

function Buddy({ blue = false }: { blue?: boolean }) {
  return (
    <svg className="msn-buddy" viewBox="0 0 36 38" aria-hidden="true">
      <ellipse cx="18" cy="35" rx="14" ry="2" fill="#516879" opacity=".2" />
      <path
        d="M8 32v-5c0-7 4-12 10-12s10 5 10 12v5c-5 3-15 3-20 0Z"
        fill={blue ? "#5a9ed2" : "#74b94d"}
        stroke={blue ? "#3d77ac" : "#548937"}
      />
      <path d="M10 29v-3c0-4 2-7 5-8" fill="none" stroke="#fff" strokeWidth="2" opacity=".55" />
      <circle
        cx="18"
        cy="10"
        r="8"
        fill={blue ? "#a9d7f0" : "#c2e697"}
        stroke={blue ? "#689fc5" : "#86b25f"}
      />
      <path
        d="M13 8c0-3 3-5 6-5"
        fill="none"
        stroke="#fff"
        strokeWidth="2"
        strokeLinecap="round"
        opacity=".75"
      />
    </svg>
  );
}

export function ClippyIcon() {
  return (
    <svg className="clippy-icon" viewBox="0 0 36 42" aria-hidden="true">
      <ellipse cx="19" cy="39" rx="11" ry="2" fill="#516879" opacity=".18" />
      <path
        d="M25 16v13c0 7-13 10-16 2L6 14C4 1 26-1 29 10l2 16c2 14-18 19-24 9"
        fill="none"
        stroke="#627386"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <path
        d="M25 16v13c0 7-13 10-16 2L6 14C4 1 26-1 29 10l2 16c2 14-18 19-24 9"
        fill="none"
        stroke="#d8e1e7"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <ellipse cx="16" cy="14" rx="4.3" ry="5.1" fill="white" stroke="#647686" />
      <ellipse cx="25" cy="13" rx="4.3" ry="5.1" fill="white" stroke="#647686" />
      <circle cx="17" cy="15" r="1.7" fill="#273d54" />
      <circle cx="25" cy="14" r="1.7" fill="#273d54" />
      <path d="m12 7 5-1m6-1 5 1" stroke="#536a7b" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function agentModelLabel(model?: string) {
  return !model || model === "claude-sonnet-5-5" ? "Sonnet 5.5" : model;
}

export function agentStatusLabel(agent: AgentState | null | undefined, connected: boolean) {
  if (!connected) return "Reconnecting";
  if (!agent) return "Checking availability";
  return {
    idle: "Ready to help",
    working: "Working",
    completed: "Task completed",
    cancelled: "Stopped",
    failed: "Task failed",
    interrupted: "Interrupted",
    unavailable: "Unavailable",
  }[agent.status];
}

function messageTime(sentAt: string | number) {
  const date = new Date(sentAt);
  return Number.isNaN(date.valueOf())
    ? null
    : {
        iso: date.toISOString(),
        short: date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
        full: date.toLocaleString(),
      };
}

function messageKey(message: ChatMessage) {
  return JSON.stringify([message.clientId, message.id]);
}

export function Messenger({
  open,
  onClose,
  name,
  peers,
  messages,
  typing,
  connected,
  onSend,
  onTyping,
  pendingIds,
  error,
  agent = null,
  onStopAgent,
}: MessengerProps) {
  const [draft, setDraft] = useState("");
  const [picker, setPicker] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [unread, setUnread] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [stopRequested, setStopRequested] = useState<string | null>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const following = useRef(true);
  const newestMessage = messages.at(-1);
  const newestKey = newestMessage ? messageKey(newestMessage) : null;
  const lastMessageKey = useRef(newestKey);
  const previouslyOpen = useRef(open);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const typingActive = useRef(false);
  const lastTyping = useRef(0);
  const typingCallback = useRef(onTyping);
  const titleId = useId();
  const peopleId = useId();
  const pickerId = useId();
  const pending = new Set(pendingIds);
  const displayName = name.trim() || "Guest";
  const people = peers.filter((peer) => peer.id !== "clippy");
  const participantNames = people.map((peer) => peer.name || "Guest");
  const audience = [...participantNames, "Clippy"].join(", ");
  const typingNames = typing.map((peer) =>
    peer.id === "clippy" ? "Clippy" : peer.name || "Someone",
  );
  const working = connected && agent?.status === "working";
  const modelLabel = agentModelLabel(agent?.model);
  const activity = !connected
    ? "Room connection lost. Waiting for Clippy’s current status."
    : !agent
      ? "Checking Clippy’s availability in this room…"
      : agent.activity ||
        (agent.status === "idle"
          ? "Send @Clippy a task in this conversation."
          : agentStatusLabel(agent, connected));
  const typingLabel =
    typingNames.length === 1
      ? `${typingNames[0]} is typing…`
      : typingNames.length === 2
        ? `${typingNames[0]} and ${typingNames[1]} are typing…`
        : typingNames.length > 2
          ? `${typingNames[0]} and ${typingNames.length - 1} others are typing…`
          : "";

  useLayoutEffect(() => {
    typingCallback.current = onTyping;
  }, [onTyping]);
  useEffect(
    () => () => {
      clearTimeout(typingTimer.current);
      if (typingActive.current) typingCallback.current(false);
    },
    [],
  );

  function stopTyping() {
    clearTimeout(typingTimer.current);
    if (typingActive.current) typingCallback.current(false);
    typingActive.current = false;
  }

  function signalTyping(value: string) {
    clearTimeout(typingTimer.current);
    if (!connected || !value.trim()) {
      stopTyping();
      return;
    }
    const now = Date.now();
    if (!typingActive.current || now - lastTyping.current > 1500) {
      typingCallback.current(true);
      lastTyping.current = now;
    }
    typingActive.current = true;
    typingTimer.current = setTimeout(stopTyping, 2400);
  }

  useEffect(() => {
    if (!open || !connected) {
      clearTimeout(typingTimer.current);
      if (typingActive.current) typingCallback.current(false);
      typingActive.current = false;
    }
  }, [open, connected]);

  useEffect(() => {
    if (!connected || agent?.status !== "working" || agent.runId !== stopRequested)
      setStopRequested(null);
  }, [connected, agent?.status, agent?.runId, stopRequested]);

  useLayoutEffect(() => {
    const added = newestKey !== null && newestKey !== lastMessageKey.current;
    lastMessageKey.current = newestKey;
    if (added && !following.current) setUnread(true);
    if (open && following.current && transcript.current) {
      transcript.current.scrollTop = transcript.current.scrollHeight;
      setUnread(false);
    }
  }, [messages, newestKey, pendingIds, open]);

  useEffect(() => {
    if (open && !previouslyOpen.current) input.current?.focus();
    previouslyOpen.current = open;
  }, [open]);

  function close() {
    stopTyping();
    setPicker(false);
    setPeopleOpen(false);
    onClose();
  }

  function send() {
    const text = draft.trim();
    if (!connected || !text) return;
    try {
      if (!onSend(text)) {
        setSendError("Your message could not be sent. Your draft is still here.");
        return;
      }
    } catch {
      setSendError("Your message could not be sent. Your draft is still here.");
      return;
    }
    setDraft("");
    setSendError(null);
    setPicker(false);
    stopTyping();
    following.current = true;
    setUnread(false);
    input.current?.focus();
  }

  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  }

  function insertAtCursor(text: string) {
    const field = input.current;
    const start = field?.selectionStart ?? draft.length;
    const end = field?.selectionEnd ?? start;
    const next = draft.slice(0, start) + text + draft.slice(end);
    if (next.length > LIMIT) {
      setPicker(false);
      field?.focus();
      return;
    }
    setDraft(next);
    signalTyping(next);
    setPicker(false);
    setSendError(null);
    requestAnimationFrame(() => {
      field?.focus();
      field?.setSelectionRange(start + text.length, start + text.length);
    });
  }

  function mentionClippy() {
    const start = input.current?.selectionStart ?? draft.length;
    insertAtCursor(`${start > 0 && !/\s/.test(draft[start - 1]) ? " " : ""}@Clippy `);
  }

  function stopClippy() {
    if (!working || !agent?.runId || !onStopAgent) return;
    if (onStopAgent(agent.runId)) setStopRequested(agent.runId);
    else
      setSendError(
        "The stop request could not be sent. Check the connection and Clippy’s latest task.",
      );
  }

  function latest() {
    following.current = true;
    setUnread(false);
    if (transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight;
  }

  return (
    <section
      className="msn-window"
      hidden={!open}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        if (picker) setPicker(false);
        else if (peopleOpen) setPeopleOpen(false);
        else close();
      }}
    >
      <header className="msn-titlebar">
        <span className="msn-title-icon">
          <Buddy />
        </span>
        <span id={titleId}>Document conversation</span>
        <button
          className="msn-close"
          onClick={close}
          aria-label="Minimize conversation"
          title="Minimize conversation"
        >
          ×
        </button>
      </header>
      <div className="msn-heading">
        <div className="msn-heading-buddies">
          <Buddy />
          <Buddy blue />
        </div>
        <div className="msn-heading-copy">
          <strong>Messenger</strong>
          <span title={audience}>To: {audience}</span>
        </div>
        <span
          className={`msn-online ${connected ? "is-online" : ""}`}
          title={connected ? "Connected to this document room" : "Waiting for connection"}
        >
          <i />
          {connected ? "Online" : "Offline"}
        </span>
      </div>
      <div className="msn-toolbar">
        <div className="msn-tool-wrap">
          <button
            className="msn-tool"
            aria-expanded={peopleOpen}
            aria-controls={peopleId}
            onClick={() => {
              setPeopleOpen(!peopleOpen);
              setPicker(false);
            }}
          >
            <span className="msn-tool-buddies">
              <Buddy />
            </span>
            People <span className="msn-tool-count">({people.length + 1} + AI)</span>
            <span className="msn-caret">▾</span>
          </button>
          {peopleOpen && (
            <div className="msn-people" id={peopleId}>
              <strong>In this document</strong>
              <ul>
                <li>
                  <Buddy blue />
                  <span>
                    {displayName} <small>(you)</small>
                  </span>
                </li>
                {people.map((peer) => (
                  <li key={peer.id}>
                    <Buddy />
                    <span>{peer.name || "Guest"}</span>
                  </li>
                ))}
                <li className="msn-clippy-person">
                  <ClippyIcon />
                  <span>
                    Clippy <small>AI coworker · {modelLabel}</small>
                    <small>{agentStatusLabel(agent, connected)}</small>
                  </span>
                </li>
              </ul>
              {!people.length && <p>Share the document link to invite someone.</p>}
            </div>
          )}
        </div>
        <span className="msn-tool-divider" />
        <div className="msn-tool-wrap">
          <button
            className="msn-tool"
            aria-expanded={picker}
            aria-controls={pickerId}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setPicker(!picker);
              setPeopleOpen(false);
            }}
          >
            <span className="msn-smile">☺</span>Emoticons<span className="msn-caret">▾</span>
          </button>
          {picker && (
            <div
              className="msn-emoticons"
              id={pickerId}
              role="group"
              aria-label="Choose an emoticon"
            >
              {emoticons.map(([emoji, label]) => (
                <button
                  key={label}
                  title={label}
                  aria-label={label}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => insertAtCursor(emoji)}
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          className="msn-tool msn-mention"
          title="Ask Clippy to work on this document"
          onMouseDown={(event) => event.preventDefault()}
          onClick={mentionClippy}
        >
          <ClippyIcon />
          @Clippy
        </button>
      </div>
      <div className="msn-notice">
        <span aria-hidden="true">ⓘ</span>
        <span>
          {connected
            ? "Everyone can give Clippy a task, steer it with @Clippy, or stop its current task."
            : "Reconnecting… You can keep writing your message."}
        </span>
      </div>
      <div
        className="msn-agent"
        data-state={connected ? (agent?.status ?? "connecting") : "offline"}
      >
        <ClippyIcon />
        <div className="msn-agent-copy">
          <div className="msn-agent-heading">
            <strong>Clippy</strong>
            <span>{modelLabel}</span>
            <span className="msn-agent-status">{agentStatusLabel(agent, connected)}</span>
          </div>
          <p role="status" aria-live="polite">
            {activity}
          </p>
          {working && agent?.requestedBy && (
            <small>Requested by {agent.requestedBy} · anyone can steer or stop</small>
          )}
        </div>
        {working && agent?.runId && (
          <button
            className="msn-stop"
            disabled={!onStopAgent || stopRequested === agent.runId}
            onClick={stopClippy}
            title="Stop Clippy’s current task for everyone"
          >
            {stopRequested === agent.runId ? "Stopping…" : "Stop"}
          </button>
        )}
      </div>
      <div className="msn-history-wrap">
        <div
          className="msn-transcript"
          ref={transcript}
          role="log"
          aria-label="Document conversation messages"
          aria-live="polite"
          aria-relevant="additions text"
          tabIndex={0}
          onScroll={() => {
            const element = transcript.current;
            if (!element) return;
            following.current =
              element.scrollHeight - element.scrollTop - element.clientHeight < 48;
            if (following.current) setUnread(false);
          }}
        >
          {!messages.length && (
            <div className="msn-empty">
              <ClippyIcon />
              <strong>A little help with your document.</strong>
              <p>
                Say hello to the room, or send <b>@Clippy</b> a task. Everyone can follow along and
                steer.
              </p>
            </div>
          )}
          {messages.map((message) => {
            const time = messageTime(message.sentAt);
            return (
              <div
                className={`msn-message${message.role === "assistant" ? " is-assistant" : ""}`}
                key={messageKey(message)}
              >
                <div className="msn-message-heading">
                  <span className="msn-speaker">
                    {message.name || "Guest"} says:{" "}
                    {message.role === "assistant" && <span className="msn-ai-badge">AI</span>}
                  </span>
                  {time && (
                    <time dateTime={time.iso} title={time.full}>
                      {time.short}
                    </time>
                  )}
                </div>
                <p>{message.text}</p>
                {pending.has(message.id) && <span className="msn-pending">Sending…</span>}
              </div>
            );
          })}
        </div>
        {unread && (
          <button className="msn-new-messages" onClick={latest}>
            New messages ↓
          </button>
        )}
      </div>
      <div className="msn-typing" role="status" aria-live="polite">
        {typingLabel || (
          <span className="msn-typing-idle">
            {connected
              ? `${people.length + 1} ${people.length ? "people" : "person"} and Clippy in this conversation`
              : "Your draft will be kept while you reconnect."}
          </span>
        )}
      </div>
      {(error || sendError) && (
        <div className="msn-error" role="alert">
          {error || sendError}
        </div>
      )}
      <div className="msn-compose">
        <div className="msn-input-wrap">
          <textarea
            ref={input}
            aria-label="Chat message"
            placeholder="Type a message, or @Clippy a task…"
            value={draft}
            maxLength={LIMIT}
            rows={3}
            onChange={(event) => {
              setDraft(event.target.value);
              setSendError(null);
              signalTyping(event.target.value);
            }}
            onKeyDown={keyDown}
          />
          <div className="msn-input-help">
            <span>Enter to send · Shift+Enter for a new line</span>
            <span className={draft.length > 1800 ? "is-near-limit" : ""}>
              {draft.length}/{LIMIT}
            </span>
          </div>
        </div>
        <button className="msn-send" disabled={!connected || !draft.trim()} onClick={send}>
          Send
        </button>
      </div>
      <footer className="msn-footer">
        <span className="msn-footer-buddy">
          <Buddy blue />
        </span>
        <span>
          Signed in as <strong>{displayName}</strong>
        </span>
        <span className="msn-footer-brand">Messenger</span>
      </footer>
    </section>
  );
}

export default Messenger;
