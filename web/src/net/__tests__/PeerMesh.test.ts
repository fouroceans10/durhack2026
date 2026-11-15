import { afterEach, describe, expect, it } from "vitest";
import type {
  InstrumentRole,
  IntentPacket,
  SignalEnvelope,
  SignallingStatus,
} from "../../../../shared/types";
import { computeReconcilePlan } from "../../math/reconciliation";
import {
  PeerMesh,
  resolveSignallingUrl,
  type PartitionChangeEvent,
  type RTCDataChannelLike,
  type RTCPeerConnectionLike,
  type WebSocketLike,
} from "../PeerMesh";

function createTestIntentPacket(
  peerId: string,
  role: InstrumentRole,
  overrides: Partial<IntentPacket> = {}
): IntentPacket {
  return {
    peerId,
    role,
    lamportClock: overrides.lamportClock ?? 1,
    partitionGroupId: overrides.partitionGroupId ?? "initial",
    epochTimeMs: overrides.epochTimeMs ?? 10_000,
    barNumber: overrides.barNumber ?? 1,
    beatPhase: overrides.beatPhase ?? 0,
    bpm: overrides.bpm ?? 120,
    keyRoot: overrides.keyRoot ?? "C",
    mode: overrides.mode ?? "major",
    chordSymbol: overrides.chordSymbol ?? "C",
    energy: overrides.energy ?? 0.75,
    tension: overrides.tension ?? 0.25,
    activeMotif: overrides.activeMotif ?? null,
    isolationMotifHistory: overrides.isolationMotifHistory ?? [],
    modeState: overrides.modeState ?? "unified",
    reconcilePlan: overrides.reconcilePlan,
  };
}

/**
 * In-memory WebRTC + Signalling harness for deterministic testing of `"webrtc"` mode
 * and Signalling Server Fault Tolerance (Invariant #2).
 */
class MockWebRtcEnvironment {
  private sockets = new Set<MockSignalSocket>();
  private serverAlive = true;

  public createWebSocket = (): WebSocketLike => {
    const sock = new MockSignalSocket(this);
    this.sockets.add(sock);
    queueMicrotask(() => {
      if (this.serverAlive) {
        sock.triggerOpen();
      }
    });
    return sock;
  };

  public broadcastFrom(sender: MockSignalSocket, data: string): void {
    if (!this.serverAlive) {
      return;
    }
    const envelope = JSON.parse(data) as SignalEnvelope;
    for (const sock of this.sockets) {
      if (sock === sender || sock.readyState !== 1) {
        continue;
      }
      sock.onmessage?.({ data: JSON.stringify(envelope) });
    }
  }

  public killSignallingServer(): void {
    this.serverAlive = false;
    for (const sock of Array.from(this.sockets)) {
      sock.readyState = 3;
      sock.onclose?.({});
    }
    this.sockets.clear();
  }

  public removeSocket(sock: MockSignalSocket): void {
    this.sockets.delete(sock);
  }
}

class MockSignalSocket implements WebSocketLike {
  public readyState = 0;
  public onopen: ((ev: unknown) => void) | null = null;
  public onmessage: ((ev: { data: unknown }) => void) | null = null;
  public onclose: ((ev: unknown) => void) | null = null;
  public onerror: ((ev: unknown) => void) | null = null;

  constructor(private readonly env: MockWebRtcEnvironment) {}

  public triggerOpen(): void {
    this.readyState = 1;
    this.onopen?.({});
  }

  public send(data: string): void {
    this.env.broadcastFrom(this, data);
  }

  public close(): void {
    this.readyState = 3;
    this.env.removeSocket(this);
    this.onclose?.({});
  }
}

class MockDataChannelPair {
  public readonly channelA: MockDataChannel;
  public readonly channelB: MockDataChannel;

  constructor(label: string) {
    this.channelA = new MockDataChannel(label);
    this.channelB = new MockDataChannel(label);
    this.channelA.peer = this.channelB;
    this.channelB.peer = this.channelA;
  }

  public openBoth(): void {
    this.channelA.readyState = "open";
    this.channelB.readyState = "open";
    this.channelA.onopen?.({});
    this.channelB.onopen?.({});
  }
}

class MockDataChannel implements RTCDataChannelLike {
  public readyState: "connecting" | "open" | "closing" | "closed" =
    "connecting";
  public peer: MockDataChannel | null = null;
  public onopen: ((ev: unknown) => void) | null = null;
  public onmessage: ((ev: { data: unknown }) => void) | null = null;
  public onclose: ((ev: unknown) => void) | null = null;
  public onerror: ((ev: unknown) => void) | null = null;

  constructor(public readonly label: string) {}

  public send(data: string): void {
    if (this.readyState !== "open" || !this.peer || this.peer.readyState !== "open") {
      return;
    }
    this.peer.onmessage?.({ data });
  }

  public close(): void {
    if (this.readyState === "closed") {
      return;
    }
    this.readyState = "closed";
    this.onclose?.({});
  }
}

const pendingOfferChannels = new Map<string, MockDataChannelPair>();
let offerSeq = 0;

function createMockRtcPeerConnection(): RTCPeerConnectionLike {
  let pendingPair: MockDataChannelPair | null = null;
  let offerToken = "";

  const pc: RTCPeerConnectionLike = {
    connectionState: "connected",
    onicecandidate: null,
    ondatachannel: null,
    onconnectionstatechange: null,
    createDataChannel(label: string) {
      pendingPair = new MockDataChannelPair(label);
      return pendingPair.channelA;
    },
    async createOffer() {
      offerToken = `offer-${++offerSeq}`;
      if (pendingPair) {
        pendingOfferChannels.set(offerToken, pendingPair);
      }
      return { type: "offer", sdp: offerToken };
    },
    async createAnswer() {
      return { type: "answer", sdp: offerToken };
    },
    async setLocalDescription() {
      // No-op in mock
    },
    async setRemoteDescription(desc: { type: string; sdp?: string }) {
      if (desc.type === "offer" && desc.sdp) {
        offerToken = desc.sdp;
        const pair = pendingOfferChannels.get(offerToken);
        if (pair) {
          pc.ondatachannel?.({ channel: pair.channelB });
        }
      } else if (desc.type === "answer" && desc.sdp) {
        const pair = pendingOfferChannels.get(desc.sdp);
        if (pair) {
          pendingOfferChannels.delete(desc.sdp);
          pair.openBoth();
        }
      }
    },
    async addIceCandidate() {
      // No-op in mock
    },
    close() {
      pc.connectionState = "closed";
    },
  };
  return pc;
}

describe("PeerMesh P2P Networking & Software Partition Matrix (Phase 2)", () => {
  const activeMeshes: PeerMesh[] = [];

  afterEach(() => {
    for (const m of activeMeshes) {
      m.destroy();
    }
    activeMeshes.length = 0;
    pendingOfferChannels.clear();
  });

  function createFourNodeBroadcastOrchestra(channelName = "test-symphony-mesh") {
    let clockMs = 1_000_000;
    const offsets: Record<InstrumentRole, number> = {
      drums: 0,
      bass: 20,
      piano: -10,
      lead: 40,
    };

    const roles: InstrumentRole[] = ["drums", "bass", "piano", "lead"];
    const nodes = {} as Record<InstrumentRole, PeerMesh>;

    for (const role of roles) {
      nodes[role] = new PeerMesh({
        peerId: `peer-${role}`,
        role,
        roomId: "room-alpha",
        transportMode: "broadcast",
        broadcastChannelName: channelName,
        autoStartTimers: false,
        now: () => clockMs + offsets[role],
      });
      activeMeshes.push(nodes[role]);
    }

    // Complete initial presence round so all 4 peers know each other
    for (const role of roles) {
      nodes[role].announcePresence();
    }

    return {
      nodes,
      advanceClock: (deltaMs: number) => {
        clockMs += deltaMs;
      },
      getClock: () => clockMs,
    };
  }

  it("1. discovers all 4 orchestra nodes and delivers IntentPackets & NTP ClockPings across the mesh", () => {
    const { nodes } = createFourNodeBroadcastOrchestra("mesh-test-1");
    const { drums, bass, piano, lead } = nodes;

    for (const node of [drums, bass, piano, lead]) {
      expect(node.getKnownPeerIds()).toEqual([
        "peer-bass",
        "peer-drums",
        "peer-lead",
        "peer-piano",
      ]);
      expect(node.getReachableRoles()).toEqual([
        "bass",
        "drums",
        "lead",
        "piano",
      ]);
      expect(node.isPartitioned()).toBe(false);
    }

    // Exactly one deterministic leader across the unified 4-node group ("peer-bass" is lowest lexicographically)
    expect(bass.isSubgroupLeader()).toBe(true);
    expect(drums.isSubgroupLeader()).toBe(false);
    expect(piano.isSubgroupLeader()).toBe(false);
    expect(lead.isSubgroupLeader()).toBe(false);

    // Broadcast IntentPacket from drums and verify bass, piano, and lead receive it
    const receivedBy: InstrumentRole[] = [];
    bass.onIntentPacket((pkt) => receivedBy.push(pkt.role));
    piano.onIntentPacket((pkt) => receivedBy.push(pkt.role));
    lead.onIntentPacket((pkt) => receivedBy.push(pkt.role));

    const drumsPkt = createTestIntentPacket("peer-drums", "drums", {
      bpm: 124,
      keyRoot: "G",
    });
    drums.broadcastIntentPacket(drumsPkt);
    expect(receivedBy).toHaveLength(3);

    // Verify NTP ClockPing / ClockPong updates peer clock offsets
    const clockUpdates: number[] = [];
    drums.onPeerClockUpdate((upd) => {
      clockUpdates.push(upd.peerOffsetMs);
    });
    drums.sendClockPingNow();
    expect(clockUpdates).toHaveLength(3);
    expect(drums.getPeerClockOffset("peer-bass")).toBe(20);
    expect(drums.getPeerClockOffset("peer-piano")).toBe(-10);
    expect(drums.getPeerClockOffset("peer-lead")).toBe(40);
  });

  it("2. SPLIT_2V2 splits the 4 nodes into two isolated subgroups (drums+bass and piano+lead) and blocks cross-partition traffic", () => {
    const { nodes } = createFourNodeBroadcastOrchestra("mesh-test-2");
    const { drums, bass, piano, lead } = nodes;

    // Trigger SPLIT_2V2 on a single node (drums) and verify it propagates to all 4 nodes
    drums.applyPartitionPreset("SPLIT_2V2");

    expect(drums.isPartitioned()).toBe(true);
    expect(bass.isPartitioned()).toBe(true);
    expect(piano.isPartitioned()).toBe(true);
    expect(lead.isPartitioned()).toBe(true);

    // Subgroup 1: drums + bass share the exact same partitionGroupId
    expect(drums.getReachableRoles()).toEqual(["bass", "drums"]);
    expect(bass.getReachableRoles()).toEqual(["bass", "drums"]);
    expect(drums.getPartitionGroupId()).toBe(bass.getPartitionGroupId());

    // Subgroup 2: piano + lead share the exact same partitionGroupId, distinct from drums+bass
    expect(piano.getReachableRoles()).toEqual(["lead", "piano"]);
    expect(lead.getReachableRoles()).toEqual(["lead", "piano"]);
    expect(piano.getPartitionGroupId()).toBe(lead.getPartitionGroupId());
    expect(drums.getPartitionGroupId()).not.toBe(piano.getPartitionGroupId());

    // Each subgroup has its own deterministic leader ("peer-bass" for Subgroup 1, "peer-lead" for Subgroup 2)
    expect(bass.isSubgroupLeader()).toBe(true);
    expect(drums.isSubgroupLeader()).toBe(false);
    expect(lead.isSubgroupLeader()).toBe(true);
    expect(piano.isSubgroupLeader()).toBe(false);

    // Verify IntentPackets and ClockPings are delivered within subgroups and dropped across subgroups
    const bassReceivedFrom: string[] = [];
    const pianoReceivedFrom: string[] = [];
    const leadReceivedFrom: string[] = [];

    bass.onIntentPacket((_, from) => bassReceivedFrom.push(from));
    piano.onIntentPacket((_, from) => pianoReceivedFrom.push(from));
    lead.onIntentPacket((_, from) => leadReceivedFrom.push(from));

    drums.broadcastIntentPacket(
      createTestIntentPacket("peer-drums", "drums", { bpm: 108, keyRoot: "C" })
    );
    piano.broadcastIntentPacket(
      createTestIntentPacket("peer-piano", "piano", { bpm: 136, keyRoot: "D" })
    );

    expect(bassReceivedFrom).toEqual(["peer-drums"]);
    expect(leadReceivedFrom).toEqual(["peer-piano"]);
    expect(pianoReceivedFrom).toEqual([]);

    // ClockPing from drums only receives ClockPong from bass, NOT piano or lead
    const drumsClockPeers: string[] = [];
    drums.onPeerClockUpdate((u) => drumsClockPeers.push(u.peerId));
    drums.sendClockPingNow();
    expect(drumsClockPeers).toEqual(["peer-bass"]);
  });

  it("3. ISOLATE_LEAD isolates lead into a 1-node partition while drums+bass+piano form a 3-node partition", () => {
    const { nodes } = createFourNodeBroadcastOrchestra("mesh-test-3");
    const { drums, bass, piano, lead } = nodes;

    lead.applyPartitionPreset("ISOLATE_LEAD");

    expect(lead.isPartitioned()).toBe(true);
    expect(lead.getReachableRoles()).toEqual(["lead"]);
    expect(lead.isSubgroupLeader()).toBe(true);

    for (const trioMember of [drums, bass, piano]) {
      expect(trioMember.isPartitioned()).toBe(true);
      expect(trioMember.getReachableRoles()).toEqual([
        "bass",
        "drums",
        "piano",
      ]);
      expect(trioMember.getPartitionGroupId()).toBe(
        drums.getPartitionGroupId()
      );
      expect(trioMember.getPartitionGroupId()).not.toBe(
        lead.getPartitionGroupId()
      );
    }

    // Trio has exactly one leader ("peer-bass")
    expect(bass.isSubgroupLeader()).toBe(true);
    expect(drums.isSubgroupLeader()).toBe(false);
    expect(piano.isSubgroupLeader()).toBe(false);

    // Lead packets are blocked from reaching trio, while trio packets reach each other
    let leadHeardTrio = false;
    let pianoHeardDrums = false;
    lead.onIntentPacket(() => {
      leadHeardTrio = true;
    });
    piano.onIntentPacket((_, from) => {
      if (from === "peer-drums") {
        pianoHeardDrums = true;
      }
    });

    drums.broadcastIntentPacket(createTestIntentPacket("peer-drums", "drums"));
    lead.broadcastIntentPacket(createTestIntentPacket("peer-lead", "lead"));

    expect(pianoHeardDrums).toBe(true);
    expect(leadHeardTrio).toBe(false);
  });

  it("4. HEAL_ALL restores full 4-node connectivity, fires onPartitionChange with reconnected=true, and enables deterministic reconciliation", () => {
    const { nodes } = createFourNodeBroadcastOrchestra("mesh-test-4");
    const { drums, bass, piano, lead } = nodes;

    drums.applyPartitionPreset("SPLIT_2V2");

    // Each partitioned group drifts in tempo and key during isolation
    drums.broadcastIntentPacket(
      createTestIntentPacket("peer-drums", "drums", {
        bpm: 110,
        keyRoot: "C",
        mode: "major",
      })
    );
    bass.broadcastIntentPacket(
      createTestIntentPacket("peer-bass", "bass", {
        bpm: 110,
        keyRoot: "C",
        mode: "major",
      })
    );
    piano.broadcastIntentPacket(
      createTestIntentPacket("peer-piano", "piano", {
        bpm: 130,
        keyRoot: "D",
        mode: "minor",
      })
    );
    lead.broadcastIntentPacket(
      createTestIntentPacket("peer-lead", "lead", {
        bpm: 130,
        keyRoot: "D",
        mode: "minor",
      })
    );

    const healEvents: Record<string, PartitionChangeEvent> = {};
    for (const [role, mesh] of Object.entries(nodes)) {
      mesh.onPartitionChange((ev) => {
        if (ev.preset === "HEAL_ALL") {
          healEvents[role] = ev;
        }
      });
    }

    // Trigger HEAL_ALL from piano
    piano.applyPartitionPreset("HEAL_ALL");

    for (const role of ["drums", "bass", "piano", "lead"] as const) {
      const ev = healEvents[role];
      expect(ev).toBeDefined();
      expect(ev.reconnected).toBe(true);
      expect(ev.isPartitioned).toBe(false);
      expect(ev.reachableRoles).toEqual(["bass", "drums", "lead", "piano"]);
      expect(nodes[role].getPartitionGroupId()).toBe(
        drums.getPartitionGroupId()
      );
    }

    // Both subgroups now exchange packets and compute the exact same ReconcilePlan
    const drumsKnownPackets = drums.getReconcilePackets();
    const pianoKnownPackets = piano.getReconcilePackets();

    expect(drumsKnownPackets).toHaveLength(4);
    expect(pianoKnownPackets).toHaveLength(4);

    const planOnDrums = computeReconcilePlan(drumsKnownPackets);
    const planOnPiano = computeReconcilePlan(pianoKnownPackets);
    expect(planOnDrums).toEqual(planOnPiano);
    expect(planOnDrums.targetBpm).toBe(120);
  });

  it("5. WebRTC mode survives signalling server termination without interrupting P2P DataChannel exchange (Invariant #2)", async () => {
    const env = new MockWebRtcEnvironment();

    const statusHistoryA: SignallingStatus[] = [];
    const statusHistoryB: SignallingStatus[] = [];

    const meshA = new PeerMesh({
      peerId: "peer-drums",
      role: "drums",
      roomId: "webrtc-room",
      transportMode: "webrtc",
      autoStartTimers: false,
      webSocketFactory: env.createWebSocket,
      rtcPeerConnectionFactory: createMockRtcPeerConnection,
    });
    const meshB = new PeerMesh({
      peerId: "peer-bass",
      role: "bass",
      roomId: "webrtc-room",
      transportMode: "webrtc",
      autoStartTimers: false,
      webSocketFactory: env.createWebSocket,
      rtcPeerConnectionFactory: createMockRtcPeerConnection,
    });
    activeMeshes.push(meshA, meshB);

    meshA.onSignallingStatusChange((s) => statusHistoryA.push(s));
    meshB.onSignallingStatusChange((s) => statusHistoryB.push(s));

    // Allow microtasks for WebSocket open + SDP offer/answer handshake + DataChannel open
    await new Promise((r) => setTimeout(r, 20));

    expect(meshA.getSignallingStatus()).toBe("connected");
    expect(meshB.getSignallingStatus()).toBe("connected");
    expect(meshA.getReachableRoles()).toEqual(["bass", "drums"]);
    expect(meshB.getReachableRoles()).toEqual(["bass", "drums"]);

    // Kill the signalling server mid-performance!
    env.killSignallingServer();

    expect(meshA.getSignallingStatus()).toBe("disconnected");
    expect(meshB.getSignallingStatus()).toBe("disconnected");
    expect(statusHistoryA).toContain("disconnected");
    expect(statusHistoryB).toContain("disconnected");

    // Verify P2P RTCDataChannels remain open and continue delivering IntentPackets and ClockPings!
    const receivedAfterKill: IntentPacket[] = [];
    meshB.onIntentPacket((pkt) => receivedAfterKill.push(pkt));

    meshA.broadcastIntentPacket(
      createTestIntentPacket("peer-drums", "drums", { bpm: 128 })
    );
    expect(receivedAfterKill).toHaveLength(1);
    expect(receivedAfterKill[0].bpm).toBe(128);
    expect(meshA.isPartitioned()).toBe(false);
    expect(meshB.isPartitioned()).toBe(false);
  });

  it("detects peer timeout after 1500ms of silence and updates partitionGroupId", () => {
    const { nodes, advanceClock } =
      createFourNodeBroadcastOrchestra("mesh-test-timeout");
    const { drums, bass, piano } = nodes;

    expect(drums.isPartitioned()).toBe(false);

    // Advance clock by 1600ms (> 1500ms timeout) where only drums and bass exchange packets
    advanceClock(1000);
    bass.announcePresence();
    advanceClock(600);
    bass.announcePresence();
    drums.pruneTimedOutPeers();

    // Piano and lead have been silent for 1600ms, so drums sees only drums+bass as reachable
    expect(drums.isPartitioned()).toBe(true);
    expect(drums.getReachableRoles()).toEqual(["bass", "drums"]);

    // Once piano speaks again, it immediately rejoins the reachable set
    piano.announcePresence();
    expect(drums.getReachableRoles()).toEqual(["bass", "drums", "piano"]);
  });

  it("resolves LAN signalling URL automatically from hostname and supports ?signal= override", () => {
    expect(resolveSignallingUrl("", "192.168.1.42")).toBe(
      "ws://192.168.1.42:8080"
    );
    expect(resolveSignallingUrl("", "")).toBe("ws://localhost:8080");
    expect(
      resolveSignallingUrl(
        "?role=drums&signal=ws://10.0.0.8:9090",
        "192.168.1.42"
      )
    ).toBe("ws://10.0.0.8:9090");
  });

  it("propagates individual clickable edge severing and healing across all mesh nodes", () => {
    const { nodes } = createFourNodeBroadcastOrchestra("mesh-test-edge-toggle");
    const { drums, piano } = nodes;

    expect(drums.isEdgeBlocked("drums", "piano")).toBe(false);
    expect(piano.isEdgeBlocked("drums", "piano")).toBe(false);

    // Sever only the drums <-> piano edge
    drums.toggleEdgeBlock("drums", "piano", true);
    expect(drums.isEdgeBlocked("drums", "piano")).toBe(true);
    expect(piano.isEdgeBlocked("drums", "piano")).toBe(true);
    expect(drums.isEdgeBlocked("drums", "bass")).toBe(false);

    // Click the edge again to heal it across the mesh
    drums.toggleEdgeBlock("drums", "piano", true);
    expect(drums.isEdgeBlocked("drums", "piano")).toBe(false);
    expect(piano.isEdgeBlocked("drums", "piano")).toBe(false);
    expect(drums.isPartitioned()).toBe(false);
    expect(piano.isPartitioned()).toBe(false);
  });
});
