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
          "bg-[#80602218] border-[var(--brass)] text-[var(--brass)]",
      };
    }
    if (modeState === "unified" && isAdopted) {
      return {
        label: "WOVEN INTO UNIFIED GROOVE",
        className:
          "bg-[#3d665818] border-[var(--woodwinds)] text-[var(--woodwinds)]",
      };
    }
    if (
      modeState === "partitioned" ||
      isolationMotifs.some((m) => m.id === motif.id)
    ) {
      return {
        label: "INVENTED IN ISOLATION",
        className: "bg-[#bc382418] border-[var(--red)] text-[var(--red)]",
      };
    }
    return {
      label: "ACTIVE ENSEMBLE MOTIF",
      className: "bg-[var(--paper)] border-[var(--rule)] text-[var(--ink)]",
    };
  };

  return (
    <section
      data-testid="motif-provenance-panel"
      className="border border-[var(--ink)] bg-[var(--paper-light)] p-5 flex flex-col justify-between gap-3"
    >
      {/* Header & Optional AI Strategist Toggle */}
      <div className="flex flex-wrap items-baseline justify-between gap-2 pb-2.5 border-b border-[var(--rule)]">
        <div>
          <span className="eyebrow text-[var(--red)]">
            02 — MUSICAL MEMORY &amp; ISOLATION PROVENANCE
          </span>
          <h2 className="font-display text-2xl font-medium text-[var(--ink)] mt-1 mb-0 flex items-center gap-2">
            <Music2 className="h-4 w-4 text-[var(--red)]" />
            Motif Provenance &amp; Live Intent Telemetry
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-testid="toggle-ai-strategist-btn"
            onClick={() => onToggleAi(!aiEnabled)}
            className={`inline-flex items-center gap-1.5 border px-2.5 py-1 font-mono text-[10px] transition cursor-pointer ${
              aiEnabled
                ? "bg-[var(--red)] border-[var(--red)] text-[var(--paper-light)]"
                : "bg-[var(--paper)] border-[var(--ink)] text-[var(--ink)] hover:bg-[var(--ink)] hover:text-[var(--paper-light)]"
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
            className="inline-flex items-center gap-1 border border-[var(--ink)] bg-[var(--paper)] hover:bg-[var(--ink)] hover:text-[var(--paper-light)] px-2.5 py-1 font-mono text-[10px] text-[var(--ink)] transition cursor-pointer"
          >
            <Code2 className="h-3.5 w-3.5 text-[var(--red)]" />
            {showRawIntent ? "Show Motif Cards" : "Inspect IntentPacket JSON"}
          </button>
        </div>
      </div>

      {aiEnabled && (
        <div className="flex flex-wrap items-center justify-between gap-2 bg-[var(--paper)] border border-[var(--rule)] px-3 py-1.5 font-mono text-[10px]">
          <span className="text-[var(--ink)] flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-[var(--red)]" />
            Local Ollama Endpoint (Non-blocking AbortController fallback):
          </span>
          <input
            type="text"
            value={aiEndpointUrl}
            onChange={(e) => onChangeAiEndpoint(e.target.value)}
            className="bg-[var(--paper-light)] border border-[var(--ink)] px-2 py-0.5 text-[10px] font-mono text-[var(--ink)] w-56"
            aria-label="Ollama Endpoint URL"
          />
        </div>
      )}

      {showRawIntent ? (
        <pre
          data-testid="intent-packet-inspector"
          className="max-h-[210px] overflow-auto bg-[var(--paper)] border border-[var(--rule)] p-3 text-[11px] font-mono text-[var(--ink)]"
        >
          {JSON.stringify(latestIntentPacket, null, 2)}
        </pre>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[225px] overflow-y-auto pr-1">
          {displayMotifs.map((motif) => {
            const meta = ROLE_META[motif.authorRole];
            const badge = getProvenanceBadge(motif);
            const stepSet = new Set(motif.rhythmSteps);

            return (
              <div
                key={motif.id}
                data-testid="motif-provenance-card"
                className="bg-[var(--paper)] border border-[var(--rule)] p-3 flex flex-col justify-between gap-2"
              >
                <div className="flex items-center justify-between gap-1">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase ${meta.badgeBg} ${meta.badgeText}`}
                    >
                      {meta.label}
                    </span>
                    <span className="text-xs font-mono font-semibold text-[var(--ink)]">
                      {motif.keyRoot} {motif.mode} · {motif.bpm.toFixed(0)} BPM
                    </span>
                  </div>

                  <span
                    className={`border px-2 py-0.5 font-mono text-[9px] tracking-wide ${badge.className}`}
                  >
                    {badge.label}
                  </span>
                </div>

                {/* Mini 16-Step Staff Pitch-Contour Visualizer */}
                <div className="grid grid-cols-16 gap-0.5 items-end h-8 staff-lines-bg bg-[var(--paper-light)] px-1.5 py-1 border border-[var(--rule)]">
                  {Array.from({ length: 16 }).map((_, stepIdx) => {
                    const noteIdx = motif.rhythmSteps.indexOf(stepIdx);
                    const active = stepSet.has(stepIdx) && noteIdx >= 0;
                    const degree = active
                      ? motif.scaleDegrees[
                          noteIdx % motif.scaleDegrees.length
                        ] ?? 0
                      : 0;
                    const heightPct = active
                      ? Math.max(28, Math.min(100, 38 + degree * 8))
                      : 12;

                    return (
                      <div
                        key={stepIdx}
                        className="w-full transition-all"
                        style={{
                          height: `${heightPct}%`,
                          backgroundColor: active ? meta.colorHex : "#c7c0af",
                          opacity: active ? 0.95 : 0.35,
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

                <div className="flex items-center justify-between text-[9px] font-mono text-[var(--muted)]">
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
