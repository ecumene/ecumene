# Validation

Checked locally on 28 October 2026 with Node 22.23.1, `@reductoai/docx` 0.0.29 and `@reductoai/docx-editor` 0.0.11.

- The original 17 collaboration and chat tests pass alongside the new AI tests below. They cover real SDK replica convergence for concurrent text and formatting, lost acknowledgements, duplicate retries across restart, presence coordinates, input bounds, browser transport recovery, and named tracked changes/comments. Chat coverage includes room isolation, saved history, author names, retry deduplication across reconnect/restart, typing expiry, retention/migration, validation/rate limits, and recovery after a failed save without interrupting document editing.
- `npm run build`: TypeScript and production Vite build passed. Vite reports large SDK chunks; the largest main bundle is approximately 6.2 MB before gzip. Bundle optimization remains future work.
- Chrome smoke test: two tabs edited one room as Alice and Bob. Bob's named caret and highlighted text selection appeared in Alice's editor. Both edits appeared in the server's exported DOCX.
- The production server loaded the persisted room after restart, preserving both edits. A fresh room opened successfully from the built assets.
- Review UI smoke test: Track Changes produced a tracked insertion and Comment opened an anchored composer. The Review margin displayed the submitted comment under Alice Review; exported DOCX XML retained Alice Review on both the insertion and comment. The automated review test also covers two concurrent authors, rename after a remote reopen, history preservation, and tracking off.
- Messenger UI smoke test: two browser tabs sent messages as Alice Chat and Bob Chat. The other participant's typing indicator appeared, both attributed messages survived reload, and minimizing/reopening preserved a draft. Chat left the DOCX edit sequence unchanged.
- The source archive excludes installed packages, compiled vendor bundles, room files and credentials. `.npmrc` contains an environment-variable placeholder only.

## AI coworker

The Clippy update was checked with Vercel AI SDK 7.0.156, Anthropic provider 4.0.91, Sonnet 5.5 (`claude-sonnet-5-5`), QuickJS 0.32.0 and skia-canvas 3.0.8.

- Final `npm test`: **48/48 passed**. Final `npm run build`: TypeScript and production Vite build passed.
- Automated coverage includes the real SDK edit pipeline, atomic batch rollback, stale-sequence rejection, Clippy attribution, scoped stories, tables and review operations. QuickJS tests exercise asynchronous tool calls, state, CPU/memory limits and the absence of Node, network and host-file access.
- Shared-agent tests cover durable task claims, retry deduplication, another participant's steering and Stop, rejected writes from older tasks, restart interruption, missing configuration, incomplete model responses, failed terminal saves and delayed recovery. Failed initial claims retry with a one-second backoff and a ten-attempt cap; tests verify no provider call before a durable claim and cancellation of stale retries. Browser transport tests cover agent status and assistant identity.
- Six page-tool tests cover real pagination, headers/footers and table text, bounded windows, PNG output as a model file part, metadata-only checkpoints, transient image eviction, stale revisions, invalid pages, worker cancellation/deadlines and rejecting documents above 200 pages.
- A real Sonnet run in a synthetic room used `exec` to replace and bold a clause, anchor a comment and append a 2×2 table in one committed batch. It read back the document, revisions, comment and table, then called `render_page`. The model received a 1224×1584 PNG and returned a completed response. Exported DOCX XML retained the revised text, formatting, table and Clippy authorship on revisions and the comment.
- In two in-app browser tabs, Alice and Bob both received the edits, Clippy's activity and its reply. Alice redirected Bob's running task; the prior run was saved as superseded and the replacement completed. Bob then stopped Alice's next task, and both the public status and persisted state became cancelled. Those read-only follow-up tasks left the document sequence unchanged.
- Browser visual inspection confirmed the revised bold text, tracked deletion, inserted table and Messenger status. Tests used synthetic text; no customer document was sent to the model for these checks. The configured Anthropic key stays in the server process and is excluded from the source archive and browser build.

These checks establish the tested flows, not equivalence with Reducto's agent across arbitrary tasks. The tools expose a guarded subset of document operations. Rendering uses the SDK's final view and portable fonts; it does not establish Microsoft Word fidelity. Guest JavaScript bounds do not bound all host SDK memory or parsing time.

## Deployment preparation — 29 October 2026

- The standalone project passes 53/53 tests, including app-specific credential configuration and directory-sync durability. TypeScript, repository lint, and formatting checks pass.
- The Linux amd64 Docker image builds successfully. All six page-tool tests pass inside the image with networking disabled, including native PNG rendering. The patched `sharp` 0.35.5 dependency audit reports zero vulnerabilities for this project.
- Fourteen isolated Caddy/app checks pass: unauthenticated pages, APIs, downloads, fonts, and WebSocket handshakes return 401; authenticated room creation, download, join and reconnect work; cross-origin requests are rejected. The production-pinned Caddy image validates the configuration and Compose refuses missing credentials. Only ports 80/443 are published.
- These are deployment preparation checks. The hosted domain, production TLS, browser login, and a new personal Anthropic key still require live launch verification.

Portable fonts use the explicit 0.0.2 override described in README. The deployment is a single-process prototype behind a shared site login, without per-document accounts or permissions. These checks do not establish general DOCX fidelity or resolve the SDK formatting bugs found in the earlier fuzz campaign.
