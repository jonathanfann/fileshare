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

On the first launch, the app asks where files should be stored. Pick any folder on the machine running the server (for example `D:\Fileshare` or `C:\Users\You\Documents\Fileshare`). The path is saved in the database and does not need to be set again.

If you already had files in `D:\Fileshare` from an older version, that folder is detected automatically and used without showing the setup screen.

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
| `SHARE_DIR` | `/data/files` | File storage volume |
| `DB_PATH` | `/data/fileshare.db` | SQLite database path |
| `DOCKER` | `1` | Skips in-container restart spawn; use `docker compose restart` |

When `SHARE_DIR` is set and valid, first-run folder setup is skipped automatically.

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
└── TODO.md
```

Rebuild the frontend after editing `public/index.monolith.html` (legacy backup) or patching sources:

```bash
node scripts/build-all.js
```
