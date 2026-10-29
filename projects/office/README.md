# WordPad Live

A standalone React editor with Windows XP chrome, DOCX import/export, live multiplayer rooms and MSN Messenger-style room chat with Clippy, a shared AI coworker. Reducto supplies the editor model, page renderer and operational transforms; this project supplies the interface, room server and agent tools.

Read the short [reskinning guide](GUIDE.md). This project installs and runs independently of the repository's Yarn workspaces.

## Run locally

Use Node 22 and make `REDUCTO_NPM_TOKEN` available in your shell through your normal secret manager. The checked-in `.npmrc` references that variable; it contains no token.

```sh
npm ci --ignore-scripts
npm rebuild skia-canvas
npm run dev
```

The native `skia-canvas` renderer lets Clippy inspect page images. Configure Clippy on the **server** with an `ANTHROPIC_API_KEY` provisioned for this application. You can copy `.env.example` to `.env` and set it there; process environment settings take precedence. This is the only supported key name. Keep keys out of browser code and `VITE_` variables. Without a key, document editing and chat still work and Clippy shows **Unavailable**.

Open [localhost:3000](http://localhost:3000). Create a room, then open its link in another tab or browser to edit together. Room links grant editing and download access to anyone who has them; the Node app has no accounts or permission checks. The [production deployment](deploy/README.md) places all routes behind an HTTPS site login.

Opening the app without a room link or choosing **New shared document** creates a fresh welcome document. To use a template, place it at `.data/templates/default.docx` or set `DEFAULT_DOCX` to its file path and restart the server. Existing rooms keep their documents. Templates are runtime data and are excluded from version control. API clients can request an empty document with `{ "blank": true }`.

The Review toolbar has **Track Changes**, **Comment**, and **Review** buttons. Select text before adding an anchored comment; Review opens the comments and changes margin. Set **Author** to your display name: new revisions, comments, and replies use that name, including after reconnects. Renaming leaves earlier author metadata intact. Tracking is a setting for your own editor; other participants choose theirs independently.

```sh
npm test
npm run build
HOST=0.0.0.0 PORT=3000 npm start
```

## Room chat

Open **MSN Messenger** from the desktop shortcut or taskbar, or choose **Open room chat**. Everyone in the document room shares the conversation, with named messages, timestamps and live typing indicators. Each message keeps the display name captured when Send was pressed; changing **Author** affects future messages without rewriting earlier attribution.

The server persists the **last 200 messages** with the room and sends that history on join or reconnect. Messages allow up to **2,000 characters**, with a limit of **10 new messages per writer per 10 seconds**. Pending messages retry with their original IDs, while typing indicators expire and are not saved.

Chat uses the same `/collab` WebSocket and standalone Node process as document editing. It is stored separately from the DOCX, so chat messages do not appear in downloaded documents; comments and tracked changes still do.

## Clippy

Start a message with **@Clippy** to delegate a task, for example: `@Clippy Change the payment period from thirty to sixty days and comment on the change.` Everyone in the room sees its activity and replies. Another addressed message steers the current task; anyone can press **Stop** or send `@Clippy stop`. Steering and stopping preserve edits already saved.

Clippy can read and search paragraphs across the body, headers, footers and notes; edit text, formatting, styles and lists; insert and update tables; add, reply to and resolve comments; and accept or reject specifically requested revisions. Its edits and comments use **Clippy** attribution, with changes tracked while preserving the document's existing tracking setting afterward. It also has page-geometry and PNG tools to check layout using the same SDK and portable fonts as the editor. This is SDK rendering, not an independent Microsoft Word comparison.

Each edit batch validates exact text anchors and the document sequence, then commits atomically through the room's collaboration stream. If a participant edits meanwhile, Clippy must reread before trying again. A whole task can contain several committed batches; stopping it does not roll those batches back.

The runner uses **Vercel AI SDK 7** with Anthropic **Sonnet 5.5** (`claude-sonnet-5-5`) by default. One task runs per room, with at most **four active rooms**, **30 model steps** and **10 minutes** per attempt. Requests, task status and completed tool outcomes are saved with the room. A server restart marks unfinished work **Interrupted**; send `@Clippy continue` explicitly to start a new attempt against the saved document.

The guarded tools borrow Reducto's read–edit–inspect workflow. The optional `exec` tool runs QuickJS scripts over those same JSON operations; it has no Node, network, filesystem or credential access. It exposes a narrower API than Reducto's live facade and shell. See the [tool map](GUIDE.md#clippy-tools) for the supported surface and limits.

## Multiplayer behavior

The server orders edits; Reducto's operational transforms merge concurrent text changes. The SDK also transforms remote cursor and selection positions as text moves, then paints colored carets and selection highlights. Live presence currently covers the **main document body**; selections inside headers, footers and notes are not shared.

| Conflict                                                   | Result                                                |
| ---------------------------------------------------------- | ----------------------------------------------------- |
| Text inserted concurrently at the same position            | Both insertions remain, in server acceptance order    |
| The same formatting property changed over overlapping text | The later sequenced value wins                        |
| The same keyed entry or whole DOCX part replaced           | The later sequenced write wins for that entry or part |

Reconnects replay missed edits and resend unacknowledged work with the same operation ID. Presence is live connection state; the saved DOCX and edit history survive process restarts. See the [multiplayer diagram](GUIDE.md#multiplayer).

## Deploy one server

The production Node process serves the built website, fonts and WebSocket endpoint. Route HTTPS and WebSocket upgrades to the same process, and persist `.data` across restarts. Static website hosting alone is insufficient.

```sh
docker build --secret id=reducto_npm_token,env=REDUCTO_NPM_TOKEN -t wordpad-live .
docker run --init --rm -p 3000:3000 -e ANTHROPIC_API_KEY -v wordpad-live-data:/app/.data wordpad-live
```

The build reads the npm token through a BuildKit secret. The runtime image receives neither the token nor `.npmrc`; the command passes an existing Anthropic environment variable at runtime. The Linux amd64 container build has been verified. For the authenticated deployment at `office.mitchellhynes.com`, use the [Caddy and Docker Compose setup](deploy/README.md) instead of publishing port 3000 directly.

| Setting               | Default                                       | Purpose                                                       |
| --------------------- | --------------------------------------------- | ------------------------------------------------------------- |
| `HOST`                | `127.0.0.1`; Docker: `0.0.0.0`                | Listen address                                                |
| `PORT`                | `3000`                                        | HTTP and WebSocket port                                       |
| `DATA_DIR`            | `.data`                                       | Room files; mount persistent storage here                     |
| `DEFAULT_DOCX`        | `DATA_DIR/templates/default.docx`, if present | Template copied into new rooms; read and validated on startup |
| `MAX_UPLOAD_BYTES`    | `10485760`                                    | Maximum imported DOCX size                                    |
| `MAX_ROOMS`           | `100`                                         | Maximum room count                                            |
| `MAX_ROOM_OPERATIONS` | `10000`                                       | Maximum edits retained per room                               |
| `ANTHROPIC_API_KEY`   | Unset                                         | Server-only key enabling Clippy                               |
| `AGENT_MODEL`         | `claude-sonnet-5-5`                           | Anthropic model used by the server                            |

This is a **single-process prototype**. Each room stores its current DOCX, ordered edits, operation IDs, writer ID assignments, recent chat and agent state with delivery receipts in one atomic JSON file. The server persists an edit before acknowledging it, and repeated operation IDs do not apply twice. It has no shared state for multiple server instances, no automatic room expiry and no built-in user authentication; the deployment uses Caddy's site-wide login. Room-link holders can also delegate model work when Clippy is configured.

Fixed bounds: 32 connected editors per room, 10,000 lifetime writer identities, 4 MiB WebSocket messages and 96 MiB saved room files. Imported DOCX archives may contain at most 3,000 entries and expand to at most 64 MiB. Download the document and create a new room when a room reaches its history or size limit.

## Files and endpoints

| Location                                                  | Responsibility                                                                          |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `src/App.tsx`, `src/xp.css`                               | Interface and appearance                                                                |
| `src/Messenger.tsx`, `src/messenger.css`                  | MSN Messenger conversation window                                                       |
| `src/collaboration.ts`, `src/chat-types.ts`               | Ordered updates, reconnects, acknowledgements, presence and chat                        |
| `server/`                                                 | Room and chat storage, sequencing, downloads and WebSocket transport                    |
| `server/coworker.ts`, `server/agent-config.ts`            | Shared task lifecycle, model calls and server-only configuration                        |
| `server/document-tools.ts`, `server/document-executor.ts` | Guarded document edits and isolated scripting                                           |
| `server/layout-tools.ts`                                  | Bounded page geometry and PNG rendering workers                                         |
| `GET /api/health`                                         | Server health                                                                           |
| `POST /api/rooms`                                         | Create a room from the default template, request a blank document, or import DOCX bytes |
| `GET /api/rooms/:id/download`                             | Download the server's saved DOCX                                                        |
| `/collab`                                                 | WebSocket endpoint                                                                      |

The SDK is pinned to `@reductoai/docx` **0.0.29** and `@reductoai/docx-editor` **0.0.11**. Both declare portable-fonts `^0.0.3`, which was unavailable in the accessible registry when this project was built. An explicit override uses **0.0.2**; remove that override and recheck rendering once the required package is available. Fonts are served locally at `/fonts`. The image library `sharp` is overridden to **0.35.5**, which fixes the upstream libheif and librsvg advisories affecting the SDK's pinned version.

References: [Reducto's simple React example](https://docx-internal.reducto.ai/simple-editor/#App.tsx), [full editor](https://docx-internal.reducto.ai/word/). These require authorized Reducto access. Nothing here publishes the app automatically.
