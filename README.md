# PeerLink

PeerLink is a browser-based app for chatting and sharing files directly with other people using WebRTC.

**[Open PeerLink](https://vvishalv.github.io/PeerLink/)**

## How it works

Enter a name and choose how to connect:

- **Signaling server:** Share your assigned ID or enter another user's ID. The server exchanges the connection details needed for your browsers to connect.
- **Manual signaling:** Copy and exchange an offer and answer with the other person. This connects your browsers without using a signaling server.

Messages and files travel directly between browsers through WebRTC, not through the signaling server.

## Project layout

The client and signaling server code are kept separate:

- [`docs/`](docs/) — frontend client built with HTML, CSS and JavaScript. This is the app served on GitHub Pages.
- [`Signaling Server/`](Signaling%20Server/) — standalone Node.js WebSocket server that helps browsers exchange connection details.
