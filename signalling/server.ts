import { WebSocketServer, WebSocket } from "ws";
import { fileURLToPath } from "node:url";
import type { SignalEnvelope } from "../shared/types.js";

/**
 * Stateless WebSocket SDP/ICE Signalling Relay.
 *
 * INVARIANT #2:
 * - Strictly a stateless WebSocket SDP/ICE relay for WebRTC peer discovery.
 * - Holds ZERO musical state, ZERO clock state, and ZERO conductor logic.
 * - Killing this server mid-performance has zero effect on connected WebRTC peers.
 */
export interface RelayServerHandle {
  wss: WebSocketServer;
  port: number;
  close: () => Promise<void>;
}

interface ClientBinding {
  ws: WebSocket;
  roomId: string;
  peerId: string;
}

export function createSignallingServer(port = 8080): Promise<RelayServerHandle> {
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ port });
    const bindings = new Map<WebSocket, ClientBinding>();

    wss.on("error", (err) => {
      reject(err);
    });

    wss.on("listening", () => {
      const address = wss.address();
      const boundPort =
        typeof address === "object" && address !== null ? address.port : port;
      resolve({
        wss,
        port: boundPort,
        close: () =>
          new Promise<void>((res, rej) => {
            for (const client of wss.clients) {
              client.terminate();
            }
            wss.close((err) => (err ? rej(err) : res()));
          }),
      });
    });

    wss.on("connection", (ws) => {
      ws.on("message", (raw) => {
        let envelope: SignalEnvelope;
        try {
          const text = typeof raw === "string" ? raw : raw.toString("utf-8");
          envelope = JSON.parse(text) as SignalEnvelope;
        } catch {
          return;
        }

        if (
          !envelope ||
          typeof envelope.roomId !== "string" ||
          typeof envelope.senderPeerId !== "string" ||
          !envelope.payload
        ) {
          return;
        }

        bindings.set(ws, {
          ws,
          roomId: envelope.roomId,
          peerId: envelope.senderPeerId,
        });

        const serialized = JSON.stringify(envelope);

        for (const [clientWs, binding] of bindings.entries()) {
          if (clientWs === ws || clientWs.readyState !== WebSocket.OPEN) {
            continue;
          }
          if (binding.roomId !== envelope.roomId) {
            continue;
          }
          if (
            envelope.targetPeerId &&
            binding.peerId !== envelope.targetPeerId
          ) {
            continue;
          }
          clientWs.send(serialized);
        }
      });

      ws.on("close", () => {
        const departed = bindings.get(ws);
        bindings.delete(ws);
        if (!departed) {
          return;
        }

        const leaveEnvelope: SignalEnvelope = {
          roomId: departed.roomId,
          senderPeerId: departed.peerId,
          payload: { type: "PEER_LEAVE" },
        };
        const serialized = JSON.stringify(leaveEnvelope);

        for (const [clientWs, binding] of bindings.entries()) {
          if (
            clientWs.readyState === WebSocket.OPEN &&
            binding.roomId === departed.roomId
          ) {
            clientWs.send(serialized);
          }
        }
      });
    });
  });
}

const isMain =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const port = Number(process.env.PORT ?? 8080);
  createSignallingServer(port).then((handle) => {
    console.log(
      `[signalling] Stateless SDP/ICE relay listening on ws://localhost:${handle.port}`
    );
  });
}
