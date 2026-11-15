import {
  INSTRUMENT_ROLES,
  type InstrumentRole,
  type IntentPacket,
  type MotifRecord,
  type MusicalMode,
  type ReconcilePlan,
} from "../../../shared/types";
import {
  type CanonicalPitchClass,
  circleOfFifthsIndex,
  computeMidpointKey,
  computePivotChord,
  normalizePitchClass,
} from "./circleOfFifths";
import { computeNextBarBoundaryMs } from "./clockSync";
import { getDiatonicChord } from "./musicTheory";

const ROLE_RANK: Record<InstrumentRole, number> = {
  drums: 0,
  bass: 1,
  piano: 2,
  lead: 3,
};

const MODE_RANK: Record<MusicalMode, number> = {
  major: 0,
  dorian: 1,
  minor: 2,
};

export interface BridgeSnapshot {
  progress: number; // 0.0 .. 1.0
  isComplete: boolean;
  bpm: number;
  keyRoot: CanonicalPitchClass;
  mode: MusicalMode;
  chordSymbol: string;
  tension: number;
}

/**
 * Deduplicates IntentPackets by `peerId` (keeping the packet with the highest
 * `lamportClock`, then highest `epochTimeMs`) and sorts them canonically by `peerId`.
 *
 * This guarantees that any permutation of packet arrival order yields the exact
 * same canonical packet array.
 */
export function canonicalizePackets(
  packets: readonly IntentPacket[]
): IntentPacket[] {
  const byPeer = new Map<string, IntentPacket>();

  for (const pkt of packets) {
    const existing = byPeer.get(pkt.peerId);
    if (!existing) {
      byPeer.set(pkt.peerId, pkt);
      continue;
    }
    if (
      pkt.lamportClock > existing.lamportClock ||
      (pkt.lamportClock === existing.lamportClock &&
        pkt.epochTimeMs > existing.epochTimeMs)
    ) {
      byPeer.set(pkt.peerId, pkt);
    }
  }

  return Array.from(byPeer.values()).sort((a, b) =>
    a.peerId.localeCompare(b.peerId)
  );
}

/**
 * Collects, deduplicates (by `id`), and deterministically orders all `MotifRecord`s
 * from `activeMotif` and `isolationMotifHistory` across all exchanged `IntentPacket`s.
 */
export function mergeIsolationMotifs(
  packets: readonly IntentPacket[]
): MotifRecord[] {
  const canonical = canonicalizePackets(packets);
  const motifMap = new Map<string, MotifRecord>();

  for (const pkt of canonical) {
    if (pkt.activeMotif) {
      motifMap.set(pkt.activeMotif.id, {
        ...pkt.activeMotif,
        scaleDegrees: [...pkt.activeMotif.scaleDegrees],
        rhythmSteps: [...pkt.activeMotif.rhythmSteps],
        keyRoot: normalizePitchClass(pkt.activeMotif.keyRoot),
      });
    }
    for (const motif of pkt.isolationMotifHistory) {
      if (!motifMap.has(motif.id)) {
        motifMap.set(motif.id, {
          ...motif,
          scaleDegrees: [...motif.scaleDegrees],
          rhythmSteps: [...motif.rhythmSteps],
          keyRoot: normalizePitchClass(motif.keyRoot),
        });
      }
    }
  }

  return Array.from(motifMap.values()).sort((a, b) => {
    const roleDiff =
      (ROLE_RANK[a.authorRole] ?? INSTRUMENT_ROLES.length) -
      (ROLE_RANK[b.authorRole] ?? INSTRUMENT_ROLES.length);
    if (roleDiff !== 0) {
      return roleDiff;
    }
    const partDiff = a.createdDuringPartitionId.localeCompare(
      b.createdDuringPartitionId
    );
    if (partDiff !== 0) {
      return partDiff;
    }
    return a.id.localeCompare(b.id);
  });
}

interface PartitionGroupSummary {
  groupId: string;
  bpm: number;
  keyRoot: CanonicalPitchClass;
  mode: MusicalMode;
  energy: number;
}

/**
 * Aggregates canonical packets into partition sub-groups so that reconciliation
 * treats reconnecting sub-groups symmetrically (neither overwrites the other, even
 * if one sub-group had 1 musician and the other had 3).
 */
function summarizePartitionGroups(
  canonicalPackets: readonly IntentPacket[]
): PartitionGroupSummary[] {
  const grouped = new Map<string, IntentPacket[]>();
  for (const pkt of canonicalPackets) {
    const list = grouped.get(pkt.partitionGroupId) ?? [];
    list.push(pkt);
    grouped.set(pkt.partitionGroupId, list);
  }

  const summaries: PartitionGroupSummary[] = [];
  for (const [groupId, members] of grouped.entries()) {
    const avgBpm =
      members.reduce((sum, m) => sum + m.bpm, 0) / members.length;
    const avgEnergy =
      members.reduce((sum, m) => sum + m.energy, 0) / members.length;

    // Pick representative key/mode for the sub-group deterministically
    const sortedHarmonic = [...members].sort((a, b) => {
      const idxA = circleOfFifthsIndex(a.keyRoot);
      const idxB = circleOfFifthsIndex(b.keyRoot);
      if (idxA !== idxB) {
        return idxA - idxB;
      }
      const modeDiff = MODE_RANK[a.mode] - MODE_RANK[b.mode];
      if (modeDiff !== 0) {
        return modeDiff;
      }
      return a.peerId.localeCompare(b.peerId);
    });

    let groupKey = normalizePitchClass(sortedHarmonic[0].keyRoot);
    let groupMode: MusicalMode = sortedHarmonic[0].mode;
    for (let i = 1; i < sortedHarmonic.length; i++) {
      const next = computeMidpointKey(
        groupKey,
        groupMode,
        sortedHarmonic[i].keyRoot,
        sortedHarmonic[i].mode
      );
      groupKey = next.targetKeyRoot;
      groupMode = next.targetMode;
    }

    summaries.push({
      groupId,
      bpm: avgBpm,
      keyRoot: groupKey,
      mode: groupMode,
      energy: avgEnergy,
    });
  }

  // Sort groups canonically by harmonic signature and bpm, then groupId so
  // even if group IDs are swapped, symmetric inputs yield identical reductions.
  return summaries.sort((a, b) => {
    const idxA = circleOfFifthsIndex(a.keyRoot);
    const idxB = circleOfFifthsIndex(b.keyRoot);
    if (idxA !== idxB) {
      return idxA - idxB;
    }
    const modeDiff = MODE_RANK[a.mode] - MODE_RANK[b.mode];
    if (modeDiff !== 0) {
      return modeDiff;
    }
    if (a.bpm !== b.bpm) {
      return a.bpm - b.bpm;
    }
    return a.groupId.localeCompare(b.groupId);
  });
}

/**
 * Computes the symmetric target BPM across reconnecting partition sub-groups.
 * Invariant to packet arrival order and group sizes.
 */
export function computeSymmetricTargetBpm(
  packets: readonly IntentPacket[]
): number {
  const canonical = canonicalizePackets(packets);
  if (canonical.length === 0) {
    return 120;
  }

  const groups = summarizePartitionGroups(canonical);
  const meanBpm =
    groups.reduce((sum, g) => sum + g.bpm, 0) / groups.length;
  const clamped = Math.max(40, Math.min(240, meanBpm));
  return Math.round(clamped * 100) / 100;
}

/**
 * Computes a deterministic, order-invariant `ReconcilePlan` from exchanged `IntentPacket`s.
 *
 * Satisfies Invariant #3:
 * - Neither partitioned sub-group overwrites the other.
 * - Both sides independently compute the exact same `ReconcilePlan`
 *   (`targetBpm`, `targetKeyRoot`, `targetMode`, `pivotChord`, `bridgeStartEpochMs`,
 *   `bridgeBars`, `adoptedMotifs`) regardless of packet arrival order.
 */
export function computeReconcilePlan(
  packets: readonly IntentPacket[],
  bridgeBars = 4
): ReconcilePlan {
  const canonical = canonicalizePackets(packets);
  if (canonical.length === 0) {
    throw new Error("computeReconcilePlan requires at least one IntentPacket");
  }

  const safeBridgeBars = Math.max(1, Math.trunc(bridgeBars));
  const targetBpm = computeSymmetricTargetBpm(canonical);
  const groups = summarizePartitionGroups(canonical);

  let targetKeyRoot: CanonicalPitchClass = groups[0].keyRoot;
  let targetMode: MusicalMode = groups[0].mode;
  let pivotChord: string;

  if (groups.length === 1) {
    // All packets share one partitionGroupId; reconcile across canonical peers directly
    const sortedPeers = [...canonical].sort((a, b) => {
      const idxA = circleOfFifthsIndex(a.keyRoot);
      const idxB = circleOfFifthsIndex(b.keyRoot);
      if (idxA !== idxB) {
        return idxA - idxB;
      }
      return MODE_RANK[a.mode] - MODE_RANK[b.mode];
    });
    const first = sortedPeers[0];
    const last = sortedPeers[sortedPeers.length - 1];
    const mid = computeMidpointKey(
      first.keyRoot,
      first.mode,
      last.keyRoot,
      last.mode
    );
    targetKeyRoot = mid.targetKeyRoot;
    targetMode = mid.targetMode;
    pivotChord = computePivotChord(
      first.keyRoot,
      first.mode,
      last.keyRoot,
      last.mode
    );
  } else {
    for (let i = 1; i < groups.length; i++) {
      const mid = computeMidpointKey(
        targetKeyRoot,
        targetMode,
        groups[i].keyRoot,
        groups[i].mode
      );
      targetKeyRoot = mid.targetKeyRoot;
      targetMode = mid.targetMode;
    }
    const firstGroup = groups[0];
    const lastGroup = groups[groups.length - 1];
    pivotChord = computePivotChord(
      firstGroup.keyRoot,
      firstGroup.mode,
      lastGroup.keyRoot,
      lastGroup.mode
    );
  }

  const maxEpochTimeMs = Math.max(...canonical.map((p) => p.epochTimeMs));
  const bridgeStartEpochMs = computeNextBarBoundaryMs(maxEpochTimeMs, targetBpm);
  const adoptedMotifs = mergeIsolationMotifs(canonical);

  return {
    targetBpm,
    targetKeyRoot,
    targetMode,
    pivotChord,
    bridgeStartEpochMs,
    bridgeBars: safeBridgeBars,
    adoptedMotifs,
  };
}

/**
 * Pure interpolation helper for transitioning musical state across the `bridgeBars`
 * reconciliation window (`modeState === "bridging"`):
 * - First half of bridge (`progress < 0.5`): ramps BPM halfway to `targetBpm` and
 *   harmonizes on the shared Circle-of-Fifths `pivotChord`.
 * - Second half of bridge (`0.5 <= progress < 1.0`): completes BPM ramp to `targetBpm`
 *   and resolves harmony to the tonic chord of `(targetKeyRoot, targetMode)`.
 * - At `progress >= 1.0`: marks `isComplete = true` at the unified target state.
 */
export function interpolateBridgeState(
  originBpm: number,
  originTension: number,
  plan: ReconcilePlan,
  currentEpochMs: number
): BridgeSnapshot {
  const beatDurationMs = 60_000 / plan.targetBpm;
  const bridgeDurationMs = beatDurationMs * 4 * plan.bridgeBars;
  const elapsedMs = currentEpochMs - plan.bridgeStartEpochMs;
  const rawProgress =
    bridgeDurationMs > 0 ? elapsedMs / bridgeDurationMs : 1;
  const progress = Math.max(0, Math.min(1, Number(rawProgress.toFixed(6))));
  const isComplete = progress >= 1;

  const bpm = Number(
    (originBpm + (plan.targetBpm - originBpm) * progress).toFixed(2)
  );
  const keyRoot = normalizePitchClass(plan.targetKeyRoot);
  const mode = plan.targetMode;

  const targetTonicChord = getDiatonicChord(keyRoot, mode, 0, false).symbol;
  const chordSymbol = progress < 0.5 ? plan.pivotChord : targetTonicChord;

  // Tension peaks slightly at the pivot midpoint (0.5) and resolves to 0.2 at 1.0
  const targetTension = 0.2;
  const tension =
    progress < 0.5
      ? Number(
          (
            originTension +
            (Math.max(originTension, 0.65) - originTension) * (progress * 2)
          ).toFixed(4)
        )
      : Number(
          (
            Math.max(originTension, 0.65) +
            (targetTension - Math.max(originTension, 0.65)) *
              ((progress - 0.5) * 2)
          ).toFixed(4)
        );

  return {
    progress,
    isComplete,
    bpm,
    keyRoot,
    mode,
    chordSymbol,
    tension,
  };
}
