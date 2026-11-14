import { ANALYSIS_RATE, MAX_CLIP_BYTES, MAX_CLIP_SECONDS, type ExtractedMotif } from './motif-extraction';
import { DEFAULT_TONALITY, type Tonality } from './tonality';

export async function analyseAudio(file: File, signal: AbortSignal, progress: (value: number) => void, tonality: Tonality = DEFAULT_TONALITY): Promise<ExtractedMotif> {
  if (!file.size || file.size > MAX_CLIP_BYTES) throw new Error('Choose a non-empty audio file under 15 MB.');
  if (!file.type.startsWith('audio/') && !/\.(mp3|wav|ogg|flac|m4a|aac|webm)$/i.test(file.name)) {
    throw new Error('Choose an audio file, such as MP3 or WAV.');
  }
  const bytes = await file.arrayBuffer();
  signal.throwIfAborted();
  let decoded: AudioBuffer;
  try {
    // Offline decoding resamples without opening speakers or sending audio anywhere.
    decoded = await new OfflineAudioContext(1, 1, ANALYSIS_RATE).decodeAudioData(bytes);
  } catch { throw new Error('This audio could not be decoded. Try exporting the snippet as MP3 or WAV.'); }
  signal.throwIfAborted();
  if (decoded.duration < .25 || decoded.duration > MAX_CLIP_SECONDS + .05) throw new Error('Choose a snippet between 0.25 and 30 seconds.');
  // Use the strongest channel; averaging can erase a melody in out-of-phase stereo.
  let channel = 0, strongest = -1;
  for (let c = 0; c < decoded.numberOfChannels; c++) {
    const data = decoded.getChannelData(c);
    let energy = 0;
    for (let i = 0; i < data.length; i += 8) energy += data[i] ** 2;
    if (energy > strongest) { channel = c; strongest = energy; }
  }
  const samples = new Float32Array(decoded.getChannelData(channel));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./motif.worker.ts', import.meta.url), { type: 'module' });
    const finish = (error?: Error, result?: ExtractedMotif) => {
      clearTimeout(timeout); signal.removeEventListener('abort', abort); worker.terminate();
      if (error) reject(error); else resolve(result!);
    };
    const abort = () => finish(new DOMException('Analysis cancelled.', 'AbortError'));
    const timeout = setTimeout(() => finish(new Error('Analysis took too long. Try a shorter snippet.')), 20000);
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = event => {
      if (event.data.type === 'progress') progress(event.data.progress);
      else if (event.data.type === 'error') finish(new Error(event.data.message));
      else if (event.data.type === 'result') finish(undefined, event.data.result);
    };
    worker.onerror = () => finish(new Error('Audio analysis could not start. Reload the page and try again.'));
    worker.postMessage({ samples, sampleRate: decoded.sampleRate, tonality }, [samples.buffer]);
  });
}
