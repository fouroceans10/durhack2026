import type {
  InstrumentRole,
  MotifRecord,
  MusicalMode,
  NetworkMode,
} from "../../../shared/types";
import { normalizePitchClass } from "../math/circleOfFifths";

export interface AIStrategistOptions {
  enabled?: boolean;
  endpointUrl?: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface AIStrategyContext {
  role: InstrumentRole;
  partitionGroupId: string;
  modeState: NetworkMode;
  bpm: number;
  keyRoot: string;
  mode: MusicalMode;
  energy: number;
  tension: number;
  barNumber: number;
  hasDrumsInGroup: boolean;
}

export interface AIStrategySuggestion {
  source: "ai" | "deterministic-fallback";
  motif: MotifRecord;
  energyDelta: number;
  tensionDelta: number;
  rationale: string;
}

const RHYTHMIC_DEGREE_PATTERNS: readonly (readonly number[])[] = [
  [0, 4, 5, 7, 4, 2, 0, 4],
  [0, 2, 4, 5, 7, 4, 2, 0],
  [0, 7, 4, 5, 2, 4, 0, -1],
] as const;

const RHYTHMIC_STEP_PATTERNS: readonly (readonly number[])[] = [
  [0, 3, 6, 8, 10, 12, 14, 15],
  [0, 2, 3, 6, 8, 11, 12, 14],
  [0, 3, 4, 7, 8, 10, 13, 15],
] as const;

const LYRICAL_DEGREE_PATTERNS: readonly (readonly number[])[] = [
  [0, 2, 4, 7, 5, 4, 2, 0],
  [4, 6, 7, 9, 7, 5, 4, 2],
  [2, 4, 5, 7, 6, 4, 2, 0],
] as const;

const LYRICAL_STEP_PATTERNS: readonly (readonly number[])[] = [
  [0, 2, 4, 6, 8, 10, 12, 14],
  [0, 2, 5, 7, 8, 11, 13, 14],
  [1, 3, 4, 6, 9, 11, 12, 15],
] as const;

/**
 * Pure deterministic motif generator used as the baseline and instant fallback
 * whenever the optional AI strategist is disabled or unreachable.
 */
export function generateDeterministicMotif(
  ctx: AIStrategyContext,
  sequenceIndex = 0
): MotifRecord {
  const safeIdx = Math.abs(Math.trunc(ctx.barNumber + sequenceIndex));
  const canonicalKey = normalizePitchClass(ctx.keyRoot);

  if (ctx.hasDrumsInGroup) {
    const degrees = [
      ...RHYTHMIC_DEGREE_PATTERNS[safeIdx % RHYTHMIC_DEGREE_PATTERNS.length],
    ];
    const steps = [
      ...RHYTHMIC_STEP_PATTERNS[safeIdx % RHYTHMIC_STEP_PATTERNS.length],
    ];
    return {
      id: `motif-${ctx.role}-rhythm-${ctx.partitionGroupId}-b${ctx.barNumber}-s${sequenceIndex}`,
      authorRole: ctx.role,
      createdDuringPartitionId: ctx.partitionGroupId,
      scaleDegrees: degrees,
      rhythmSteps: steps,
      keyRoot: canonicalKey,
      mode: ctx.mode,
      bpm: ctx.bpm,
    };
  }

  const degrees = [
    ...LYRICAL_DEGREE_PATTERNS[safeIdx % LYRICAL_DEGREE_PATTERNS.length],
  ];
  const steps = [
    ...LYRICAL_STEP_PATTERNS[safeIdx % LYRICAL_STEP_PATTERNS.length],
  ];
  return {
    id: `motif-${ctx.role}-lyrical-${ctx.partitionGroupId}-b${ctx.barNumber}-s${sequenceIndex}`,
    authorRole: ctx.role,
    createdDuringPartitionId: ctx.partitionGroupId,
    scaleDegrees: degrees,
    rhythmSteps: steps,
    keyRoot: canonicalKey,
    mode: ctx.mode,
    bpm: ctx.bpm,
  };
}

/**
 * Optional non-blocking AI strategist (`AIStrategist`).
 *
 * - Disabled by default (`enabled = false`), toggleable at runtime.
 * - Uses a strict `1500ms` `AbortController` timeout when querying a local
 *   Ollama endpoint (`http://localhost:11434`).
 * - Never blocks or throws in the audio engine; silently falls back to
 *   `generateDeterministicMotif` if disabled, offline, slow, or invalid.
 */
export class AIStrategist {
  private enabled: boolean;
  private endpointUrl: string;
  private model: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl?: typeof fetch;
  private sequenceCounter = 0;

  constructor(options: AIStrategistOptions = {}) {
    this.enabled = options.enabled ?? false;
    this.endpointUrl = (options.endpointUrl ?? "http://localhost:11434").replace(
      /\/+$/,
      ""
    );
    this.model = options.model ?? "llama3.2";
    this.timeoutMs = options.timeoutMs ?? 1500;
    this.fetchImpl = options.fetchImpl;
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  public getEndpointUrl(): string {
    return this.endpointUrl;
  }

  public setEndpointUrl(url: string): void {
    this.endpointUrl = url.replace(/\/+$/, "");
  }

  public buildFallbackSuggestion(
    ctx: AIStrategyContext
  ): AIStrategySuggestion {
    const seq = ++this.sequenceCounter;
    const motif = generateDeterministicMotif(ctx, seq);
    const energyDelta = ctx.hasDrumsInGroup ? 0.08 : -0.05;
    const tensionDelta = ctx.modeState === "partitioned" ? 0.1 : -0.05;
    return {
      source: "deterministic-fallback",
      motif,
      energyDelta,
      tensionDelta,
      rationale: ctx.hasDrumsInGroup
        ? "Deterministic syncopated fifths motif for rhythm-driven subgroup."
        : "Deterministic lyrical modal motif for harmonic subgroup.",
    };
  }

  public async requestSuggestion(
    ctx: AIStrategyContext
  ): Promise<AIStrategySuggestion> {
    if (!this.enabled) {
      return this.buildFallbackSuggestion(ctx);
    }

    const fetcher =
      this.fetchImpl ??
      (typeof fetch !== "undefined" ? fetch.bind(globalThis) : undefined);

    if (!fetcher) {
      return this.buildFallbackSuggestion(ctx);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this.timeoutMs);

    try {
      const prompt = [
        "Return ONLY valid JSON with fields: scaleDegrees (8 ints), rhythmSteps (8 ints in 0..15), energyDelta (-0.2..0.2), tensionDelta (-0.2..0.2), rationale (short string).",
        `Context: role=${ctx.role}, key=${ctx.keyRoot} ${ctx.mode}, bpm=${ctx.bpm}, modeState=${ctx.modeState}, hasDrums=${ctx.hasDrumsInGroup}.`,
      ].join("\n");

      const response = await fetcher(`${this.endpointUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          prompt,
          stream: false,
          format: "json",
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        return this.buildFallbackSuggestion(ctx);
      }

      const payload = (await response.json()) as { response?: string };
      const rawJson = payload?.response;
      if (typeof rawJson !== "string") {
        return this.buildFallbackSuggestion(ctx);
      }

      const parsed = JSON.parse(rawJson) as {
        scaleDegrees?: unknown;
        rhythmSteps?: unknown;
        energyDelta?: unknown;
        tensionDelta?: unknown;
        rationale?: unknown;
      };

      if (
        !Array.isArray(parsed.scaleDegrees) ||
        parsed.scaleDegrees.length === 0 ||
        !Array.isArray(parsed.rhythmSteps) ||
        parsed.rhythmSteps.length === 0
      ) {
        return this.buildFallbackSuggestion(ctx);
      }

      const scaleDegrees = parsed.scaleDegrees
        .map((n) => Number(n))
        .filter((n) => Number.isFinite(n))
        .slice(0, 8);
      const rhythmSteps = parsed.rhythmSteps
        .map((n) => Math.max(0, Math.min(15, Math.trunc(Number(n)))))
        .filter((n) => Number.isFinite(n))
        .slice(0, 8);

      if (scaleDegrees.length < 4 || rhythmSteps.length < 4) {
        return this.buildFallbackSuggestion(ctx);
      }

      const seq = ++this.sequenceCounter;
      const motif: MotifRecord = {
        id: `motif-${ctx.role}-ai-${ctx.partitionGroupId}-b${ctx.barNumber}-s${seq}`,
        authorRole: ctx.role,
        createdDuringPartitionId: ctx.partitionGroupId,
        scaleDegrees,
        rhythmSteps,
        keyRoot: normalizePitchClass(ctx.keyRoot),
        mode: ctx.mode,
        bpm: ctx.bpm,
      };

      const energyDelta = Number.isFinite(Number(parsed.energyDelta))
        ? Math.max(-0.25, Math.min(0.25, Number(parsed.energyDelta)))
        : 0;
      const tensionDelta = Number.isFinite(Number(parsed.tensionDelta))
        ? Math.max(-0.25, Math.min(0.25, Number(parsed.tensionDelta)))
        : 0;

      return {
        source: "ai",
        motif,
        energyDelta,
        tensionDelta,
        rationale:
          typeof parsed.rationale === "string"
            ? parsed.rationale
            : "AI-generated motif variation.",
      };
    } catch {
      return this.buildFallbackSuggestion(ctx);
    } finally {
      clearTimeout(timer);
    }
  }
}
