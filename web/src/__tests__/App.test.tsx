import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { InstrumentRole, ReconcilePlan } from "../../../shared/types";
import { App } from "../App";
import { BeatPhaseRing } from "../components/BeatPhaseRing";
import { CircleOfFifthsRadar } from "../components/CircleOfFifthsRadar";
import { DemoControlBar } from "../components/DemoControlBar";
import { HeaderBar } from "../components/HeaderBar";
import { MeshTopologyGraph } from "../components/MeshTopologyGraph";
import { MotifProvenancePanel } from "../components/MotifProvenancePanel";
import {
  buildIntentPacketFromTelemetry,
  type InstrumentNodeTelemetry,
} from "../components/observatoryTypes";

function makeSampleNodes(
  modeState: "unified" | "partitioned" | "bridging" = "unified"
): Record<InstrumentRole, InstrumentNodeTelemetry> {
  const roles: InstrumentRole[] = ["drums", "bass", "piano", "lead"];
  const map = {} as Record<InstrumentRole, InstrumentNodeTelemetry>;

  for (const role of roles) {
    const isGroupA = role === "drums" || role === "bass";
    map[role] = {
      peerId: `peer-${role}`,
      role,
      bpm:
        modeState === "partitioned"
          ? isGroupA
            ? 128
            : 108
          : 120,
      keyRoot:
        modeState === "partitioned"
          ? isGroupA
            ? "G"
            : "A"
          : "C",
      mode:
        modeState === "partitioned" && !isGroupA ? "minor" : "major",
      chordSymbol:
        modeState === "partitioned"
          ? isGroupA
            ? "G"
            : "Am"
          : "C",
      energy: 0.75,
      tension: 0.35,
      beatPhase: isGroupA ? 0.5 : 2.25,
      barNumber: 4,
      partitionGroupId: isGroupA ? "part:bass-drums" : "part:lead-piano",
      modeState,
      isLeader: role === "bass" || role === "lead",
      isReachableFromLocal: true,
      isCompanion: role !== "drums",
      activeMotif: {
        id: `motif-${role}`,
        authorRole: role,
        createdDuringPartitionId: isGroupA
          ? "part:bass-drums"
          : "part:lead-piano",
        scaleDegrees: [0, 2, 4, 7, 5, 4, 2, 0],
        rhythmSteps: [0, 2, 4, 6, 8, 10, 12, 14],
        keyRoot: isGroupA ? "G" : "A",
        mode: isGroupA ? "major" : "minor",
        bpm: isGroupA ? 128 : 108,
      },
      isolationMotifHistory: [],
    };
  }

  return map;
}

describe("Judge Observatory Dashboard UI Components (Phase 4)", () => {
  it("renders full App observatory dashboard shell with all sections including Voice Recording and Local LLM", () => {
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain("Symphony Without a Conductor");
    expect(html).toContain("Join Orchestra &amp; Start Audio");
    expect(html).toContain("PRELUDE / A PHRASE OF YOUR OWN");
    expect(html).toContain("Record voice");
    expect(html).toContain("Live P2P Mesh Topology");
    expect(html).toContain("Beat-Phase Alignment Radar");
    expect(html).toContain("Circle-of-Fifths Harmonic Radar");
    expect(html).toContain("Motif Provenance &amp; Live Intent Telemetry");
    expect(html).toContain("Local LLM composition");
    expect(html).toContain("Check local model");
    expect(html).toContain("Split 2v2 (Drums+Bass | Piano+Lead)");
    expect(html).toContain("Isolate Lead (1v3)");
    expect(html).toContain("Heal Network &amp; Reconcile (4-Bar Bridge)");
    expect(html).toContain("Guided 90s Auto-Demo");
  });

  it("renders HeaderBar status pills across unified, partitioned, and bridging states", () => {
    const unifiedHtml = renderToStaticMarkup(
      <HeaderBar
        viewRole="observatory"
        onSelectViewRole={() => {}}
        isPlaying={true}
        onTogglePlay={() => {}}
        monitorMode="observatory-mix"
        onSelectMonitorMode={() => {}}
        transportMode="webrtc"
        onSelectTransportMode={() => {}}
        companionPeersEnabled={true}
        onToggleCompanionPeers={() => {}}
        modeState="unified"
        bridgeBarIndex={0}
        bridgeBars={4}
        signallingStatus="offline"
        bpm={120}
        keyRoot="C"
        musicalMode="major"
        chordSymbol="Cmaj7"
      />
    );
    expect(unifiedHtml).toContain("UNIFIED");
    expect(unifiedHtml).toContain("SIGNALLING: OFFLINE — P2P AUTONOMOUS");

    const bridgingHtml = renderToStaticMarkup(
      <HeaderBar
        viewRole="drums"
        onSelectViewRole={() => {}}
        isPlaying={true}
        onTogglePlay={() => {}}
        monitorMode="my-instrument"
        onSelectMonitorMode={() => {}}
        transportMode="broadcast"
        onSelectTransportMode={() => {}}
        companionPeersEnabled={false}
        onToggleCompanionPeers={() => {}}
        modeState="bridging"
        bridgeBarIndex={1}
        bridgeBars={4}
        signallingStatus="connected"
        bpm={118}
        keyRoot="D"
        musicalMode="dorian"
        chordSymbol="Am"
      />
    );
    expect(bridgingHtml).toContain("BRIDGING (Bar 2/4)");
    expect(bridgingHtml).toContain("SIGNALLING: CONNECTED");
  });

  it("renders MeshTopologyGraph, BeatPhaseRing, CircleOfFifthsRadar, MotifProvenancePanel, and DemoControlBar during 4-bar reconciliation bridge", () => {
    const nodes = makeSampleNodes("bridging");
    const plan: ReconcilePlan = {
      targetBpm: 118,
      targetKeyRoot: "D",
      targetMode: "dorian",
      pivotChord: "Am",
      bridgeStartEpochMs: 12_000,
      bridgeBars: 4,
      adoptedMotifs: [
        nodes.drums.activeMotif!,
        nodes.lead.activeMotif!,
      ],
    };

    const meshHtml = renderToStaticMarkup(
      <MeshTopologyGraph
        nodes={nodes}
        modeState="bridging"
        blockedEdges={[]}
        recentPulses={[]}
        reconcilePlan={plan}
        onToggleEdgeBlock={() => {}}
      />
    );
    expect(meshHtml).toContain("PIVOT CHORD BRIDGE");
    expect(meshHtml).toContain("Am → D dorian (118 BPM)");

    const phaseHtml = renderToStaticMarkup(
      <BeatPhaseRing
        nodes={nodes}
        modeState="bridging"
        phaseErrorMs={4.2}
        barNumber={7}
      />
    );
    expect(phaseHtml).toContain("4.2 ms");
    expect(phaseHtml).toContain("&lt;15ms LOCK");

    const circleHtml = renderToStaticMarkup(
      <CircleOfFifthsRadar
        nodes={nodes}
        modeState="bridging"
        reconcilePlan={plan}
        onSelectKeyAndMode={() => {}}
      />
    );
    expect(circleHtml).toContain("Pivot: Am → D dorian");

    const provenanceHtml = renderToStaticMarkup(
      <MotifProvenancePanel
        modeState="bridging"
        isolationMotifs={[nodes.drums.activeMotif!]}
        adoptedMotifs={plan.adoptedMotifs}
        activeMotif={nodes.lead.activeMotif}
        latestIntentPacket={buildIntentPacketFromTelemetry(nodes.drums)}
        aiEnabled={true}
        aiEndpointUrl="http://localhost:11434"
        onToggleAi={() => {}}
        onChangeAiEndpoint={() => {}}
      />
    );
    expect(provenanceHtml).toContain("ADOPTED IN BRIDGE");
    expect(provenanceHtml).toContain("ENABLED (1.5s Guard)");

    const controlsHtml = renderToStaticMarkup(
      <DemoControlBar
        energy={0.8}
        tension={0.5}
        onChangeEnergy={() => {}}
        onChangeTension={() => {}}
        onImproviseMotif={() => {}}
        onApplyPreset={() => {}}
        modeState="bridging"
        guidedDemoActive={true}
        guidedDemoStage={2}
        onToggleGuidedDemo={() => {}}
      />
    );
    expect(controlsHtml).toContain("Stop Guided 90s Auto-Demo");
    expect(controlsHtml).toContain("3. 4-Bar Creative Reconciliation Bridge");
  });
});
