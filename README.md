# Fileshare

A simple LAN file-sharing server with a web UI. Upload, browse, tag, preview, and edit text files from any device on your local network.

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

- Drag-and-drop upload with optional tags (up to 2 per file)
- Folder browsing, search, sort, and pagination
- In-browser viewer/editor for `.txt`, `.md`, `.pro`, and `.cho` files
- Hidden categories — hide tagged files by default and toggle them back on
- Download counts and soft-delete metadata in SQLite

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
