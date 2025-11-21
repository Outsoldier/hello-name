# Off-the-Grid P2P Messaging App

This project demonstrates a small WebRTC chat with end-to-end encryption. A lightweight WebSocket signaling server is only used to exchange SDP offers/answers and ICE candidates; all chat traffic flows directly between peers via a WebRTC DataChannel. A Diffie–Hellman (X25519) exchange derives a shared secret, which is stretched into an AES-256-GCM key for encrypting messages.

## Project layout

```
/client
  index.html       # Minimal UI for creating/joining sessions and chatting
  script.js        # WebRTC + signaling logic
  crypto.js        # E2E encryption helpers (X25519 + AES-256-GCM)
/server
  package.json
  server.js        # WebSocket signaling server
```

## Requirements
- Node.js 18+
- Modern browser with WebRTC and Web Crypto (for X25519 and AES-GCM)

## Running the signaling server

```bash
cd server
npm install
npm start
```

The server listens on `ws://localhost:3000` by default. Set `PORT` to override.

## Using the client
1. Start the signaling server.
2. Serve the contents of `client/` using any static file host (e.g., `python -m http.server 8000` from the repo root, or open `client/index.html` directly).
3. Open the client in two different browsers or devices.
4. One user clicks **Create session** (a random code is generated). Share that code.
5. The other user enters the same code and clicks **Join session**.
6. After WebRTC connects, the DataChannel opens, a shared secret is derived, and you can exchange encrypted messages directly.

> The signaling server never sees encryption keys or chat content. Sessions are dropped once both peers report a successful DataChannel connection.
