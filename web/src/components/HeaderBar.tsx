import React from "react";
import {
  Activity,
  Headphones,
  Play,
  Radio,
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
          className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 border border-emerald-500/40 px-3 py-1 text-xs font-semibold tracking-wider text-emerald-300"
        >
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          UNIFIED
        </span>
      );
    }
    if (modeState === "partitioned") {
      return (
        <span
          data-testid="network-mode-badge"
          className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/15 border border-rose-500/40 px-3 py-1 text-xs font-semibold tracking-wider text-rose-300"
        >
          <span className="h-2 w-2 rounded-full bg-rose-400 animate-ping" />
          PARTITIONED
        </span>
      );
    }
    const barDisplay = Math.min(bridgeBars, bridgeBarIndex + 1);
    return (
      <span
        data-testid="network-mode-badge"
        className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/20 border border-amber-400/50 px-3 py-1 text-xs font-semibold tracking-wider text-amber-200 animate-pulse"
      >
        <Sparkles className="h-3.5 w-3.5 text-amber-300" />
        BRIDGING (Bar {barDisplay}/{bridgeBars})
      </span>
    );
  };

  const renderSignallingBadge = () => {
    if (signallingStatus === "connected") {
      return (
        <span
          data-testid="signalling-status-badge"
          className="inline-flex items-center gap-1.5 rounded-full bg-emerald-950/80 border border-emerald-500/30 px-3 py-1 text-xs font-medium text-emerald-300"
        >
          <Wifi className="h-3.5 w-3.5 text-emerald-400" />
          SIGNALLING: CONNECTED
        </span>
      );
    }
    return (
      <span
        data-testid="signalling-status-badge"
        className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 border border-amber-500/30 px-3 py-1 text-xs font-medium text-amber-300"
        title="Signalling server is only used for initial SDP/ICE discovery. Connected peers continue playing autonomously."
      >
        <WifiOff className="h-3.5 w-3.5 text-amber-400" />
        SIGNALLING: OFFLINE — P2P AUTONOMOUS
      </span>
    );
  };

  return (
    <header className="border-b border-slate-800/90 bg-slate-950/95 backdrop-blur px-4 py-3">
      <div className="mx-auto max-w-[1600px] flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        {/* Left: Brand Title & Live Musical Telemetry */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500/30 to-cyan-500/30 border border-indigo-400/30">
              <Radio className="h-5 w-5 text-cyan-300" />
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight text-slate-100">
                Symphony Without a Conductor
              </h1>
              <p className="text-[11px] text-slate-400">
                Decentralized P2P Orchestra &amp; Partition Reconciliation Observatory
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 ml-1">
            {renderNetworkModeBadge()}
            {renderSignallingBadge()}
            <div className="inline-flex items-center gap-2 rounded-full bg-slate-900/90 border border-slate-800 px-3 py-1 text-xs text-slate-300">
              <Activity className="h-3.5 w-3.5 text-cyan-400" />
              <span className="font-mono font-semibold text-white">
                {bpm.toFixed(1)} BPM
              </span>
              <span className="text-slate-600">|</span>
              <span className="font-semibold text-indigo-300">
                {keyRoot} {musicalMode}
              </span>
              <span className="text-slate-600">|</span>
              <span className="font-mono text-amber-300">{chordSymbol}</span>
            </div>
          </div>
        </div>

        {/* Right: Primary Audio CTA, Role Switcher, Monitor Mode, Transport & Companion Toggle */}
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            data-testid="join-start-audio-btn"
            onClick={onTogglePlay}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold tracking-wide transition shadow-lg cursor-pointer ${
              isPlaying
                ? "bg-rose-600 hover:bg-rose-500 text-white shadow-rose-950/50"
                : "bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-emerald-950/50"
            }`}
          >
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
          </button>

          {/* Role Switcher */}
          <div
            className="inline-flex rounded-lg bg-slate-900 p-0.5 border border-slate-800"
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
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition cursor-pointer ${
                    active
                      ? "bg-indigo-600 text-white shadow"
                      : "text-slate-400 hover:text-slate-200"
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
                  : "observatory-mix"
              )
            }
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition cursor-pointer"
            title="Switch between synthesizing all reachable peers vs only your assigned instrument"
          >
            <Headphones className="h-3.5 w-3.5 text-cyan-400" />
            {monitorMode === "observatory-mix"
              ? "Observatory Mix (All Peers)"
              : "My Instrument Only"}
          </button>

          {/* Transport Selector */}
          <button
            type="button"
            onClick={() =>
              onSelectTransportMode(
                transportMode === "broadcast" ? "webrtc" : "broadcast"
              )
            }
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition cursor-pointer"
            title="Switch P2P transport between WebRTC DataChannels and local BroadcastChannel"
          >
            <ShieldCheck className="h-3.5 w-3.5 text-indigo-400" />
            {transportMode === "webrtc" ? "WebRTC Mesh" : "BroadcastChannel"}
          </button>

          {/* Virtual Companion Peers Toggle */}
          <button
            type="button"
            data-testid="companion-peers-toggle"
            onClick={() => onToggleCompanionPeers(!companionPeersEnabled)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition cursor-pointer ${
              companionPeersEnabled
                ? "bg-cyan-500/15 border-cyan-500/40 text-cyan-200"
                : "bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200"
            }`}
            title="Virtual Companion Peers (Fill Missing Roles Locally)"
          >
            <Users className="h-3.5 w-3.5" />
            Auto-Spawn Companion Peers: {companionPeersEnabled ? "ON" : "OFF"}
          </button>
        </div>
      </div>
    </header>
  );
};
