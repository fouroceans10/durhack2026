import React, { useEffect, useState } from "react";
import type { InstrumentRole } from "@shared/types";
import {
  DEFAULT_MODEL,
  REVIEW_INTERVAL_CHOICES,
  listLocalModels,
  type BrainStatus,
} from "../ai/strategist";

export interface LocalIntelligencePanelProps {
  aiEnabled: boolean;
  onToggleAi: (enabled: boolean) => void;
  model: string;
  onChangeModel: (model: string) => void;
  reviewIntervalMs: number;
  onChangeReviewIntervalMs: (ms: number) => void;
  brainStatuses: Record<InstrumentRole, BrainStatus>;
}

const ROLE_LABELS: Record<InstrumentRole, string> = {
  drums: "Drums",
  bass: "Bass",
  piano: "Piano",
  lead: "Lead",
};

export const LocalIntelligencePanel: React.FC<LocalIntelligencePanelProps> = ({
  aiEnabled,
  onToggleAi,
  model,
  onChangeModel,
  reviewIntervalMs,
  onChangeReviewIntervalMs,
  brainStatuses,
}) => {
  const [models, setModels] = useState<string[]>([]);
  const [modelStatus, setModelStatus] = useState<string>(
    "Checking the local model…",
  );
  const [checkingModel, setCheckingModel] = useState(false);

  async function checkModel() {
    setCheckingModel(true);
    try {
      const installed = await listLocalModels();
      setModels(installed);
      setModelStatus(
        installed.includes(model)
          ? `${model} is ready on this computer.`
          : `Install ${model} with npm run llm:pull, or choose an installed model.`,
      );
    } catch {
      setModels([]);
      setModelStatus(
        "Local model offline. Run npm run llm:serve; the orchestra can keep playing.",
      );
    } finally {
      setCheckingModel(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    setModelStatus("Checking the local model…");
    void listLocalModels(controller.signal)
      .then((installed) => {
        if (controller.signal.aborted) return;
        setModels(installed);
        setModelStatus(
          installed.includes(model)
            ? `${model} is ready on this computer.`
            : `Install ${model} with npm run llm:pull, or choose an installed model.`,
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setModelStatus(
            "Local model offline. Run npm run llm:serve; the orchestra can keep playing.",
          );
        }
      });
    return () => controller.abort();
  }, [model]);

  const modelChoices = [...new Set([DEFAULT_MODEL, model, ...models])];

  return (
    <section
      id="local-ai"
      className="grid grid-cols-1 lg:grid-cols-12 gap-8 py-8 border-t border-[var(--ink)]"
      aria-labelledby="local-ai-heading"
    >
      {/* Left Column: Editorial Heading */}
      <div className="lg:col-span-5">
        <span className="eyebrow text-[var(--red)]">
          03 — EACH VOICE THINKS FOR ITSELF
        </span>
        <h2
          id="local-ai-heading"
          className="font-display text-3xl sm:text-4xl font-medium tracking-tight leading-tight my-3 text-[var(--ink)]"
        >
          Local LLM composition.
          <br />
          <em className="italic font-medium text-[var(--red)]">
            Zero cloud latency.
          </em>
        </h2>
        <p className="text-[18px] leading-snug text-[var(--muted)] max-w-md">
          Each instrument considers its harmonic context, remembered motifs, and
          reachable neighbours across the P2P mesh. It experiments with
          contrapuntal approaches (echo, counterpoint, support, contrast,
          develop) and ornamental gestures on the next bar boundary.
        </p>

        <details className="mt-4 bg-[var(--paper-light)] border border-[var(--rule)] p-3.5">
          <summary className="cursor-pointer font-mono text-[10px] tracking-wider uppercase text-[var(--ink)]">
            First performance with a local Ollama model
          </summary>
          <p className="text-[16px] text-[var(--muted)] my-2">
            Install Ollama, then run these in separate terminals:
          </p>
          <code className="block font-mono text-[11px] leading-relaxed bg-[var(--paper)] border-l-2 border-[var(--red)] p-2.5 text-[var(--ink)]">
            npm run llm:serve
            <br />
            npm run llm:pull
          </code>
          <p className="font-mono text-[9px] text-[var(--muted)] mt-2 mb-0">
            One local model is shared for efficiency. All 4 instrument agents
            maintain independent prompts and musical memory. If Ollama is
            offline, deterministic music-theory rules continue seamlessly.
          </p>
        </details>
      </div>

      {/* Right Column: Controls & Per-Voice Mind Status */}
      <div className="lg:col-span-7 flex flex-col gap-5">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end bg-[var(--paper-light)] border border-[var(--rule)] p-4">
          <label className="flex items-center gap-2.5 cursor-pointer sm:col-span-3 pb-2 border-b border-[var(--rule)]">
            <input
              type="checkbox"
              checked={aiEnabled}
              onChange={(e) => onToggleAi(e.target.checked)}
              className="w-4 h-4 accent-[var(--red)]"
            />
            <span className="text-xl font-medium text-[var(--ink)]">
              Local LLM composition
            </span>
            <span className="ml-auto font-mono text-[10px] uppercase px-2 py-0.5 border border-[var(--rule)] text-[var(--muted)]">
              {aiEnabled
                ? `ACTIVE (${model})`
                : "OFF (DETERMINISTIC MUSIC THEORY)"}
            </span>
          </label>

          <label className="flex flex-col gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--muted)]">
            Re-evaluation interval
            <select
              aria-label="Re-evaluation interval"
              value={reviewIntervalMs}
              onChange={(e) =>
                onChangeReviewIntervalMs(Number(e.target.value))
              }
              className="border-0 border-b border-[var(--ink)] bg-[var(--paper)] text-[var(--ink)] font-body text-lg py-2 px-2"
            >
              {REVIEW_INTERVAL_CHOICES.map((ms) => (
                <option key={ms} value={ms}>
                  {ms / 1000} second{ms === 1000 ? "" : "s"}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--muted)]">
            Local model
            <select
              aria-label="Local model"
              value={model}
              onChange={(e) => onChangeModel(e.target.value)}
              className="border-0 border-b border-[var(--ink)] bg-[var(--paper)] text-[var(--ink)] font-body text-lg py-2 px-2"
            >
              {modelChoices.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            disabled={checkingModel}
            onClick={() => void checkModel()}
            className="editorial-btn w-full"
          >
            {checkingModel ? "Checking…" : "Check local model"}
          </button>

          <p
            className="sm:col-span-3 font-mono text-[10px] leading-relaxed text-[var(--muted)] m-0 pt-1"
            role="status"
          >
            {modelStatus}
          </p>
        </div>

        {/* 4 Autonomous Agent Minds */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {(["drums", "bass", "piano", "lead"] as const).map((role) => {
            const st = brainStatuses[role];
            const phaseLabel = !aiEnabled
              ? "Musical rules"
              : {
                  listening: "Listening",
                  queued: "Queued locally",
                  thinking: "Thinking locally",
                  ready: "Phrase ready",
                  playing: "Playing / local LLM",
                  fallback: "Inference unavailable · fallback",
                }[st?.phase ?? "listening"];

            return (
              <div
                key={role}
                className="bg-[var(--paper-light)] border border-[var(--rule)] p-3"
              >
                <div className="flex items-center justify-between mb-1">
                  <strong className="text-lg font-medium text-[var(--ink)]">
                    {ROLE_LABELS[role]}
                  </strong>
                  <span className="font-mono text-[9px] uppercase text-[var(--red)]">
                    {st?.approach ?? "develop"} · {st?.gesture ?? "plain"}
                  </span>
                </div>
                <details
                  className="agent-mind"
                  data-phase={aiEnabled ? st?.phase ?? "listening" : "listening"}
                  open
                >
                  <summary>
                    <span>{phaseLabel}</span>
                    <span>{st?.decisions ?? 0} phrases ↗</span>
                  </summary>
                  <p>{st?.detail}</p>
                  <p className="text-[var(--muted)]">
                    Hearing:{" "}
                    {st?.heard?.length
                      ? st.heard.join(", ")
                      : "own musical memory"}
                  </p>
                </details>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
