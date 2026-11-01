# PeerLink

WebRTC chat and file sharing with multiple peers. Chat and files travel directly between browsers and are not stored on the signaling server.

## Structure

- `docs/`: static HTML, CSS and JavaScript.
- `Signaling Server/server.js`: standalone WebSocket relay with an in-memory client map.

## Run

Requires Node.js 22+ and npm. Start signaling:

```sh
cd "Signaling Server"
npm ci
npm start
```

From the repository root in another terminal, serve the client:

```sh
python3 -m http.server 8080 --directory docs
```

Open `http://localhost:8080`, enter a name and `ws://localhost:3001/signal`. Share your assigned ID and connect to other users by ID. Select a user to chat or send files; disconnecting one user does not affect other connections.

For LAN devices, replace localhost with the server's LAN IP and allow ports 8080 and 3001. File receiving requires Chrome/Edge on HTTPS or localhost. For HTTPS deployments, use a TLS reverse proxy supporting WebSocket upgrades and a `wss://host/signal` URL.

## Docker

```sh
cd "Signaling Server"
docker build -t peerlink-signaling .
docker run -p 3001:3001 peerlink-signaling
```

Use `-e PORT=...` to change the port (also update `-p`). `.dockerignore` keeps `node_modules`, logs and `.env` out of the image.

## Signaling

The server stores only `{ id, name, ws }` per user, not pairings or sessions. IDs start at 1 and reset on restart. Disconnected clients are removed and online users notified.

- `register`: send `{ type: "register", name }`; receive `{ type: "registered", id, name }`.
- `connect`: send `{ type: "connect", to }`; both receive `peer-ready`. The lower ID creates the offer.
- `signal`: send `{ type: "signal", to, signal }`; target receives `{ type: "signal", from, signal }`.
- `disconnect`: send `{ type: "disconnect", to }`; target receives `peer-left`.

`PORT` defaults to `3001`; `HOST` defaults to `0.0.0.0`. No custom HTTP endpoints or persistence. Full signaling payloads are printed with `console.log`; logs contain sensitive connection data, so keep them private. This basic relay has no authentication and is intended for trusted users/networks.

WebRTC uses Google's public STUN server. Some networks need TURN (not included). For LAN-only connectivity, set `iceServers: []` in `docs/script.js`.

## Debug in ZCode

Select **Launch Signaling Server** in Run and Debug. Alternatively, run `node --inspect server.js` from `Signaling Server/` and choose **Attach to Signaling Server**. Stop an existing server before launching another on the same port.

## Check

Connect three browser tabs, exchange messages/files with multiple peers, and disconnect one peer to confirm the other connections remain open.
