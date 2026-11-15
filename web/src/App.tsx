import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  INSTRUMENT_ROLES,
  type InstrumentRole,
  type MotifRecord,
  type MusicalMode,
  type PartitionPreset,
  type SignallingStatus,
  type TransportMode,
} from "../../shared/types";
import { BeatPhaseRing } from "./components/BeatPhaseRing";
import { CircleOfFifthsRadar } from "./components/CircleOfFifthsRadar";
import { DemoControlBar } from "./components/DemoControlBar";
import { HeaderBar } from "./components/HeaderBar";
import { MeshTopologyGraph } from "./components/MeshTopologyGraph";
import { MotifProvenancePanel } from "./components/MotifProvenancePanel";
import {
  buildIntentPacketFromTelemetry,
  type InstrumentNodeTelemetry,
  type ViewRole,
} from "./components/observatoryTypes";
import {
  OrchestraEngine,
  type EngineSnapshot,
} from "./engine/OrchestraEngine";
import {
  RecordingSynthAdapter,
  type AudioMonitorMode,
} from "./engine/SynthRack";
import {
  PeerMesh,
  resolveInitialTransportMode,
  type PacketEdgePulseEvent,
} from "./net/PeerMesh";

function resolveInitialViewRole(): ViewRole {
  if (typeof window === "undefined") {
    return "observatory";
  }
  const params = new URLSearchParams(window.location.search);
  const roleParam = params.get("role")?.toLowerCase();
  if (
    roleParam === "drums" ||
    roleParam === "bass" ||
    roleParam === "piano" ||
    roleParam === "lead" ||
    roleParam === "observatory"
  ) {
    return roleParam;
  }
  return "observatory";
}

function hasExplicitSingleRoleQuery(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const params = new URLSearchParams(window.location.search);
  const role = params.get("role")?.toLowerCase();
  return (
    role === "drums" ||
    role === "bass" ||
    role === "piano" ||
    role === "lead"
  );
}

export function App(): React.ReactElement {
  const initialViewRole = useMemo(() => resolveInitialViewRole(), []);
  const initialTransport = useMemo(() => resolveInitialTransportMode(), []);

  const [viewRole, setViewRole] = useState<ViewRole>(initialViewRole);
  const [monitorMode, setMonitorMode] = useState<AudioMonitorMode>(
    hasExplicitSingleRoleQuery() ? "my-instrument" : "observatory-mix"
  );
  const [transportMode, setTransportMode] =
    useState<TransportMode>(initialTransport);
  const [companionPeersEnabled, setCompanionPeersEnabled] = useState<boolean>(
    !hasExplicitSingleRoleQuery()
  );
  const [signallingStatus, setSignallingStatus] =
    useState<SignallingStatus>("offline");
  const [recentPulses, setRecentPulses] = useState<PacketEdgePulseEvent[]>([]);
  const [aiEnabled, setAiEnabled] = useState<boolean>(false);
  const [aiEndpointUrl, setAiEndpointUrl] = useState<string>(
    "http://localhost:11434"
  );
  const [guidedDemoActive, setGuidedDemoActive] = useState<boolean>(false);
  const [guidedDemoStage, setGuidedDemoStage] = useState<number>(0);

  const primaryEngineRef = useRef<OrchestraEngine | null>(null);
  const companionEnginesRef = useRef<
    Partial<Record<InstrumentRole, OrchestraEngine>>
  >({});

  const [primarySnapshot, setPrimarySnapshot] =
    useState<EngineSnapshot | null>(null);
  const [companionSnapshots, setCompanionSnapshots] = useState<
    Partial<Record<InstrumentRole, EngineSnapshot>>
  >({});

  const activeLocalRole: InstrumentRole =
    viewRole === "observatory" ? "drums" : viewRole;

  // Initialize Primary OrchestraEngine & PeerMesh
  useEffect(() => {
    const primaryMesh = new PeerMesh({
      peerId: `peer-${activeLocalRole}`,
      role: activeLocalRole,
      roomId: "symphony-main-hall",
      transportMode,
      broadcastChannelName: "symphony-mesh",
    });

    const engine = new OrchestraEngine({
      peerMesh: primaryMesh,
      monitorMode,
    });
    primaryEngineRef.current = engine;
    setSignallingStatus(primaryMesh.getSignallingStatus());

    const unsubSnap = engine.onSnapshot((snap) => {
      setPrimarySnapshot(snap);
    });

    const unsubSig = primaryMesh.onSignallingStatusChange((status) => {
      setSignallingStatus(status);
    });

    const unsubPulse = primaryMesh.onPacketEdgePulse((pulse) => {
      setRecentPulses((prev) => [...prev.slice(-18), pulse]);
    });

    return () => {
      unsubSnap();
      unsubSig();
      unsubPulse();
      engine.dispose();
      primaryMesh.destroy();
      primaryEngineRef.current = null;
    };
  }, [activeLocalRole, transportMode]);

  // Spawn or tear down Virtual Companion Peers for missing roles when enabled
  useEffect(() => {
    const primaryEngine = primaryEngineRef.current;
    if (!primaryEngine || !companionPeersEnabled) {
      primaryEngine?.setCompanionEngines([]);
      setCompanionSnapshots({});
      return;
    }

    const companionList: OrchestraEngine[] = [];
    const companionMap: Partial<Record<InstrumentRole, OrchestraEngine>> = {};
    const unsubs: Array<() => void> = [];

    for (const role of INSTRUMENT_ROLES) {
      if (role === activeLocalRole) {
        continue;
      }

      const compMesh = new PeerMesh({
        peerId: `peer-${role}`,
        role,
        roomId: "symphony-main-hall",
        transportMode,
        broadcastChannelName: "symphony-mesh",
      });

      // Companion uses non-duplicating RecordingSynthAdapter while primary SynthRack
      // handles audio output in "observatory-mix" mode
      const silentAdapter = new RecordingSynthAdapter(role, "my-instrument");
      const compEngine = new OrchestraEngine({
        peerMesh: compMesh,
        synth: silentAdapter,
        monitorMode: "my-instrument",
      });

      companionList.push(compEngine);
      companionMap[role] = compEngine;

      const unsub = compEngine.onSnapshot((snap) => {
        setCompanionSnapshots((prev) => ({
          ...prev,
          [role]: snap,
        }));
      });

      unsubs.push(() => {
        unsub();
        compEngine.dispose();
        compMesh.destroy();
      });
    }

    companionEnginesRef.current = companionMap;
    primaryEngine.setCompanionEngines(companionList);
    primaryEngine.peerMesh.announcePresence();
    for (const comp of companionList) {
      comp.peerMesh.announcePresence();
      comp.broadcastCurrentIntent();
    }
    primaryEngine.broadcastCurrentIntent();

    return () => {
      primaryEngine.setCompanionEngines([]);
      companionEnginesRef.current = {};
      for (const cleanup of unsubs) {
        cleanup();
      }
    };
  }, [activeLocalRole, companionPeersEnabled, transportMode]);

  // Guided 90s Auto-Demo Choreography Controller (strictly dispatches high-level engine commands)
  useEffect(() => {
    if (!guidedDemoActive) {
      setGuidedDemoStage(0);
      return;
    }

    const engine = primaryEngineRef.current;
    if (!engine) {
      return;
    }

    setGuidedDemoStage(0);
    engine.applyPartitionPreset("HEAL_ALL");
    engine.setEnergy(0.75);
    engine.setTension(0.45);

    const tStage2 = setTimeout(() => {
      setGuidedDemoStage(1);
      engine.applyPartitionPreset("SPLIT_2V2");
      engine.improviseNewMotif();
      for (const comp of Object.values(companionEnginesRef.current)) {
        comp?.improviseNewMotif();
      }
    }, 6_000);

    const tStage3 = setTimeout(() => {
      setGuidedDemoStage(2);
      engine.applyPartitionPreset("HEAL_ALL");
    }, 14_000);

    const tStage4 = setTimeout(() => {
      setGuidedDemoStage(3);
      engine.setEnergy(0.82);
      engine.setTension(0.3);
    }, 22_000);

    return () => {
      clearTimeout(tStage2);
      clearTimeout(tStage3);
      clearTimeout(tStage4);
    };
  }, [guidedDemoActive]);

  // Control Handlers
  const handleTogglePlay = useCallback(async () => {
    const engine = primaryEngineRef.current;
    if (!engine) {
      return;
    }
    if (engine.getSnapshot().isPlaying) {
      engine.stop();
    } else {
      await engine.start();
    }
  }, []);

  const handleSelectMonitorMode = useCallback((mode: AudioMonitorMode) => {
    setMonitorMode(mode);
    primaryEngineRef.current?.setMonitorMode(mode);
  }, []);

  const handleSelectTransportMode = useCallback((mode: TransportMode) => {
    setTransportMode(mode);
  }, []);

  const handleChangeEnergy = useCallback((value: number) => {
    primaryEngineRef.current?.setEnergy(value);
  }, []);

  const handleChangeTension = useCallback((value: number) => {
    primaryEngineRef.current?.setTension(value);
    companionEnginesRef.current.piano?.setTension(value);
  }, []);

  const handleImproviseMotif = useCallback(() => {
    primaryEngineRef.current?.improviseNewMotif();
    companionEnginesRef.current.lead?.improviseNewMotif();
  }, []);

  const handleApplyPreset = useCallback((preset: PartitionPreset) => {
    primaryEngineRef.current?.applyPartitionPreset(preset);
  }, []);

  const handleToggleEdgeBlock = useCallback(
    (roleA: InstrumentRole, roleB: InstrumentRole) => {
      const engine = primaryEngineRef.current;
      if (!engine) {
        return;
      }
      engine.peerMesh.toggleEdgeBlock(roleA, roleB, true);
    },
    []
  );

  const handleSelectKeyAndMode = useCallback(
    (keyRoot: string, mode: MusicalMode) => {
      primaryEngineRef.current?.setKeyAndMode(keyRoot, mode);
    },
    []
  );

  const handleToggleAi = useCallback((enabled: boolean) => {
    setAiEnabled(enabled);
    primaryEngineRef.current?.strategist.setEnabled(enabled);
    for (const comp of Object.values(companionEnginesRef.current)) {
      comp?.strategist.setEnabled(enabled);
    }
  }, []);

  const handleChangeAiEndpoint = useCallback((url: string) => {
    setAiEndpointUrl(url);
    primaryEngineRef.current?.strategist.setEndpointUrl(url);
    for (const comp of Object.values(companionEnginesRef.current)) {
      comp?.strategist.setEndpointUrl(url);
    }
  }, []);

  // Build unified 4-node telemetry map for the Judge Observatory Dashboard
  const nodesTelemetry: Record<InstrumentRole, InstrumentNodeTelemetry> =
    useMemo(() => {
      const snap = primarySnapshot;
      const result = {} as Record<InstrumentRole, InstrumentNodeTelemetry>;

      for (const role of INSTRUMENT_ROLES) {
        if (snap && role === snap.role) {
          result[role] = {
            peerId: snap.peerId,
            role,
            bpm: snap.bpm,
            keyRoot: snap.keyRoot,
            mode: snap.mode,
            chordSymbol: snap.chordSymbol,
            energy: snap.energy,
            tension: snap.tension,
            beatPhase: snap.beatPhase,
            barNumber: snap.barNumber,
            partitionGroupId: snap.partitionGroupId,
            modeState: snap.modeState,
            isLeader: snap.isSubgroupLeader,
            isReachableFromLocal: true,
            isCompanion: false,
            activeMotif: snap.activeMotif,
            isolationMotifHistory: snap.isolationMotifHistory,
          };
          continue;
        }

        // Check if we have a live companion snapshot (gives full observatory visibility even when partitioned!)
        const compSnap = companionSnapshots[role];
        if (compSnap) {
          result[role] = {
            peerId: compSnap.peerId,
            role,
            bpm: compSnap.bpm,
            keyRoot: compSnap.keyRoot,
            mode: compSnap.mode,
            chordSymbol: compSnap.chordSymbol,
            energy: compSnap.energy,
            tension: compSnap.tension,
            beatPhase: compSnap.beatPhase,
            barNumber: compSnap.barNumber,
            partitionGroupId: compSnap.partitionGroupId,
            modeState: compSnap.modeState,
            isLeader: compSnap.isSubgroupLeader,
            isReachableFromLocal:
              snap?.reachableRoles.includes(role) ?? true,
            isCompanion: true,
            activeMotif: compSnap.activeMotif,
            isolationMotifHistory: compSnap.isolationMotifHistory,
          };
          continue;
        }

        // Otherwise check reachable remote peer intents
        const remotePkt = snap
          ? Object.values(snap.peerIntents).find((p) => p.role === role)
          : undefined;

        if (remotePkt) {
          result[role] = {
            peerId: remotePkt.peerId,
            role,
            bpm: remotePkt.bpm,
            keyRoot: remotePkt.keyRoot,
            mode: remotePkt.mode,
            chordSymbol: remotePkt.chordSymbol,
            energy: remotePkt.energy,
            tension: remotePkt.tension,
            beatPhase: remotePkt.beatPhase,
            barNumber: remotePkt.barNumber,
            partitionGroupId: remotePkt.partitionGroupId,
            modeState: remotePkt.modeState,
            isLeader: false,
            isReachableFromLocal: true,
            isCompanion: false,
            activeMotif: remotePkt.activeMotif,
            isolationMotifHistory: remotePkt.isolationMotifHistory,
          };
          continue;
        }

        // Default placeholder when role is offline/unoccupied
        result[role] = {
          peerId: `peer-${role}`,
          role,
          bpm: snap?.bpm ?? 120,
          keyRoot: snap?.keyRoot ?? "C",
          mode: snap?.mode ?? "major",
          chordSymbol: snap?.chordSymbol ?? "C",
          energy: 0.5,
          tension: 0.25,
          beatPhase: snap?.beatPhase ?? 0,
          barNumber: snap?.barNumber ?? 0,
          partitionGroupId: snap?.partitionGroupId ?? "offline",
          modeState: snap?.modeState ?? "unified",
          isLeader: false,
          isReachableFromLocal: false,
          isCompanion: false,
          activeMotif: null,
          isolationMotifHistory: [],
        };
      }

      return result;
    }, [primarySnapshot, companionSnapshots]);

  // Combine isolation & adopted motifs across all 4 nodes for the provenance panel
  const combinedIsolationMotifs = useMemo(() => {
    const map = new Map<string, MotifRecord>();
    for (const role of INSTRUMENT_ROLES) {
      for (const m of nodesTelemetry[role].isolationMotifHistory) {
        map.set(m.id, m);
      }
      const active = nodesTelemetry[role].activeMotif;
      if (active) {
        map.set(active.id, active);
      }
    }
    return Array.from(map.values());
  }, [nodesTelemetry]);

  const modeState = primarySnapshot?.modeState ?? "unified";
  const reconcilePlan = primarySnapshot?.reconcilePlan ?? null;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <HeaderBar
        viewRole={viewRole}
        onSelectViewRole={setViewRole}
        isPlaying={primarySnapshot?.isPlaying ?? false}
        onTogglePlay={handleTogglePlay}
        monitorMode={monitorMode}
        onSelectMonitorMode={handleSelectMonitorMode}
        transportMode={transportMode}
        onSelectTransportMode={handleSelectTransportMode}
        companionPeersEnabled={companionPeersEnabled}
        onToggleCompanionPeers={setCompanionPeersEnabled}
        modeState={modeState}
        bridgeBarIndex={primarySnapshot?.bridgeBarIndex ?? 0}
        bridgeBars={reconcilePlan?.bridgeBars ?? 4}
        signallingStatus={signallingStatus}
        bpm={primarySnapshot?.bpm ?? 120}
        keyRoot={primarySnapshot?.keyRoot ?? "C"}
        musicalMode={primarySnapshot?.mode ?? "major"}
        chordSymbol={primarySnapshot?.chordSymbol ?? "C"}
      />

      <main className="mx-auto w-full max-w-[1600px] flex-1 p-4 space-y-4">
        {/* Top Row: P2P Mesh Topology Graph + Beat-Phase Alignment Ring + Circle-of-Fifths Radar */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
          <div className="xl:col-span-5">
            <MeshTopologyGraph
              nodes={nodesTelemetry}
              modeState={modeState}
              blockedEdges={primarySnapshot?.blockedEdges ?? []}
              recentPulses={recentPulses}
              reconcilePlan={reconcilePlan}
              onToggleEdgeBlock={handleToggleEdgeBlock}
            />
          </div>

          <div className="xl:col-span-3">
            <BeatPhaseRing
              nodes={nodesTelemetry}
              modeState={modeState}
              phaseErrorMs={primarySnapshot?.phaseErrorMs ?? 0}
              barNumber={primarySnapshot?.barNumber ?? 0}
            />
          </div>

          <div className="xl:col-span-4">
            <CircleOfFifthsRadar
              nodes={nodesTelemetry}
              modeState={modeState}
              reconcilePlan={reconcilePlan}
              onSelectKeyAndMode={handleSelectKeyAndMode}
            />
          </div>
        </div>

        {/* Middle Row: Motif Provenance Cards & Live Telemetry */}
        <MotifProvenancePanel
          modeState={modeState}
          isolationMotifs={combinedIsolationMotifs}
          adoptedMotifs={primarySnapshot?.adoptedMotifs ?? []}
          activeMotif={primarySnapshot?.activeMotif ?? null}
          latestIntentPacket={buildIntentPacketFromTelemetry(
            nodesTelemetry[activeLocalRole]
          )}
          aiEnabled={aiEnabled}
          aiEndpointUrl={aiEndpointUrl}
          onToggleAi={handleToggleAi}
          onChangeAiEndpoint={handleChangeAiEndpoint}
        />

        {/* Bottom Row: Interactive Performance & Guided 90s Auto-Demo Bar */}
        <DemoControlBar
          energy={primarySnapshot?.energy ?? 0.6}
          tension={primarySnapshot?.tension ?? 0.25}
          onChangeEnergy={handleChangeEnergy}
          onChangeTension={handleChangeTension}
          onImproviseMotif={handleImproviseMotif}
          onApplyPreset={handleApplyPreset}
          modeState={modeState}
          guidedDemoActive={guidedDemoActive}
          guidedDemoStage={guidedDemoStage}
          onToggleGuidedDemo={() => setGuidedDemoActive((prev) => !prev)}
        />
      </main>
    </div>
  );
}

export default App;
