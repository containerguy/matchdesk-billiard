import { parseClientMessage, type ServerMessage } from "@bandenduell/protocol";
import express from "express";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { Hub, type Connection } from "./hub";

const PORT = Number(process.env.PORT ?? 3000);
const here = dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = resolve(process.env.CLIENT_DIR ?? resolve(here, "../../client/dist"));

const app = express();
app.disable("x-powered-by");
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});
if (existsSync(CLIENT_DIR)) {
  app.use(express.static(CLIENT_DIR, { index: "index.html", maxAge: "1h" }));
  app.get(/^\/(?!ws|health).*/, (_req, res) => res.sendFile(resolve(CLIENT_DIR, "index.html")));
} else {
  console.warn(`[server] Kein Client-Build unter ${CLIENT_DIR}; nur WebSocket und /health aktiv.`);
}

const server = createServer(app);
const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 16 * 1024 });
const hub = new Hub();

wss.on("connection", (socket) => {
  const conn: Connection = {
    send(message: ServerMessage) {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
    }
  };
  let player: ReturnType<Hub["hello"]> = null;
  let alive = true;
  let budget = 60; // Nachrichten pro Sekunde, grobe Bremse gegen Fluten
  const refill = setInterval(() => (budget = 60), 1000);
  const ping = setInterval(() => {
    if (!alive) return socket.terminate();
    alive = false;
    socket.ping();
  }, 20_000);
  socket.on("pong", () => (alive = true));

  socket.on("message", (data) => {
    if (--budget < 0) return;
    const msg = parseClientMessage(String(data));
    if (!msg) return conn.send({ t: "error", message: "Unbekannte Nachricht" });
    if (msg.t === "hello") {
      player = hub.hello(conn, msg.name, msg.token);
      return;
    }
    if (!player) return conn.send({ t: "error", message: "Bitte zuerst anmelden" });
    hub.handle(player, msg);
  });

  socket.on("close", () => {
    clearInterval(refill);
    clearInterval(ping);
    if (player) hub.disconnect(player, conn);
  });
});

setInterval(() => hub.sweep(), 5_000).unref();

server.listen(PORT, () => {
  console.log(`[server] Bandenduell läuft auf http://localhost:${PORT}`);
});
