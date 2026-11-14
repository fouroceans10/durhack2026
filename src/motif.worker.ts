import { extractMotif } from './motif-extraction';
import type { Tonality } from './tonality';

self.onmessage = (event: MessageEvent<{ samples: Float32Array; sampleRate: number; tonality: Tonality }>) => {
  try {
    const result = extractMotif(event.data.samples, event.data.sampleRate,
      progress => self.postMessage({ type: 'progress', progress }), event.data.tonality);
    self.postMessage({ type: 'result', result });
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Could not extract a melody.' });
  }
};
