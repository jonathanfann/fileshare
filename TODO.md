# Fileshare — future work

Notes for agents and contributors.

## Frontend modularization (partial)

Done:

- `public/css/app.css` — styles extracted from HTML
- `public/index.html` — thin shell + ES module entry
- `public/js/util.js` — DOM helpers, icons, file types, formatters
- `public/js/ui/toast.js` — toast notifications
- `public/js/chordpro.js` — ChordPro renderer
- `public/js/app.js` — main application logic
- `public/js/main.js` — module entry point

Optional next steps:

- Move remaining `app.js` logic into `ui/modals.js`, `ui/viewer.js`, `ui/file-list.js`, `ui/upload.js`, `state.js`, `api.js`
- Lightweight bundler (esbuild/vite) if module count grows
- TypeScript for API contracts
- Split `server.js` into `server/routes/*.js`

### Constraints to preserve

- No build step required for deploy (`npm start` + static `public/`)
- Custom modals only — no `alert`, `confirm`, or `prompt`
- LAN-only today; no auth layer yet (see **VPS & auth** below)

## Quality checks

- **ESLint** — catches duplicate declarations (`no-redeclare`), syntax issues, etc.
- **`npm run check`** — ESLint + `node --check` on all project JS
- **Cursor hooks** — `.cursor/hooks.json` runs `npm run check` on agent `stop` and `sessionEnd`

Run manually: `npm run lint` or `npm run check`

## Cache busting

`npm start` runs `scripts/stamp-build.js`, writing `public/.build-id`. The server injects that id into CSS/JS URLs (`?v=…`) so browsers pick up changes without a hard refresh.

## Song groupings

Implemented: `songs` + `song_assets` tables, Songs tab, viewer asset bar, Add to song…, song tags/notes/types, asset list with grouping.

### Phase C — Song studio view (implemented)

**List | Studio** toggle on song detail (`?view=songs&song=<id>&layout=studio`). Browse-only chrome (tag pills, hidden categories, breadcrumbs) is hidden on song detail; restored when leaving.

Studio layout:

- **Notes strip** — always visible at top (song banner).
- **Version rail** — assets grouped by type (Audio, Lyrics & charts, …), labeled by Type, click to select.
- **Main panel** — inline preview or edit for selected asset (markdown, ChordPro, plain text).
- **Listen while transcribing** — pinned audio player when the song has an audio asset: pick which recording to play; playback continues while editing a lyrics/chord document in the main panel.
- **+ New document** on song banner — create `.md`/`.pro`/… in current folder, auto-add to song as Type `Lyrics`, opens in studio edit mode.

**Compare** (later) — side-by-side lyrics or A/B audio between two assets.

Hide **New document** in the global header when on song detail (use song-scoped create instead).

Future (post–Phase C):

- Auto-group by folder/filename patterns
- Allow one file in multiple songs

### Documents tab (formerly “Sheets”)

UI label is **Documents** / **New document**. URL and API use `view=documents` (`view=sheets` still accepted for old links).

## Docker self-hosting

Implemented: `Dockerfile`, `docker-compose.yml`, `PORT` / `SHARE_DIR` / `DB_PATH` env vars.

Port is already configurable: set `PORT=80` (or any value) in env / `docker-compose.yml` and map `80:80` in `ports`. On Linux, binding to port 80 may require root or `cap_net_bind_service`; common VPS pattern is app on `3000` + reverse proxy on `80`/`443`.

## VPS & auth (plan — not implemented)

Goal: run Fileshare on a remote VPS (Docker or native) without exposing an open upload/delete API to the internet.

### Deployment shape (pick one)

| Approach | Port 80/443 | Auth | App changes |
|----------|-------------|------|-------------|
| **A. VPN only** (Tailscale, WireGuard) | Optional; often internal IP | Network membership | None |
| **B. Reverse proxy** (Caddy, nginx, Traefik) | Proxy on 80/443 → app on `PORT` | Basic auth, OAuth, Authelia, Cloudflare Access | None or minimal |
| **C. Built-in auth** | App or proxy on 80 | Login in UI + session/API key | Significant |

Document chosen approach in README when implemented.

### If built-in auth (approach C) — scope to design

- **Session model** — HTTP-only cookie vs Bearer token; login page; logout; password hash (bcrypt/argon2) in SQLite
- **Protect all mutating routes** — upload, rename, delete, move, tags, songs, settings, share-path, admin restart
- **Protect reads** — file list, file download/stream, `/api/*` (or risk leaking entire share)
- **Admin restart** — disable or restrict when `DOCKER=1` / production flag; never public without auth
- **First-run setup** — lock down after initial admin account or when `SHARE_DIR` is preset (Docker)
- **Optional** — read-only guest role, API keys for scripts, rate limiting on login

### VPS checklist (docs + compose)

- [ ] README section: VPS deploy (clone, `docker compose`, volumes, backups of `./data/files` + `./data/db`)
- [ ] Example `docker-compose` override for `PORT=80` or proxy-on-443 sample (Caddyfile / nginx snippet)
- [ ] Firewall: only 80/443 (or VPN) open; do not publish 3000 publicly unless auth is in place
- [ ] HTTPS — Let’s Encrypt via Caddy/Certbot in front of app
- [ ] Health check / restart policy (`restart: unless-stopped` already in compose)
- [ ] Env reference: `PORT`, `SHARE_DIR`, `DB_PATH`, future `AUTH_*` / `TRUST_PROXY`

### Open questions

- Single shared password vs per-user accounts?
- Auth in-app vs always require external proxy (simpler, less code)?
- Bind `0.0.0.0` vs `127.0.0.1` when behind proxy only?


- Server-side PDF render (puppeteer) if print layout needs more control
- Inline rename modal reuse (viewer rename already inline)
