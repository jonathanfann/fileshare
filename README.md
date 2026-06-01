# Fileshare

A simple LAN file-sharing server with a single-page web UI. Upload files from your phone or laptop, browse folders, preview media in the browser, tag and filter content, and edit lyrics sheets — all on your local network.

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

On the first launch, the app asks where files should be stored. Pick any folder on the machine running the server (for example `D:\Fileshare` or `C:\Users\You\Documents\Fileshare`). The path is saved in `fileshare.db` and does not need to be set again.

If you already had files in `D:\Fileshare` from an older version, that folder is detected automatically and used without showing the setup screen.

## Start the server

```bash
npm start
```

Or on Windows:

- **`start.bat`** — runs the server in a console window
- **`start-hidden.vbs`** — runs the server in the background (no console)

Then open **http://localhost:3000** in a browser. The console also prints network URLs (e.g. `http://192.168.1.10:3000`) for other devices on the same LAN.

## Configuration

| Item | Location |
|------|----------|
| Storage folder | First-run setup UI, or **Settings → Change storage folder** (type `fileshare` to confirm) |
| Port | `3000` in `server.js` (`PORT` constant) |
| Database | `fileshare.db` in the project folder (created automatically) |

There is no `.env` file. Category/tag visibility settings are stored in the database and managed from the gear icon in the UI.

To change the storage folder later, open **Settings** (gear icon) → **Change storage folder**. You must type `fileshare` in the confirmation dialog before choosing a new path. Files in the old folder are not moved.

## Features

### Built-in viewer

Click any file to open it in a full-screen viewer modal:

- **Audio** — custom player with play/pause, seek bar, elapsed/remaining time, and volume (remembered in the browser). Supports MP3, WAV, FLAC, OGG, M4A, AAC, and more.
- **Video** — in-browser playback with native controls (MP4, MKV, MOV, WebM, etc.).
- **Images** — JPG, PNG, GIF, WebP, SVG, and other common formats.
- **PDF** — embedded preview in the viewer.
- **Text & code** — read `.txt`, `.md`, `.pro`, `.cho`, and many code file types; edit and save `.txt`, `.md`, `.pro`, and `.cho` in place.
- **Download** — one click from the viewer; download counts are tracked in the database.

### Browse & organize

- Folder navigation with breadcrumbs; folders show recursive size totals.
- Unified file list with search, sortable columns (name, size, modified, downloads), and pagination.
- Tag filters switch to a flat cross-folder view for a given tag.
- **Hidden categories** — hide tagged files by default in Settings, then toggle them back on from the main page.
- Up to **2 tags per file**; assign tags from the list, viewer, or upload queue.

### Upload & create

- Drag-and-drop or file picker; optional tag applies to the whole upload queue.
- **New sheet** — create a new lyrics/chord file (`.pro`, `.cho`, etc.) in the current folder.
- Rename files from the viewer (extension is locked so file types stay valid).

### Other

- **Settings** (gear icon) — manage tags, hide-by-default categories, and change the storage folder.
- **Restart server** — from the header, without leaving the browser (page reconnects automatically).
- Shareable URLs — folder path, tag filter, search, sort, and page are reflected in the address bar.

## Security note

Fileshare is intended for **trusted local networks only**. It has no authentication, binds to all interfaces (`0.0.0.0`), and exposes a server restart endpoint. Do not expose it directly to the internet.

## Project layout

```
fileshare/
├── server.js          # Express API + file storage
├── public/index.html  # Single-page UI
├── fileshare.db       # SQLite (gitignored; created at runtime)
├── start.bat
└── start-hidden.vbs
```
