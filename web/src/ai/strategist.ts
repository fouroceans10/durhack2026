import type {
  InstrumentRole,
  MotifRecord,
  MusicalMode,
  NetworkMode,
} from "../../../shared/types";
import { normalizePitchClass } from "../math/circleOfFifths";

export const DEFAULT_MODEL = "qwen3:1.7b";
export const DEFAULT_REVIEW_INTERVAL_MS = 2000;
export const REVIEW_INTERVAL_CHOICES = [1000, 2000, 4000, 8000, 12000] as const;

export type BrainPhase =
  | "listening"
  | "queued"
  | "thinking"
  | "ready"
  | "playing"
  | "fallback";

export type MusicalApproach =
  | "echo"
  | "counterpoint"
  | "support"
  | "contrast"
  | "develop";

export type MusicalGesture =
  | "plain"
  | "arpeggio"
  | "mordent"
  | "trill"
  | "ostinato";

export interface BrainStatus {
  phase: BrainPhase;
  detail: string;
  heard: string[];
  decisions: number;
  approach: MusicalApproach;
  gesture: MusicalGesture;
  model: string;
}

export interface AIStrategistOptions {
  enabled?: boolean;
  endpointUrl?: string;
  model?: string;
  timeoutMs?: number;
  reviewIntervalMs?: number;
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
  reachableRoles?: InstrumentRole[];
  neighbourMotifDegrees?: number[];
}

export interface AIStrategySuggestion {
  source: "ai" | "deterministic-fallback";
  motif: MotifRecord;
  energyDelta: number;
  tensionDelta: number;
  rationale: string;
  approach?: MusicalApproach;
  gesture?: MusicalGesture;
}

export const STRATEGY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "respondTo",
    "approach",
    "gesture",
    "interval",
    "scaleDegrees",
    "rhythmSteps",
    "energyDelta",
    "tensionDelta",
    "rationale",
  ],
  properties: {
    respondTo: { type: "string" },
    approach: {
      type: "string",
      enum: ["echo", "counterpoint", "support", "contrast", "develop"],
    },
    gesture: {
      type: "string",
      enum: ["plain", "arpeggio", "mordent", "trill", "ostinato"],
    },
    interval: { type: "integer", minimum: -2, maximum: 2 },
    scaleDegrees: {
      type: "array",
      items: { type: "integer", minimum: -2, maximum: 9 },
      minItems: 4,
      maxItems: 8,
    },
    rhythmSteps: {
      type: "array",
      items: { type: "integer", minimum: 0, maximum: 15 },
      minItems: 4,
      maxItems: 8,
    },
    energyDelta: { type: "number", minimum: -0.25, maximum: 0.25 },
    tensionDelta: { type: "number", minimum: -0.25, maximum: 0.25 },
    rationale: { type: "string", maxLength: 140 },
  },
} as const;

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
 * Queries the local Ollama runtime via Vite proxy (`/api/local-llm/tags`)
 * and returns installed non-cloud models.
 */
export async function listLocalModels(
  signal?: AbortSignal,
  fetchImpl?: typeof fetch,
  baseUrl = "/api/local-llm",
): Promise<string[]> {
  const fetcher =
    fetchImpl ??
    (typeof fetch !== "undefined" ? fetch.bind(globalThis) : undefined);
  if (!fetcher) {
    throw new Error("Fetch API unavailable.");
  }
  const cleanBase = baseUrl.replace(/\/+$/, "");
  const tagsPath = cleanBase.endsWith("/api/local-llm")
    ? `${cleanBase}/tags`
    : `${cleanBase}/api/tags`;

  const response = await fetcher(tagsPath, {
    signal: signal ?? AbortSignal.timeout(5000),
  });
  if (!response.ok) {
    throw new Error("Local model server unavailable. Start Ollama.");
  }
  const data = (await response.json()) as {
    models?: Array<{
      name?: unknown;
      remote_host?: unknown;
      remote_model?: unknown;
    }>;
  };
  if (!Array.isArray(data.models)) {
    throw new Error("Unexpected local model response.");
  }
  return data.models
    .filter(
      (m) =>
        typeof m.name === "string" &&
        !/cloud/i.test(m.name) &&
        !m.remote_host &&
        !m.remote_model,
    )
    .map((m) => m.name as string);
}

/**
 * Deterministically transforms a source scale-degree contour using the LLM's chosen
 * contrapuntal approach (`echo`, `counterpoint`, `support`, `contrast`, `develop`).
 */
export function realizeApproachDegrees(
  sourceLine: readonly number[],
  ownLine: readonly number[],
  approach: MusicalApproach,
  intervalShift = 0,
): number[] {
  const line = sourceLine.length > 0 ? sourceLine : [0, 2, 4, 7, 5, 4, 2, 0];
  const own = ownLine.length > 0 ? ownLine : line;
  const wrap = (n: number) => ((n % 7) + 7) % 7;

  const realized = Array.from({ length: 8 }, (_, i) => {
    const note = line[i % line.length];
    let degree = note;
    switch (approach) {
      case "echo":
        degree = note;
        break;
      case "counterpoint":
        degree = 2 * line[0] - note + 2;
        break;
      case "support":
        degree = line[0] + [0, 2, 4, 2][i % 4];
        break;
      case "contrast":
        degree = line[line.length - 1 - (i % line.length)] + 3;
        break;
      case "develop":
        degree = i % 2 ? note : own[Math.floor(i / 2) % own.length];
        break;
    }
    return wrap(degree + intervalShift);
  });

  if (JSON.stringify(realized) === JSON.stringify(own)) {
    realized[realized.length - 1] = wrap(realized[realized.length - 1] + 1);
  }
  return realized;
}

/**
 * Pure deterministic motif generator used as the baseline and instant fallback
 * whenever the optional AI strategist is disabled or unreachable.
 */
export function generateDeterministicMotif(
  ctx: AIStrategyContext,
  sequenceIndex = 0,
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

function createInitialBrainStatus(model: string): BrainStatus {
  return {
    phase: "listening",
    detail: "Listening to nearby instruments before choosing the next phrase.",
    heard: ["drums", "bass", "piano", "lead"],
    decisions: 0,
    approach: "develop",
    gesture: "plain",
    model,
  };
}

/**
 * Non-blocking Local LLM Strategist (`AIStrategist`).
 *
 * - Supports local Ollama models (`qwen3:1.7b` default) via `/api/local-llm/chat`
 *   as well as direct `/api/generate` endpoints.
 * - Maintains per-instrument `BrainStatus` (`listening`, `queued`, `thinking`,
 *   `ready`, `playing`, `fallback`) and musical memory.
 * - Never blocks or throws in the audio engine; silently falls back to
 *   `generateDeterministicMotif` if disabled, offline, slow, or invalid.
 */
export class AIStrategist {
  private enabled: boolean;
  private endpointUrl: string;
  private model: string;
  private readonly timeoutMs: number;
  private reviewIntervalMs: number;
  private readonly fetchImpl?: typeof fetch;
  private sequenceCounter = 0;

  private statuses: Record<InstrumentRole, BrainStatus>;
  private statusListeners = new Set<
    (statuses: Record<InstrumentRole, BrainStatus>) => void
  >();

  constructor(options: AIStrategistOptions = {}) {
    this.enabled = options.enabled ?? false;
    this.endpointUrl = (options.endpointUrl ?? "/api/local-llm").replace(
      /\/+$/,
      "",
    );
    this.model = options.model ?? DEFAULT_MODEL;
    this.timeoutMs = options.timeoutMs ?? 2500;
    this.reviewIntervalMs =
      options.reviewIntervalMs ?? DEFAULT_REVIEW_INTERVAL_MS;
    this.fetchImpl = options.fetchImpl;

    this.statuses = {
      drums: createInitialBrainStatus(this.model),
      bass: createInitialBrainStatus(this.model),
      piano: createInitialBrainStatus(this.model),
      lead: createInitialBrainStatus(this.model),
    };
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    const roles: InstrumentRole[] = ["drums", "bass", "piano", "lead"];
    for (const role of roles) {
      this.statuses[role] = {
        ...this.statuses[role],
        phase: enabled ? "listening" : "listening",
        detail: enabled
          ? `Local LLM (${this.model}) active · listening to neighbours.`
          : "Deterministic music theory rules active.",
      };
    }
    this.emitStatuses();
  }

  public getModel(): string {
    return this.model;
  }

  public setModel(model: string): void {
    if (!model || /cloud/i.test(model)) {
      throw new Error("Choose an installed local model, not a cloud alias.");
    }
    this.model = model;
    const roles: InstrumentRole[] = ["drums", "bass", "piano", "lead"];
    for (const role of roles) {
      this.statuses[role] = {
        ...this.statuses[role],
        model,
        phase: "listening",
        detail: `Switched local model to ${model} · listening again.`,
      };
    }
    this.emitStatuses();
  }

  public getReviewIntervalMs(): number {
    return this.reviewIntervalMs;
  }

  public setReviewIntervalMs(ms: number): void {
    if (!Number.isFinite(ms) || ms < 250 || ms > 60_000) {
      return;
    }
    this.reviewIntervalMs = ms;
  }

  public getEndpointUrl(): string {
    return this.endpointUrl;
  }

  public setEndpointUrl(url: string): void {
    this.endpointUrl = url.replace(/\/+$/, "");
  }

  public getStatus(role: InstrumentRole): BrainStatus {
    return { ...this.statuses[role], heard: [...this.statuses[role].heard] };
  }

  public getAllStatuses(): Record<InstrumentRole, BrainStatus> {
    return {
      drums: this.getStatus("drums"),
      bass: this.getStatus("bass"),
      piano: this.getStatus("piano"),
      lead: this.getStatus("lead"),
    };
  }

  public onStatusChange(
    listener: (statuses: Record<InstrumentRole, BrainStatus>) => void,
  ): () => void {
    this.statusListeners.add(listener);
    listener(this.getAllStatuses());
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  private updateRoleStatus(
    role: InstrumentRole,
    patch: Partial<BrainStatus>,
  ): void {
    this.statuses[role] = {
      ...this.statuses[role],
      ...patch,
      model: this.model,
    };
    this.emitStatuses();
  }

  private emitStatuses(): void {
    const snap = this.getAllStatuses();
    for (const listener of this.statusListeners) {
      listener(snap);
    }
  }

  public buildFallbackSuggestion(
    ctx: AIStrategyContext,
  ): AIStrategySuggestion {
    const seq = ++this.sequenceCounter;
    const motif = generateDeterministicMotif(ctx, seq);
    const energyDelta = ctx.hasDrumsInGroup ? 0.08 : -0.05;
    const tensionDelta = ctx.modeState === "partitioned" ? 0.1 : -0.05;
    const approach: MusicalApproach = ctx.hasDrumsInGroup
      ? "support"
      : "counterpoint";
    const gesture: MusicalGesture =
      ctx.role === "piano"
        ? "arpeggio"
        : ctx.role === "lead"
        ? "mordent"
        : "ostinato";
    const rationale = ctx.hasDrumsInGroup
      ? "Deterministic syncopated fifths motif for rhythm-driven subgroup."
      : "Deterministic lyrical modal motif for harmonic subgroup.";

    return {
      source: "deterministic-fallback",
      motif,
      energyDelta,
      tensionDelta,
      rationale,
      approach,
      gesture,
    };
  }

  public async requestSuggestion(
    ctx: AIStrategyContext,
  ): Promise<AIStrategySuggestion> {
    const heard = (
      ctx.reachableRoles ?? ["drums", "bass", "piano", "lead"]
    ).filter((r) => r !== ctx.role);

    if (!this.enabled) {
      const fb = this.buildFallbackSuggestion(ctx);
      this.updateRoleStatus(ctx.role, {
        phase: "listening",
        detail: fb.rationale,
        heard,
        approach: fb.approach ?? "develop",
        gesture: fb.gesture ?? "plain",
      });
      return fb;
    }

    const fetcher =
      this.fetchImpl ??
      (typeof fetch !== "undefined" ? fetch.bind(globalThis) : undefined);

    if (!fetcher) {
      const fb = this.buildFallbackSuggestion(ctx);
      this.updateRoleStatus(ctx.role, {
        phase: "fallback",
        detail: "Fetch unavailable; continuing deterministic phrase.",
        heard,
      });
      return fb;
    }

    this.updateRoleStatus(ctx.role, {
      phase: "thinking",
      detail: `Composing a response locally with ${this.model}…`,
      heard,
    });

    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this.timeoutMs);

    try {
      const systemPrompt = [
        "You are one autonomous musician in a decentralized peer-to-peer orchestra without a conductor.",
        `You play ONLY ${ctx.role}. Choose a musical response to your reachable neighbours (${heard.join(", ") || "self"}).`,
        "Pick approach: echo repeats contour; counterpoint moves against it; support outlines harmony; contrast reverses it; develop mixes neighbour notes with your memory.",
        "Pick gesture: plain, arpeggio, mordent, trill, or ostinato.",
        `Return ONLY valid JSON matching ${JSON.stringify(STRATEGY_SCHEMA)}.`,
      ].join(" ");

      const userPayload = JSON.stringify({
        role: ctx.role,
        key: `${ctx.keyRoot} ${ctx.mode}`,
        bpm: ctx.bpm,
        modeState: ctx.modeState,
        barNumber: ctx.barNumber,
        energy: ctx.energy,
        tension: ctx.tension,
        neighbours: heard,
      });

      const isProxyChat = this.endpointUrl.endsWith("/api/local-llm");
      const targetUrl = isProxyChat
        ? `${this.endpointUrl}/chat`
        : `${this.endpointUrl}/api/generate`;

      const requestBody = isProxyChat
        ? {
            model: this.model,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPayload },
            ],
            stream: false,
            think: false,
            format: STRATEGY_SCHEMA,
            keep_alive: "10m",
            options: { temperature: 0.65, num_predict: 384, num_ctx: 2048 },
          }
        : {
            model: this.model,
            prompt: `${systemPrompt}\n${userPayload}`,
            stream: false,
            format: "json",
          };

      const response = await fetcher(targetUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      if (!response.ok) {
        const fb = this.buildFallbackSuggestion(ctx);
        this.updateRoleStatus(ctx.role, {
          phase: "fallback",
          detail:
            response.status === 404
              ? `Model ${this.model} not installed. Continuing deterministic phrase.`
              : `Local inference unavailable (${response.status}). Continuing current phrase.`,
          heard,
        });
        return fb;
      }

      const payload = (await response.json()) as {
        response?: string;
        message?: { content?: string };
      };
      const rawJson = payload?.message?.content ?? payload?.response;
      if (typeof rawJson !== "string") {
        const fb = this.buildFallbackSuggestion(ctx);
        this.updateRoleStatus(ctx.role, {
          phase: "fallback",
          detail: "Invalid local model response; continuing current phrase.",
          heard,
        });
        return fb;
      }

      const parsed = JSON.parse(rawJson) as {
        approach?: unknown;
        gesture?: unknown;
        interval?: unknown;
        scaleDegrees?: unknown;
        rhythmSteps?: unknown;
        energyDelta?: unknown;
        tensionDelta?: unknown;
        rationale?: unknown;
      };

      const validApproaches: MusicalApproach[] = [
        "echo",
        "counterpoint",
        "support",
        "contrast",
        "develop",
      ];
      const validGestures: MusicalGesture[] = [
        "plain",
        "arpeggio",
        "mordent",
        "trill",
        "ostinato",
      ];
      const approach: MusicalApproach = validApproaches.includes(
        parsed.approach as MusicalApproach,
      )
        ? (parsed.approach as MusicalApproach)
        : "develop";
      const gesture: MusicalGesture = validGestures.includes(
        parsed.gesture as MusicalGesture,
      )
        ? (parsed.gesture as MusicalGesture)
        : "plain";
      const intervalShift = Number.isFinite(Number(parsed.interval))
        ? Math.max(-2, Math.min(2, Math.trunc(Number(parsed.interval))))
        : 0;

      if (
        !Array.isArray(parsed.scaleDegrees) ||
        parsed.scaleDegrees.length === 0 ||
        !Array.isArray(parsed.rhythmSteps) ||
        parsed.rhythmSteps.length === 0
      ) {
        const fb = this.buildFallbackSuggestion(ctx);
        this.updateRoleStatus(ctx.role, {
          phase: "fallback",
          detail: "Model omitted notes; continuing current phrase.",
          heard,
        });
        return fb;
      }

      const rawDegrees = parsed.scaleDegrees
        .map((n) => Number(n))
        .filter((n) => Number.isFinite(n))
        .slice(0, 8);
      const rhythmSteps = parsed.rhythmSteps
        .map((n) => Math.max(0, Math.min(15, Math.trunc(Number(n)))))
        .filter((n) => Number.isFinite(n))
        .slice(0, 8);

      if (rawDegrees.length < 4 || rhythmSteps.length < 4) {
        const fb = this.buildFallbackSuggestion(ctx);
        this.updateRoleStatus(ctx.role, {
          phase: "fallback",
          detail: "Phrase too short; continuing current phrase.",
          heard,
        });
        return fb;
      }

      const scaleDegrees = ctx.neighbourMotifDegrees?.length
        ? realizeApproachDegrees(
            ctx.neighbourMotifDegrees,
            rawDegrees,
            approach,
            intervalShift,
          )
        : rawDegrees;

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
      const rationale =
        typeof parsed.rationale === "string" && parsed.rationale.trim()
          ? parsed.rationale.trim()
          : `Local ${this.model} (${approach} / ${gesture}) response.`;

      const prevDecisions = this.statuses[ctx.role]?.decisions ?? 0;
      this.updateRoleStatus(ctx.role, {
        phase: "playing",
        detail: rationale,
        heard,
        decisions: prevDecisions + 1,
        approach,
        gesture,
      });

      return {
        source: "ai",
        motif,
        energyDelta,
        tensionDelta,
        rationale,
        approach,
        gesture,
      };
    } catch {
      const fb = this.buildFallbackSuggestion(ctx);
      this.updateRoleStatus(ctx.role, {
        phase: "fallback",
        detail: `Local inference offline (${this.model}). Continuing deterministic phrase.`,
        heard,
        approach: fb.approach ?? "develop",
        gesture: fb.gesture ?? "plain",
      });
      return fb;
    } finally {
      clearTimeout(timer);
    }
  }
}
