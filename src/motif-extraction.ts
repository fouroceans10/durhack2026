import { PitchDetector } from 'pitchy';
import type { StartingMotif } from './melody';
import { DEFAULT_TONALITY, nearestDegree, validTonality, type Tonality } from './tonality';
export { nearestDegree } from './tonality';
import { fitValue, normalizeRhythm } from './phrasing';

export const MAX_CLIP_SECONDS = 30;
export const MAX_CLIP_BYTES = 15 * 1024 * 1024;
export const ANALYSIS_RATE = 16000;
type HeardNote = { midi: number; start: number; end: number; clarity: number };
export type ExtractedMotif = StartingMotif & {
  duration: number; notes: HeardNote[]; detectedNotes: number; confidence: number; waveform: number[];
};

// Fit to the existing ensemble's pitch collection; this is not full-score transcription.
export function adaptMotif(result: ExtractedMotif, tonality: Tonality): ExtractedMotif {
  if (!validTonality(tonality)) throw new Error('Invalid tonality.');
  return { ...result, tonality: { ...tonality }, motif: result.notes.map(note => nearestDegree(note.midi, tonality)) };
}

export function extractMotif(samples: Float32Array, sampleRate: number, progress = (_value: number) => {}, tonality: Tonality = DEFAULT_TONALITY): ExtractedMotif {
  if (!validTonality(tonality)) throw new Error('Invalid tonality.');
  if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 96000) throw new Error('Unsupported audio sample rate.');
  const duration = samples.length / sampleRate;
  if (duration < .25 || duration > MAX_CLIP_SECONDS + .05) throw new Error('Choose a snippet between 0.25 and 30 seconds.');
  const size = 2 ** Math.ceil(Math.log2(sampleRate * .064)), hop = Math.round(sampleRate * .01);
  const detector = PitchDetector.forFloat32Array(size);
  const frame = new Float32Array(size);
  const energies: number[] = [];
  let peak = 0;
  for (let offset = 0; offset + size <= samples.length; offset += hop) {
    let sum = 0;
    // A short centre window detects re-attacks that the longer pitch window smears.
    for (let j = size / 2 - hop; j < size / 2 + hop; j++) sum += samples[offset + j] ** 2;
    const rms = Math.sqrt(sum / (hop * 2));
    energies.push(rms); peak = Math.max(peak, rms);
  }
  const gate = Math.max(.002, peak * .08);
  const notes: HeardNote[] = [];
  let current: HeardNote | undefined;
  const flush = () => { if (current && current.end - current.start >= .08) notes.push(current); current = undefined; };
  let lastProgress = -1;
  energies.forEach((rms, index) => {
    const offset = index * hop;
    const time = (offset + size / 2) / sampleRate;
    let midi: number | undefined, clarity = 0;
    if (rms >= gate) {
      frame.set(samples.subarray(offset, offset + size));
      const [frequency, certainty] = detector.findPitch(frame, sampleRate);
      if (certainty >= .88 && frequency >= 65 && frequency <= 1600) {
        midi = Math.round(69 + 12 * Math.log2(frequency / 440)); clarity = certainty;
      }
    }
    if (midi !== undefined) {
      if (current?.midi === midi && time - current.end <= .05) {
        current.end = time + hop / sampleRate;
        current.clarity = Math.min(current.clarity, clarity);
      } else {
        flush(); current = { midi, start: time, end: time + hop / sampleRate, clarity };
      }
    } else if (current && (rms < gate || time - current.end > .04)) flush();
    const percent = Math.floor(index / energies.length * 100);
    if (percent >= lastProgress + 5) { lastProgress = percent; progress(percent); }
  });
  flush();
  if (!notes.length || notes.reduce((sum, n) => sum + n.end - n.start, 0) < .15) {
    throw new Error('No clear melody found. Try a solo instrument, humming or a whistle with less background sound.');
  }
  // Preserve order and relative entrances; a bounded phrase becomes one 16-step bar.
  const selected = notes.slice(0, 12), first = selected[0].start;
  const span = selected.at(-1)!.end - first;
  const rhythm: number[] = [], motif: number[] = [], used: HeardNote[] = [];
  for (const note of selected) {
    const step = Math.min(15, Math.round((note.start - first) / span * 16));
    if (rhythm.includes(step)) continue;
    rhythm.push(step); motif.push(nearestDegree(note.midi, tonality)); used.push(note);
  }
  const waveform = Array.from({ length: 100 }, (_, i) => {
    const start = Math.floor(i * samples.length / 100), end = Math.floor((i + 1) * samples.length / 100);
    let sum = 0;
    for (let j = start; j < end; j++) sum += samples[j] ** 2;
    return Math.min(1, Math.sqrt(sum / (end - start)) / Math.max(peak, .001));
  });
  progress(100);
  const durations = used.map(note => fitValue(Math.round((note.end - note.start) / span * 16)));
  return { motif, ...normalizeRhythm({ rhythm, durations }), tonality: { ...tonality }, duration, notes: used, detectedNotes: notes.length,
    confidence: used.reduce((sum, n) => sum + n.clarity, 0) / used.length, waveform };
}
