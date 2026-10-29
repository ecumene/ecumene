import type { EditorModel } from "@reductoai/docx-editor";
import { downloadDocx, peerColor } from "@reductoai/docx-editor/model";
import { DocxEditor, useObservable } from "@reductoai/docx-editor/react";
import EditorWorker from "@reductoai/docx-editor/worker?worker";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { emptyChat, type ChatState } from "./chat-types";
import { connectRoom, type Connection } from "./collaboration";
import { Messenger, ClippyIcon, agentModelLabel, agentStatusLabel } from "./Messenger";

const spawnWorker = () => new EditorWorker();
const fontsUrl = new URL("/fonts", location.origin).href;
const initialConnection: Connection = { status: "connecting", pending: false, seq: 0, peers: [] };

async function createRoom(file?: File) {
  const response = await fetch(
    "/api/rooms",
    file
      ? {
          method: "POST",
          headers: {
            "Content-Type":
              "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "X-Document-Name": encodeURIComponent(file.name),
          },
          body: file,
        }
      : { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
  );
  if (!response.ok) throw new Error((await response.text()).slice(0, 300));
  return (await response.json()) as { roomId: string; name: string };
}

function Tool({
  label,
  children,
  action,
  pressed,
  disabled = false,
  wide = false,
}: {
  label: string;
  children: ReactNode;
  action: () => void;
  pressed?: boolean;
  disabled?: boolean;
  wide?: boolean;
}) {
  return (
    <button
      className={`tool-button${wide ? " review-tool" : ""}`}
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={action}
    >
      {children}
    </button>
  );
}

function Toolbar({
  model,
  enabled,
  name,
  onNameChange,
  onNew,
  onOpen,
  onHelp,
}: {
  model: EditorModel | null;
  enabled: boolean;
  name: string;
  onNameChange: (value: string) => void;
  onNew: () => void;
  onOpen: () => void;
  onHelp: () => void;
}) {
  const format = useObservable(model, (m) => ({
    bold: m?.format?.bold,
    italic: m?.format?.italic,
    underline: m?.format?.underline,
    font: m?.format?.font || "Arial",
    size: m?.format?.sizePt || 12,
    alignment: m?.format?.alignment,
    undo: m?.canUndo,
    redo: m?.canRedo,
    list: m?.format?.list,
    zoom: m?.zoom || 1,
    tracking: m?.suggesting,
    canComment: m?.review.canComment,
    reviewOpen: m?.review.open,
    markupCount: m?.review.markupCount || 0,
  }));
  return (
    <>
      <div className="xp-toolbar" role="toolbar" aria-label="Standard">
        <div className="toolbar-group">
          <Tool label="New shared document" action={onNew}>
            <span className="file-icon">▤</span>
          </Tool>
          <Tool label="Open a DOCX in a new room" action={onOpen}>
            <span className="folder-icon">📂</span>
          </Tool>
          <Tool
            label="Download DOCX"
            disabled={!model?.host}
            action={() => {
              if (model) void downloadDocx(model);
            }}
          >
            💾
          </Tool>
        </div>
        <span className="toolbar-separator" />
        <div className="toolbar-group">
          <Tool
            label="Undo (Ctrl+Z)"
            disabled={!enabled || !format.undo}
            action={() => model?.undo()}
          >
            ↶
          </Tool>
          <Tool
            label="Redo (Ctrl+Y)"
            disabled={!enabled || !format.redo}
            action={() => model?.redo()}
          >
            ↷
          </Tool>
        </div>
        <span className="toolbar-separator" />
        <div className="toolbar-group toolbar-optional">
          <Tool
            label="Insert picture"
            disabled={!enabled}
            action={() => {
              void model?.pickImage();
            }}
          >
            🖼
          </Tool>
          <Tool
            label="Insert 2 × 3 table"
            disabled={!enabled}
            action={() => model?.run({ kind: "insertTable", rows: 2, cols: 3 })}
          >
            ▦
          </Tool>
        </div>
        <span className="toolbar-spacer" />
        <label className="zoom-control" title="Zoom">
          <select
            aria-label="Zoom"
            className="xp-select"
            value={Math.round(format.zoom * 100)}
            onChange={(e) => model?.setZoom(Number(e.target.value) / 100)}
          >
            {[50, 75, 90, 100, 125, 150].map((n) => (
              <option key={n} value={n}>
                {n}%
              </option>
            ))}
          </select>
        </label>
        <button className="xp-button guide-button" onClick={onHelp}>
          ? Help
        </button>
      </div>
      <div className="xp-toolbar formatting-toolbar" role="toolbar" aria-label="Formatting">
        <select
          aria-label="Font"
          className="xp-select font-select"
          disabled={!enabled}
          value={format.font}
          onChange={(e) => {
            void model?.run({ kind: "runFormat", format: { font: e.target.value } });
          }}
        >
          {[
            ...new Set([
              format.font,
              "Arial",
              "Georgia",
              "Times New Roman",
              "Courier New",
              "Verdana",
              "Calibri",
            ]),
          ].map((font) => (
            <option key={font}>{font}</option>
          ))}
        </select>
        <select
          aria-label="Font size"
          className="xp-select size-select"
          disabled={!enabled}
          value={format.size}
          onChange={(e) => {
            void model?.run({ kind: "runFormat", format: { sizePt: Number(e.target.value) } });
          }}
        >
          {[...new Set([8, 10, 11, 12, 14, 16, 18, 24, 28, 36, format.size])]
            .sort((a, b) => a - b)
            .map((n) => (
              <option key={n}>{n}</option>
            ))}
        </select>
        <span className="toolbar-separator" />
        <Tool
          label="Bold (Ctrl+B)"
          pressed={!!format.bold}
          disabled={!enabled}
          action={() => model?.toggleBold()}
        >
          <b>B</b>
        </Tool>
        <Tool
          label="Italic (Ctrl+I)"
          pressed={!!format.italic}
          disabled={!enabled}
          action={() => model?.toggleItalic()}
        >
          <i>I</i>
        </Tool>
        <Tool
          label="Underline (Ctrl+U)"
          pressed={!!format.underline}
          disabled={!enabled}
          action={() => model?.toggleUnderline()}
        >
          <u>U</u>
        </Tool>
        <span className="toolbar-separator" />
        {(["left", "center", "right", "justify"] as const).map((align, i) => (
          <Tool
            key={align}
            label={`Align ${align}`}
            pressed={format.alignment === align}
            disabled={!enabled}
            action={() => model?.setAlignment(align)}
          >
            <span className={`align-icon align-${align}`}>{["☰", "≡", "☰", "▤"][i]}</span>
          </Tool>
        ))}
        <span className="toolbar-separator toolbar-optional" />
        <Tool
          label="Bullet list"
          pressed={!!format.list}
          disabled={!enabled}
          action={() => model?.toggleList("bullet")}
        >
          ☷
        </Tool>
        <label className="text-color toolbar-optional" title="Text color">
          <span>A</span>
          <input
            aria-label="Text color"
            type="color"
            defaultValue="#173e73"
            disabled={!enabled}
            onChange={(e) => {
              void model?.run({ kind: "runFormat", format: { color: e.target.value.slice(1) } });
            }}
          />
        </label>
      </div>
      <div className="xp-toolbar review-toolbar" role="toolbar" aria-label="Review">
        <Tool
          wide
          label="Track changes"
          pressed={!!format.tracking}
          disabled={!enabled}
          action={() => model?.setSuggesting(!model.suggesting)}
        >
          ✎ Track Changes
        </Tool>
        <Tool
          wide
          label="Add comment"
          disabled={!enabled || !format.canComment}
          action={() => model?.startComment()}
        >
          ▣ Comment
        </Tool>
        <Tool
          wide
          label="Show comments and changes"
          pressed={!!format.reviewOpen}
          disabled={!model?.host}
          action={() => model?.review.toggle()}
        >
          Review{format.markupCount ? ` (${format.markupCount})` : ""}
        </Tool>
        <span className="toolbar-spacer" />
        <label className="review-author">
          Author{" "}
          <input
            className="xp-input"
            aria-label="Comment and revision author"
            maxLength={40}
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
          />
        </label>
      </div>
    </>
  );
}

export function App() {
  const [model, setModel] = useState<EditorModel | null>(null);
  const [roomId, setRoomId] = useState<string | null>(
    new URLSearchParams(location.search).get("room"),
  );
  const [name, setName] = useState(
    () =>
      localStorage.getItem("xp-display-name") || `Guest ${Math.floor(Math.random() * 900 + 100)}`,
  );
  const [connection, setConnection] = useState(initialConnection);
  const [chat, setChat] = useState<ChatState>(emptyChat);
  const [messengerOpen, setMessengerOpen] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [clock, setClock] = useState(new Date());
  const fileInput = useRef<HTMLInputElement>(null);
  const starting = useRef(false);
  const session = useRef<ReturnType<typeof connectRoom> | null>(null);
  const initialName = useRef(name);
  const view = useObservable(model, (m) => ({
    name: m?.name || "Connecting.docx",
    page: m?.page || 1,
    pages: m?.ir?.pages.length || 1,
    error: m?.error,
    opening: m?.opening,
    tracking: m?.suggesting,
    author: m?.revisionAuthor || "Guest",
  }));
  const ready = useCallback((next: EditorModel) => {
    next.readOnly = true;
    setModel(next);
  }, []);

  useEffect(() => {
    document.title = `${view.name} — WordPad Live`;
  }, [view.name]);

  useEffect(() => {
    if (roomId || starting.current) return;
    starting.current = true;
    void createRoom()
      .then((room) => {
        const url = new URL(location.href);
        url.searchParams.set("room", room.roomId);
        history.replaceState(null, "", url);
        setRoomId(room.roomId);
      })
      .catch((e) => setError(String(e)));
  }, [roomId]);
  useEffect(() => {
    if (!model || !roomId) return;
    const current = connectRoom(model, roomId, initialName.current, setConnection, setChat);
    session.current = current;
    return () => {
      current.destroy();
      session.current = null;
    };
  }, [model, roomId]);
  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (connection.pending || chat.pendingIds.length) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    addEventListener("beforeunload", warn);
    return () => removeEventListener("beforeunload", warn);
  }, [connection.pending, chat.pendingIds.length]);

  async function newDocument(file?: File) {
    try {
      if (file && !/\.docx$/i.test(file.name)) throw new Error("Choose a .docx document.");
      const room = await createRoom(file);
      // A new room gets a fresh model and writer identity; existing rooms stay untouched.
      const url = new URL(location.href);
      url.searchParams.set("room", room.roomId);
      location.assign(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setError("Copy the room address from your browser’s address bar.");
    }
  }
  function changeName(value: string) {
    initialName.current = value;
    setName(value);
    localStorage.setItem("xp-display-name", value);
    session.current?.rename(value);
  }
  const enabled = connection.status === "online";
  const humanPeers = connection.peers.filter((peer) => peer.id !== "clippy");
  const statusLabel =
    connection.status === "online"
      ? connection.pending
        ? "Saving changes…"
        : "All changes saved"
      : {
          connecting: "Connecting…",
          opening: "Opening document…",
          offline: "Reconnecting · editing paused",
          error: "Connection needs attention",
        }[connection.status];
  const closeMenu = (action: () => void) => {
    setMenu(null);
    action();
  };

  return (
    <div className={`xp-desktop ${maximized ? "is-maximized" : ""}`}>
      <div className="desktop-shortcuts">
        <button onClick={() => setMinimized(false)}>
          <span className="shortcut-icon">▤</span>WordPad Live
        </button>
        <button onClick={() => setMessengerOpen(!messengerOpen)}>
          <span className="shortcut-icon">👥</span>MSN Messenger
        </button>
        <button onClick={() => setHelp(true)}>
          <span className="shortcut-icon">🌐</span>Read me first
        </button>
      </div>
      <main
        className={`xp-window ${minimized ? "is-minimized" : ""}`}
        aria-label="WordPad Live editor"
      >
        <header className="xp-titlebar" onDoubleClick={() => setMaximized(!maximized)}>
          <span className="app-icon">▤</span>
          <span className="window-title">
            {view.name} — WordPad Live <span className="edition-label">XP Edition</span>
          </span>
          <div className="window-controls">
            <button aria-label="Minimize" onClick={() => setMinimized(true)}>
              _
            </button>
            <button aria-label="Toggle maximize" onClick={() => setMaximized(!maximized)}>
              □
            </button>
            <button className="close" aria-label="About WordPad Live" onClick={() => setHelp(true)}>
              ×
            </button>
          </div>
        </header>
        <nav className="xp-menubar" aria-label="Application menu">
          {["File", "Edit", "View", "Insert", "Help"].map((label) => (
            <div className="menu-wrap" key={label}>
              <button
                className={menu === label ? "is-open" : ""}
                onClick={() => setMenu(menu === label ? null : label)}
              >
                {label}
              </button>
              {menu === label && (
                <div className="xp-menu" role="menu">
                  {label === "File" && (
                    <>
                      <button
                        role="menuitem"
                        onClick={() =>
                          closeMenu(() => {
                            void newDocument();
                          })
                        }
                      >
                        New shared document
                      </button>
                      <button
                        role="menuitem"
                        onClick={() => closeMenu(() => fileInput.current?.click())}
                      >
                        Open DOCX…
                      </button>
                      <button
                        role="menuitem"
                        disabled={!model?.host}
                        onClick={() =>
                          closeMenu(() => {
                            if (model) void downloadDocx(model);
                          })
                        }
                      >
                        Download DOCX
                      </button>
                      <button
                        role="menuitem"
                        onClick={() =>
                          closeMenu(() => {
                            void copyInvite();
                          })
                        }
                      >
                        Copy room link
                      </button>
                    </>
                  )}
                  {label === "Edit" && (
                    <>
                      <button
                        role="menuitem"
                        disabled={!enabled || !model?.canUndo}
                        onClick={() => closeMenu(() => model?.undo())}
                      >
                        Undo
                      </button>
                      <button
                        role="menuitem"
                        disabled={!enabled || !model?.canRedo}
                        onClick={() => closeMenu(() => model?.redo())}
                      >
                        Redo
                      </button>
                      <button role="menuitem" onClick={() => closeMenu(() => model?.selectAll())}>
                        Select all
                      </button>
                    </>
                  )}
                  {label === "View" && (
                    <>
                      {[75, 100, 125].map((n) => (
                        <button
                          key={n}
                          role="menuitem"
                          onClick={() => closeMenu(() => model?.setZoom(n / 100))}
                        >
                          {n}% zoom
                        </button>
                      ))}
                      <button
                        role="menuitem"
                        onClick={() => closeMenu(() => setMaximized(!maximized))}
                      >
                        Toggle maximize
                      </button>
                    </>
                  )}
                  {label === "Insert" && (
                    <>
                      <button
                        role="menuitem"
                        disabled={!enabled}
                        onClick={() =>
                          closeMenu(() => {
                            void model?.pickImage();
                          })
                        }
                      >
                        Picture…
                      </button>
                      <button
                        role="menuitem"
                        disabled={!enabled}
                        onClick={() =>
                          closeMenu(() => model?.run({ kind: "insertTable", rows: 2, cols: 3 }))
                        }
                      >
                        Table (2 × 3)
                      </button>
                    </>
                  )}
                  {label === "Help" && (
                    <button role="menuitem" onClick={() => closeMenu(() => setHelp(true))}>
                      About & reskinning guide
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
          <span className="menu-tagline">A little nostalgia. A shared document.</span>
        </nav>
        <Toolbar
          model={model}
          enabled={enabled}
          name={name}
          onNameChange={changeName}
          onNew={() => {
            void newDocument();
          }}
          onOpen={() => fileInput.current?.click()}
          onHelp={() => setHelp(true)}
        />
        {(error || connection.message || view.error) && (
          <div className="error-banner" role="alert">
            <span>{error || connection.message || view.error}</span>
            <button className="xp-button" onClick={() => setError(null)}>
              Dismiss
            </button>
          </div>
        )}
        <div className="xp-workspace" onClick={() => setMenu(null)}>
          <div className="editor-frame">
            <DocxEditor
              className="xp-editor"
              worker={spawnWorker}
              fontsUrl={fontsUrl}
              onReady={ready}
              toolbar={null}
              inspector={null}
              nav={null}
              navClosed={null}
              selection={null}
            />
          </div>
          <aside className="xp-sidebar">
            <h2>Shared workspace</h2>
            <div className="sidebar-body">
              <p className="connection" data-state={connection.status}>
                <span className="connection-dot" />
                {enabled ? "You’re connected" : statusLabel}
              </p>
              <label className="room-field">
                Your display name
                <input
                  className="xp-input"
                  maxLength={40}
                  value={name}
                  onChange={(e) => changeName(e.target.value)}
                />
              </label>
              <p className="hint author-hint">
                Comments and tracked changes are signed as <strong>{view.author}</strong>.
              </p>
              <button
                className="xp-button invite-button"
                disabled={!roomId}
                onClick={() => {
                  void copyInvite();
                }}
              >
                {copied ? "✓ Link copied" : "✉ Invite a friend"}
              </button>
              <button className="xp-button room-chat-button" onClick={() => setMessengerOpen(true)}>
                👥 Open room chat
              </button>
              <p className="hint">
                Open the link in another tab or share it with someone on this server.
              </p>
            </div>
            <h3>
              People here <span>{humanPeers.length + 1}</span>
            </h3>
            <ul className="peer-list">
              <li className="peer">
                <span className="peer-dot" style={{ background: peerColor(name) }} />
                <span>
                  <strong className="peer-name">
                    {name || "Guest"} <small>(you)</small>
                  </strong>
                  <span className="peer-label">
                    {enabled ? "Editing this document" : "Connecting"}
                  </span>
                </span>
              </li>
              {humanPeers.map((peer) => (
                <li className="peer" key={peer.id}>
                  <span className="peer-dot" style={{ background: peerColor(peer.name) }} />
                  <span>
                    <strong className="peer-name">{peer.name}</strong>
                    <span className="peer-label">
                      {peer.presence.anchor === peer.presence.focus
                        ? "Cursor in document"
                        : "Selecting text"}
                    </span>
                  </span>
                </li>
              ))}
              <li
                className="peer clippy-peer"
                data-state={enabled ? (chat.agent?.status ?? "connecting") : "offline"}
              >
                <ClippyIcon />
                <span>
                  <strong className="peer-name">
                    <button className="clippy-open" onClick={() => setMessengerOpen(true)}>
                      Clippy
                    </button>{" "}
                    <small>AI coworker</small>
                  </strong>
                  <span className="peer-label">
                    {agentModelLabel(chat.agent?.model)} · {agentStatusLabel(chat.agent, enabled)}
                  </span>
                  <span
                    className="clippy-peer-activity"
                    title={enabled ? chat.agent?.activity : undefined}
                  >
                    {enabled
                      ? chat.agent?.activity || "Send @Clippy a task in chat."
                      : "Waiting for the room connection."}
                  </span>
                </span>
              </li>
            </ul>
            <div className="sidebar-tip">
              <span className="tip-icon">💡</span>
              <strong>A coworker in your room</strong>
              <p>
                Send <b>@Clippy</b> a task in Messenger. Anyone can steer the work with another
                mention or use Stop.
              </p>
            </div>
            <div className="sidebar-footer">
              Powered by Reducto
              <br />
              <span>docx 0.0.29 · editor 0.0.11</span>
            </div>
          </aside>
        </div>
        <footer className="xp-statusbar">
          <span>
            Page {view.page} of {view.pages}
          </span>
          <span className="status-secondary">
            {humanPeers.length + 1} editor{humanPeers.length ? "s" : ""} here
            {enabled && chat.agent?.status === "working" ? " · Clippy working" : ""}
          </span>
          <span className="save-status">{statusLabel}</span>
          <span
            className={`tracking-status${view.tracking ? " is-tracking" : ""}`}
            title={`New comments and changes are attributed to ${view.author}`}
          >
            {view.tracking ? "Tracking on" : "Tracking off"}
          </span>
          <span className="resize-grip">◢</span>
        </footer>
      </main>
      <Messenger
        open={messengerOpen}
        onClose={() => setMessengerOpen(false)}
        name={name.trim() || "Guest"}
        peers={connection.peers}
        messages={chat.messages}
        typing={chat.typing}
        connected={enabled}
        pendingIds={chat.pendingIds}
        error={chat.error}
        agent={chat.agent}
        onStopAgent={(runId) => session.current?.stopAgent(runId) ?? false}
        onSend={(text) => session.current?.sendChat(text) ?? false}
        onTyping={(active) => session.current?.setTyping(active)}
      />
      <footer className="xp-taskbar">
        <button className="start-button" onClick={() => setHelp(true)}>
          <span>▦</span> start
        </button>
        <button className="task-button" onClick={() => setMinimized(!minimized)}>
          <span>▤</span> WordPad Live
        </button>
        <button
          className="task-button messenger-task-button"
          aria-label="Open room chat"
          aria-pressed={messengerOpen}
          onClick={() => setMessengerOpen(!messengerOpen)}
        >
          <span>👥</span> MSN Messenger{chat.messages.length ? ` (${chat.messages.length})` : ""}
        </button>
        <span className="taskbar-spacer" />
        <div className="task-tray">
          <span title={statusLabel}>🖧</span>
          <time>{clock.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time>
        </div>
      </footer>
      <input
        ref={fileInput}
        type="file"
        accept=".docx"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void newDocument(file);
          e.target.value = "";
        }}
      />
      {help && (
        <div className="dialog-backdrop" onClick={() => setHelp(false)}>
          <section
            className="xp-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="help-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="xp-titlebar">
              <span id="help-title" className="window-title">
                About WordPad Live
              </span>
              <div className="window-controls">
                <button className="close" aria-label="Close help" onClick={() => setHelp(false)}>
                  ×
                </button>
              </div>
            </header>
            <div className="dialog-body">
              <div className="about-mark">▤</div>
              <h2>Good ideas travel together.</h2>
              <p>
                A real DOCX editor wearing its favorite 2001 outfit. Invite someone, type together,
                and take your document home as a .docx.
              </p>
              <h3>Make it your own</h3>
              <ol>
                <li>
                  Use <code>DocxEditor</code> for pages, input and layout.
                </li>
                <li>
                  Pass <code>null</code> or your own React nodes into its chrome slots.
                </li>
                <li>
                  Read toolbar state with <code>useObservable</code>.
                </li>
                <li>
                  Send commands through <code>EditorModel</code>.
                </li>
                <li>
                  Change <code>src/xp.css</code> to give it a different decade.
                </li>
              </ol>
              <p>
                The project’s <strong>GUIDE.md</strong> has the code and the multiplayer diagram.{" "}
                <strong>README.md</strong> covers running and hosting it.
              </p>
              <p className="hint">
                Live cursors currently cover the document body. Rooms are shared by link and stored
                on this server. Use synthetic documents on a public demo.
              </p>
              <a
                href="https://docx-internal.reducto.ai/simple-editor/#App.tsx"
                target="_blank"
                rel="noreferrer"
              >
                Reducto’s headless example ↗
              </a>
            </div>
            <div className="dialog-actions">
              <button
                className="xp-button"
                autoFocus
                onClick={() => {
                  setHelp(false);
                  model?.focusInput();
                }}
              >
                OK
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
