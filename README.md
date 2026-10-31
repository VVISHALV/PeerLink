# PeerLink

WebRTC chat and file sharing with multiple simultaneous peers and an independent Node.js WebSocket signaling server. Select a connected user to chat or send files. Messages stay in browser memory; disconnecting a user clears only that conversation.

## Run locally

Requires Node.js 22+ and npm.

```sh
cd server
npm ci
npm start
```

Serve the UI separately from the repository root:

```sh
python3 -m http.server 8080
```

1. Open `http://localhost:8080` in several tabs or browsers.
2. Enter a name and `ws://localhost:3001/signal`.
3. Share your assigned integer ID. Enter another user's ID and click Connect.
4. Repeat with more users without closing existing connections. Select a user in the sidebar to chat or attach a file.
5. Disconnect selected ends only that user's connection. Closing the tab removes the user from the server's map and notifies all online browsers.

For LAN devices, replace localhost with the host's LAN IP and allow ports 8080/3001. File receiving requires Chrome/Edge and HTTPS or localhost. For HTTPS deployments, use a TLS reverse proxy supporting WebSocket upgrades and enter its `wss://host/signal` URL.

## Simple signaling relay

`server/signaling.js` keeps one `Map` of registered IDs to `{ id, name, ws }`. It does not store peer relationships or sessions. IDs start at 1, increase on registration, and reset on server restart. IDs identify online connections, not authenticated accounts.

Messages:

- `register`: `{ type: "register", name }` → `{ type: "registered", id, name }`.
- `connect`: `{ type: "connect", to }` → both users receive `peer-ready` with the other's ID/name. The lower ID creates the offer, avoiding competing offers when both click Connect.
- `signal`: `{ type: "signal", to, signal }` → the target receives `{ type: "signal", from, signal }`. The server supplies `from` using the registered socket ID.
- `disconnect`: `{ type: "disconnect", to }` → the target receives `peer-left` with the sender's ID.
- Socket close removes the ID and broadcasts `peer-left`. Browsers ignore notifications for users they aren't connected to.

The browser keeps a separate WebRTC connection, candidate queue, chat history and file transfers per peer. Chat and file contents travel over WebRTC, not through the signaling server. This supports multiple separate conversations, not group-message broadcasting.

`HOST` defaults to `0.0.0.0`; `PORT` defaults to `3001`. There is no custom HTTP server, health endpoint, persistence, heartbeat, pairing table or setup timeout. The `ws` library handles the HTTP upgrade internally.

## Logs and limitations

Direct `console.log` calls print full incoming/outgoing signaling data without redaction, including names, SDP, ICE candidates and connection credentials. Keep logs private. Chat/files cannot be logged by this server.

This basic relay is for trusted users/networks: no authentication, invitations, origin filtering or custom rate limits. Incoming connections are accepted automatically. No session IDs are tracked; reconnecting rapidly can encounter delayed signals from an earlier connection. A broken network may take time to be detected; use Disconnect selected to cancel setup.

WebRTC uses Google's public STUN server. Some networks need TURN (not included). For strictly LAN-only connectivity, use `iceServers: []` in `script.js`.

## Validation

```sh
cd server
npm test
```

Tests cover registration, multi-user forwarding, disconnect cleanup and the UI's independent per-peer handling. For a real-browser check, connect three tabs (A↔B, A↔C, B↔C), exchange chat and files independently, disconnect A↔B, and confirm the other connections still work.
