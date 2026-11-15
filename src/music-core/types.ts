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

