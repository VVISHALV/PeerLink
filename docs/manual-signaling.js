// Complete SDP includes ICE candidates so only one offer and answer need exchanging.
function waitForIce(pc) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const finish = (error) => {
      clearTimeout(timer);
      pc.removeEventListener("icegatheringstatechange", check);
      pc.removeEventListener("connectionstatechange", check);
      error ? reject(error) : resolve();
    };
    const check = () => {
      if (["closed", "failed"].includes(pc.connectionState)) finish(Error("Connection closed. Please try again."));
      else if (pc.iceGatheringState === "complete") finish();
    };
    const timer = setTimeout(() => finish(Error("Gathering connection details timed out. Please try again.")), 30000);
    pc.addEventListener("icegatheringstatechange", check);
    pc.addEventListener("connectionstatechange", check);
    check();
  });
}

function readManualSignal(type) {
  let signal;
  try { signal = JSON.parse($("manualRemote").value.trim()); }
  catch { throw Error("Paste a valid PeerLink " + type + " first."); }
  if (!signal || signal.app !== "PeerLink" || signal.version !== 1 || signal.type !== type ||
      typeof signal.sdp !== "string" || !signal.sdp.startsWith("v=0") ||
      typeof signal.exchange !== "string" || !signal.exchange || signal.exchange.length > 100 ||
      typeof signal.name !== "string" || !signal.name.trim() || signal.name.length > 40 ||
      /[\u0000-\u001f\u007f]/.test(signal.name)) {
    throw Error("Invalid PeerLink " + type + ". Copy the complete connection details.");
  }
  return signal;
}

async function publishManualSignal(pending) {
  await waitForIce(pending.peer.pc);
  if (manualPending !== pending || !peers.has(pending.peer.id)) throw Error("Exchange cancelled. Please try again.");
  const description = pending.peer.pc.localDescription;
  $("manualLocal").value = JSON.stringify({
    app: "PeerLink", version: 1, exchange: pending.exchange,
    name: myName, type: description.type, sdp: description.sdp,
  });
}

async function runManual(action) {
  if (!manualMode || manualBusy) return;
  manualBusy = true;
  updateConnectionControls();
  try { await action(); }
  catch (error) { setStatus(error.message); }
  finally { manualBusy = false; updateConnectionControls(); }
}

$("createOffer").onclick = () => runManual(async () => {
  if (manualPending) return;
  const exchange = crypto.randomUUID();
  const peer = makePeer(exchange);
  const pending = manualPending = { peer, exchange, role: "offer" };
  $("manualRemote").value = "";
  setStatus("Gathering connection details…");
  try {
    setupChannel(peer, peer.pc.createDataChannel("chat"));
    await peer.pc.setLocalDescription(await peer.pc.createOffer());
    await publishManualSignal(pending);
  } catch (error) { removePeer(peer, false); throw error; }
  setStatus("Copy your offer and send it to the other user. Then paste their answer and select Apply answer.");
});

$("createAnswer").onclick = () => runManual(async () => {
  if (manualPending) return;
  const signal = readManualSignal("offer");
  if (peers.has(signal.exchange)) throw Error("This offer is already connected or connecting.");
  const peer = makePeer(signal.exchange, signal.name);
  const pending = manualPending = { peer, exchange: signal.exchange, role: "answer" };
  setStatus("Gathering connection details…");
  try {
    await peer.pc.setRemoteDescription({ type: "offer", sdp: signal.sdp });
    await peer.pc.setLocalDescription(await peer.pc.createAnswer());
    await publishManualSignal(pending);
  } catch (error) { removePeer(peer, false); throw error; }
  setStatus("Copy your answer and send it back to the user who created the offer.");
});

$("applyAnswer").onclick = () => runManual(async () => {
  const pending = manualPending;
  if (!pending || pending.role !== "offer" || pending.applied) return;
  const signal = readManualSignal("answer");
  if (signal.exchange !== pending.exchange) throw Error("This answer belongs to a different offer. Ask for the answer to your current offer.");
  await pending.peer.pc.setRemoteDescription({ type: "answer", sdp: signal.sdp });
  pending.peer.name = signal.name;
  pending.applied = true;
  setStatus("Answer applied. Connecting directly to " + signal.name + "…");
});

$("resetManual").onclick = () => {
  if (manualBusy) return;
  const peer = manualPending?.peer;
  manualPending = null;
  if (peer && peer.channel?.readyState !== "open") removePeer(peer, false);
  $("manualLocal").value = "";
  $("manualRemote").value = "";
  setStatus("Ready for a new exchange. Existing connected users are kept.");
  updateConnectionControls();
};

$("copyManual").onclick = async () => {
  if (!$("manualLocal").value) return;
  try {
    await navigator.clipboard.writeText($("manualLocal").value);
    setStatus("Copied. Send these details privately to the other user.");
  } catch {
    $("manualLocal").focus(); $("manualLocal").select();
    setStatus("Clipboard access unavailable. Details selected; use Copy (Ctrl/Cmd+C).");
  }
};
$("pasteManual").onclick = async () => {
  try { $("manualRemote").value = await navigator.clipboard.readText(); }
  catch { setStatus("Clipboard access unavailable. Paste into the box with Ctrl/Cmd+V or your device's Paste action."); }
  $("manualRemote").focus();
};
