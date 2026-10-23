# PeerLink

Static, manually signaled WebRTC live chat. Serve this folder over HTTPS or localhost and open `index.html` in two browsers. Exchange an offer and answer using the three signaling buttons.

## File attachments

Select a connected user, click the paperclip left of Send, and choose a file. The recipient clicks **Save file** and chooses a destination before data is sent. Choosing an existing file replaces its contents once the save completes; use a new filename to keep the original.

Receiving requires a browser supporting `showSaveFilePicker` (Chrome or Edge) in a secure context, with permission to save. Unsupported browsers show an error instead of downloading the whole file into memory.

Files use dedicated ordered, reliable WebRTC data channels, 16 KiB chunks, bounded send buffering, and disk-write acknowledgments for backpressure. Chunks are written through a writable file stream without accumulating the whole file in JavaScript memory. Both participants see receiver-confirmed percentages. 100% means the recipient's stream has closed successfully. Cancel or disconnection aborts unfinished writes; a browser may leave an empty placeholder for a newly created destination.

Chat and transfer metadata remain session-only and disappear when the peer disconnects. Only files explicitly saved by the recipient persist. A receiver must keep the tab open while a transfer is running. Real-world connectivity depends on the network; STUN alone does not guarantee a connection on restrictive networks.

## Validation

Run `node --test tests/file-transfer.test.cjs` for simulated paired-channel transfer tests, including chunk boundaries, zero-byte files, progress, cancellation, invalid chunks, unsupported browsers, and disconnect cleanup.

For browser verification, connect two Chrome/Edge tabs, send a file, accept it, confirm progress on both sides and compare the saved file with the original. Also verify cancelling, disconnecting during transfer, switching users, simultaneous transfers, and chatting while sending a file.
