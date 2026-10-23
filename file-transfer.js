/* Each file uses its own ordered, reliable channel; no file is buffered in full. */
class FileTransfer {
  static prefix = "peerlink-file:";
  static chunkSize = 16 * 1024;
  static highWater = 256 * 1024;

  constructor(channel, { file = null, onUpdate = () => {} } = {}) {
    this.channel = channel;
    this.file = file;
    this.outgoing = !!file;
    this.name = file?.name || "Incoming file";
    this.size = file?.size || 0;
    this.bytes = 0;
    this.sent = 0;
    this.state = file ? "Waiting for receiver" : "Waiting for file details";
    this.done = false;
    this.writer = null;
    this.onUpdate = onUpdate;
    this.queue = Promise.resolve();
    channel.binaryType = "arraybuffer";
    channel.onopen = () => {
      if (this.outgoing) this.send({ type: "offer", name: this.name, size: this.size });
    };
    channel.onmessage = ({ data }) => {
      this.queue = this.queue.then(() => this.receive(data)).catch((error) => this.fail(error));
    };
    channel.onclose = () => {
      if (!this.done) this.fail(new Error("Transfer interrupted or cancelled"), false);
    };
    channel.onerror = () => this.fail(new Error("File channel error"));
  }

  update() {
    this.onUpdate(this);
  }

  send(message) {
    if (this.channel.readyState !== "open") throw new Error("File connection closed");
    this.channel.send(JSON.stringify(message));
  }

  async receive(data) {
    if (this.done) return;
    if (typeof data !== "string") {
      if (this.outgoing || this.state !== "Receiving" || !(data instanceof ArrayBuffer) ||
          data.byteLength === 0 || data.byteLength > FileTransfer.chunkSize ||
          this.bytes + data.byteLength > this.size) {
        throw new Error("Invalid file chunk");
      }
      await this.writer.write(data);
      if (this.done) return;
      this.bytes += data.byteLength;
      // Acknowledgments follow disk writes, never just network receipt.
      if (this.bytes === this.size || this.bytes - (this.lastAck || 0) >= FileTransfer.highWater) {
        this.lastAck = this.bytes;
        this.send({ type: "progress", bytes: this.bytes });
        this.update();
      }
      return;
    }
    const message = JSON.parse(data);
    switch (message.type) {
      case "offer":
        if (this.outgoing || this.state !== "Waiting for file details" ||
            typeof message.name !== "string" || !message.name || message.name.length > 1024 ||
            !Number.isSafeInteger(message.size) || message.size < 0) {
          throw new Error("Invalid file offer");
        }
        this.name = message.name;
        this.size = message.size;
        this.state = "Choose where to save";
        this.update();
        break;
      case "accept":
        if (!this.outgoing || this.state !== "Waiting for receiver") throw new Error("Unexpected acceptance");
        this.state = "Sending";
        this.update();
        // Keep handling acknowledgments while the sender pumps chunks.
        void this.pump().catch((error) => this.fail(error));
        break;
      case "progress":
        if (!this.outgoing || !Number.isSafeInteger(message.bytes) ||
            message.bytes < this.bytes || message.bytes > this.sent) throw new Error("Invalid progress");
        this.bytes = message.bytes;
        this.update();
        break;
      case "end":
        if (this.outgoing || this.state !== "Receiving" || this.bytes !== this.size) {
          throw new Error("Incomplete file");
        }
        await this.writer.close();
        this.writer = null;
        if (this.done) return;
        this.send({ type: "complete" });
        this.finish();
        break;
      case "complete":
        if (!this.outgoing || !this.endSent) throw new Error("Unexpected completion");
        this.bytes = this.size;
        this.finish();
        this.channel.close();
        break;
      default:
        throw new Error("Unknown file-transfer message");
    }
  }

  async accept() {
    if (this.done || this.state !== "Choose where to save") return;
    if (!globalThis.isSecureContext || typeof globalThis.showSaveFilePicker !== "function") {
      this.fail(new Error("Direct-to-disk saving requires Chrome or Edge on HTTPS or localhost"));
      return;
    }
    this.state = "Choosing destination";
    this.update();
    try {
      // Called directly from the Save button to preserve browser user activation.
      const handle = await globalThis.showSaveFilePicker({ suggestedName: this.name.replace(/[\\/]/g, "_") });
      if (this.done) return;
      const writer = await handle.createWritable();
      if (this.done) {
        await writer.abort();
        return;
      }
      this.writer = writer;
      this.state = "Receiving";
      this.send({ type: "accept" });
      this.update();
    } catch (error) {
      this.fail(new Error(error.name === "AbortError" ? "Save cancelled" : "Cannot save file: " + error.message));
    }
  }

  async pump() {
    while (!this.done && this.sent < this.size) {
      // Bound both the browser send buffer and bytes awaiting disk acknowledgments.
      if (this.channel.bufferedAmount > FileTransfer.highWater ||
          this.sent - this.bytes >= FileTransfer.highWater) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        continue;
      }
      const chunk = await this.file.slice(this.sent, this.sent + FileTransfer.chunkSize).arrayBuffer();
      if (this.done) return;
      if (!chunk.byteLength) throw new Error("Could not read file");
      this.channel.send(chunk);
      this.sent += chunk.byteLength;
    }
    if (!this.done) {
      this.endSent = true;
      this.send({ type: "end" });
      this.state = "Finishing save";
      this.update();
    }
  }

  finish() {
    this.done = true;
    this.state = "Complete";
    this.file = null;
    this.update();
  }

  fail(error, close = true) {
    if (this.done) return;
    this.done = true;
    this.state = error.message || "Transfer failed";
    this.file = null;
    const writer = this.writer;
    this.writer = null;
    if (writer) void writer.abort().catch(() => {});
    if (close && this.channel.readyState !== "closed") this.channel.close();
    this.update();
  }

  cancel() {
    this.fail(new Error("Transfer cancelled"));
  }
}
