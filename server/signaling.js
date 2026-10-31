import { WebSocket, WebSocketServer } from "ws";

export function createSignalingServer({ port = 3001, host = "0.0.0.0" } = {}) {
  const server = new WebSocketServer({ port, host, path: "/signal" });
  const clients = new Map();
  let nextId = 1;

  function send(client, message) {
    if (client.ws.readyState !== WebSocket.OPEN) return;
    console.log("outgoing", client.id, message);
    client.ws.send(JSON.stringify(message));
  }

  server.on("connection", (ws) => {
    const client = { ws, id: null, name: "" };
    console.log("connected");

    ws.on("message", (data) => {
      console.log("incoming", client.id, data.toString());
      let message;
      try {
        message = JSON.parse(data.toString());
      } catch {
        return send(client, { type: "error", code: "INVALID_MESSAGE" });
      }
      if (!message || typeof message !== "object" || Array.isArray(message)) {
        return send(client, { type: "error", code: "INVALID_MESSAGE" });
      }

      if (message.type === "register") {
        if (client.id !== null) return send(client, { type: "error", code: "ALREADY_REGISTERED" });
        if (typeof message.name !== "string" || !message.name.trim() || message.name.trim().length > 40) {
          return send(client, { type: "error", code: "INVALID_NAME" });
        }
        client.id = nextId++;
        client.name = message.name.trim();
        clients.set(client.id, client);
        return send(client, { type: "registered", id: client.id, name: client.name });
      }
      if (client.id === null) return send(client, { type: "error", code: "REGISTER_FIRST" });
      if (!["connect", "signal", "disconnect"].includes(message.type)) {
        return send(client, { type: "error", code: "INVALID_MESSAGE" });
      }
      if (!Number.isSafeInteger(message.to) || message.to < 1 || message.to === client.id) {
        return send(client, { type: "error", code: "INVALID_PEER", to: message.to });
      }
      const peer = clients.get(message.to);
      if (!peer || peer.ws.readyState !== WebSocket.OPEN) {
        return send(client, { type: "error", code: "PEER_NOT_FOUND", to: message.to });
      }

      if (message.type === "connect") {
        // A consistent initiator also handles both users clicking Connect together.
        send(client, { type: "peer-ready", peerId: peer.id, peerName: peer.name, initiator: client.id < peer.id });
        send(peer, { type: "peer-ready", peerId: client.id, peerName: client.name, initiator: peer.id < client.id });
      } else if (message.type === "signal") {
        send(peer, { type: "signal", from: client.id, signal: message.signal });
      } else {
        send(peer, { type: "peer-left", from: client.id, reason: "Peer disconnected" });
      }
    });

    ws.on("close", (code, reason) => {
      console.log("disconnected", client.id, code, reason.toString());
      if (!clients.delete(client.id)) return;
      // No pairing records: let all online browsers discard this ID if connected.
      for (const peer of clients.values()) {
        send(peer, { type: "peer-left", from: client.id, reason: "Peer went offline" });
      }
    });
    ws.on("error", (error) => console.log("socket error", client.id, error));
  });

  function close() {
    for (const ws of server.clients) ws.terminate();
    return new Promise((resolve) => server.close(resolve));
  }

  return { server, close };
}
