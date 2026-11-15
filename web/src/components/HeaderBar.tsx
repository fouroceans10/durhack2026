import React from "react";
import {
  Headphones,
  Play,
  ShieldCheck,
  Sparkles,
  Square,
  Users,
  Wifi,
  WifiOff,
} from "lucide-react";
import type {
  NetworkMode,
  SignallingStatus,
  TransportMode,
} from "../../../shared/types";
import type { AudioMonitorMode } from "../engine/SynthRack";
import type { ViewRole } from "./observatoryTypes";

export interface HeaderBarProps {
  viewRole: ViewRole;
  onSelectViewRole: (role: ViewRole) => void;
  isPlaying: boolean;
  onTogglePlay: () => void;
  monitorMode: AudioMonitorMode;
  onSelectMonitorMode: (mode: AudioMonitorMode) => void;
  transportMode: TransportMode;
  onSelectTransportMode: (mode: TransportMode) => void;
  companionPeersEnabled: boolean;
  onToggleCompanionPeers: (enabled: boolean) => void;
  modeState: NetworkMode;
  bridgeBarIndex: number;
  bridgeBars: number;
  signallingStatus: SignallingStatus;
  bpm: number;
  keyRoot: string;
  musicalMode: string;
  chordSymbol: string;
}

const VIEW_ROLES: Array<{ id: ViewRole; label: string }> = [
  { id: "observatory", label: "Observatory" },
  { id: "drums", label: "Drums" },
  { id: "bass", label: "Bass" },
  { id: "piano", label: "Piano" },
  { id: "lead", label: "Lead" },
];

function PerformanceDial({
  running,
  tempo,
  count,
}: {
  running: boolean;
  tempo: number;
  count: number;
}) {
  return (
    <div
      className={`performance-dial ${running ? "is-playing" : ""}`}
      style={
        {
          "--revolution": `${240 / Math.max(40, tempo)}s`,
        } as React.CSSProperties
      }
      aria-hidden="true"
    >
      <svg viewBox="0 0 260 260">
        <circle className="dial-outer" cx="130" cy="130" r="116" />
        <circle className="dial-inner" cx="130" cy="130" r="86" />
        {Array.from({ length: 24 }, (_, i) => (
          <g key={i} transform={`rotate(${(i * 360) / 24} 130 130)`}>
            <line
              x1="130"
              y1="20"
              x2="130"
              y2={i % 2 ? "29" : "37"}
              className="dial-tick"
            />
            <circle cx="130" cy="57" r={i % 3 === 0 ? 3 : 1.5} className="dial-dot" />
          </g>
        ))}
        <g className="dial-hand">
          <path d="M130 130 L130 34" />
          <circle cx="130" cy="34" r="5" />
        </g>
        <text x="130" y="137" textAnchor="middle" className="dial-count">
          {String(count).padStart(2, "0")}
        </text>
        <text x="130" y="159" textAnchor="middle" className="dial-caption">
          INDEPENDENT VOICES
        </text>
      </svg>
      <span className="dial-note">a collective, never a conductor</span>
    </div>
  );
}

export const HeaderBar: React.FC<HeaderBarProps> = ({
  viewRole,
  onSelectViewRole,
  isPlaying,
  onTogglePlay,
  monitorMode,
  onSelectMonitorMode,
  transportMode,
  onSelectTransportMode,
  companionPeersEnabled,
  onToggleCompanionPeers,
  modeState,
  bridgeBarIndex,
  bridgeBars,
  signallingStatus,
  bpm,
  keyRoot,
  musicalMode,
  chordSymbol,
}) => {
  const renderNetworkModeBadge = () => {
    if (modeState === "unified") {
      return (
        <span
          data-testid="network-mode-badge"
          className="inline-flex items-center gap-1.5 border border-[var(--woodwinds)] bg-[#3d665815] px-2.5 py-1 font-mono text-[10px] tracking-wider text-[var(--woodwinds)]"
        >
          <span className="h-2 w-2 rounded-full bg-[var(--woodwinds)]" />
          UNIFIED
        </span>
      );
    }
    if (modeState === "partitioned") {
      return (
        <span
          data-testid="network-mode-badge"
          className="inline-flex items-center gap-1.5 border border-[var(--red)] bg-[#bc382418] px-2.5 py-1 font-mono text-[10px] tracking-wider text-[var(--red)]"
        >
          <span className="h-2 w-2 rounded-full bg-[var(--red)] animate-ping" />
          PARTITIONED
        </span>
      );
    }
    const barDisplay = Math.min(bridgeBars, bridgeBarIndex + 1);
    return (
      <span
        data-testid="network-mode-badge"
        className="inline-flex items-center gap-1.5 border border-[var(--brass)] bg-[#8060221c] px-2.5 py-1 font-mono text-[10px] tracking-wider text-[var(--brass)]"
      >
        <Sparkles className="h-3 w-3 text-[var(--brass)]" />
        BRIDGING (Bar {barDisplay}/{bridgeBars})
      </span>
    );
  };

  const renderSignallingBadge = () => {
    if (signallingStatus === "connected") {
      return (
        <span
          data-testid="signalling-status-badge"
          className="inline-flex items-center gap-1.5 border border-[var(--woodwinds)] bg-[var(--paper-light)] px-2.5 py-1 font-mono text-[10px] text-[var(--woodwinds)]"
        >
          <Wifi className="h-3 w-3 text-[var(--woodwinds)]" />
          SIGNALLING: CONNECTED
        </span>
      );
    }
    return (
      <span
        data-testid="signalling-status-badge"
        className="inline-flex items-center gap-1.5 border border-[var(--rule)] bg-[var(--paper-light)] px-2.5 py-1 font-mono text-[10px] text-[var(--muted)]"
        title="Signalling server is only used for initial SDP/ICE discovery. Connected peers continue playing autonomously."
      >
        <WifiOff className="h-3 w-3 text-[var(--red)]" />
        SIGNALLING: OFFLINE — P2P AUTONOMOUS
      </span>
    );
  };

  return (
    <header className="border-b border-[var(--ink)] bg-[var(--paper)]">
      <div className="mx-auto max-w-[1600px] px-4 sm:px-8">
        {/* Top Editorial Masthead */}
        <div className="min-h-[88px] py-4 flex flex-wrap items-center justify-between gap-4 border-b border-[var(--ink)]">
          <div className="flex items-center gap-4">
            <span
              className="font-display italic text-[38px] tracking-[-4px] leading-none select-none text-[var(--ink)]"
              aria-hidden="true"
            >
              s<span className="text-[var(--red)] px-0.5">/</span>wc
            </span>
            <div>
              <h1 className="text-sm font-semibold tracking-[1.7px] uppercase leading-tight text-[var(--ink)] m-0">
                Symphony Without a Conductor
              </h1>
              <p className="font-mono text-[9px] tracking-wider uppercase text-[var(--muted)] m-0 mt-0.5">
                Decentralized P2P Orchestra &amp; Partition Reconciliation Observatory
              </p>
            </div>
          </div>

          <span className="hidden xl:block font-mono text-[9px] leading-relaxed tracking-wider text-[var(--ink)]">
            AN EXPERIMENT IN COLLECTIVE SOUND
            <br />
            <b className="font-normal text-[var(--muted)]">
              DURHACK, 2026 — OPUS 004 · ZERO CONDUCTORS
            </b>
          </span>

          <div className="flex flex-wrap items-center gap-2">
            {renderNetworkModeBadge()}
            {renderSignallingBadge()}
          </div>
        </div>

        {/* Hero Overture & Performance Dial */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center py-8 border-b border-[var(--ink)]">
          <div className="lg:col-span-8 min-w-0">
            <p className="eyebrow flex items-center gap-2.5 text-[var(--ink)] mb-4">
              <span
                className="text-2xl text-[var(--red)] leading-none"
                aria-hidden="true"
              >
                ✳
              </span>
              AUTONOMOUS BY NATURE. MUSICAL BY CONSENSUS.
            </p>
            <div className="font-display text-5xl sm:text-6xl xl:text-7xl font-medium tracking-[-0.055em] leading-[1.06] mb-5 text-[var(--ink)]">
              <span className="block">Four autonomous peers.</span>
              <em className="block italic font-medium text-[var(--red)]">
                Zero conductors.
              </em>
            </div>
            <div className="flex flex-wrap items-center gap-5">
              <span
                className="font-display italic text-2xl sm:text-3xl pr-5 border-r border-[var(--rule)] text-[var(--ink)]"
                aria-hidden="true"
              >
                № 04
              </span>
              <p className="text-lg sm:text-xl text-[var(--muted)] m-0 max-w-xl leading-snug">
                A self-synchronizing peer-to-peer orchestra with a mind of its
                own. Sever the network links; subgroups diverge in tempo and key,
                then weave a 4-bar creative reconciliation bridge when healed.
              </p>
            </div>

            {/* Session Role, Transport & Companion Controls Bar */}
            <div className="mt-6 pt-5 border-t border-[var(--rule)] flex flex-wrap items-center gap-2.5">
              {/* Role Switcher */}
              <div
                className="inline-flex border border-[var(--ink)] bg-[var(--paper-light)]"
                role="group"
                aria-label="Role Switcher"
              >
                {VIEW_ROLES.map((item) => {
                  const active = viewRole === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onSelectViewRole(item.id)}
                      className={`px-3 py-1.5 text-sm font-medium border-r last:border-r-0 border-[var(--rule)] transition cursor-pointer ${
                        active
                          ? "bg-[var(--ink)] text-[var(--paper-light)]"
                          : "text-[var(--ink)] hover:bg-[#27251f0d]"
                      }`}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>

              {/* Audio Monitoring Mode Toggle */}
              <button
                type="button"
                onClick={() =>
                  onSelectMonitorMode(
                    monitorMode === "observatory-mix"
                      ? "my-instrument"
                      : "observatory-mix",
                  )
                }
                className="inline-flex items-center gap-1.5 border border-[var(--ink)] bg-[var(--paper-light)] hover:bg-[var(--ink)] hover:text-[var(--paper-light)] px-3 py-1.5 text-sm transition cursor-pointer"
                title="Switch between synthesizing all reachable peers vs only your assigned instrument"
              >
                <Headphones className="h-3.5 w-3.5 text-[var(--red)]" />
                {monitorMode === "observatory-mix"
                  ? "Observatory Mix (All Peers)"
                  : "My Instrument Only"}
              </button>

              {/* Transport Selector */}
              <button
                type="button"
                onClick={() =>
                  onSelectTransportMode(
                    transportMode === "broadcast" ? "webrtc" : "broadcast",
                  )
                }
                className="inline-flex items-center gap-1.5 border border-[var(--ink)] bg-[var(--paper-light)] hover:bg-[var(--ink)] hover:text-[var(--paper-light)] px-3 py-1.5 text-sm transition cursor-pointer"
                title="Switch P2P transport between WebRTC DataChannels and local BroadcastChannel"
              >
                <ShieldCheck className="h-3.5 w-3.5 text-[var(--woodwinds)]" />
                {transportMode === "webrtc"
                  ? "WebRTC Mesh"
                  : "BroadcastChannel"}
              </button>

              {/* Virtual Companion Peers Toggle */}
              <button
                type="button"
                data-testid="companion-peers-toggle"
                onClick={() => onToggleCompanionPeers(!companionPeersEnabled)}
                className={`inline-flex items-center gap-1.5 border px-3 py-1.5 text-sm transition cursor-pointer ${
                  companionPeersEnabled
                    ? "bg-[var(--ink)] border-[var(--ink)] text-[var(--paper-light)]"
                    : "bg-[var(--paper-light)] border-[var(--ink)] text-[var(--muted)]"
                }`}
                title="Virtual Companion Peers (Fill Missing Roles Locally)"
              >
                <Users className="h-3.5 w-3.5" />
                Auto-Spawn Companion Peers:{" "}
                {companionPeersEnabled ? "ON" : "OFF"}
              </button>
            </div>
          </div>

          {/* Right Column: Revolving Performance Dial & Primary Play Button */}
          <div className="lg:col-span-4 flex flex-col items-center">
            <PerformanceDial running={isPlaying} tempo={bpm} count={4} />
            <span className="font-mono text-[9px] tracking-wider flex items-center gap-2 my-2.5 text-[var(--ink)]">
              <i
                className={`inline-block w-2 h-2 rounded-full border border-[var(--ink)] ${
                  isPlaying
                    ? "bg-[var(--red)] border-[var(--red)] animate-pulse"
                    : ""
                }`}
              />
              {isPlaying
                ? "THE ORCHESTRA IS PLAYING"
                : "THE ORCHESTRA IS WAITING"}
            </span>
            <button
              type="button"
              data-testid="join-start-audio-btn"
              onClick={onTogglePlay}
              className="editorial-btn-primary w-full max-w-[260px] flex items-center justify-between px-4 py-3.5 text-lg"
            >
              <span className="inline-flex items-center gap-2">
                {isPlaying ? (
                  <>
                    <Square className="h-3.5 w-3.5 fill-current" />
                    Stop Audio Engine
                  </>
                ) : (
                  <>
                    <Play className="h-3.5 w-3.5 fill-current" />
                    Join Orchestra &amp; Start Audio
                  </>
                )}
              </span>
              <span aria-hidden="true">↗</span>
            </button>
            <span className="font-mono text-[8px] mt-2 text-[var(--muted)]">
              4 AUTONOMOUS ROLES · TONE.JS SYNTHESIS RACK
            </span>
          </div>
        </div>

        {/* 4-Column Editorial Metrics Bar */}
        <div className="grid grid-cols-2 lg:grid-cols-4 py-4">
          <div className="pr-5 border-r border-[var(--rule)]">
            <small className="font-mono block text-[9px] tracking-wider text-[var(--muted)]">
              ENSEMBLE TEMPO
            </small>
            <strong className="flex items-baseline gap-2 font-normal text-3xl mt-1.5 text-[var(--ink)] tabular-nums">
              {bpm.toFixed(1)} BPM
              <span className="font-mono text-[9px] text-[var(--muted)]">
                PLL CLOCK
              </span>
            </strong>
          </div>

          <div className="px-5 lg:border-r border-[var(--rule)]">
            <small className="font-mono block text-[9px] tracking-wider text-[var(--muted)]">
              TONAL CENTRE &amp; CHORD
            </small>
            <strong className="flex items-baseline gap-2 font-normal text-3xl mt-1.5 text-[var(--ink)]">
              <span>
                {keyRoot} {musicalMode}
              </span>
              <span className="font-mono text-xs text-[var(--red)]">
                | {chordSymbol}
              </span>
            </strong>
          </div>

          <div className="pr-5 pt-3 lg:pt-0 lg:px-5 border-r border-[var(--rule)]">
            <small className="font-mono block text-[9px] tracking-wider text-[var(--muted)]">
              AUTONOMOUS VOICES
            </small>
            <strong className="flex items-baseline gap-2 font-normal text-3xl mt-1.5 text-[var(--ink)]">
              04{" "}
              <span className="font-mono text-[9px] text-[var(--muted)]">
                Drums · Bass · Piano · Lead
              </span>
            </strong>
          </div>

          <div className="pl-5 pt-3 lg:pt-0">
            <small className="font-mono block text-[9px] tracking-wider text-[var(--muted)]">
              NETWORK STATE
            </small>
            <strong
              className={`flex items-baseline gap-2 font-normal text-3xl mt-1.5 ${
                modeState === "partitioned"
                  ? "text-[var(--red)]"
                  : modeState === "bridging"
                  ? "text-[var(--brass)]"
                  : "text-[var(--woodwinds)]"
              }`}
            >
              {modeState === "partitioned"
                ? "Partitioned"
                : modeState === "bridging"
                ? "Reconciling"
                : "Connected"}
              <span className="font-mono text-xs">●</span>
            </strong>
          </div>
        </div>
      </div>
    </header>
  );
};
