import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import type { SignalEnvelope } from "../../shared/types";
import { createSignallingServer, type RelayServerHandle } from "../server";

function connectClient(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

function nextMessage(ws: WebSocket): Promise<SignalEnvelope> {
  return new Promise((resolve) => {
    ws.once("message", (data) => {
      resolve(JSON.parse(data.toString("utf-8")) as SignalEnvelope);
    });
  });
}

describe("Stateless WebSocket Signalling Relay (Invariant #2)", () => {
  let server: RelayServerHandle | null = null;

  afterEach(async () => {
    if (server) {
      await server.close();
      server = null;
    }
  });

  it("relays broadcast and targeted SDP/ICE envelopes within a room without holding musical state", async () => {
    server = await createSignallingServer(0);
    const clientA = await connectClient(server.port);
    const clientB = await connectClient(server.port);
    const clientOtherRoom = await connectClient(server.port);

    // Register clients in their respective rooms via PEER_ANNOUNCE
    clientB.send(
      JSON.stringify({
        roomId: "symphony-1",
        senderPeerId: "peer-B",
        payload: { type: "PEER_ANNOUNCE", role: "bass" },
      } satisfies SignalEnvelope)
    );
    clientOtherRoom.send(
      JSON.stringify({
        roomId: "other-room",
        senderPeerId: "peer-C",
        payload: { type: "PEER_ANNOUNCE", role: "piano" },
      } satisfies SignalEnvelope)
    );

    // Give server a brief tick to register bindings
    await new Promise((r) => setTimeout(r, 25));

    const msgPromiseB = nextMessage(clientB);
    let otherRoomReceived = false;
    clientOtherRoom.on("message", () => {
      otherRoomReceived = true;
    });

    const offerEnvelope: SignalEnvelope = {
      roomId: "symphony-1",
      senderPeerId: "peer-A",
      targetPeerId: "peer-B",
      payload: {
        type: "SDP_OFFER",
        sdp: { type: "offer", sdp: "v=0..." },
      },
    };
    clientA.send(JSON.stringify(offerEnvelope));

    const received = await msgPromiseB;
    expect(received).toEqual(offerEnvelope);
    expect(otherRoomReceived).toBe(false);

    // Verify PEER_LEAVE notification when clientA disconnects
    const leavePromiseB = nextMessage(clientB);
    clientA.close();
    const leaveMsg = await leavePromiseB;
    expect(leaveMsg).toEqual({
      roomId: "symphony-1",
      senderPeerId: "peer-A",
      payload: { type: "PEER_LEAVE" },
    });

    clientB.close();
    clientOtherRoom.close();
  });
});
