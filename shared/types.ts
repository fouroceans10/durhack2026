export type InstrumentRole = "drums" | "bass" | "piano" | "lead";
export type NetworkMode = "unified" | "partitioned" | "bridging";
export type MusicalMode = "major" | "minor" | "dorian";
export type TransportMode = "webrtc" | "broadcast";
export type SignallingStatus =
  | "connecting"
  | "connected"
  | "disconnected"
  | "offline";
export type PartitionPreset = "SPLIT_2V2" | "ISOLATE_LEAD" | "HEAL_ALL";

export const INSTRUMENT_ROLES: readonly InstrumentRole[] = [
  "drums",
  "bass",
  "piano",
  "lead",
] as const;

export interface MotifRecord {
  id: string;
  authorRole: InstrumentRole;
  createdDuringPartitionId: string;
  scaleDegrees: number[]; // e.g., [0, 2, 4, 7, 5, 4, 2, 0]
  rhythmSteps: number[];  // 16th-note step offsets within 1 or 2 bars
  keyRoot: string;
  mode: "major" | "minor" | "dorian";
  bpm: number;
}

export interface ReconcilePlan {
  targetBpm: number;
  targetKeyRoot: string;
  targetMode: "major" | "minor" | "dorian";
  pivotChord: string;
  bridgeStartEpochMs: number;
  bridgeBars: number;     // default 4
  adoptedMotifs: MotifRecord[];
}

export interface IntentPacket {
  peerId: string;
  role: InstrumentRole;
  lamportClock: number;
  partitionGroupId: string;
  epochTimeMs: number;
  barNumber: number;
  beatPhase: number;        // 0.0 .. 4.0
  bpm: number;
  keyRoot: string;
  mode: "major" | "minor" | "dorian";
  chordSymbol: string;
  energy: number;           // 0.0 .. 1.0
  tension: number;          // 0.0 .. 1.0
  activeMotif: MotifRecord | null;
  isolationMotifHistory: MotifRecord[];
  modeState: NetworkMode;
  reconcilePlan?: {
    targetBpm: number;
    targetKeyRoot: string;
    targetMode: "major" | "minor" | "dorian";
    pivotChord: string;
    bridgeStartEpochMs: number;
    bridgeBars: number;     // default 4
    adoptedMotifs: MotifRecord[];
  };
}

export interface ClockPing {
  type: "CLOCK_PING";
  pingId: string;
  senderId: string;
  t1: number; // Sender local epoch timestamp (ms) when ping was transmitted
}

export interface ClockPong {
  type: "CLOCK_PONG";
  pingId: string;
  senderId: string;    // Original ping sender peerId
  responderId: string; // Responder peerId
  t1: number;          // Original sender transmit timestamp (ms)
  t2: number;          // Responder receive timestamp (ms)
  t3: number;          // Responder transmit timestamp (ms)
}

export interface PartitionCommand {
  type: "PARTITION_COMMAND";
  action: "split" | "heal";
  preset?: PartitionPreset;
  partitionId: string;
  /**
   * Maps peerId (or role) to its assigned partitionGroupId during a split,
   * or unified group id on heal.
   */
  groups: Record<string, string>;
  /**
   * Optional explicit list of normalized blocked edge keys ("peerA::peerB" or "roleA::roleB").
   */
  blockedEdges?: string[];
  issuedAtMs: number;
  lamportClock?: number;
}

/**
 * Stateless WebRTC SDP / ICE signalling relay messages.
 * The signalling server inspects only routing fields (`roomId`, `targetPeerId`)
 * and holds zero musical, clock, or conductor state.
 */
export type SignalPayload =
  | {
      type: "SDP_OFFER" | "sdp-offer";
      sdp: RTCSessionDescriptionInit | { type: string; sdp?: string };
      role?: InstrumentRole;
    }
  | {
      type: "SDP_ANSWER" | "sdp-answer";
      sdp: RTCSessionDescriptionInit | { type: string; sdp?: string };
      role?: InstrumentRole;
    }
  | {
      type: "ICE_CANDIDATE" | "ice-candidate";
      candidate: RTCIceCandidateInit | Record<string, unknown>;
    }
  | {
      type: "PEER_ANNOUNCE" | "peer-join";
      role?: InstrumentRole;
    }
  | {
      type: "PEER_LEAVE" | "peer-leave";
      role?: InstrumentRole;
    }
  | {
      type: "PARTITION_COMMAND" | "partition-command";
      command: PartitionCommand;
    };

export interface SignalEnvelope {
  roomId: string;
  senderPeerId: string;
  targetPeerId?: string; // Omit to broadcast to all other peers in roomId
  payload: SignalPayload;
}

export type PeerWireMessage =
  | { type: "INTENT_PACKET"; packet: IntentPacket }
  | { type: "PEER_HELLO"; peerId: string; role: InstrumentRole; sentAtMs: number }
  | ClockPing
  | ClockPong
  | PartitionCommand;
