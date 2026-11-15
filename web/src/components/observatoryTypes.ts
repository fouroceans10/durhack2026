import type {
  InstrumentRole,
  IntentPacket,
  MotifRecord,
  MusicalMode,
  NetworkMode,
} from "../../../shared/types";

export type ViewRole = InstrumentRole | "observatory";

export interface InstrumentNodeTelemetry {
  peerId: string;
  role: InstrumentRole;
  bpm: number;
  keyRoot: string;
  mode: MusicalMode;
  chordSymbol: string;
  energy: number;
  tension: number;
  beatPhase: number;
  barNumber: number;
  partitionGroupId: string;
  modeState: NetworkMode;
  isLeader: boolean;
  isReachableFromLocal: boolean;
  isCompanion: boolean;
  activeMotif: MotifRecord | null;
  isolationMotifHistory: MotifRecord[];
}

export const ROLE_META: Record<
  InstrumentRole,
  {
    label: string;
    colorHex: string;
    badgeBg: string;
    badgeText: string;
    borderClass: string;
  }
> = {
  drums: {
    label: "Drums",
    colorHex: "#f43f5e", // rose-500
    badgeBg: "bg-rose-500/15",
    badgeText: "text-rose-300",
    borderClass: "border-rose-500/40",
  },
  bass: {
    label: "Bass",
    colorHex: "#06b6d4", // cyan-500
    badgeBg: "bg-cyan-500/15",
    badgeText: "text-cyan-300",
    borderClass: "border-cyan-500/40",
  },
  piano: {
    label: "Piano",
    colorHex: "#a855f7", // purple-500
    badgeBg: "bg-purple-500/15",
    badgeText: "text-purple-300",
    borderClass: "border-purple-500/40",
  },
  lead: {
    label: "Lead",
    colorHex: "#f59e0b", // amber-500
    badgeBg: "bg-amber-500/15",
    badgeText: "text-amber-300",
    borderClass: "border-amber-500/40",
  },
};

export function buildIntentPacketFromTelemetry(
  node: InstrumentNodeTelemetry
): IntentPacket {
  return {
    peerId: node.peerId,
    role: node.role,
    lamportClock: 1,
    partitionGroupId: node.partitionGroupId,
    epochTimeMs: Date.now(),
    barNumber: node.barNumber,
    beatPhase: node.beatPhase,
    bpm: node.bpm,
    keyRoot: node.keyRoot,
    mode: node.mode,
    chordSymbol: node.chordSymbol,
    energy: node.energy,
    tension: node.tension,
    activeMotif: node.activeMotif,
    isolationMotifHistory: node.isolationMotifHistory,
    modeState: node.modeState,
  };
}
