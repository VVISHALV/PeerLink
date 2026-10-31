import { createSignalingServer } from "./signaling.js";

const port = Number(process.env.PORT || 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error("PORT must be between 1 and 65535.");

const app = createSignalingServer({ port, host: process.env.HOST || "0.0.0.0" });
app.server.on("listening", () => console.log(`Signaling server listening on port ${port}`));
app.server.on("error", (error) => {
  console.log("server error", error);
  process.exitCode = 1;
  void app.close();
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => { void app.close(); });
}
