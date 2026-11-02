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

Open `http://localhost:8080`, enter a name and choose **Peerlink signaling server 1** (the default, `wss://peerlink-server-production.up.railway.app/signal`) or **Manual signaling**. In server mode, share your assigned ID and connect to other users by ID. Select a user to chat or send files; disconnecting one user does not affect other connections.

To use your own signaling server, change the server option value in `docs/index.html` to your `ws://localhost:3001/signal` or deployed `wss://host/signal` URL. HTTPS pages require `wss://`.

### Manual signaling

Both users choose Manual signaling after entering their names:

1. One user selects **Create offer**, waits for connection details, then selects **Copy offer / answer** and sends the offer privately to the other user.
2. The other user selects **Paste from clipboard** (or pastes into the box), selects **Create answer from offer**, then copies and sends the answer back.
3. The first user pastes the answer and selects **Apply answer**. Chat and file sharing work as usual once connected.

No signaling server is contacted in manual mode. Offers/answers contain the name and complete SDP with gathered ICE candidates; treat them as private connection data. Use **Cancel pending exchange** to retry or prepare another exchange; already connected users are kept. Clipboard buttons need browser permission and HTTPS/localhost; ordinary copy/paste remains available if access is denied.

For LAN devices, replace localhost with the server's LAN IP and allow port 8080 (and 3001 if using a local signaling server). File receiving requires Chrome/Edge on HTTPS or localhost. WebRTC still uses the configured STUN server in both modes.

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
