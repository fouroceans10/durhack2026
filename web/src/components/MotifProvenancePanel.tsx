import React, { useState } from "react";
import { Bot, Code2, Music2, Sparkles } from "lucide-react";
import type {
  IntentPacket,
  MotifRecord,
  NetworkMode,
} from "../../../shared/types";
import { ROLE_META } from "./observatoryTypes";

export interface MotifProvenancePanelProps {
  modeState: NetworkMode;
  isolationMotifs: MotifRecord[];
  adoptedMotifs: MotifRecord[];
  activeMotif: MotifRecord | null;
  latestIntentPacket: IntentPacket;
  aiEnabled: boolean;
  aiEndpointUrl: string;
  onToggleAi: (enabled: boolean) => void;
  onChangeAiEndpoint: (url: string) => void;
}

export const MotifProvenancePanel: React.FC<MotifProvenancePanelProps> = ({
  modeState,
  isolationMotifs,
  adoptedMotifs,
  activeMotif,
  latestIntentPacket,
  aiEnabled,
  aiEndpointUrl,
  onToggleAi,
  onChangeAiEndpoint,
}) => {
  const [showRawIntent, setShowRawIntent] = useState(false);

  const adoptedIds = new Set(adoptedMotifs.map((m) => m.id));

  // Combine unique motifs for provenance display
  const motifMap = new Map<string, MotifRecord>();
  for (const m of adoptedMotifs) {
    motifMap.set(m.id, m);
  }
  for (const m of isolationMotifs) {
    if (!motifMap.has(m.id)) {
      motifMap.set(m.id, m);
    }
  }
  if (activeMotif && !motifMap.has(activeMotif.id)) {
    motifMap.set(activeMotif.id, activeMotif);
  }

  const displayMotifs = Array.from(motifMap.values()).slice(0, 6);

  const getProvenanceBadge = (motif: MotifRecord) => {
    const isAdopted = adoptedIds.has(motif.id);
    if (modeState === "bridging" && isAdopted) {
      return {
        label: "ADOPTED IN BRIDGE",
        className:
          "bg-amber-500/20 border-amber-400/50 text-amber-200",
      };
    }
    if (modeState === "unified" && isAdopted) {
      return {
        label: "WOVEN INTO UNIFIED GROOVE",
        className:
          "bg-emerald-500/20 border-emerald-400/50 text-emerald-200",
      };
    }
    if (
      modeState === "partitioned" ||
      isolationMotifs.some((m) => m.id === motif.id)
    ) {
      return {
        label: "INVENTED IN ISOLATION",
        className: "bg-rose-500/20 border-rose-400/50 text-rose-200",
      };
    }
    return {
      label: "ACTIVE ENSEMBLE MOTIF",
      className: "bg-indigo-500/20 border-indigo-400/40 text-indigo-200",
    };
  };

  return (
    <section
      data-testid="motif-provenance-panel"
      className="rounded-xl border border-slate-800/90 bg-slate-900/60 p-4 flex flex-col justify-between gap-3"
    >
      {/* Header & Optional AI Strategist Toggle */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Music2 className="h-4 w-4 text-amber-400" />
          <h2 className="text-sm font-semibold text-slate-100">
            Motif Provenance &amp; Live Intent Telemetry
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="toggle-ai-strategist-btn"
            onClick={() => onToggleAi(!aiEnabled)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition cursor-pointer ${
              aiEnabled
                ? "bg-purple-500/20 border-purple-400/50 text-purple-200"
                : "bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-200"
            }`}
            title="Optional non-blocking Ollama AI Strategist (1500ms timeout, instant deterministic fallback)"
          >
            <Bot className="h-3.5 w-3.5" />
            AI Strategist:{" "}
            {aiEnabled ? "ENABLED (1.5s Guard)" : "OFF (Deterministic Theory)"}
          </button>

          <button
            type="button"
            onClick={() => setShowRawIntent(!showRawIntent)}
            className="inline-flex items-center gap-1 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 px-2.5 py-1 text-xs font-medium text-slate-300 transition cursor-pointer"
          >
            <Code2 className="h-3.5 w-3.5 text-cyan-400" />
            {showRawIntent ? "Show Motif Cards" : "Inspect IntentPacket JSON"}
          </button>
        </div>
      </div>

      {aiEnabled && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-purple-950/30 border border-purple-500/30 px-3 py-1.5 text-xs">
          <span className="text-purple-200 flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-purple-400" />
            Local Ollama Endpoint (Non-blocking 1500ms AbortController fallback):
          </span>
          <input
            type="text"
            value={aiEndpointUrl}
            onChange={(e) => onChangeAiEndpoint(e.target.value)}
            className="rounded bg-slate-950 border border-slate-700 px-2 py-0.5 text-xs font-mono text-slate-200 w-56"
            aria-label="Ollama Endpoint URL"
          />
        </div>
      )}

      {showRawIntent ? (
        <pre
          data-testid="intent-packet-inspector"
          className="max-h-[210px] overflow-auto rounded-lg bg-slate-950 border border-slate-800 p-3 text-[11px] font-mono text-cyan-300"
        >
          {JSON.stringify(latestIntentPacket, null, 2)}
        </pre>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 max-h-[220px] overflow-y-auto pr-1">
          {displayMotifs.map((motif) => {
            const meta = ROLE_META[motif.authorRole];
            const badge = getProvenanceBadge(motif);
            const stepSet = new Set(motif.rhythmSteps);

            return (
              <div
                key={motif.id}
                data-testid="motif-provenance-card"
                className={`rounded-lg bg-slate-950/90 border ${meta.borderClass} p-2.5 flex flex-col justify-between gap-2`}
              >
                <div className="flex items-center justify-between gap-1">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${meta.badgeBg} ${meta.badgeText}`}
                    >
                      {meta.label}
                    </span>
                    <span className="text-xs font-mono font-semibold text-slate-200">
                      {motif.keyRoot} {motif.mode} · {motif.bpm.toFixed(0)} BPM
                    </span>
                  </div>

                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide ${badge.className}`}
                  >
                    {badge.label}
                  </span>
                </div>

                {/* Mini 16-Step Pitch-Contour Visualizer */}
                <div className="grid grid-cols-16 gap-0.5 items-end h-8 bg-slate-900/90 rounded px-1.5 py-1 border border-slate-800/80">
                  {Array.from({ length: 16 }).map((_, stepIdx) => {
                    const noteIdx = motif.rhythmSteps.indexOf(stepIdx);
                    const active = stepSet.has(stepIdx) && noteIdx >= 0;
                    const degree = active
                      ? motif.scaleDegrees[
                          noteIdx % motif.scaleDegrees.length
                        ] ?? 0
                      : 0;
                    const heightPct = active
                      ? Math.max(25, Math.min(100, 35 + degree * 8))
                      : 12;

                    return (
                      <div
                        key={stepIdx}
                        className="w-full rounded-xs transition-all"
                        style={{
                          height: `${heightPct}%`,
                          backgroundColor: active ? meta.colorHex : "#1e293b",
                          opacity: active ? 0.95 : 0.4,
                        }}
                        title={
                          active
                            ? `Step ${stepIdx}: scale degree ${degree}`
                            : `Step ${stepIdx}: rest`
                        }
                      />
                    );
                  })}
                </div>

                <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                  <span>Degrees: [{motif.scaleDegrees.join(", ")}]</span>
                  <span>
                    Origin: {motif.createdDuringPartitionId.slice(0, 18)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
