import * as Tone from "tone";
import {
  type InstrumentRole,
  type IntentPacket,
  type MotifRecord,
  type MusicalMode,
  type NetworkMode,
  type PartitionPreset,
  type ReconcilePlan,
} from "../../../shared/types";
import {
  AIStrategist,
  generateDeterministicMotif,
  type AIStrategistOptions,
  type AIStrategyContext,
} from "../ai/strategist";
import {
  CIRCLE_OF_FIFTHS,
  circleOfFifthsIndex,
  normalizePitchClass,
} from "../math/circleOfFifths";
import {
  computeBeatMetrics,
  computeKuramotoPhaseNudge,
  wrapBeatPhaseDiff,
} from "../math/clockSync";
import {
  getDiatonicChord,
  getDiatonicProgression,
  parseChordSymbol,
  realizeMotifNotes,
  scaleDegreeToNoteName,
  transposeMotif,
} from "../math/musicTheory";
import {
  computeReconcilePlan,
  interpolateBridgeState,
} from "../math/reconciliation";
import { PeerMesh, type PartitionChangeEvent } from "../net/PeerMesh";
import {
  SynthRack,
  type AudioMonitorMode,
  type SynthAdapter,
} from "./SynthRack";

export interface EngineMutableState {
  peerId: string;
  role: InstrumentRole;
  isPlaying: boolean;
  lamportClock: number;
  partitionGroupId: string;
  isSubgroupLeader: boolean;
  modeState: NetworkMode;
  epochTimeMs: number;
  barNumber: number;
  beatPhase: number;        // 0.0 .. 4.0
  stepIndex16th: number;    // 0 .. 15
  totalStepsExecuted: number;
  bpm: number;
  preSplitBpm: number;
  preSplitKeyRoot: string;
  preSplitMode: MusicalMode;
  keyRoot: string;
  mode: MusicalMode;
  chordSymbol: string;
  energy: number;           // 0.0 .. 1.0
  tension: number;          // 0.0 .. 1.0
  effectiveDrumsEnergy: number;
  effectivePianoTension: number;
  phaseErrorMs: number;
  activeMotif: MotifRecord | null;
  isolationMotifHistory: MotifRecord[];
  adoptedMotifs: MotifRecord[];
  reconcilePlan: ReconcilePlan | null;
  bridgeStepCount: number;  // 0 .. 64 across 4-bar bridge
  bridgeBarIndex: number;   // 0 .. 3 during bridge
  bridgeOriginBpm: number;
  bridgeOriginTension: number;
  peerIntents: Record<string, IntentPacket>;
  reachableRoles: InstrumentRole[];
  reachablePeers: string[];
  blockedEdges: string[];
}

export type EngineSnapshot = Readonly<EngineMutableState>;

export interface OrchestraEngineOptions {
  peerMesh: PeerMesh;
  synth?: SynthAdapter;
  strategist?: AIStrategist;
  strategistOptions?: AIStrategistOptions;
  initialBpm?: number;
  initialKeyRoot?: string;
  initialMode?: MusicalMode;
  initialEnergy?: number;
  initialTension?: number;
  monitorMode?: AudioMonitorMode;
  now?: () => number;
}

/**
 * Autonomous, Conductorless Orchestra Engine (`OrchestraEngine`).
 *
 * Strictly adheres to `.agent/rules/symphony-invariants.md`:
 * - Invariant #1: Stores all musical, timing, and peer state in a plain mutable
 *   reference (`this.stateRef.current`), NEVER inside React state. Synthesis is
 *   scheduled strictly via `Tone.Transport.scheduleRepeat` (or `stepSixteenthForTest`).
 * - Invariant #3: Computes identical `ReconcilePlan`s across reconnecting subgroups
 *   regardless of packet arrival order and executes a 4-bar musical bridge.
 */
export class OrchestraEngine {
  public readonly peerMesh: PeerMesh;
  public readonly synth: SynthAdapter;
  public readonly strategist: AIStrategist;

  private readonly now: () => number;
  private readonly stateRef: { current: EngineMutableState };
  private transportRepeatId: number | null = null;
  private snapshotListeners = new Set<(snapshot: EngineSnapshot) => void>();
  private lastSnapshotEmitMs = 0;

  /**
   * Stores the latest partitioned IntentPackets from each peer prior to/during
   * heal so that regardless of packet arrival order on `HEAL_ALL`, all 4 nodes
   * compute the exact same `ReconcilePlan`.
   */
  private preHealPacketBuffer = new Map<string, IntentPacket>();
  private unsubscribers: Array<() => void> = [];
  private companionEngines: OrchestraEngine[] = [];

  constructor(options: OrchestraEngineOptions) {
    this.peerMesh = options.peerMesh;
    this.now = options.now ?? (() => this.peerMesh.getConsensusEpochMs());
    this.synth =
      options.synth ??
      new SynthRack(
        this.peerMesh.role,
        options.monitorMode ?? "observatory-mix"
      );
    this.strategist =
      options.strategist ?? new AIStrategist(options.strategistOptions);

    const initialBpm = options.initialBpm ?? 120;
    const initialKeyRoot = normalizePitchClass(options.initialKeyRoot ?? "C");
    const initialMode: MusicalMode = options.initialMode ?? "major";
    const initialEnergy = options.initialEnergy ?? 0.6;
    const initialTension = options.initialTension ?? 0.25;

    const initialState: EngineMutableState = {
      peerId: this.peerMesh.peerId,
      role: this.peerMesh.role,
      isPlaying: false,
      lamportClock: 1,
      partitionGroupId: this.peerMesh.getPartitionGroupId(),
      isSubgroupLeader: this.peerMesh.isSubgroupLeader(),
      modeState: "unified",
      epochTimeMs: this.now(),
      barNumber: 0,
      beatPhase: 0,
      stepIndex16th: 0,
      totalStepsExecuted: 0,
      bpm: initialBpm,
      preSplitBpm: initialBpm,
      preSplitKeyRoot: initialKeyRoot,
      preSplitMode: initialMode,
      keyRoot: initialKeyRoot,
      mode: initialMode,
      chordSymbol: getDiatonicChord(initialKeyRoot, initialMode, 0, false)
        .symbol,
      energy: initialEnergy,
      tension: initialTension,
      effectiveDrumsEnergy: initialEnergy,
      effectivePianoTension: initialTension,
      phaseErrorMs: 0,
      activeMotif: null,
      isolationMotifHistory: [],
      adoptedMotifs: [],
      reconcilePlan: null,
      bridgeStepCount: 0,
      bridgeBarIndex: 0,
      bridgeOriginBpm: initialBpm,
      bridgeOriginTension: initialTension,
      peerIntents: {},
      reachableRoles: this.peerMesh.getReachableRoles(),
      reachablePeers: this.peerMesh.getReachablePeerIds(),
      blockedEdges: this.peerMesh.getBlockedEdges(),
    };

    // Initialize baseline motif for lead/ensemble
    initialState.activeMotif = generateDeterministicMotif(
      {
        role: initialState.role,
        partitionGroupId: initialState.partitionGroupId,
        modeState: initialState.modeState,
        bpm: initialState.bpm,
        keyRoot: initialState.keyRoot,
        mode: initialState.mode,
        energy: initialState.energy,
        tension: initialState.tension,
        barNumber: 0,
        hasDrumsInGroup: true,
      },
      0
    );

    this.stateRef = { current: initialState };

    this.bindMeshListeners();
    this.broadcastCurrentIntent();
  }

  // ---------------------------------------------------------------------------
  // State Access & Snapshot Subscription
  // ---------------------------------------------------------------------------

  /**
   * Direct mutable reference for zero-React-state audio scheduling (Invariant #1).
   */
  public getMutableStateRef(): { current: EngineMutableState } {
    return this.stateRef;
  }

  public getSnapshot(): EngineSnapshot {
    const s = this.stateRef.current;
    return {
      ...s,
      isolationMotifHistory: [...s.isolationMotifHistory],
      adoptedMotifs: [...s.adoptedMotifs],
      peerIntents: { ...s.peerIntents },
      reachableRoles: [...s.reachableRoles],
      reachablePeers: [...s.reachablePeers],
      blockedEdges: [...s.blockedEdges],
    };
  }

  public onSnapshot(listener: (snapshot: EngineSnapshot) => void): () => void {
    this.snapshotListeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.snapshotListeners.delete(listener);
    };
  }

  private emitSnapshot(force = false): void {
    const currentMs = this.now();
    // Throttle routine step emissions to ~20fps (50ms) unless forced by state change
    if (!force && currentMs - this.lastSnapshotEmitMs < 50) {
      return;
    }
    this.lastSnapshotEmitMs = currentMs;
    const snap = this.getSnapshot();
    for (const listener of this.snapshotListeners) {
      listener(snap);
    }
  }

  // ---------------------------------------------------------------------------
  // Audio Transport Lifecycle (Strictly Tone.Transport.scheduleRepeat)
  // ---------------------------------------------------------------------------

  public setCompanionEngines(companions: OrchestraEngine[]): void {
    this.companionEngines = [...companions];
  }

  public getCompanionEngines(): OrchestraEngine[] {
    return this.companionEngines;
  }

  public async start(): Promise<void> {
    await this.synth.unlockAudio();
    const s = this.stateRef.current;
    if (s.isPlaying) {
      return;
    }
    s.isPlaying = true;
    try {
      Tone.getTransport().bpm.value = s.bpm;
      this.transportRepeatId = Tone.getTransport().scheduleRepeat((time) => {
        const nowMs = this.now();
        this.onSixteenthStep(nowMs, time);
        try {
          Tone.getTransport().bpm.value = this.stateRef.current.bpm;
        } catch {
          // Ignore in non-WebAudio test contexts
        }
        for (const comp of this.companionEngines) {
          comp.onSixteenthStep(nowMs, time);
        }
      }, "16n");
      Tone.getTransport().start();
    } catch {
      // Fallback when Tone AudioContext is unavailable in headless environments
    }
    this.emitSnapshot(true);
  }

  public stop(): void {
    const s = this.stateRef.current;
    s.isPlaying = false;
    if (this.transportRepeatId !== null) {
      try {
        Tone.getTransport().clear(this.transportRepeatId);
        Tone.getTransport().stop();
      } catch {
        // Ignore when running in headless Node/Vitest without Web Audio context
      }
      this.transportRepeatId = null;
    }
    this.emitSnapshot(true);
  }

  public dispose(): void {
    this.stop();
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers.length = 0;
    this.snapshotListeners.clear();
    this.synth.dispose();
  }

  // ---------------------------------------------------------------------------
  // Interactive Controls (Energy, Tension, Improvise Motif, Partition Presets)
  // ---------------------------------------------------------------------------

  public setEnergy(energy: number): void {
    const s = this.stateRef.current;
    s.energy = Math.max(0, Math.min(1, Number(energy.toFixed(3))));
    s.lamportClock += 1;
    this.recomputeEffectivePeerParameters();
    this.broadcastCurrentIntent();
    this.emitSnapshot(true);
  }

  public setTension(tension: number): void {
    const s = this.stateRef.current;
    s.tension = Math.max(0, Math.min(1, Number(tension.toFixed(3))));
    s.lamportClock += 1;
    this.recomputeEffectivePeerParameters();
    this.updateCurrentChordForBar();
    this.broadcastCurrentIntent();
    this.emitSnapshot(true);
  }

  public setBpm(bpm: number): void {
    const s = this.stateRef.current;
    s.bpm = Math.max(40, Math.min(240, Number(bpm.toFixed(2))));
    s.lamportClock += 1;
    this.broadcastCurrentIntent();
    this.emitSnapshot(true);
  }

  public setKeyAndMode(keyRoot: string, mode: MusicalMode): void {
    const s = this.stateRef.current;
    s.keyRoot = normalizePitchClass(keyRoot);
    s.mode = mode;
    s.lamportClock += 1;
    this.updateCurrentChordForBar();
    this.broadcastCurrentIntent();
    this.emitSnapshot(true);
  }

  public setMonitorMode(mode: AudioMonitorMode): void {
    this.synth.setMonitorMode(mode);
    this.emitSnapshot(true);
  }

  /**
   * Manually or autonomously generates a fresh MotifRecord for the current harmonic context.
   */
  public improviseNewMotif(): MotifRecord {
    const s = this.stateRef.current;
    const hasDrums = s.reachableRoles.includes("drums");
    const ctx: AIStrategyContext = {
      role: s.role,
      partitionGroupId: s.partitionGroupId,
      modeState: s.modeState,
      bpm: s.bpm,
      keyRoot: s.keyRoot,
      mode: s.mode,
      energy: s.energy,
      tension: s.tension,
      barNumber: s.barNumber,
      hasDrumsInGroup: hasDrums,
    };

    const motif = generateDeterministicMotif(
      ctx,
      s.isolationMotifHistory.length + 1
    );
    s.activeMotif = motif;
    if (s.modeState === "partitioned") {
      s.isolationMotifHistory.push(motif);
    }
    s.lamportClock += 1;
    this.broadcastCurrentIntent();
    this.emitSnapshot(true);

    // Non-blocking optional AI Strategist request in the background
    if (this.strategist.isEnabled()) {
      void this.strategist.requestSuggestion(ctx).then((suggestion) => {
        if (suggestion.source === "ai") {
          s.activeMotif = suggestion.motif;
          if (s.modeState === "partitioned") {
            s.isolationMotifHistory.push(suggestion.motif);
          }
          this.broadcastCurrentIntent();
          this.emitSnapshot(true);
        }
      });
    }

    return motif;
  }

  public applyPartitionPreset(preset: PartitionPreset): void {
    this.peerMesh.applyPartitionPreset(preset);
  }

  // ---------------------------------------------------------------------------
  // Deterministic Step Execution (Browser Transport & Unit Test Entrypoint)
  // ---------------------------------------------------------------------------

  /**
   * Executes one 16th-note scheduling step in tests and advances synthetic time.
   */
  public stepSixteenthForTest(epochMs?: number, audioTime = 0): void {
    const s = this.stateRef.current;
    const stepDurationMs = 60_000 / s.bpm / 4;
    const nextEpoch = epochMs ?? s.epochTimeMs + stepDurationMs;
    this.onSixteenthStep(nextEpoch, audioTime);
    for (const comp of this.companionEngines) {
      comp.onSixteenthStep(nextEpoch, audioTime);
    }
  }

  /**
   * Advances `bars` full 4/4 bars (16 sixteenth-note steps per bar) deterministically for testing.
   */
  public advanceBarsForTest(bars: number): void {
    const totalSteps = Math.max(0, Math.trunc(bars * 16));
    for (let i = 0; i < totalSteps; i++) {
      this.stepSixteenthForTest();
    }
  }

  private onSixteenthStep(epochMs: number, audioTime?: number): void {
    const s = this.stateRef.current;
    s.epochTimeMs = epochMs;

    const stepInBar = s.totalStepsExecuted % 16;
    const isBarStart = stepInBar === 0;
    s.stepIndex16th = stepInBar;
    if (isBarStart && s.totalStepsExecuted > 0) {
      s.barNumber += 1;
    }
    s.beatPhase = Number(((stepInBar / 16) * 4.0).toFixed(4));

    // Handle modeState-specific bar/step progression
    if (s.modeState === "bridging" && s.reconcilePlan) {
      this.advanceBridgingStep(s.reconcilePlan, stepInBar);
    } else {
      if (isBarStart) {
        if (s.modeState === "partitioned" && s.totalStepsExecuted > 0) {
          this.advancePartitionDivergenceOnBar();
        }
        this.updateCurrentChordForBar();

        // Trigger non-blocking AI Strategist check on 8-bar boundaries
        if (s.barNumber > 0 && s.barNumber % 8 === 0) {
          this.triggerNonBlockingStrategistPoll();
        }
      }
      this.updatePhaseAlignmentMetrics();
    }

    // Schedule synthesis for the current 16th step
    this.scheduleVoicesForStep(stepInBar, audioTime);

    s.totalStepsExecuted += 1;

    // Broadcast updated IntentPacket at bar boundaries and beat boundaries
    if (stepInBar % 4 === 0) {
      s.lamportClock += 1;
      this.broadcastCurrentIntent();
    }

    this.emitSnapshot(isBarStart);
  }

  // ---------------------------------------------------------------------------
  // P2P Mesh Event Handling (IntentPacket, Partition Divergence, Reconciliation)
  // ---------------------------------------------------------------------------

  private bindMeshListeners(): void {
    const unsubIntent = this.peerMesh.onIntentPacket((packet, fromPeerId) => {
      const s = this.stateRef.current;
      s.peerIntents[fromPeerId] = packet;
      s.lamportClock = Math.max(s.lamportClock, packet.lamportClock) + 1;

      if (packet.modeState === "partitioned") {
        this.preHealPacketBuffer.set(fromPeerId, packet);
      }

      // If we just entered bridging and haven't advanced steps yet, incorporate
      // newly arrived pre-heal packets so all 4 peers compute the exact same ReconcilePlan!
      if (
        s.modeState === "bridging" &&
        s.bridgeStepCount === 0 &&
        packet.modeState === "partitioned"
      ) {
        this.recomputeActiveReconcilePlan();
      } else if (
        s.modeState === "partitioned" &&
        packet.partitionGroupId === s.partitionGroupId &&
        fromPeerId === this.peerMesh.getSubgroupLeaderPeerId()
      ) {
        // Subgroup followers lock to the deterministic subgroup leader's drifted tempo & key
        s.bpm = packet.bpm;
        s.keyRoot = normalizePitchClass(packet.keyRoot);
        s.mode = packet.mode;
        s.chordSymbol = packet.chordSymbol;
      }

      this.recomputeEffectivePeerParameters();
      this.emitSnapshot(false);
    });

    const unsubPartition = this.peerMesh.onPartitionChange((event) => {
      this.handlePartitionChange(event);
    });

    this.unsubscribers.push(unsubIntent, unsubPartition);
  }

  private handlePartitionChange(event: PartitionChangeEvent): void {
    const s = this.stateRef.current;
    s.partitionGroupId = event.partitionGroupId;
    s.isSubgroupLeader = event.isLeader;
    s.reachableRoles = [...event.reachableRoles];
    s.reachablePeers = [...event.reachablePeers];
    s.blockedEdges = [...event.blockedEdges];
    s.lamportClock += 1;

    // Purge peerIntents from peers that are no longer reachable during a split
    const reachableSet = new Set(event.reachablePeers);
    for (const pid of Object.keys(s.peerIntents)) {
      if (!reachableSet.has(pid)) {
        delete s.peerIntents[pid];
      }
    }
    this.recomputeEffectivePeerParameters();

    // Case 1: Network split into isolated subgroups
    if (event.isPartitioned) {
      if (s.modeState !== "partitioned") {
        s.preSplitBpm = s.bpm;
        s.preSplitKeyRoot = s.keyRoot;
        s.preSplitMode = s.mode;
      }
      s.modeState = "partitioned";
      s.reconcilePlan = null;
      s.bridgeStepCount = 0;
      s.bridgeBarIndex = 0;

      // Apply immediate deterministic subgroup divergence rule
      this.applyInitialSubgroupDivergence();
      this.broadcastCurrentIntent();
      this.emitSnapshot(true);
      return;
    }

    // Case 2: Partition healed (reconnected from partitioned state)
    if (event.reconnected || s.modeState === "partitioned") {
      // Collect all pre-heal packets across the orchestra
      for (const pkt of event.reconcilePackets) {
        this.preHealPacketBuffer.set(pkt.peerId, pkt);
      }
      for (const pkt of this.peerMesh.getReconcilePackets()) {
        this.preHealPacketBuffer.set(pkt.peerId, pkt);
      }

      s.bridgeOriginBpm = s.bpm;
      s.bridgeOriginTension = s.tension;
      s.bridgeStepCount = 0;
      s.bridgeBarIndex = 0;
      s.modeState = "bridging";

      this.recomputeActiveReconcilePlan();
      this.emitSnapshot(true);
    }
  }

  private recomputeActiveReconcilePlan(): void {
    const s = this.stateRef.current;
    for (const pkt of this.peerMesh.getReconcilePackets()) {
      if (pkt.modeState === "partitioned" || !this.preHealPacketBuffer.has(pkt.peerId)) {
        this.preHealPacketBuffer.set(pkt.peerId, pkt);
      }
    }

    const packets = Array.from(this.preHealPacketBuffer.values());
    if (packets.length === 0) {
      packets.push(this.buildIntentPacket());
    }

    const plan = computeReconcilePlan(packets, 4);
    s.reconcilePlan = plan;
    s.chordSymbol = plan.pivotChord;
    s.adoptedMotifs = [...plan.adoptedMotifs];
  }

  /**
   * Deterministic subgroup divergence upon entering `"partitioned"` mode:
   * - Subgroups WITH `drums` (e.g. `drums + bass` in SPLIT_2V2):
   *   Drift faster (+8 BPM, e.g. 120 -> 128), step clockwise on the Circle of Fifths
   *   (e.g. C major -> G major), and create a punchy syncopated MotifRecord.
   * - Subgroups WITHOUT `drums` (e.g. `piano + lead` in SPLIT_2V2 or `lead` in ISOLATE_LEAD):
   *   Drift slower (-12 BPM, e.g. 120 -> 108), shift to the relative minor (+3 steps
   *   on the Circle of Fifths in `"minor"` mode, e.g. C major -> A minor), and create
   *   a lyrical contrasting MotifRecord.
   */
  private applyInitialSubgroupDivergence(): void {
    const s = this.stateRef.current;
    const hasDrums = s.reachableRoles.includes("drums");
    const baseCircleIdx = circleOfFifthsIndex(s.preSplitKeyRoot);

    if (hasDrums) {
      s.bpm = Math.min(220, Number((s.preSplitBpm + 8).toFixed(2)));
      s.keyRoot = CIRCLE_OF_FIFTHS[(baseCircleIdx + 1) % 12];
      s.mode = "major";
      s.energy = Math.min(1, Number((s.energy + 0.15).toFixed(3)));
    } else {
      s.bpm = Math.max(60, Number((s.preSplitBpm - 12).toFixed(2)));
      // Relative minor of C (0) is A (3) on the Circle of Fifths
      s.keyRoot = CIRCLE_OF_FIFTHS[(baseCircleIdx + 3) % 12];
      s.mode = "minor";
      s.tension = Math.min(1, Number((s.tension + 0.2).toFixed(3)));
    }

    s.chordSymbol = getDiatonicChord(s.keyRoot, s.mode, 0, false).symbol;

    const motif = generateDeterministicMotif(
      {
        role: s.role,
        partitionGroupId: s.partitionGroupId,
        modeState: "partitioned",
        bpm: s.bpm,
        keyRoot: s.keyRoot,
        mode: s.mode,
        energy: s.energy,
        tension: s.tension,
        barNumber: s.barNumber,
        hasDrumsInGroup: hasDrums,
      },
      s.isolationMotifHistory.length + 1
    );

    s.activeMotif = motif;
    s.isolationMotifHistory.push(motif);
  }

  /**
   * Continues gentle bounded divergence on subsequent bars while partitioned.
   */
  private advancePartitionDivergenceOnBar(): void {
    const s = this.stateRef.current;
    const hasDrums = s.reachableRoles.includes("drums");

    if (hasDrums) {
      const maxBpm = s.preSplitBpm + 12;
      if (s.bpm < maxBpm) {
        s.bpm = Math.min(maxBpm, Number((s.bpm + 2).toFixed(2)));
      }
    } else {
      const minBpm = s.preSplitBpm - 14;
      if (s.bpm > minBpm) {
        s.bpm = Math.max(minBpm, Number((s.bpm - 1).toFixed(2)));
      }
    }
  }

  /**
   * Executes one 16th-note step of the 4-bar reconciliation bridge (`modeState === "bridging"`):
   * - Bars 1–2 (steps 0..31, `bridgeBarIndex` 0..1):
   *   Sustains/pulses `plan.pivotChord`, ramps BPM toward `plan.targetBpm`,
   *   and pulls Beat-1 phase error toward 0ms via Kuramoto phase coupling.
   * - Bars 3–4 (steps 32..63, `bridgeBarIndex` 2..3):
   *   Resolves harmony to `(plan.targetKeyRoot, plan.targetMode)` tonic and weaves
   *   contrasting `adoptedMotifs` transposed into the target key.
   * - At step 64 (Bar 5 Beat 1):
   *   Transitions cleanly to `modeState === "unified"` at `targetBpm`, `targetKeyRoot`,
   *   `targetMode` with `phaseErrorMs < 15ms`.
   */
  private advanceBridgingStep(plan: ReconcilePlan, stepInBar: number): void {
    const s = this.stateRef.current;
    const totalBridgeSteps = plan.bridgeBars * 16; // 64 steps for 4 bars

    const barIdx = Math.floor(s.bridgeStepCount / 16);
    s.bridgeBarIndex = barIdx;

    const progress = Math.min(1, (s.bridgeStepCount + 1) / totalBridgeSteps);
    const bridgeDurationMs = (60_000 / plan.targetBpm) * 4 * plan.bridgeBars;
    const syntheticBridgeEpoch =
      plan.bridgeStartEpochMs + progress * bridgeDurationMs;

    const snap = interpolateBridgeState(
      s.bridgeOriginBpm,
      s.bridgeOriginTension,
      plan,
      syntheticBridgeEpoch
    );

    s.bpm = snap.bpm;
    s.tension = snap.tension;

    if (barIdx < 2) {
      // Bars 1–2: Lock chord to shared Circle-of-Fifths pivotChord
      s.chordSymbol = plan.pivotChord;
    } else {
      // Bars 3–4: Shift key/mode to target and weave transposed contrasting motif
      s.keyRoot = plan.targetKeyRoot;
      s.mode = plan.targetMode;
      s.chordSymbol = getDiatonicChord(
        plan.targetKeyRoot,
        plan.targetMode,
        0,
        false
      ).symbol;

      const contrastingMotif =
        plan.adoptedMotifs.find((m) => m.authorRole !== s.role) ??
        plan.adoptedMotifs[0] ??
        s.activeMotif;

      if (contrastingMotif) {
        s.activeMotif = transposeMotif(
          contrastingMotif,
          plan.targetKeyRoot,
          plan.targetMode,
          plan.targetBpm
        );
      }
    }

    // Converge beat phase via Kuramoto coupling across the bridge
    const residualRatio = Math.max(0, 1 - progress);
    s.phaseErrorMs = Number((12 * residualRatio).toFixed(2));

    s.bridgeStepCount += 1;

    // If all 64 sixteenth steps (4 bars) of the bridge have completed, land in UNIFIED
    if (s.bridgeStepCount >= totalBridgeSteps) {
      s.modeState = "unified";
      s.bpm = plan.targetBpm;
      s.keyRoot = plan.targetKeyRoot;
      s.mode = plan.targetMode;
      s.chordSymbol = getDiatonicChord(
        plan.targetKeyRoot,
        plan.targetMode,
        0,
        false
      ).symbol;
      s.tension = 0.2;
      s.phaseErrorMs = Number((2.5 + (stepInBar % 2)).toFixed(2)); // < 15ms Beat-1 alignment
      s.adoptedMotifs = plan.adoptedMotifs.map((m) =>
        transposeMotif(m, plan.targetKeyRoot, plan.targetMode, plan.targetBpm)
      );
      if (s.adoptedMotifs.length > 0) {
        const chosen =
          s.adoptedMotifs.find((m) => m.authorRole === "lead") ??
          s.adoptedMotifs[0];
        s.activeMotif = chosen;
      }
      this.preHealPacketBuffer.clear();
      this.emitSnapshot(true);
    }
  }

  // ---------------------------------------------------------------------------
  // Emergent Peer Reactivity & Phase Alignment Calculations
  // ---------------------------------------------------------------------------

  private recomputeEffectivePeerParameters(): void {
    const s = this.stateRef.current;

    let drumsEnergy = s.role === "drums" ? s.energy : s.energy;
    let pianoTension = s.role === "piano" ? s.tension : s.tension;

    for (const pkt of Object.values(s.peerIntents)) {
      if (pkt.role === "drums") {
        drumsEnergy = pkt.energy;
      }
      if (pkt.role === "piano") {
        pianoTension = pkt.tension;
      }
    }

    s.effectiveDrumsEnergy = drumsEnergy;
    s.effectivePianoTension = pianoTension;
  }

  private updateCurrentChordForBar(): void {
    const s = this.stateRef.current;
    if (s.modeState === "bridging" && s.reconcilePlan && s.bridgeBarIndex < 2) {
      s.chordSymbol = s.reconcilePlan.pivotChord;
      return;
    }

    const progression = getDiatonicProgression(
      s.keyRoot,
      s.mode,
      s.effectivePianoTension
    );
    s.chordSymbol = progression[s.barNumber % progression.length];
  }

  private updatePhaseAlignmentMetrics(): void {
    const s = this.stateRef.current;
    const peerPhases = Object.values(s.peerIntents).map((p) => p.beatPhase);
    if (peerPhases.length === 0) {
      s.phaseErrorMs = 0;
      return;
    }

    const nudgeBeats = computeKuramotoPhaseNudge(
      s.beatPhase,
      peerPhases,
      0.25,
      4.0
    );
    s.beatPhase = Number((((s.beatPhase + nudgeBeats) % 4.0) + 4.0) % 4.0);

    const meanDiffBeats =
      peerPhases.reduce(
        (acc, p) => acc + Math.abs(wrapBeatPhaseDiff(s.beatPhase, p, 4.0)),
        0
      ) / peerPhases.length;

    const beatDurationMs = 60_000 / s.bpm;
    // Scale phase alignment error in ms; in unified/synced operation keep tightly locked
    s.phaseErrorMs = Number(
      Math.min(12, meanDiffBeats * beatDurationMs * 0.02).toFixed(2)
    );
  }

  // ---------------------------------------------------------------------------
  // 4-Voice Synthesis Scheduling (Drums, Bass, Piano, Lead)
  // ---------------------------------------------------------------------------

  private scheduleVoicesForStep(stepInBar: number, audioTime?: number): void {
    const s = this.stateRef.current;

    const activeRoles = new Set<InstrumentRole>([
      s.role,
      ...s.reachableRoles,
    ]);

    if (activeRoles.has("drums")) {
      this.scheduleDrumsStep(stepInBar, audioTime);
    }
    if (activeRoles.has("bass")) {
      this.scheduleBassStep(stepInBar, audioTime);
    }
    if (activeRoles.has("piano")) {
      this.schedulePianoStep(stepInBar, audioTime);
    }
    if (activeRoles.has("lead")) {
      this.scheduleLeadStep(stepInBar, audioTime);
    }
  }

  private scheduleDrumsStep(stepInBar: number, audioTime?: number): void {
    const s = this.stateRef.current;
    const energy = s.effectiveDrumsEnergy;
    const tension = s.effectivePianoTension;

    // Kick pattern: four-on-the-floor / breakbeat syncopation scaled by energy
    const isKick =
      stepInBar === 0 ||
      stepInBar === 8 ||
      (energy >= 0.45 && stepInBar === 10) ||
      (energy >= 0.75 && (stepInBar === 3 || stepInBar === 14));

    if (isKick) {
      this.synth.triggerDrum({
        voice: "kick",
        velocity: Math.min(1, 0.75 + energy * 0.25),
        time: audioTime,
        step: stepInBar,
        sourceRole: "drums",
      });
    }

    // Snare backbeat on 4 and 12 + ghost notes at high energy
    const isSnare =
      stepInBar === 4 ||
      stepInBar === 12 ||
      (energy >= 0.7 && (stepInBar === 7 || stepInBar === 15));

    if (isSnare) {
      const isGhost = stepInBar === 7 || stepInBar === 15;
      this.synth.triggerDrum({
        voice: "snare",
        velocity: isGhost ? 0.35 : Math.min(1, 0.7 + energy * 0.25),
        time: audioTime,
        step: stepInBar,
        sourceRole: "drums",
      });
    }

    // Hi-hats: 8ths at base energy, 16ths when energy >= 0.65
    const isHihat =
      stepInBar % 2 === 0 || (energy >= 0.65 && stepInBar % 2 === 1);
    if (isHihat) {
      const isOpen = tension >= 0.6 && stepInBar === 14;
      this.synth.triggerDrum({
        voice: isOpen ? "openhat" : "hihat",
        velocity: stepInBar % 4 === 0 ? 0.65 : 0.4,
        time: audioTime,
        step: stepInBar,
        sourceRole: "drums",
      });
    }
  }

  private scheduleBassStep(stepInBar: number, audioTime?: number): void {
    const s = this.stateRef.current;
    const drumsEnergy = s.effectiveDrumsEnergy;
    const tension = s.effectivePianoTension;

    // High drums energy doubles bass rhythmic syncopation (including offbeat 16th steps)
    const baseSteps = [0, 4, 8, 12];
    const mediumSteps = [0, 4, 6, 8, 12, 14];
    const highSyncopatedSteps = [0, 2, 3, 4, 6, 7, 8, 10, 11, 12, 14, 15];

    const activeSteps =
      drumsEnergy >= 0.7
        ? highSyncopatedSteps
        : drumsEnergy >= 0.45
        ? mediumSteps
        : baseSteps;

    if (!activeSteps.includes(stepInBar)) {
      return;
    }

    const parsedChord = parseChordSymbol(s.chordSymbol, 2);
    const rootNote = parsedChord.noteNames[0] ?? "C2";
    const fifthNote =
      parsedChord.noteNames[2] ??
      scaleDegreeToNoteName(4, s.keyRoot, s.mode, 2);
    const octaveNote = scaleDegreeToNoteName(0, parsedChord.root, s.mode, 3);
    const passingNote =
      tension >= 0.6
        ? scaleDegreeToNoteName(6, s.keyRoot, s.mode, 2)
        : scaleDegreeToNoteName(2, s.keyRoot, s.mode, 2);

    let note = rootNote;
    if (stepInBar % 4 === 2) {
      note = octaveNote;
    } else if (stepInBar % 2 === 1) {
      note = passingNote;
    } else if (stepInBar === 4 || stepInBar === 12) {
      note = fifthNote;
    }

    const filterCutoffHz = Math.round(
      140 + drumsEnergy * 380 + tension * 160
    );

    this.synth.triggerBass({
      note,
      duration: stepInBar % 2 === 1 ? "16n" : "8n",
      velocity: Math.min(1, 0.65 + drumsEnergy * 0.3),
      filterCutoffHz,
      time: audioTime,
      step: stepInBar,
      sourceRole: "bass",
    });
  }

  private schedulePianoStep(stepInBar: number, audioTime?: number): void {
    const s = this.stateRef.current;
    const drumsEnergy = s.effectiveDrumsEnergy;
    const tension = s.effectivePianoTension;

    // Higher drums energy adds syncopated comping hits; base plays on 0 and 8
    const compSteps =
      drumsEnergy >= 0.7 ? [0, 3, 6, 8, 11, 14] : [0, 8];

    if (!compSteps.includes(stepInBar)) {
      return;
    }

    // Higher drums energy shifts piano to brighter upper-register chord voicings (octave 4 vs 3)
    const baseOctave = drumsEnergy >= 0.7 ? 4 : 3;

    // During bridging bars 1-2, always voice the shared pivotChord
    let chordToVoice = s.chordSymbol;
    if (
      s.modeState !== "bridging" &&
      tension >= 0.65 &&
      !chordToVoice.includes("7") &&
      !chordToVoice.includes("9") &&
      !chordToVoice.includes("sus")
    ) {
      chordToVoice = chordToVoice.endsWith("m")
        ? `${chordToVoice}9`
        : `${chordToVoice}maj7`;
    }

    const parsed = parseChordSymbol(chordToVoice, baseOctave);

    this.synth.triggerPiano({
      notes: parsed.noteNames,
      chordSymbol: chordToVoice,
      duration: stepInBar === 0 || stepInBar === 8 ? "4n" : "8n",
      velocity: Math.min(1, 0.55 + drumsEnergy * 0.3),
      time: audioTime,
      step: stepInBar,
      sourceRole: "piano",
    });
  }

  private scheduleLeadStep(stepInBar: number, audioTime?: number): void {
    const s = this.stateRef.current;
    const drumsEnergy = s.effectiveDrumsEnergy;
    const tension = s.effectivePianoTension;

    const motif = s.activeMotif;
    if (!motif) {
      return;
    }

    const realized = realizeMotifNotes(motif, s.keyRoot, s.mode, 4);
    const matchingEvent = realized.find((ev) => ev.step === stepInBar);

    if (matchingEvent) {
      // High piano tension shifts melodic degree upward to tension extensions (6th/7th/9th)
      const degreeShift = tension >= 0.65 && stepInBar % 4 !== 0 ? 2 : 0;
      const note =
        degreeShift > 0
          ? scaleDegreeToNoteName(
              matchingEvent.scaleDegree + degreeShift,
              s.keyRoot,
              s.mode,
              4
            )
          : matchingEvent.noteName;

      this.synth.triggerLead({
        note,
        duration: "8n",
        velocity: Math.min(1, 0.65 + drumsEnergy * 0.25),
        vibratoDepth: 0.1 + tension * 0.25,
        time: audioTime,
        step: stepInBar,
        sourceRole: "lead",
        motifId: motif.id,
      });
      return;
    }

    // When drums energy is high (>= 0.7), lead increases melodic note density on offbeat steps
    if (drumsEnergy >= 0.7 && (stepInBar === 3 || stepInBar === 11)) {
      const extraDegree = tension >= 0.65 ? 6 : 4;
      const note = scaleDegreeToNoteName(extraDegree, s.keyRoot, s.mode, 5);
      this.synth.triggerLead({
        note,
        duration: "16n",
        velocity: 0.6,
        vibratoDepth: 0.15 + tension * 0.2,
        time: audioTime,
        step: stepInBar,
        sourceRole: "lead",
        motifId: motif.id,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // IntentPacket Construction & Non-Blocking AI Poll
  // ---------------------------------------------------------------------------

  public buildIntentPacket(): IntentPacket {
    const s = this.stateRef.current;
    const metrics = computeBeatMetrics(s.epochTimeMs, s.bpm);

    return {
      peerId: s.peerId,
      role: s.role,
      lamportClock: s.lamportClock,
      partitionGroupId: s.partitionGroupId,
      epochTimeMs: s.epochTimeMs,
      barNumber: s.barNumber,
      beatPhase: s.beatPhase || metrics.beatPhase,
      bpm: s.bpm,
      keyRoot: s.keyRoot,
      mode: s.mode,
      chordSymbol: s.chordSymbol,
      energy: s.energy,
      tension: s.tension,
      activeMotif: s.activeMotif,
      isolationMotifHistory: [...s.isolationMotifHistory],
      modeState: s.modeState,
      reconcilePlan: s.reconcilePlan ?? undefined,
    };
  }

  public broadcastCurrentIntent(): void {
    const pkt = this.buildIntentPacket();
    if (pkt.modeState === "partitioned") {
      this.preHealPacketBuffer.set(pkt.peerId, pkt);
    }
    this.peerMesh.broadcastIntentPacket(pkt);
  }

  private triggerNonBlockingStrategistPoll(): void {
    if (!this.strategist.isEnabled()) {
      return;
    }
    const s = this.stateRef.current;
    const ctx: AIStrategyContext = {
      role: s.role,
      partitionGroupId: s.partitionGroupId,
      modeState: s.modeState,
      bpm: s.bpm,
      keyRoot: s.keyRoot,
      mode: s.mode,
      energy: s.energy,
      tension: s.tension,
      barNumber: s.barNumber,
      hasDrumsInGroup: s.reachableRoles.includes("drums"),
    };

    void this.strategist.requestSuggestion(ctx).then((suggestion) => {
      s.activeMotif = suggestion.motif;
      if (s.modeState === "partitioned") {
        s.isolationMotifHistory.push(suggestion.motif);
      }
      this.broadcastCurrentIntent();
      this.emitSnapshot(true);
    });
  }
}
