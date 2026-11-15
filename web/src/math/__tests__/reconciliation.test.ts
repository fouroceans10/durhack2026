import { describe, expect, it } from "vitest";
import type { IntentPacket, MotifRecord } from "../../../../shared/types";
import {
  computeReconcilePlan,
  computeSymmetricTargetBpm,
  interpolateBridgeState,
  mergeIsolationMotifs,
} from "../reconciliation";

function makeMotif(
  id: string,
  authorRole: IntentPacket["role"],
  partitionId: string,
  keyRoot: string,
  mode: IntentPacket["mode"],
  bpm: number
): MotifRecord {
  return {
    id,
    authorRole,
    createdDuringPartitionId: partitionId,
    scaleDegrees: [0, 2, 4, 7, 5, 4, 2, 0],
    rhythmSteps: [0, 2, 4, 6, 8, 10, 12, 14],
    keyRoot,
    mode,
    bpm,
  };
}

function makePacket(overrides: Partial<IntentPacket> & { peerId: string; role: IntentPacket["role"] }): IntentPacket {
  return {
    peerId: overrides.peerId,
    role: overrides.role,
    lamportClock: overrides.lamportClock ?? 10,
    partitionGroupId: overrides.partitionGroupId ?? "group-A",
    epochTimeMs: overrides.epochTimeMs ?? 10_000,
    barNumber: overrides.barNumber ?? 5,
    beatPhase: overrides.beatPhase ?? 1.0,
    bpm: overrides.bpm ?? 120,
    keyRoot: overrides.keyRoot ?? "C",
    mode: overrides.mode ?? "major",
    chordSymbol: overrides.chordSymbol ?? "C",
    energy: overrides.energy ?? 0.7,
    tension: overrides.tension ?? 0.4,
    activeMotif: overrides.activeMotif ?? null,
    isolationMotifHistory: overrides.isolationMotifHistory ?? [],
    modeState: overrides.modeState ?? "partitioned",
    reconcilePlan: overrides.reconcilePlan,
  };
}

function allPermutations<T>(items: T[]): T[][] {
  if (items.length <= 1) {
    return [items];
  }
  const result: T[][] = [];
  for (let i = 0; i < items.length; i++) {
    const current = items[i];
    const remaining = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const perm of allPermutations(remaining)) {
      result.push([current, ...perm]);
    }
  }
  return result;
}

describe("reconciliation module (Invariant #3)", () => {
  const motifDrums = makeMotif("m-drums", "drums", "part-A", "C", "major", 110);
  const motifBass = makeMotif("m-bass", "bass", "part-A", "C", "major", 110);
  const motifPiano = makeMotif("m-piano", "piano", "part-B", "D", "minor", 130);
  const motifLead = makeMotif("m-lead", "lead", "part-B", "D", "minor", 130);

  const pDrums = makePacket({
    peerId: "peer-1-drums",
    role: "drums",
    partitionGroupId: "sub-A",
    bpm: 110,
    keyRoot: "C",
    mode: "major",
    epochTimeMs: 12_100,
    activeMotif: motifDrums,
    isolationMotifHistory: [motifDrums],
  });

  const pBass = makePacket({
    peerId: "peer-2-bass",
    role: "bass",
    partitionGroupId: "sub-A",
    bpm: 110,
    keyRoot: "C",
    mode: "major",
    epochTimeMs: 12_150,
    activeMotif: motifBass,
    isolationMotifHistory: [motifDrums, motifBass],
  });

  const pPiano = makePacket({
    peerId: "peer-3-piano",
    role: "piano",
    partitionGroupId: "sub-B",
    bpm: 130,
    keyRoot: "D",
    mode: "minor",
    epochTimeMs: 12_120,
    activeMotif: motifPiano,
    isolationMotifHistory: [motifPiano],
  });

  const pLead = makePacket({
    peerId: "peer-4-lead",
    role: "lead",
    partitionGroupId: "sub-B",
    bpm: 130,
    keyRoot: "D",
    mode: "minor",
    epochTimeMs: 12_200,
    activeMotif: motifLead,
    isolationMotifHistory: [motifLead, motifPiano],
  });

  it("computes the exact same ReconcilePlan across all 24 packet arrival permutations", () => {
    const packets = [pDrums, pBass, pPiano, pLead];
    const perms = allPermutations(packets);
    expect(perms).toHaveLength(24);

    const baselinePlan = computeReconcilePlan(perms[0]);

    // Verify expected mathematical properties of baselinePlan:
    // 110 BPM and 130 BPM -> symmetric 120 BPM
    expect(baselinePlan.targetBpm).toBe(120);
    // C (0) and D (2) on Circle of Fifths -> midpoint G (1), major + minor -> dorian
    expect(baselinePlan.targetKeyRoot).toBe("G");
    expect(baselinePlan.targetMode).toBe("dorian");
    expect(baselinePlan.bridgeBars).toBe(4);
    expect(baselinePlan.adoptedMotifs.map((m) => m.id)).toEqual([
      "m-drums",
      "m-bass",
      "m-piano",
      "m-lead",
    ]);

    for (const perm of perms) {
      const plan = computeReconcilePlan(perm);
      expect(plan).toEqual(baselinePlan);
    }
  });

  it("treats asymmetric partition group sizes symmetrically (1 vs 3 split does not overwrite solo peer)", () => {
    const soloGroup = makePacket({
      peerId: "peer-solo",
      role: "lead",
      partitionGroupId: "island-solo",
      bpm: 100,
      keyRoot: "C",
      mode: "major",
    });

    const trio1 = makePacket({
      peerId: "peer-t1",
      role: "drums",
      partitionGroupId: "island-trio",
      bpm: 140,
      keyRoot: "D",
      mode: "major",
    });
    const trio2 = makePacket({
      peerId: "peer-t2",
      role: "bass",
      partitionGroupId: "island-trio",
      bpm: 140,
      keyRoot: "D",
      mode: "major",
    });
    const trio3 = makePacket({
      peerId: "peer-t3",
      role: "piano",
      partitionGroupId: "island-trio",
      bpm: 140,
      keyRoot: "D",
      mode: "major",
    });

    // Neither group overwrites the other: 100 BPM vs 140 BPM -> symmetric 120 BPM, C vs D -> G
    expect(computeSymmetricTargetBpm([soloGroup, trio1, trio2, trio3])).toBe(
      120
    );
    const planA = computeReconcilePlan([soloGroup, trio1, trio2, trio3]);
    const planB = computeReconcilePlan([trio3, trio2, soloGroup, trio1]);
    expect(planA).toEqual(planB);
    expect(planA.targetBpm).toBe(120);
    expect(planA.targetKeyRoot).toBe("G");
  });

  it("deduplicates stale packets from the same peerId using lamportClock", () => {
    const stale = makePacket({
      peerId: "peer-1",
      role: "drums",
      lamportClock: 4,
      bpm: 90,
      partitionGroupId: "g1",
    });
    const fresh = makePacket({
      peerId: "peer-1",
      role: "drums",
      lamportClock: 9,
      bpm: 110,
      partitionGroupId: "g1",
    });
    const remote = makePacket({
      peerId: "peer-2",
      role: "bass",
      lamportClock: 9,
      bpm: 130,
      partitionGroupId: "g2",
    });

    const plan = computeReconcilePlan([stale, remote, fresh]);
    expect(plan.targetBpm).toBe(120);
  });

  it("deduplicates and canonically orders isolation motifs", () => {
    const mergedForward = mergeIsolationMotifs([pLead, pPiano, pBass, pDrums]);
    const mergedReverse = mergeIsolationMotifs([pDrums, pBass, pPiano, pLead]);
    expect(mergedForward).toEqual(mergedReverse);
    expect(mergedForward.map((m) => m.authorRole)).toEqual([
      "drums",
      "bass",
      "piano",
      "lead",
    ]);
  });

  it("interpolates smoothly across the 4-bar bridge from pivot chord to target tonic", () => {
    const plan = computeReconcilePlan([pDrums, pPiano], 4);
    const startMs = plan.bridgeStartEpochMs;
    // At 120 BPM, 4 bars = 8000ms
    const snapStart = interpolateBridgeState(110, 0.4, plan, startMs);
    expect(snapStart.progress).toBe(0);
    expect(snapStart.bpm).toBe(110);
    expect(snapStart.chordSymbol).toBe(plan.pivotChord);
    expect(snapStart.isComplete).toBe(false);

    const snapMid = interpolateBridgeState(110, 0.4, plan, startMs + 2000); // 25% into bridge
    expect(snapMid.progress).toBe(0.25);
    expect(snapMid.bpm).toBe(112.5);
    expect(snapMid.chordSymbol).toBe(plan.pivotChord);

    const snapResolve = interpolateBridgeState(110, 0.4, plan, startMs + 6000); // 75% into bridge
    expect(snapResolve.progress).toBe(0.75);
    expect(snapResolve.bpm).toBe(117.5);
    expect(snapResolve.chordSymbol).toBe("Gm"); // G dorian tonic triad

    const snapDone = interpolateBridgeState(110, 0.4, plan, startMs + 8000); // 100%
    expect(snapDone.progress).toBe(1);
    expect(snapDone.bpm).toBe(120);
    expect(snapDone.isComplete).toBe(true);
    expect(snapDone.tension).toBe(0.2);
  });
});
