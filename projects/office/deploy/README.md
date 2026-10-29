# Office deployment

This runs one WordPad Live server on a persistent Linux host. Caddy provides HTTPS and requires the `mitch` login for every application route, including `/api/*`, downloads, and the `/collab` WebSocket handshake. Only ports 80 and 443 are published; the Node port stays on Docker's private network. Caddy preserves the public Host header, which the app checks against browser Origin headers.

Use one Lightsail instance with Docker Engine and the Compose plugin. Start with 4 GB RAM for rendering and Clippy; this is a pilot size, not a tested capacity guarantee. Attach a static IP, point the Route53 `office.mitchellhynes.com` A record to it, and allow inbound TCP 80/443. Keep administrative access restricted. Do not run multiple app replicas: room sequencing and locks live in one Node process.

## Supply the application image

Build for the host's Linux architecture from `projects/office`, using the existing BuildKit secret. Keep the Reducto token in your secret manager or shell; never use a Docker build argument for it.

```sh
docker build --platform linux/amd64 \
  --secret id=reducto_npm_token,env=REDUCTO_NPM_TOKEN \
  -t wordpad-live:release .
docker save -o /tmp/wordpad-live.tar wordpad-live:release
```

Transfer the archive privately, then run `docker load -i /path/to/wordpad-live.tar` on the host. Alternatively, push and pull through a **private** registry with your normal registry authentication. Compose uses `pull_policy: never`, so the selected image must already be present. The image contains the private SDK; do not publish it to a public registry. Build inside Docker instead of copying macOS `node_modules`.

## Configure host-local secrets

On the host, create a private directory outside the checkout, such as `~/.config/wordpad-live`, with mode 700. Create `app.env` inside it with mode 600 using your editor or secret manager:

```dotenv
ANTHROPIC_API_KEY=replace-with-an-app-specific-key
AGENT_MODEL=claude-sonnet-5-5
```

Use a dedicated key for this app. An absent Anthropic key leaves editing/chat available and shows Clippy as unavailable. The secrets file must exist, even when intentionally running without Clippy. It is injected only into the app container and is never mounted in Caddy or used during the image build.

Generate a new strong password in your password manager. Run the hash command interactively and enter that password when prompted, so the plaintext is not placed in command arguments or shell history:

```sh
docker run --rm -it caddy:2-alpine caddy hash-password
```

In this `deploy` directory, copy `.env.example` to `.env`, set its mode to 600, and edit the image name, absolute `OFFICE_SECRETS_FILE` path, and generated hash. Keep the hash single-quoted to preserve its `$` characters. Missing or empty hashes stop Compose before startup; Caddy also rejects an invalid hash. Store the plaintext password only in your password manager and share it separately from room links. This is a shared site login, not per-document authorization or verified author identities.

## Start and verify

Run these commands from `projects/office/deploy` on the host:

```sh
docker compose config --quiet
docker compose up -d
docker compose ps
```

Use `config --quiet`: ordinary `docker compose config` prints the resolved secret environment. Caddy obtains its certificate after DNS points to this host. The first startup waits for the Node health check. No certificate files need to be committed.

Verify that an unauthenticated HTTPS request to the homepage and `/api/health` returns 401. Sign in as `mitch` in Chrome, create a synthetic document, and open the same room in a second browser tab. Check edits, chat, Clippy, a rendered page, downloads, and reconnect after closing/reopening a tab. Restart the app container and confirm the document and chat persist. Reject a deployment that passes health checks but fails Linux page rendering or authenticated WebSocket reconnects.

## Keep data and update safely

`office-data` holds documents, ordered edits, chat, and agent state; `office-caddy-data` holds TLS assets; `office-caddy-config` holds Caddy runtime configuration. These named volumes survive container replacement and `docker compose down`. **Never use `docker compose down --volumes` for an update.** The image's `/app/.data` directory belongs to the Node user; a new named volume inherits that ownership. Restored data must remain writable by uid 1000.

Enable daily Lightsail snapshots and periodically test a restore. For a separate consistent export, stop the app while copying `office-data`, then start it again. Treat backups as private document/chat data. No user documents or templates are included in this source deployment; without a host-provided template, new rooms use the welcome document.

For an update, load or privately pull a uniquely tagged image, update `OFFICE_IMAGE`, and run `docker compose up -d`. The saved room data stays in place; active Clippy tasks become interrupted and require an explicit new request. Keep the previous image for rollback. The pilot caps new rooms at ten; it does not expire them automatically. Monitor host memory and disk because saved rooms and history are loaded into memory.

To rotate the site password, generate a new hash, change `.env`, and recreate Caddy with `docker compose up -d --force-recreate caddy`. This also closes existing WebSockets, forcing reconnects through the new login. To rotate the model key, update the private `app.env` and recreate the app with `docker compose up -d --force-recreate app`.

## DNS

The repository's existing GitHub deployment keys cannot manage Route 53. Use an authenticated AWS profile for the Ecumene account when running the constrained helper from the repository root:

```sh
AWS_PROFILE=ecumene-office python3 .github/scripts/office-dns.py
AWS_PROFILE=ecumene-office python3 .github/scripts/office-dns.py --ipv4 YOUR_SERVER_STATIC_IP
```

The first command only inspects DNS. The second creates only the missing `office.mitchellhynes.com` A record after checking the authoritative zone's nameservers. It refuses to overwrite a different record.
