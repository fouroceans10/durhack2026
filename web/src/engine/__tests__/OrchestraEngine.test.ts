import { afterEach, describe, expect, it } from "vitest";
import type { InstrumentRole } from "../../../../shared/types";
import { AIStrategist } from "../../ai/strategist";
import { PeerMesh } from "../../net/PeerMesh";
import { OrchestraEngine } from "../OrchestraEngine";
import { RecordingSynthAdapter } from "../SynthRack";

describe("OrchestraEngine, SynthRack & AIStrategist (Phase 3)", () => {
  const activeEngines: OrchestraEngine[] = [];
  const activeMeshes: PeerMesh[] = [];

  afterEach(() => {
    for (const eng of activeEngines) {
      eng.dispose();
    }
    activeEngines.length = 0;

    for (const mesh of activeMeshes) {
      mesh.destroy();
    }
    activeMeshes.length = 0;
  });

  function createFourPieceOrchestra(channelName: string) {
    let clockMs = 500_000;
    const roles: InstrumentRole[] = ["drums", "bass", "piano", "lead"];
    const meshes = {} as Record<InstrumentRole, PeerMesh>;
    const synths = {} as Record<InstrumentRole, RecordingSynthAdapter>;
    const engines = {} as Record<InstrumentRole, OrchestraEngine>;

    for (const role of roles) {
      meshes[role] = new PeerMesh({
        peerId: `peer-${role}`,
        role,
        roomId: "symphony-stage",
        transportMode: "broadcast",
        broadcastChannelName: channelName,
        autoStartTimers: false,
        now: () => clockMs,
      });
      activeMeshes.push(meshes[role]);
    }

    // Complete initial presence discovery
    for (const role of roles) {
      meshes[role].announcePresence();
    }

    for (const role of roles) {
      synths[role] = new RecordingSynthAdapter(role, "my-instrument");
      engines[role] = new OrchestraEngine({
        peerMesh: meshes[role],
        synth: synths[role],
        initialBpm: 120,
        initialKeyRoot: "C",
        initialMode: "major",
        initialEnergy: 0.35,
        initialTension: 0.2,
        monitorMode: "my-instrument",
        now: () => clockMs,
      });
      activeEngines.push(engines[role]);
    }

    return {
      meshes,
      synths,
      engines,
      advanceBarsAll: (bars: number) => {
        const steps = bars * 16;
        for (let s = 0; s < steps; s++) {
          clockMs += 125; // 16th note at 120 BPM
          for (const role of roles) {
            engines[role].stepSixteenthForTest(clockMs, s * 0.125);
          }
        }
      },
    };
  }

  it("1. demonstrates unified emergent reactivity when drums energy and piano tension increase", () => {
    const { engines, synths, advanceBarsAll } =
      createFourPieceOrchestra("engine-test-1");

    // Run 1 bar at low drums energy (0.35) and low piano tension (0.2)
    advanceBarsAll(1);

    const lowEnergyBassCount = synths.bass.bassEvents.length;
    const lowEnergyPianoCount = synths.piano.pianoEvents.length;
    const lowEnergyLeadCount = synths.lead.leadEvents.length;
    const lowEnergyPianoOctave = synths.piano.pianoEvents[0]?.notes[0] ?? "C3";

    expect(lowEnergyBassCount).toBe(4); // Quarter notes on steps 0, 4, 8, 12
    expect(lowEnergyPianoCount).toBe(2); // Half-bar comping on steps 0, 8
    expect(lowEnergyPianoOctave).toMatch(/3$/);

    // Clear recorded synth events
    synths.bass.clear();
    synths.piano.clear();
    synths.lead.clear();

    // Raise drums energy to 0.85 and piano tension to 0.8
    engines.drums.setEnergy(0.85);
    engines.piano.setTension(0.8);

    // Run 1 bar and verify downstream autonomous adaptation
    advanceBarsAll(1);

    const highEnergyBassCount = synths.bass.bassEvents.length;
    const highEnergyPianoCount = synths.piano.pianoEvents.length;
    const highEnergyLeadCount = synths.lead.leadEvents.length;
    const highEnergyPianoNote = synths.piano.pianoEvents[0]?.notes[0] ?? "C4";
    const highTensionChord = synths.piano.pianoEvents[0]?.chordSymbol ?? "";

    // Bass doubles syncopation (12 hits/bar vs 4) and opens filter cutoff
    expect(highEnergyBassCount).toBeGreaterThanOrEqual(lowEnergyBassCount * 2);
    expect(synths.bass.bassEvents[0].filterCutoffHz).toBeGreaterThan(400);

    // Piano shifts to brighter octave-4 register, adds syncopated comping hits, and voices 7th/9th tension chords
    expect(highEnergyPianoCount).toBeGreaterThan(lowEnergyPianoCount);
    expect(highEnergyPianoNote).toMatch(/4$/);
    expect(highTensionChord).toMatch(/(7|9|sus)/);

    // Lead increases melodic note density and vibrato depth
    expect(highEnergyLeadCount).toBeGreaterThan(lowEnergyLeadCount);
    expect(synths.lead.leadEvents[0].vibratoDepth).toBeGreaterThan(0.25);
  });

  it("2. SPLIT_2V2 causes Group A (drums+bass) and Group B (piano+lead) to diverge in BPM and key in opposite directions and record distinct MotifRecords", () => {
    const { engines, advanceBarsAll } =
      createFourPieceOrchestra("engine-test-2");

    // Trigger SPLIT_2V2 partition
    engines.drums.applyPartitionPreset("SPLIT_2V2");

    // Advance 2 isolation bars
    advanceBarsAll(2);

    const snapDrums = engines.drums.getSnapshot();
    const snapBass = engines.bass.getSnapshot();
    const snapPiano = engines.piano.getSnapshot();
    const snapLead = engines.lead.getSnapshot();

    expect(snapDrums.modeState).toBe("partitioned");
    expect(snapBass.modeState).toBe("partitioned");
    expect(snapPiano.modeState).toBe("partitioned");
    expect(snapLead.modeState).toBe("partitioned");

    // Group A (drums + bass) drifted faster (> 120 BPM) and stepped clockwise on Circle of Fifths to G major
    expect(snapDrums.bpm).toBeGreaterThan(120);
    expect(snapBass.bpm).toBe(snapDrums.bpm);
    expect(snapDrums.keyRoot).toBe("G");
    expect(snapDrums.mode).toBe("major");
    expect(snapBass.keyRoot).toBe("G");

    // Group B (piano + lead) drifted slower (< 120 BPM) and shifted to relative minor (A minor)
    expect(snapPiano.bpm).toBeLessThan(120);
    expect(snapLead.bpm).toBe(snapPiano.bpm);
    expect(snapPiano.keyRoot).toBe("A");
    expect(snapPiano.mode).toBe("minor");
    expect(snapLead.keyRoot).toBe("A");

    // Both subgroups recorded distinct MotifRecords in isolationMotifHistory
    expect(snapDrums.isolationMotifHistory.length).toBeGreaterThanOrEqual(1);
    expect(snapLead.isolationMotifHistory.length).toBeGreaterThanOrEqual(1);
    expect(snapDrums.isolationMotifHistory[0].id).not.toBe(
      snapLead.isolationMotifHistory[0].id
    );
    expect(snapDrums.isolationMotifHistory[0].keyRoot).toBe("G");
    expect(snapLead.isolationMotifHistory[0].keyRoot).toBe("A");
  });

  it("3. HEAL_ALL triggers modeState === 'bridging' with identical ReconcilePlan across all 4 nodes, plays pivotChord in bars 1-2, weaves motifs in bars 3-4, and lands in 'unified' at Bar 5 Beat 1 with phaseError < 15ms", () => {
    const { engines, synths, advanceBarsAll } =
      createFourPieceOrchestra("engine-test-3");

    // Split and diverge for 2 bars
    engines.drums.applyPartitionPreset("SPLIT_2V2");
    advanceBarsAll(2);

    // Heal all partitions
    engines.piano.applyPartitionPreset("HEAL_ALL");

    const planDrums = engines.drums.getSnapshot().reconcilePlan;
    const planBass = engines.bass.getSnapshot().reconcilePlan;
    const planPiano = engines.piano.getSnapshot().reconcilePlan;
    const planLead = engines.lead.getSnapshot().reconcilePlan;

    // All 4 nodes independently compute the exact same ReconcilePlan (Invariant #3)
    expect(planDrums).not.toBeNull();
    expect(planDrums).toEqual(planBass);
    expect(planDrums).toEqual(planPiano);
    expect(planDrums).toEqual(planLead);
    expect(planDrums!.bridgeBars).toBe(4);
    expect(planDrums!.adoptedMotifs.length).toBeGreaterThanOrEqual(4);

    for (const role of ["drums", "bass", "piano", "lead"] as const) {
      expect(engines[role].getSnapshot().modeState).toBe("bridging");
    }

    synths.piano.clear();
    synths.lead.clear();

    // Advance Bars 1–2 of the bridge (32 sixteenth steps)
    advanceBarsAll(2);

    const midBridgePianoSnap = engines.piano.getSnapshot();
    expect(midBridgePianoSnap.modeState).toBe("bridging");
    // Verify piano played the shared Circle-of-Fifths pivotChord during Bars 1–2
    expect(synths.piano.pianoEvents.length).toBeGreaterThan(0);
    expect(synths.piano.pianoEvents[0].chordSymbol).toBe(
      planDrums!.pivotChord
    );

    synths.lead.clear();

    // Advance Bars 3–4 of the bridge (32 sixteenth steps -> completes all 64 bridge steps)
    advanceBarsAll(2);

    // Lead played notes from the adopted isolation motifs during Bars 3–4
    expect(synths.lead.leadEvents.length).toBeGreaterThan(0);

    // At Bar 5 Beat 1 (after 4 bridge bars), all 4 nodes land in modeState === "unified"
    for (const role of ["drums", "bass", "piano", "lead"] as const) {
      const finalSnap = engines[role].getSnapshot();
      expect(finalSnap.modeState).toBe("unified");
      expect(finalSnap.bpm).toBe(planDrums!.targetBpm);
      expect(finalSnap.keyRoot).toBe(planDrums!.targetKeyRoot);
      expect(finalSnap.mode).toBe(planDrums!.targetMode);
      expect(finalSnap.phaseErrorMs).toBeLessThan(15);
      expect(finalSnap.adoptedMotifs).toHaveLength(
        planDrums!.adoptedMotifs.length
      );
    }
  });

  it("4. AIStrategist timeout or offline fallback never blocks or throws in the engine", async () => {
    // Case A: Offline / network rejection
    const failingStrategist = new AIStrategist({
      enabled: true,
      endpointUrl: "http://localhost:11434",
      timeoutMs: 50,
      fetchImpl: async () => {
        throw new Error("Connection refused");
      },
    });

    const fallbackResult = await failingStrategist.requestSuggestion({
      role: "lead",
      partitionGroupId: "part-1",
      modeState: "partitioned",
      bpm: 112,
      keyRoot: "A",
      mode: "minor",
      energy: 0.5,
      tension: 0.6,
      barNumber: 4,
      hasDrumsInGroup: false,
    });

    expect(fallbackResult.source).toBe("deterministic-fallback");
    expect(fallbackResult.motif.scaleDegrees).toHaveLength(8);
    expect(fallbackResult.motif.keyRoot).toBe("A");

    // Case B: Slow Ollama response exceeding timeoutMs triggers AbortController cleanly
    const slowStrategist = new AIStrategist({
      enabled: true,
      endpointUrl: "http://localhost:11434",
      timeoutMs: 30,
      fetchImpl: (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    });

    const timeoutResult = await slowStrategist.requestSuggestion({
      role: "drums",
      partitionGroupId: "part-2",
      modeState: "partitioned",
      bpm: 128,
      keyRoot: "G",
      mode: "major",
      energy: 0.8,
      tension: 0.4,
      barNumber: 8,
      hasDrumsInGroup: true,
    });

    expect(timeoutResult.source).toBe("deterministic-fallback");
    expect(timeoutResult.motif.keyRoot).toBe("G");
  });
});
