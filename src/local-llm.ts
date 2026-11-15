import { allowedKeyChanges, applyDecision, decisionKey, isOpening, isFormEntrance, musicianPhrasing, type Musician } from './engine';
import { normalizeRhythm, phrasingIdeas } from './phrasing';
import { currentKey, homeKey, keyName, degreeName, modes, nearestDegree } from './tonality';
import { formIds, formNames, formPosition, gestures, themeActions } from './forms';
import { strategySchema, validStrategy, validDecision, type MelodyDecision, type MusicalStrategy } from './melody';
import { orchestra, isPitched } from './orchestra';

export const DEFAULT_MODEL = 'qwen3:1.7b';
export const DEFAULT_BRAIN_OPTIONS = { concurrency: 4, intervalMs: 2000, timeoutMs: 20000 };
export const MAX_CONTEXT_STEPS = 64;
const API = '/api/local-llm';
export type ListeningContext = { self: Musician; neighbours: Musician[]; memory: MelodyDecision[] };
export type BrainStatus = { phase: 'listening' | 'queued' | 'thinking' | 'ready' | 'playing' | 'fallback'; detail: string; heard: string[]; decisions: number };
export type Decide = (context: ListeningContext, signal: AbortSignal) => Promise<MelodyDecision>;
export class LocalRuntimeError extends Error {}

// The same seating is used for synthesis and listening. No partition-crossing state
// is passed here: callers supply only observations available to this musician.
export function selectNeighbours(self: Musician, reachable: Musician[]): Musician[] {
  const profile = orchestra[self.instrument];
  const distance = (p: Musician) => Math.abs(orchestra[p.instrument].pan - profile.pan)
    + (orchestra[p.instrument].section === profile.section ? 0 : 1.5);
  return reachable.filter(p => p.id !== self.id && p.audible && p.recentNotes.some(n => n.step >= p.beat - 32))
    .sort((a, b) => distance(a) - distance(b) || a.id.localeCompare(b.id)).slice(0, 6);
}

function describe(m: Musician, self = false) {
  const profile = orchestra[m.instrument];
  const notes = m.recentNotes.filter(n => n.step >= m.beat - 32).slice(-4);
  return {
    instrument: profile.name,
    ...(self ? { role: profile.role, register: profile.base, tempo: Math.round(m.tempo), motif: m.motif, ...musicianPhrasing(m) } : {}),
    energy: Number(m.energy.toFixed(2)), pitched: isPitched(m.instrument),
    key: isPitched(m.instrument) ? keyName(currentKey(m)) : 'unpitched',
    section: m.form ? { form: m.form.selected ?? 'choosing', movement: formPosition(m.form, m.beat).movementName, section: formPosition(m.form, m.beat).label, gesture: m.decision?.gesture ?? m.form.gesture } : undefined,
    // Compact event tuples keep CPU inference practical across a whole orchestra.
    played: notes.map(n => [n.step % 16, isPitched(m.instrument) ? n.midi : null, isPitched(m.instrument) ? nearestDegree(n.midi, currentKey(m)) : null, Number(n.duration.toFixed(2)), Number(n.velocity.toFixed(2)), Number((n.offset ?? 0).toFixed(3)), n.noteValue ?? null, n.articulation ?? 'normal']),
  };
}
export function buildMessages(context: ListeningContext) {
  const position = formPosition(context.self.form, context.self.beat);
  const form = context.self.form;
  const key = currentKey(context.self);
  const harmony = { current: keyName(key), home: keyName(homeKey(context.self)), modulation: context.self.harmony?.modulation ?? 'fixed',
    notes: modes[key.mode].map((_, i) => degreeName(i, key)),
    destinations: Object.fromEntries(allowedKeyChanges(context.self).map(change => [change, keyName(decisionKey(context.self, change))])) };
  const structure = form ? {
    choice: formNames[form.choice], selected: form.selected ?? 'choose once now',
    movement: position.movementName, section: position.label, bar: position.bar, bars: position.bars,
    returning: position.returning, cadence: position.cadence, intention: position.intention,
    suggestedEnergy: position.energy, suggestedGesture: form.expression && form.expression !== 'auto' ? form.expression : ['legato', 'staccato'].includes(position.gesture) ? 'plain' : position.gesture,
    suggestedArticulation: ['legato', 'staccato'].includes(position.gesture) ? position.gesture : 'mixed',
    rememberedTheme: form.themes[position.themeKey] ?? form.home,
  } : undefined;
  return [
    { role: 'system', content: `You are one autonomous musician. You play ONLY self.instrument, following self.role. Choose a musical response to nearby players, never control them. Played events are [sixteenth step, MIDI note, scale degree, sounding duration seconds, velocity, onset offset seconds, written note value, articulation]; null pitch means unpitched percussion. For ornaments the written value belongs to the parent figure; duration/offset describe each sounded sub-note.
Pick respondTo from the actual neighbour names ("self" if alone). Choose approach: echo repeats their contour; counterpoint moves against it; support outlines their harmony; contrast reverses it; develop mixes their notes with your memory. interval shifts the result by -2..2 diatonic steps. The deterministic sound engine realizes these choices using that musician's ACTUAL recent notes, in your register.
Consider structure over multiple sections. Choose form once if not selected: aba returns A after contrasting B; abb repeats B; pop has intro, verse, chorus, verse, chorus, bridge, final chorus, outro; classical has Allegro exposition/development/reprise, Adagio ABA, Scherzo ABA, rondo ABACA finale; free develops without sections. Keep the selected form thereafter. Each agent advances on its own clock.
Choose themeAction: recall reuses the remembered section theme and rhythm exactly (use on returns); contrast creates a different contour; develop responds to nearby notes. In the last bar, aim for resolution. Consider neighbours' sections but follow your own form.
Choose gesture for your instrument and movement: plain; arpeggio (broken triad); mordent (main/lower neighbour/main); trill (quick upper-neighbour alternation); ostinato (repeat a short cell). Choose legato/staccato separately in each note's articulations array. Only a manual gesture focus may require a uniform legato/staccato gesture. Use legato articulation and space for Adagio, light ornaments for Scherzo, hooks for choruses, contrast for bridges. Unpitched percussion keeps rhythmic onsets without pitched ornaments.
Respect harmony: degrees 0..6 refer to the CURRENT key/mode, never assume C major. Played MIDI pitches are absolute; their degree is approximated in that player's displayed key. Listen across different keys using actual pitches. Choose keyChange only from harmony.destinations. 'stay' keeps the current key; other destinations are relative to the HOME key. Modulation happens at a bar boundary, at most once per section (four bars in free development); returning themes preserve their key. Avoid unnecessary modulation when neighbours already agree. Cadences resolve to the current tonic.
Choose rhythm: 1..16 ascending unique onsets, integers 0..15, in a 16-step bar. Choose durations and articulations with EXACTLY one entry per onset, in the same order. Durations are WRITTEN lengths in sixteenth steps: 1=semiquaver, 2=quaver, 3=dotted quaver, 4=crotchet, 6=dotted crotchet, 8=minim, 12=dotted minim, 16=semibreve. Fit each duration before the next onset and the bar end. A shorter value leaves a rest. Examples: rhythm [0,1,3,6,10], durations [1,2,3,4,6]; or rhythm [0,8], durations [8,8].
Experiment with coherent rhythmic cells: mix short runs with held notes and breathing spaces; vary your previous durations rather than endlessly repeating one size. Answer a busy neighbour with space, or animate a sustained line with quavers/semiquavers. Slower movements favour longer values; scherzos favour short gestures. Choose per-note articulation: normal, legato (connected), staccato (detached), tenuto (full value), accent (strong attack). Shape groups of connected notes with detached endings; do not randomly switch every note. Articulation is independent of written length and ornaments, so an arpeggio can be staccato or legato. A legato/staccato gesture focus overrides every note's articulation. Recall restores the remembered theme's rhythm and note values. energy: 0.2..0.9. Give ONE short reason under 100 characters naming your partner and rhythmic/phrasing intention. Return ONLY JSON matching ${JSON.stringify(strategySchema)}` },
    { role: 'user', content: JSON.stringify({ self: describe(context.self, true), harmony, structure, neighbours: context.neighbours.map(m => describe(m)), previousDecisions: context.memory.slice(-2).map(d => ({ motif: d.motif, rhythm: d.rhythm, durations: d.durations, articulations: d.articulations, respondTo: d.respondTo, approach: d.approach, gesture: d.gesture, themeAction: d.themeAction, key: d.tonality ? keyName(d.tonality) : undefined })),
      phraseExperiment: position.returning ? 'Recall the theme with its remembered note values, or develop it gently.' : {
        invitation: 'Choose a new rhythmic idea below, combine them or invent a variation that responds to your neighbours. Avoid repeating your current rhythm. Use gesture plain or an ornament for mixed articulation; gesture legato/staccato makes the whole phrase uniform.',
        ideas: phrasingIdeas(context.self.instrument, context.self.beat, [context.self.rhythm, ...context.memory.slice(-2).map(d => d.rhythm)]),
      } }) },
  ];
}

export async function listLocalModels(signal?: AbortSignal): Promise<string[]> {
  const response = await fetch(`${API}/tags`, { signal: signal ?? AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('Local model server unavailable. Start Ollama.');
  const data = await response.json();
  if (!Array.isArray(data.models)) throw new Error('Unexpected local model response.');
  // Cloud model aliases are excluded; the bundled launcher also disables cloud access.
  return data.models.filter((m: { name?: unknown; remote_host?: unknown; remote_model?: unknown }) => typeof m.name === 'string' && !/cloud/i.test(m.name) && !m.remote_host && !m.remote_model).map((m: { name: string }) => m.name);
}

export function responseSchema(context: ListeningContext) {
  return { ...strategySchema, properties: { ...strategySchema.properties,
    form: { type: 'string', enum: context.self.form?.selected ? [context.self.form.selected] : context.self.form?.choice === 'auto' ? formIds.filter(id => id !== 'free') : ['free'] },
    gesture: { type: 'string', enum: context.self.form?.expression && context.self.form.expression !== 'auto' ? [context.self.form.expression] : gestures.filter(g => g !== 'legato' && g !== 'staccato') },
    themeAction: { type: 'string', enum: context.self.form && formPosition(context.self.form, context.self.beat).returning ? ['recall', 'develop'] : themeActions },
    keyChange: { type: 'string', enum: allowedKeyChanges(context.self) },
    respondTo: { type: 'string', enum: context.neighbours.length ? context.neighbours.map(p => orchestra[p.instrument].name) : ['self'] },
  } };
}

// The LLM chooses the musical relationship. This deterministic realization grounds
// every phrase in the selected partner's played notes rather than invented pitches.
export function realizeStrategy(context: ListeningContext, strategy: MusicalStrategy): MelodyDecision {
  if (!validStrategy(strategy)) throw new Error('Local model strategy failed musical validation.');
  if (!allowedKeyChanges(context.self).includes(strategy.keyChange ?? 'stay')) throw new Error('Modulation is not available in this phrase.');
  const tonality = { ...decisionKey(context.self, strategy.keyChange) };
  const partner = context.neighbours.find(p => orchestra[p.instrument].name === strategy.respondTo);
  if ((!partner && context.neighbours.length) || (!context.neighbours.length && strategy.respondTo !== 'self')) {
    throw new Error('Model referenced a musician it cannot hear.');
  }
  const source = partner ?? context.self;
  const heard = isPitched(source.instrument)
    ? source.recentNotes.filter(n => n.step >= source.beat - 32).slice(-8).map(n => nearestDegree(n.midi, tonality))
    : [];
  // Unpitched partners contribute rhythm/dynamics; develop remembered pitches.
  const line = heard.length ? heard : context.self.motif;
  const own = context.self.motif;
  const position = formPosition(context.self.form, context.self.beat);
  const theme = context.self.form?.themes[position.themeKey] ?? context.self.form?.home;
  if (strategy.themeAction === 'recall' && theme) {
    const motif = [...theme.motif];
    return { ...strategy, tonality, motif, ...normalizeRhythm(theme, strategy.gesture) };
  }
  const wrap = (n: number) => (n % 7 + 7) % 7;
  const motif = Array.from({ length: 8 }, (_, i) => {
    const note = line[i % line.length];
    let degree: number;
    switch (strategy.approach) {
      case 'echo': degree = note; break;
      case 'counterpoint': degree = 2 * line[0] - note + 2; break;
      case 'support': degree = line[0] + [0, 2, 4, 2][i % 4]; break;
      case 'contrast': degree = line[(line.length - 1 - i % line.length)] + 3; break;
      case 'develop': degree = i % 2 ? note : own[(i / 2) % own.length]; break;
    }
    return wrap(degree + strategy.interval + (strategy.themeAction === 'contrast' ? 2 : 0));
  });
  // If an echo exactly repeats the current phrase, give its final note a turn.
  if (JSON.stringify(motif) === JSON.stringify(own)) motif[motif.length - 1] = wrap(motif[motif.length - 1] + 1);
  if (context.self.form && position.cadence) motif[motif.length - 1] = 0;
  return { ...strategy, tonality, ...normalizeRhythm(strategy, strategy.gesture), motif };
}

export function ollamaDecider(model: string): Decide {
  return async (context, signal) => {
    if (!model || /cloud/i.test(model)) throw new Error('Choose an installed local model.');
    const response = await fetch(`${API}/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
      body: JSON.stringify({ model, messages: buildMessages(context), stream: false, think: false,
        format: responseSchema(context), keep_alive: '10m', options: { temperature: .65, num_predict: 512, num_ctx: 4096 } }),
    }).catch(error => { throw new LocalRuntimeError(error instanceof Error ? error.message : 'Local inference is unavailable.'); });
    if (!response.ok) throw new LocalRuntimeError(response.status === 404 ? `Model ${model} is not installed.` : `Local inference failed (${response.status}).`);
    const result = await response.json();
    const text = result?.message?.content;
    if (typeof text !== 'string' || text.length > 8192) throw new Error('Local model returned an invalid phrase.');
    const strategy: unknown = JSON.parse(text);
    if (!validStrategy(strategy)) throw new Error('Local model strategy failed musical validation.');
    if (!strategy.form || !strategy.gesture || !strategy.themeAction) throw new Error('Local model omitted form or phrasing choices.');
    if (!responseSchema(context).properties.form.enum.includes(strategy.form)) throw new Error('Local model changed the selected form.');
    if (!responseSchema(context).properties.gesture.enum.includes(strategy.gesture)) throw new Error('Local model ignored the gesture focus.');
    if (!responseSchema(context).properties.themeAction.enum.includes(strategy.themeAction)) throw new Error('Local model replaced a returning theme with a contrast.');
    if (!strategy.keyChange || !allowedKeyChanges(context.self).includes(strategy.keyChange)) throw new Error('Local model returned an unavailable key change.');
    if (!strategy.durations || !strategy.articulations) throw new Error('Local model omitted note lengths or articulation.');
    return realizeStrategy(context, strategy);
  };
}

type Memory = {
  history: MelodyDecision[]; status: BrainStatus; nextAt: number; failures: number;
  lastAppliedAt?: number; lastStartedAt?: number;
  formToken?: string;
  pending?: { decision: MelodyDecision; fromBeat: number; heardIds: string[]; formToken: string };
};

// An independent memory/state machine per instrument. This queue only shares local
// inference capacity; it cannot combine agents into a single composition request.
export class LocalBrains {
  private memories = new Map<string, Memory>();
  private queued: string[] = [];
  private inFlight = new Map<string, AbortController>();
  private generation = 0;
  private disposed = false;
  private retryAt = 0;
  constructor(
    private decide: Decide,
    private observe: (id: string) => { self: Musician; reachable: Musician[] } | undefined,
    private changed: (id: string, status: BrainStatus) => void,
    private options = { ...DEFAULT_BRAIN_OPTIONS },
  ) { this.options = { ...options }; }
  setIntervalMs(intervalMs: number) {
    if (!Number.isFinite(intervalMs) || intervalMs < 0 || intervalMs > 60000) throw new RangeError('Invalid re-evaluation interval.');
    this.options.intervalMs = intervalMs;
    for (const memory of this.memories.values()) {
      // Changing cadence must preserve both musical memory and failure backoff.
      if (memory.lastAppliedAt !== undefined && memory.failures === 0) memory.nextAt = memory.lastAppliedAt + intervalMs;
    }
  }
  private memory(id: string): Memory {
    let memory = this.memories.get(id);
    if (!memory) {
      memory = { history: [], nextAt: 0, failures: 0, status: { phase: 'listening', detail: 'Listening to nearby instruments.', heard: [], decisions: 0 } };
      this.memories.set(id, memory);
    }
    return memory;
  }
  private status(id: string, change: Partial<BrainStatus>) {
    const memory = this.memory(id);
    memory.status = { ...memory.status, ...change };
    this.changed(id, { ...memory.status, heard: [...memory.status.heard] });
  }
  tick(ids: string[], now = Date.now()) {
    if (this.disposed) return;
    for (const id of ids) {
      const memory = this.memory(id);
      const self = this.observe(id)?.self;
      const token = self ? formPosition(self.form, self.beat).token : undefined;
      if (memory.formToken !== token) { memory.formToken = token; memory.pending = undefined; memory.nextAt = 0; }
      if (now < memory.nextAt || now < this.retryAt || memory.pending || this.inFlight.has(id) || this.queued.includes(id)) continue;
      this.queued.push(id);
      this.status(id, { phase: 'queued', detail: 'Waiting for a local inference slot.' });
    }
    this.pump(now);
  }
  private pump(now: number) {
    if (this.disposed || now < this.retryAt) return;
    while (this.inFlight.size < this.options.concurrency && this.queued.length) {
      // Serve the least recently reviewed instrument first, including its first turn.
      this.queued.sort((a, b) => (this.memory(a).lastStartedAt ?? 0) - (this.memory(b).lastStartedAt ?? 0));
      const id = this.queued.shift()!;
      const observation = this.observe(id);
      if (!observation || !observation.self.audible || isOpening(observation.self) || isFormEntrance(observation.self)) continue;
      // Read current observations when the job starts, never a stale queued snapshot.
      const memory = this.memory(id);
      if (memory.pending || this.inFlight.has(id)) continue;
      if (now < memory.nextAt) {
        this.status(id, { phase: 'listening', detail: 'Holding the phrase until its next review.' });
        continue;
      }
      const neighbours = selectNeighbours(observation.self, observation.reachable);
      const context = structuredClone({ self: observation.self, neighbours, memory: memory.history });
      const controller = new AbortController();
      this.inFlight.set(id, controller);
      const generation = this.generation;
      memory.lastStartedAt = now;
      this.status(id, { phase: 'thinking', detail: 'Composing a response locally.', heard: neighbours.map(p => orchestra[p.instrument].name) });
      void this.run(id, context, controller, generation);
    }
  }
  private async run(id: string, context: ListeningContext, controller: AbortController, generation: number) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new LocalRuntimeError('Local inference timed out.')); }, this.options.timeoutMs);
      });
      const decision = await Promise.race([this.decide(context, controller.signal), timeout]);
      if (this.disposed || generation !== this.generation || controller.signal.aborted) return;
      if (!validDecision(decision)) throw new Error('Local model phrase failed musical validation.');
      const current = this.observe(id);
      if (!current) return;
      const token = formPosition(context.self.form, context.self.beat).token;
      if (formPosition(current.self.form, current.self.beat).token !== token || current.self.beat - context.self.beat > MAX_CONTEXT_STEPS) {
        this.memory(id).nextAt = 0;
        this.status(id, { phase: 'listening', detail: 'The music moved on; listening to the latest phrase.' });
        return;
      }
      this.memory(id).pending = { decision: structuredClone(decision), fromBeat: context.self.beat, heardIds: context.neighbours.map(p => p.id), formToken: token };
      this.status(id, { phase: 'ready', detail: 'New phrase ready for the next bar.' });
    } catch (error) {
      if (this.disposed || generation !== this.generation) return;
      const memory = this.memory(id);
      memory.failures++;
      memory.nextAt = Date.now() + Math.min(60000, 5000 * 2 ** Math.min(memory.failures - 1, 4));
      // An unavailable runtime needs a shared pause; malformed musical choices only
      // delay their own musician, allowing the rest of the orchestra to keep thinking.
      if (error instanceof LocalRuntimeError) this.retryAt = Date.now() + 3000;
      this.status(id, { phase: 'fallback', detail: `${error instanceof Error ? error.message : 'Local inference unavailable.'} Continuing the current phrase.` });
    } finally {
      clearTimeout(timer);
      if (this.inFlight.get(id) === controller) this.inFlight.delete(id);
      if (generation === this.generation) this.pump(Date.now());
    }
  }
  atBar(m: Musician, now = Date.now()): Musician {
    if (m.beat % 16 !== 0 || isOpening(m) || isFormEntrance(m)) return m;
    const memory = this.memory(m.id), pending = memory.pending;
    if (!pending) return m;
    memory.pending = undefined;
    const current = this.observe(m.id);
    const reachableIds = new Set(current?.reachable.filter(p => p.audible).map(p => p.id));
    if (formPosition(m.form, m.beat).token !== pending.formToken || m.beat - pending.fromBeat > MAX_CONTEXT_STEPS || pending.heardIds.some(id => !reachableIds.has(id))) {
      memory.nextAt = 0;
      this.status(m.id, { phase: 'listening', detail: 'Section or neighbours changed; listening again.' });
      return m;
    }
    const updated = applyDecision(m, pending.decision);
    if (updated === m) {
      memory.nextAt = 0;
      this.status(m.id, { phase: 'listening', detail: 'The harmonic context changed; listening again.' });
      return m;
    }
    memory.history = [...memory.history, structuredClone(pending.decision)].slice(-3);
    memory.lastAppliedAt = now;
    memory.nextAt = now + this.options.intervalMs;
    memory.failures = 0;
    this.status(m.id, { phase: 'playing', detail: pending.decision.reason, decisions: memory.status.decisions + 1 });
    return updated;
  }
  invalidate() {
    this.generation++;
    for (const controller of this.inFlight.values()) controller.abort();
    this.inFlight.clear(); this.queued = []; this.retryAt = 0;
    for (const [id, memory] of this.memories) {
      memory.pending = undefined; memory.nextAt = 0;
      this.status(id, { phase: 'listening', detail: 'Listening again after the ensemble changed.', heard: [] });
    }
  }
  dispose() { this.disposed = true; this.invalidate(); }
}
