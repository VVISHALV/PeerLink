/// <reference path="./file-transfer.js" />

const $ = (id) => document.getElementById(id);
let myName = "",
  myId = null,
  socket = null,
  peers = new Map(),
  activePeerId = "";
let manualMode = false;
let manualPending = null;
let manualBusy = false;

function setStatus(s) {
  console.log("[Connection] Status:", s);
  $("signalStatus").textContent = s;
}

function renderChat() {
  const peer = peers.get(activePeerId);
  const open = peer?.channel?.readyState === "open";
  $("chatTitle").textContent = open ? "Chat with " + (peer.name || "Peer") : "Live chat";
  $("chatEmpty").classList.toggle("hidden", open);
  $("chatMessage").disabled = !open;
  $("sendMessage").disabled = !open;
  $("attachFile").disabled = !open;
  const log = $("chatLog");
  log.replaceChildren();
  if (open) {
    peer.messages.forEach((message) => {
      const row = document.createElement("p");
      row.className = message.outgoing ? "message outgoing" : "message";
      if (message.transfer) {
        renderTransfer(row, message.transfer);
      } else {
        row.textContent = (message.outgoing ? "You" : peer.name || "Peer") + ": " + message.text;
      }
      log.append(row);
    });
  }
  log.scrollTop = log.scrollHeight;
}

function renderTransfer(row, transfer) {
  row.classList.add("file-transfer");
  const title = document.createElement("strong");
  const label = transfer.state === "Complete"
    ? (transfer.outgoing ? "Sent" : "Received")
    : (transfer.outgoing ? "Sending" : "Receiving");
  title.textContent = label + ": " + transfer.name;
  const progress = document.createElement("progress");
  const percent = transfer.state === "Complete" ? 100 : transfer.size
    ? Math.min(99, Math.floor(transfer.bytes / transfer.size * 100)) : 0;
  progress.max = 100;
  progress.value = percent;
  progress.setAttribute("aria-label", transfer.name + " transfer progress");
  const detail = document.createElement("small");
  const statusLabel = transfer.state === "Complete" ? label : transfer.state;
  detail.textContent = `${percent}% · ${statusLabel} · ${transfer.bytes.toLocaleString()} / ${transfer.size.toLocaleString()} bytes`;
  row.append(title, progress, detail);
  if (!transfer.done && transfer.state === "Choose where to save") {
    const save = document.createElement("button");
    save.type = "button";
    save.textContent = "Save file";
    save.onclick = () => { void transfer.accept(); };
    row.append(save);
  }
  if (!transfer.done) {
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    cancel.onclick = () => transfer.cancel();
    row.append(cancel);
  }
}

function setupFileTransfer(peer, channel, file = null) {
  const transfer = new FileTransfer(channel, {
    file,
    onUpdate: () => {
      if (peers.has(peer.id) && activePeerId === peer.id) renderChat();
    },
  });
  peer.messages.push({ transfer, outgoing: !!file });
  if (activePeerId === peer.id) renderChat();
}

function addMessage(peer, text, outgoing = false) {
  if (!peers.has(peer.id)) return;
  peer.messages.push({ text, outgoing });
  if (activePeerId === peer.id) renderChat();
}

function connected() {
  return [...peers.values()].filter(
    (p) => p.channel && p.channel.readyState === "open",
  );
}

function refresh() {
  const list = connected(),
    box = $("users");
  if (!list.some((p) => p.id === activePeerId)) {
    activePeerId = list[0]?.id || "";
    $("chatMessage").value = "";
  }
  box.replaceChildren();
  $("userCount").textContent = list.length;
  if (!list.length) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = manualMode
      ? "No connected user yet. Exchange an offer and answer to connect."
      : "No connected user yet. Enter the other user's ID to connect.";
    box.append(p);
  }

  list.forEach((p) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "user";
    row.setAttribute("aria-pressed", String(activePeerId === p.id));
    row.setAttribute("aria-controls", "chatLog");
    const name = document.createElement("strong");
    name.textContent = `${p.name || "Peer"} · ID ${p.id}`;
    const state = document.createElement("span");
    state.className = "muted";
    state.textContent = "Connected";
    row.onclick = () => {
      if (activePeerId !== p.id) $("chatMessage").value = "";
      activePeerId = p.id;
      refresh();
      $("chatMessage").focus();
    };
    row.append(name, state);
    box.append(row);
  });
  updateConnectionControls();
  renderChat();
}

function removePeer(peer, notify = true) {
  if (peers.get(peer.id) !== peer || !peers.delete(peer.id)) return;
  if (notify && !manualMode) sendSignal({ type: "disconnect", to: peer.id });
  if (manualPending?.peer === peer) {
    manualPending = null;
    $("manualLocal").value = "";
    $("manualRemote").value = "";
  }
  updateConnectionControls();
  console.log("[Connection] Removing peer:", peer.id, { name: peer.name, connectionState: peer.pc.connectionState, signalingState: peer.pc.signalingState, channelState: peer.channel?.readyState });
  peer.messages.forEach((message) => message.transfer?.cancel());
  peer.messages.length = 0;
  if (peer.channel && peer.channel.readyState !== "closed") peer.channel.close();
  if (peer.pc.connectionState !== "closed") peer.pc.close();
  setStatus((peer.name || "Peer") + " disconnected.");
  refresh();
}
function setupChannel(peer, ch) {
  peer.channel = ch;
  console.log("[Connection] Chat channel attached:", peer.id, { label: ch.label, id: ch.id, readyState: ch.readyState, ordered: ch.ordered, protocol: ch.protocol });
  ch.onopen = () => {
    console.log("[Connection] Chat channel open:", peer.id, { label: ch.label, id: ch.id, readyState: ch.readyState });
    setStatus(`Connected to ${peer.name || "peer"} (ID ${peer.id}).`);
    updateConnectionControls();
    refresh();
  };
  ch.onclosing = () => console.log("[Connection] Chat channel closing:", peer.id, ch.readyState);
  ch.onclose = () => {
    console.log("[Connection] Chat channel closed:", peer.id, ch.readyState);
    removePeer(peer);
  };
  ch.onerror = (event) => {
    console.error("[Connection] Chat channel error:", peer.id, event.error, event);
    setStatus("Data channel error for " + (peer.name || "peer"));
  };
  ch.onmessage = (e) => addMessage(peer, e.data);
  refresh();
}

function makePeer(id, name = "") {
  const pc = new RTCPeerConnection({
      // iceServers: [],
      iceServers: [{urls:"stun:stun.l.google.com:19302"}],
    });
  const p = { id, name, pc, channel: null, messages: [], candidates: [] };
  peers.set(id, p);
  console.log("[Connection] Peer created:", id, { name, configuration: pc.getConfiguration(), connectionState: pc.connectionState, signalingState: pc.signalingState, iceConnectionState: pc.iceConnectionState, iceGatheringState: pc.iceGatheringState });
  pc.onsignalingstatechange = () => console.log("[Connection] Signaling state:", id, pc.signalingState);
  pc.oniceconnectionstatechange = () => console.log("[Connection] ICE connection state:", id, pc.iceConnectionState);
  pc.onicegatheringstatechange = () => console.log("[Connection] ICE gathering state:", id, pc.iceGatheringState);
  pc.onicecandidate = (event) => {
    if (!manualMode && event.candidate && peers.get(id) === p) {
      sendSignal({ type: "signal", to: id, signal: { type: "candidate", candidate: event.candidate.toJSON() } });
    }
  };
  pc.onicecandidateerror = (event) => {
    console.error("[Connection] ICE candidate error:", id, { address: event.address, port: event.port, url: event.url, errorCode: event.errorCode, errorText: event.errorText }, event);
  };
  pc.onnegotiationneeded = () => console.log("[Connection] Negotiation needed:", id, pc.signalingState);
  pc.ondatachannel = (e) => {
    console.log("[Connection] Remote data channel received:", id, { label: e.channel.label, id: e.channel.id, readyState: e.channel.readyState, ordered: e.channel.ordered, protocol: e.channel.protocol, maxRetransmits: e.channel.maxRetransmits, maxPacketLifeTime: e.channel.maxPacketLifeTime });
    if (e.channel.label.startsWith(FileTransfer.prefix)) {
      if (!e.channel.ordered || e.channel.maxRetransmits !== null || e.channel.maxPacketLifeTime !== null) {
        console.warn("[Connection] Rejecting unreliable file channel:", id, e.channel.label);
        e.channel.close();
        return;
      }
      setupFileTransfer(p, e.channel);
    } else if (e.channel.label === "chat") {
      setupChannel(p, e.channel);
    } else {
      console.warn("[Connection] Rejecting unknown data channel:", id, e.channel.label);
      e.channel.close();
    }
  };
  pc.onconnectionstatechange = () => {
    console.log("[Connection] Peer connection state:", id, pc.connectionState);
    if (["disconnected", "failed", "closed"].includes(pc.connectionState)) {
      removePeer(p);
    }
  };
  return p;
}

function sendSignal(message) {
  if (socket?.readyState !== WebSocket.OPEN) return false;
  socket.send(JSON.stringify(message));
  return true;
}

function updateConnectionControls() {
  const registered = myId !== null && socket?.readyState === WebSocket.OPEN;
  $("connectPeer").disabled = !registered;
  $("disconnectPeer").disabled = !peers.size;
  $("peerId").disabled = !registered;
  $("createOffer").disabled = manualBusy || !!manualPending;
  $("createAnswer").disabled = manualBusy || !!manualPending;
  $("applyAnswer").disabled = manualBusy || manualPending?.role !== "offer" || !!manualPending?.applied;
  $("resetManual").disabled = manualBusy || !manualPending;
  $("copyManual").disabled = manualBusy || !$("manualLocal").value;
  $("manualRemote").disabled = manualBusy;
  $("pasteManual").disabled = manualBusy;
}

function clearConnection(notify = true) {
  for (const peer of [...peers.values()]) removePeer(peer, notify);
  updateConnectionControls();
  refresh();
}

async function handleServerMessage(message) {
  if (message.type === "registered") {
    if (!Number.isSafeInteger(message.id) || message.id < 1) throw Error("Invalid server user ID.");
    myId = message.id;
    myName = message.name;
    $("myName").textContent = myName;
    $("myId").textContent = String(myId);
    $("joinButton").disabled = false;
    $("joinStatus").textContent = "";
    $("namePage").classList.add("hidden");
    $("appPage").classList.remove("hidden");
    setStatus("Online. Share your ID or enter another user's ID.");
    updateConnectionControls();
    return;
  }
  if (message.type === "error") {
    const errors = {
      PEER_NOT_FOUND: "That user is not online on this server.",
      INVALID_PEER: "Enter another user's positive integer ID.",
      INVALID_NAME: "Enter a name of 1–40 characters without control characters.",
      RATE_LIMITED: "Too many requests. Please reconnect and try again.",
    };
    const text = errors[message.code] || "Signaling error: " + message.code;
    if (myId === null) {
      $("joinStatus").textContent = text;
      socket?.close();
    } else {
      const peer = peers.get(message.to);
      if (peer && peer.channel?.readyState !== "open") removePeer(peer, false);
      setStatus(text);
      updateConnectionControls();
    }
    return;
  }
  if (message.type === "peer-ready") {
    if (peers.has(message.peerId)) return;
    updateConnectionControls();
    setStatus(`Connecting to ${message.peerName} (ID ${message.peerId})…`);
    const peer = makePeer(message.peerId, message.peerName);
    if (message.initiator) {
      setupChannel(peer, peer.pc.createDataChannel("chat"));
      await peer.pc.setLocalDescription(await peer.pc.createOffer());
      sendSignal({ type: "signal", to: peer.id, signal: { type: "offer", sdp: peer.pc.localDescription.sdp } });
    }
    return;
  }
  const peer = peers.get(message.from);
  if (!peer) return;
  if (message.type === "peer-left") {
    removePeer(peer, false);
    return;
  }
  if (message.type !== "signal") return;
  const signal = message.signal;
  if (!signal || !["candidate", "offer", "answer"].includes(signal.type)) return;
  if (signal.type === "candidate") {
    if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(signal.candidate);
    else peer.candidates.push(signal.candidate);
    return;
  }
  await peer.pc.setRemoteDescription({ type: signal.type, sdp: signal.sdp });
  for (const candidate of peer.candidates.splice(0)) await peer.pc.addIceCandidate(candidate);
  if (signal.type === "offer") {
    await peer.pc.setLocalDescription(await peer.pc.createAnswer());
    sendSignal({ type: "signal", to: peer.id, signal: { type: "answer", sdp: peer.pc.localDescription.sdp } });
  }
}

$("joinForm").onsubmit = (event) => {
  event.preventDefault();
  const name = $("displayName").value.trim();
  if (!name || name.length > 40 || /[\u0000-\u001f\u007f]/.test(name)) {
    $("joinStatus").textContent = "Enter a name of 1–40 characters without control characters.";
    return;
  }
  manualMode = $("signalingUrl").value === "manual";
  $("serverSignaling").classList.toggle("hidden", manualMode);
  $("serverIdentity").classList.toggle("hidden", manualMode);
  $("manualSignaling").classList.toggle("hidden", !manualMode);
  $("manualIdentity").classList.toggle("hidden", !manualMode);
  if (manualMode) {
    myName = name;
    $("myName").textContent = name;
    $("joinStatus").textContent = "";
    $("namePage").classList.add("hidden");
    $("appPage").classList.remove("hidden");
    setStatus("Create an offer, or paste the other user's offer to create an answer.");
    refresh();
    return;
  }
  let url;
  try {
    url = new URL($("signalingUrl").value.trim());
    if (!["ws:", "wss:"].includes(url.protocol) || url.username || url.password || url.hash) throw Error("Use a ws:// or wss:// server URL without credentials or a fragment.");
    if (window.location.protocol === "https:" && url.protocol !== "wss:") throw Error("HTTPS pages require a secure wss:// signaling server.");
  } catch (error) {
    $("joinStatus").textContent = error.message;
    return;
  }
  if (socket && socket.readyState < WebSocket.CLOSING) return;
  $("joinButton").disabled = true;
  $("joinStatus").textContent = "Connecting to signaling server…";
  const ws = new WebSocket(url.href);
  socket = ws;
  let queue = Promise.resolve();
  const timeout = setTimeout(() => {
    if (myId === null && socket === ws) {
      $("joinStatus").textContent = "Registration timed out. Check the server URL and retry.";
      ws.close();
    }
  }, 12_000);
  ws.onopen = () => ws.send(JSON.stringify({ type: "register", name }));
  ws.onmessage = (event) => {
    // Preserve offer/answer/candidate order across asynchronous WebRTC work.
    queue = queue.then(async () => {
      if (socket !== ws || ws.readyState !== WebSocket.OPEN) return;
      const message = JSON.parse(event.data);
      await handleServerMessage(message);
      if (myId !== null) clearTimeout(timeout);
    }).catch((error) => {
      let message = {};
      try { message = JSON.parse(event.data) || {}; } catch { /* Invalid server JSON. */ }
      const peer = peers.get(message.from ?? message.peerId);
      if (peer) removePeer(peer);
      setStatus("Connection failed: " + error.message);
    });
  };
  ws.onerror = () => {
    $("joinStatus").textContent = "Cannot reach the signaling server. Check its URL, TLS certificate, and network access.";
  };
  ws.onclose = () => {
    clearTimeout(timeout);
    if (socket !== ws) return;
    socket = null;
    myId = null;
    clearConnection(false);
    $("myId").textContent = "";
    $("appPage").classList.add("hidden");
    $("namePage").classList.remove("hidden");
    $("joinButton").disabled = false;
    if (!$("joinStatus").textContent || $("joinStatus").textContent === "Connecting to signaling server…") {
      $("joinStatus").textContent = "Signaling connection closed. Continue to get a new ID.";
    }
  };
};

$("connectForm").onsubmit = (event) => {
  event.preventDefault();
  const to = Number($("peerId").value);
  if (!Number.isSafeInteger(to) || to < 1 || to === myId) {
    setStatus("Enter another user's positive integer ID.");
    return;
  }
  if (myId === null) return;
  if (peers.has(to)) {
    setStatus("Already connected or connecting to that user.");
    return;
  }
  const sent = sendSignal({ type: "connect", to });
  setStatus(sent ? "Requesting connection…" : "Signaling server is offline.");
};

$("disconnectPeer").onclick = () => {
  const peer = peers.get(activePeerId) || [...peers.values()][0];
  if (peer) removePeer(peer);
};

let attachmentPeerId = "";
$("attachFile").onclick = () => {
  attachmentPeerId = activePeerId;
  $("attachmentInput").value = "";
  $("attachmentInput").click();
};

$("attachmentInput").onchange = () => {
  const file = $("attachmentInput").files[0];
  const peer = peers.get(attachmentPeerId);
  if (!file) return;
  if (peer?.channel?.readyState !== "open") {
    setStatus("The selected user is no longer connected.");
    return;
  }
  try {
    const channel = peer.pc.createDataChannel(FileTransfer.prefix + crypto.randomUUID(), { ordered: true });
    setupFileTransfer(peer, channel, file);
  } catch (error) {
    setStatus("Cannot attach file: " + error.message);
  } finally {
    $("attachmentInput").value = "";
  }
};

$("sendMessage").onclick = () => {
  const p = peers.get(activePeerId),
    m = $("chatMessage").value.trim();
  if (!m || !p?.channel || p.channel.readyState !== "open") return;
  try {
    p.channel.send(m);
    addMessage(p, m, true);
    $("chatMessage").value = "";
  } catch {
    setStatus("Message could not be sent. Check the peer connection.");
  }
};

$("chatMessage").onkeydown = (e) => {
  if (e.key === "Enter") $("sendMessage").click();
};
