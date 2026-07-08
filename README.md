# Fileshare

A simple LAN file-sharing server with a single-page web UI. Upload files from your phone or laptop, browse folders, preview media in the browser, tag and filter content, edit lyrics and chord documents, and group song assets — all on your local network.

## Requirements

- [Node.js](https://nodejs.org/) 18+ (LTS recommended)
- Windows, macOS, or Linux

## Install

```bash
git clone https://github.com/jonathanfann/fileshare.git
cd fileshare
npm install
```

## First run — choose a storage folder

On the first launch, the app asks where files should be stored. Pick any folder on the machine running the server (for example `D:\Media` or `C:\Users\You\Documents\Files`). The path is saved in the database and does not need to be set again.

> **Running in Docker?** The storage location is set by the container's bind mount, not this dialog. See [Changing the storage folder in Docker](#changing-the-storage-folder-in-docker) below.

## Start the server

```bash
npm start
```

Or on Windows:

- **`start.bat`** — runs the server in a console window
- **`start-hidden.vbs`** — runs the server in the background (no console)

Then open **http://localhost:3000** in a browser. The console also prints network URLs (e.g. `http://192.168.1.10:3000`) for other devices on the same LAN.

## Run with Docker

For self-hosting on any machine (Linux NAS, mini-PC, etc.):

```bash
docker compose up -d --build
```

Open **http://localhost:3000**. Data persists in `./data/files` (uploads) and `./data/db` (SQLite).

Environment variables (set in `docker-compose.yml` or override):

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `3000` | Listen port |
| `SHARE_DIR` | `/data/files` | File storage path **inside the container** (leave as-is) |
| `SHARE_HOST_DIR` | `./data/files` | **Host** folder mapped to `/data/files` (set in `.env`; this is where files actually live) |
| `DB_PATH` | `/data/db/fileshare.db` | SQLite database path (must match the `./data/db` volume mount) |
| `DISPLAY_SHARE_DIR` | _(from `.env`)_ | Host path shown in the UI header |
| `DOCKER` | `1` | Restart reloads from bind-mounted source (see Auto-start section) |

When `SHARE_DIR` is set and valid, first-run folder setup is skipped automatically.

### Changing the storage folder in Docker

In Docker, **do not** use the in-app "Change storage folder" dialog — a path typed there is resolved
inside the Linux container, not on your host. The real location is the bind mount
`${SHARE_HOST_DIR:-./data/files}:/data/files` in `docker-compose.yml`. To move it:

1. Move or copy your files to the new host folder.
2. In `.env` (gitignored), set the host mount source and the display path:
   ```
   SHARE_HOST_DIR=D:/Media
   DISPLAY_SHARE_DIR=D:\Media
   ```
   Use forward slashes for `SHARE_HOST_DIR` (Docker mount source); `DISPLAY_SHARE_DIR` is just the
   header label, so write it however you like.
3. Apply it: `docker compose up -d`.

The tracked `docker-compose.yml` keeps the generic `./data/files` default, so no machine-specific path
is ever committed.

### Migrate native install to Docker

If you already run Fileshare with `npm start` and store files elsewhere (for example `D:\Media`):

```powershell
powershell -ExecutionPolicy Bypass -File scripts/migrate-to-docker.ps1
docker compose up -d --build
```

This copies your database into `./data/db/` and your share folder into `./data/files/`.

## Auto-start on login

Fileshare does **not** auto-start by itself. After a reboot you need either Docker (recommended) or a Windows Startup entry for native Node.

### Docker (recommended)

1. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/).
2. Enable **Settings → General → Start Docker Desktop when you sign in**.
3. From the project folder, run once:

   ```bash
   docker compose up -d --build
   ```

The compose file sets `restart: unless-stopped`, so when Docker starts after login the Fileshare container comes back automatically. Expect a short delay (30–60 seconds) after sign-in before **http://localhost:3000** responds.

Verify after a reboot:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/verify-auto-start.ps1
```

Use `docker compose restart` only if the in-app restart button fails.

**Restart server button (Docker):** `server.js`, `public/`, and the build stamp script are bind-mounted from your project folder. Clicking **Restart server** exits and recreates the container process, re-reads those files from disk, and refreshes the page — the same workflow as native `npm start`, without rebuilding the image. Run `docker compose up -d --build` only when `package.json` dependencies change.

### Native Node (Windows fallback)

If you prefer bare `node server.js` without Docker:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-windows-startup.ps1
```

This adds a Startup shortcut that runs `start-hidden.vbs` (background, no console). Remove with `-Remove`.

## Configuration

| Item | Location |
|------|----------|
| Storage folder | First-run setup UI, **Settings → Change storage folder**, or `SHARE_DIR` env (Docker) |
| Port | `PORT` env var or default `3000` |
| Database | `DB_PATH` env var or `fileshare.db` in the project folder |

Category/tag visibility settings are stored in the database and managed from the gear icon in the UI.

## Features

### Built-in viewer

- **Audio** — custom player with seek, volume (remembered in browser)
- **Video**, **images**, **PDF** — in-browser preview
- **Markdown** (`.md`) — rendered view with **Save as PDF** (browser print)
- **ChordPro** (`.pro`, `.cho`) — chord/lyric layout in viewer; create new documents from **New document**
- **Text edit** — edit and save `.txt`, `.md`, `.pro`, `.cho` in place
- **Song bar** — when a file belongs to a song group, switch between linked assets in the viewer
- **Add to song…** — attach the open file to a song group from the viewer

### Browse & organize

- **Browse**, **Documents**, and **Songs** tabs
- **Song groups** — name a song and attach lyrics, demos, final mixes, etc.; browse assets from the Songs tab
- Tag filters (flat cross-folder search); **folder-level tags** inherit to files when filtering
- Up to **2 tags per file or folder**
- Hidden categories, search, sort, pagination, shareable URLs

### Upload & create

- Drag-and-drop upload with optional tag
- **New document** — shared name modal for `.md`, `.txt`, `.pro`, `.cho`

## Security note

Fileshare is intended for **trusted local networks only**. No authentication; binds to `0.0.0.0`. Do not expose directly to the internet.

## Project layout

```
fileshare/
├── server.js
├── public/
│   ├── index.html       # Thin HTML shell
│   ├── css/app.css
│   └── js/
│       ├── main.js      # ES module entry
│       ├── app.js       # Application logic
│       ├── util.js      # DOM helpers, formatters, file types
│       ├── chordpro.js  # ChordPro renderer
│       └── ui/          # toast + future splits
├── Dockerfile
├── docker-compose.yml
├── scripts/
│   ├── migrate-to-docker.ps1
│   ├── install-windows-startup.ps1
│   └── verify-auto-start.ps1
└── TODO.md
```

Rebuild the frontend after editing `public/index.monolith.html` (legacy backup) or patching sources:

```bash
node scripts/build-all.js
```
