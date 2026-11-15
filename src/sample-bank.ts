import manifest from './sample-manifest.json';
import type { NoteEvent } from './engine';

export type Sample = {
  file: string; root: number; style: string; loop?: number[]; repo: string;
};
export type SamplePatch = { name: string; source: string; samples: string[]; unpitched?: boolean; derived?: string };
export const samplePatches: readonly SamplePatch[] = manifest.patches;
export const sampleDefinitions: Readonly<Record<string, Sample>> = manifest.samples;
export type SampleProgress = { loaded: number; total: number };
export type SampleLoadResult = SampleProgress & { failed: string[] };

// AudioBuffers can be reused across contexts. Pause/resume and auditions reuse decoded PCM.
// Only successful decodes are cached, so a failed request can be retried next time.
const decoded = new Map<string, AudioBuffer>();

export function chooseSample(patch: SamplePatch, note: NoteEvent, available: ReadonlySet<string>, turn = 0) {
  const short = note.articulation === 'staccato' || note.duration < .22 && note.articulation !== 'legato' && note.articulation !== 'tenuto';
  const candidates = patch.samples.filter(id => available.has(id));
  const preferred = candidates.filter(id => sampleDefinitions[id].style === (short ? 'short' : 'sustain'));
  const pool = preferred.length ? preferred : candidates;
  if (!pool.length) return undefined;
  const distance = (id: string) => patch.unpitched ? 0 : Math.abs(sampleDefinitions[id].root - note.midi);
  const nearest = Math.min(...pool.map(distance));
  // Alternate real recorded takes at the same nearest pitch (no random detuning).
  const root = sampleDefinitions[pool.find(id => distance(id) === nearest)!].root;
  const takes = pool.filter(id => patch.unpitched || sampleDefinitions[id].root === root);
  const id = takes[turn % takes.length], sample = sampleDefinitions[id];
  return { id, sample, rate: patch.unpitched ? 1 : 2 ** ((note.midi - sample.root) / 12) };
}

export class SampleBank {
  private buffers = new Map<string, AudioBuffer>();
  private available = new Set<string>();
  private abort = new AbortController();
  private turns = new Map<number, number>();
  constructor(private context: BaseAudioContext) {}

  async load(instruments: readonly number[], progress?: (value: SampleProgress) => void): Promise<SampleLoadResult> {
    const patches = [...new Set(instruments)].map(i => {
      if (!samplePatches[i]) throw new RangeError('Unknown instrument');
      return samplePatches[i];
    });
    const queue = [...new Set(patches.flatMap(patch => patch.samples))];
    // Bound the whole warm-up as well as each file, even if the asset server hangs.
    const deadline = AbortSignal.timeout(30000);
    let next = 0, loaded = 0, finished = 0;
    const report = () => { if (!this.abort.signal.aborted) progress?.({ loaded: finished, total: queue.length }); };
    report();
    await Promise.all(Array.from({ length: Math.min(6, queue.length) }, async () => {
      while (next < queue.length && !this.abort.signal.aborted && !deadline.aborted) {
        const id = queue[next++], sample = sampleDefinitions[id];
        try {
          let buffer = decoded.get(sample.file);
          if (!buffer) {
            const response = await fetch(`/samples/${sample.file}`, { signal: AbortSignal.any([this.abort.signal, deadline, AbortSignal.timeout(15000)]) });
            if (!response.ok) throw new Error(`Sample HTTP ${response.status}`);
            buffer = await this.context.decodeAudioData(await response.arrayBuffer());
            if (!buffer.length || !Number.isFinite(buffer.duration)) throw new Error('Invalid sample audio');
            if (sample.repo === 'FluidR3') {
              // Match the raw recordings' level without clipping a rendered soundfont transient.
              let sum = 0, peak = 0, count = 0;
              for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
                const data = buffer.getChannelData(channel), body = Math.min(data.length, Math.floor(buffer.sampleRate * .8));
                for (let i = 0; i < data.length; i++) { peak = Math.max(peak, Math.abs(data[i])); if (i < body) { sum += data[i] ** 2; count++; } }
              }
              const gain = Math.min(.22 / Math.max(.001, Math.sqrt(sum / count)), .9 / Math.max(.001, peak));
              for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
                const data = buffer.getChannelData(channel);
                for (let i = 0; i < data.length; i++) data[i] *= gain;
              }
            }
            // FluidR3 is a rendered note. Loop only its held body, before the baked-in note-off.
            if (sample.repo === 'FluidR3' && sample.loop) {
              const [start, end] = sample.loop, fade = .08;
              if (buffer.duration < end + fade) throw new Error('English horn sample is too short');
              for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
                const data = buffer.getChannelData(channel), count = Math.floor(fade * buffer.sampleRate);
                const a = Math.floor(start * buffer.sampleRate), b = Math.floor(end * buffer.sampleRate);
                for (let i = 0; i < count; i++) {
                  const blend = i / (count - 1);
                  data[b - count + i] = data[b - count + i] * (1 - blend) + data[a - count + i] * blend;
                }
              }
            }
            if (this.abort.signal.aborted) break;
            decoded.set(sample.file, buffer);
          }
          this.buffers.set(id, buffer); this.available.add(id); loaded++;
        } catch {
          // Partial availability still plays the nearest recording; total failure uses the synth.
        } finally { finished++; report(); }
      }
    }));
    if (this.abort.signal.aborted) throw new DOMException('Audio loading cancelled', 'AbortError');
    return { loaded, total: queue.length, failed: patches.filter(p => p.samples.some(id => !this.buffers.has(id))).map(p => p.name) };
  }

  play(instrument: number, note: NoteEvent, time: number, destination: AudioNode, level: number): boolean {
    const patch = samplePatches[instrument], turn = this.turns.get(instrument) ?? 0;
    const selected = chooseSample(patch, note, this.available, turn);
    if (!selected || this.abort.signal.aborted) return false;
    this.turns.set(instrument, turn + 1);
    const { id, sample, rate } = selected;
    const source = this.context.createBufferSource(), envelope = this.context.createGain();
    source.buffer = this.buffers.get(id)!;
    source.playbackRate.setValueAtTime(rate, time);
    const loop = sample.loop;
    if (loop) { source.loop = true; source.loopStart = loop[0]; source.loopEnd = loop[1]; }
    const end = time + note.duration;
    const attack = Math.min(.004, note.duration / 4), release = Math.min(note.articulation === 'staccato' ? .018 : .045, note.duration / 3);
    // The recording provides the attack/decay; this envelope supplies the agent's exact gate.
    const volume = level * 3 * note.velocity;
    envelope.gain.setValueAtTime(0, time);
    envelope.gain.linearRampToValueAtTime(volume, time + attack);
    envelope.gain.setValueAtTime(volume, end - release);
    envelope.gain.linearRampToValueAtTime(0, end);
    source.connect(envelope); envelope.connect(destination);
    source.onended = () => { source.disconnect(); envelope.disconnect(); };
    source.start(time); source.stop(end + .005);
    return true;
  }

  close() { this.abort.abort(); this.buffers.clear(); this.available.clear(); }
}
