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
    section: string;
    colorHex: string;
    badgeBg: string;
    badgeText: string;
    borderClass: string;
  }
> = {
  drums: {
    label: "Drums",
    section: "PERCUSSION",
    colorHex: "#3c5c77", // --percussion
    badgeBg: "bg-[#3c5c77]/12",
    badgeText: "text-[#3c5c77]",
    borderClass: "border-[#3c5c77]/45",
  },
  bass: {
    label: "Bass",
    section: "BASS / CONTINUO",
    colorHex: "#3d6658", // --woodwinds
    badgeBg: "bg-[#3d6658]/12",
    badgeText: "text-[#3d6658]",
    borderClass: "border-[#3d6658]/45",
  },
  piano: {
    label: "Piano",
    section: "KEYS / HARMONY",
    colorHex: "#806022", // --brass
    badgeBg: "bg-[#806022]/12",
    badgeText: "text-[#806022]",
    borderClass: "border-[#806022]/45",
  },
  lead: {
    label: "Lead",
    section: "SOLO STRINGS",
    colorHex: "#ad3c25", // --strings / --red
    badgeBg: "bg-[#ad3c25]/12",
    badgeText: "text-[#ad3c25]",
    borderClass: "border-[#ad3c25]/45",
  },
};

export function buildIntentPacketFromTelemetry(
  node: InstrumentNodeTelemetry,
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
