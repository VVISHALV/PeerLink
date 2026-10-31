/// <reference path="./file-transfer.js" />

const $ = (id) => document.getElementById(id);
let myName = "",
  peers = new Map(),
  pendingPeerId = "",
  nextId = 1,
  activePeerId = "";

function status(s) {
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
    p.textContent =
      "No connected users yet. Exchange an offer and answer with another browser.";
    box.append(p);
  }

  list.forEach((p) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "user";
    row.setAttribute("aria-pressed", String(activePeerId === p.id));
    row.setAttribute("aria-controls", "chatLog");
    const name = document.createElement("strong");
    name.textContent = p.name || "Peer";
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
  renderChat();
}

function removePeer(peer) {
  if (!peers.delete(peer.id)) return;
  console.log("[Connection] Removing peer:", peer.id, { name: peer.name, connectionState: peer.pc.connectionState, signalingState: peer.pc.signalingState, channelState: peer.channel?.readyState });
  peer.messages.forEach((message) => message.transfer?.cancel());
  peer.messages.length = 0;
  if (pendingPeerId === peer.id) pendingPeerId = "";
  if (peer.channel && peer.channel.readyState !== "closed") peer.channel.close();
  if (peer.pc.connectionState !== "closed") peer.pc.close();
  status((peer.name || "Peer") + " disconnected.");
  refresh();
}
function setupChannel(peer, ch) {
  peer.channel = ch;
  console.log("[Connection] Chat channel attached:", peer.id, { label: ch.label, id: ch.id, readyState: ch.readyState, ordered: ch.ordered, protocol: ch.protocol });
  ch.onopen = () => {
    console.log("[Connection] Chat channel open:", peer.id, { label: ch.label, id: ch.id, readyState: ch.readyState });
    status("Connected to " + (peer.name || "peer"));
    refresh();
  };
  ch.onclosing = () => console.log("[Connection] Chat channel closing:", peer.id, ch.readyState);
  ch.onclose = () => {
    console.log("[Connection] Chat channel closed:", peer.id, ch.readyState);
    removePeer(peer);
  };
  ch.onerror = (event) => {
    console.error("[Connection] Chat channel error:", peer.id, event.error, event);
    status("Data channel error for " + (peer.name || "peer"));
  };
  ch.onmessage = (e) => addMessage(peer, e.data);
  refresh();
}

function makePeer(name = "") {
  const id = "peer-" + nextId++,
    pc = new RTCPeerConnection({
      iceServers: [],
      // iceServers: [{urls:"stun:stun.l.google.com:19302"}],
    });
  const p = { id, name, pc, channel: null, messages: [] };
  peers.set(id, p);
  console.log("[Connection] Peer created:", id, { name, configuration: pc.getConfiguration(), connectionState: pc.connectionState, signalingState: pc.signalingState, iceConnectionState: pc.iceConnectionState, iceGatheringState: pc.iceGatheringState });
  pc.onsignalingstatechange = () => console.log("[Connection] Signaling state:", id, pc.signalingState);
  pc.oniceconnectionstatechange = () => console.log("[Connection] ICE connection state:", id, pc.iceConnectionState);
  pc.onicegatheringstatechange = () => console.log("[Connection] ICE gathering state:", id, pc.iceGatheringState);
  pc.onicecandidate = (event) => {
    console.log("[Connection] Local ICE candidate:", id, event.candidate ? event.candidate.toJSON() : null);
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

function waitIce(pc) {
  console.log("[Connection] Waiting for ICE gathering:", pc.iceGatheringState);
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      if (pc.iceGatheringState === "complete") {
        console.log("[Connection] ICE gathering complete.");
      } else {
        console.warn("[Connection] ICE gathering wait timed out after 15000 ms:", pc.iceGatheringState);
      }
      pc.removeEventListener("icegatheringstatechange", check);
      clearTimeout(timer);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === "complete") finish();
    };
    pc.addEventListener("icegatheringstatechange", check);
    const timer = setTimeout(finish, 15000);
  });
}

async function output(p) {
  await waitIce(p.pc);
  const signal = JSON.stringify({
    type: p.pc.localDescription.type,
    sdp: p.pc.localDescription.sdp,
    peerName: myName,
  });
  console.log("[Connection] Outgoing signaling payload:", p.id, signal);
  return signal;
}

async function readSignal(type) {
  let text;
  console.log("[Connection] Reading incoming signaling:", type);
  try {
    text = await navigator.clipboard.readText();
  } catch (error) {
    console.warn("[Connection] Clipboard read unavailable; using manual signaling:", type, error);
    text = window.prompt("Clipboard access unavailable. Paste the " + type + " here:");
  }
  console.log("[Connection] Incoming signaling payload:", type, text);
  if (text === null) throw Error("Signaling cancelled.");
  let d;
  try {
    d = JSON.parse(text.trim());
  } catch {
    throw Error("Copy valid signaling JSON before clicking this step.");
  }
  if (!d || d.type !== type || typeof d.sdp !== "string" || !d.sdp.trim()) {
    throw Error("Clipboard must contain a valid " + type + ".");
  }
  console.log("[Connection] Incoming signaling validated:", type, d);
  return d;
}

async function copySignal(generate) {
  // Reserve clipboard access during the click, before WebRTC's async work.
  const text = Promise.resolve().then(generate);
  let copied = false;
  try {
    if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": text.then((value) => new Blob([value], { type: "text/plain" })),
        }),
      ]);
    } else {
      await navigator.clipboard.writeText(await text);
    }
    copied = true;
    console.log("[Connection] Outgoing signaling copied to clipboard.");
  } catch (error) {
    console.warn("[Connection] Clipboard write or signaling generation failed:", error);
    // Still await generation: connection errors must not look like copy failures.
  }
  const value = await text;
  if (!copied) {
    console.log("[Connection] Outgoing signaling shown for manual copy:", value);
    const result = window.prompt("Automatic copy unavailable. Copy this signaling data and send it to the other user:", value);
    console.log("[Connection] Manual signaling prompt:", result === null ? "cancelled" : "confirmed");
    if (result === null) return false;
  }
  return copied;
}

function signalingAction(id, action) {
  $(id).onclick = async () => {
    const buttons = [$("createOffer"), $("applyOffer"), $("applyAnswer")];
    buttons.forEach((button) => { button.disabled = true; });
    console.log("[Connection] Signaling action started:", id);
    try {
      await action();
      console.log("[Connection] Signaling action completed:", id);
    } catch (e) {
      console.error("[Connection] Signaling action failed:", id, e);
      status("Error: " + e.message);
    } finally {
      buttons.forEach((button) => { button.disabled = false; });
    }
  };
}

$("joinForm").onsubmit = (e) => {
  e.preventDefault();
  myName = $("displayName").value.trim();
  if (!myName) return;
  $("myName").textContent = myName;
  $("namePage").classList.add("hidden");
  $("appPage").classList.remove("hidden");
};

signalingAction("createOffer", async () => {
  if (peers.has(pendingPeerId)) {
    throw Error("Apply the answer to your pending offer before creating another.");
  }
  const copied = await copySignal(async () => {
    const p = makePeer();
    try {
      setupChannel(p, p.pc.createDataChannel("chat"));
      console.log("[Connection] Creating offer:", p.id);
      const offer = await p.pc.createOffer();
      console.log("[Connection] Offer created; applying local description:", p.id, offer);
      await p.pc.setLocalDescription(offer);
      console.log("[Connection] Local offer applied:", p.id, p.pc.localDescription.toJSON());
      status("Gathering ICE candidates for offer…");
      const value = await output(p);
      pendingPeerId = p.id;
      return value;
    } catch (e) {
      removePeer(p);
      throw e;
    }
  });
  status(copied ? "Offer copied. Send it to the other user." : "Offer ready. Use the manual copy prompt to share it.");
});

signalingAction("applyOffer", async () => {
  // Start the clipboard read in the click handler, before awaiting anything else.
  const offer = readSignal("offer");
  const copied = await copySignal(async () => {
    const d = await offer;
    const p = makePeer(typeof d.peerName === "string" ? d.peerName : "");
    try {
      console.log("[Connection] Applying remote offer:", p.id, d);
      await p.pc.setRemoteDescription({ type: "offer", sdp: d.sdp });
      console.log("[Connection] Remote offer applied:", p.id, p.pc.remoteDescription.toJSON());
      console.log("[Connection] Creating answer:", p.id);
      const answer = await p.pc.createAnswer();
      console.log("[Connection] Answer created; applying local description:", p.id, answer);
      await p.pc.setLocalDescription(answer);
      console.log("[Connection] Local answer applied:", p.id, p.pc.localDescription.toJSON());
      status("Gathering ICE candidates for answer…");
      return await output(p);
    } catch (e) {
      removePeer(p);
      throw e;
    }
  });
  status(copied ? "Answer copied. Send it back to the offerer." : "Answer ready. Use the manual copy prompt to share it.");
});

signalingAction("applyAnswer", async () => {
  const p = peers.get(pendingPeerId);
  if (!p || p.pc.signalingState !== "have-local-offer") {
    throw Error("Create an offer in this tab first.");
  }
  const d = await readSignal("answer");
  console.log("[Connection] Applying remote answer:", p.id, d);
  await p.pc.setRemoteDescription({ type: "answer", sdp: d.sdp });
  console.log("[Connection] Remote answer applied:", p.id, p.pc.remoteDescription.toJSON());
  p.name = typeof d.peerName === "string" ? d.peerName : p.name || "Peer";
  pendingPeerId = "";
  status("Answer applied. Waiting for connection…");
  refresh();
});

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
    status("The selected user is no longer connected.");
    return;
  }
  try {
    const channel = peer.pc.createDataChannel(FileTransfer.prefix + crypto.randomUUID(), { ordered: true });
    setupFileTransfer(peer, channel, file);
  } catch (error) {
    status("Cannot attach file: " + error.message);
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
    status("Message could not be sent. Check the peer connection.");
  }
};

$("chatMessage").onkeydown = (e) => {
  if (e.key === "Enter") $("sendMessage").click();
};
