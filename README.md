# PulseChat

A real-time messaging platform built with Node.js, Express and Socket.IO. Users can DM or group-chat with text, **images, voice notes, and video clips** — all recorded or uploaded straight from the browser.

## Features

- Username + password auth (bcrypt-hashed, session-based)
- 1:1 direct messages and group chats
- Real-time delivery via Socket.IO (typing indicators, live presence)
- Send **images** (file picker), **voice notes** (in-browser mic recording via `MediaRecorder`), and **video clips** (in-browser camera recording or upload)
- Profile photos
- Zero external services required — everything (including the database) runs locally

## Tech stack

| Layer     | Choice |
|-----------|--------|
| Server    | Node.js, Express, Socket.IO |
| Database  | SQLite via `better-sqlite3` (schema in [`db/schema.sql`](db/schema.sql)) |
| Frontend  | Plain HTML/CSS/JS — no build step, no framework |
| Media     | Browser `MediaRecorder` + `getUserMedia` APIs, uploaded via `multer` |

## Running it locally

Requires [Node.js](https://nodejs.org) 18+.

```bash
git clone https://github.com/<your-username>/pulsechat.git
cd pulsechat
npm install
npm start
```

Then open **http://localhost:3000** in two different browser profiles (or one normal + one incognito window) to simulate two users chatting with each other.

The SQLite database file and uploaded media are created automatically on first run and are git-ignored, so the repo stays clean.

## Recording audio/video

Voice and video recording use `navigator.mediaDevices.getUserMedia`, which browsers only allow on `localhost` or over HTTPS — so it works out of the box when run locally, but would need a TLS certificate if deployed to a bare HTTP domain.

## Live demo

This is a stateful app with a database and WebSocket connections, so it can't be hosted as a static GitHub Pages site the way a plain HTML/CSS/JS project can. To put a real, working link in this README:

**Demo:** pulsechatinstamessager-production.up.railway.app

## Project structure

```
pulsechat/
├── server.js              # Express app + Socket.IO realtime logic
├── db/
│   ├── schema.sql          # SQLite schema
│   └── init.js             # Opens the DB and applies the schema on boot
└── public/                 # Everything served to the browser
    ├── index.html
    ├── css/style.css
    ├── js/app.js
    └── img/default-avatar.svg
```

## Known limitations (next steps)

- Sessions are stored in memory, so restarting the server logs everyone out. Swapping in `connect-sqlite3` or Redis for session storage would fix that.
- No message editing/deletion yet.
- Video/audio are recorded clips sent as attachments, not live calls — adding WebRTC peer connections for live video calling would be the natural next feature.
