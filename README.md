# FLAPS

FLAPS is a planning-poker / story-estimation app for teams. An Express + Socket.IO
server keeps room state and broadcasts vote and re-vote events in real time; the
browser client is vanilla ES modules served straight from `public/`, so there is no
build step or bundler.

## Requirements

Node.js 20.19 or later (matches the `engines` field in `package.json`).

## Install

```bash
npm install
```

## Run

```bash
npm start
```

Then open <http://localhost:3000>. The server listens on port 3000 by default; set
the `PORT` environment variable to override it:

```bash
PORT=8080 npm start
```

## Test

```bash
npm test
```

Runs the Vitest suite once and exits (unit, property-based, and integration tests).

## Layout

| Path | Contents |
| --- | --- |
| `server.js` | Express app, static file serving, and all Socket.IO room/voting handlers |
| `public/` | Browser client: `index.html`, `app.js`, `styles.css`, and the shared ESM modules (`session-identity.js`, `session-machine.js`, `story-revote.js`) |
| `*.test.js` | Tests colocated with the code they cover — server tests at the root, client tests in `public/` |
