import { MAX_CLIP_BYTES, MAX_CLIP_SECONDS } from './motif-extraction';

export type VoiceRecording = { stop: () => void; result: Promise<File>; stream: MediaStream };

export function recordingError(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Microphone access was blocked. Allow it in your browser’s site settings, then try again.';
  if (name === 'NotFoundError') return 'No microphone was found. Connect or enable a microphone, then try again.';
  if (name === 'NotReadableError') return 'The microphone could not start. Check that another app is not using it.';
  return error instanceof Error ? error.message : 'Voice recording could not start. Please try again.';
}

export async function startVoiceRecording(signal: AbortSignal, progress: (seconds: number) => void): Promise<VoiceRecording> {
  signal.throwIfAborted();
  if (!globalThis.isSecureContext) throw new Error('Microphone recording needs localhost or HTTPS. Open the app at http://localhost:5173 or use its HTTPS address.');
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    throw new Error('This browser cannot record audio. Try a current browser or choose an audio file instead.');
  }
  // Avoid speech processing that can distort sustained sung or hummed notes.
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false });
  const release = () => stream.getTracks().forEach(track => track.stop());
  // Permission prompts cannot be aborted; release a stream granted after cancel.
  if (signal.aborted) { release(); signal.throwIfAborted(); }
  let recorder: MediaRecorder;
  try {
    const mimeType = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find(type => MediaRecorder.isTypeSupported(type));
    recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  } catch (error) { release(); throw error; }

  let stop = () => {};
  const result = new Promise<File>((resolve, reject) => {
    const chunks: Blob[] = [];
    let bytes = 0, settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined, ticker: ReturnType<typeof setInterval> | undefined;
    const clearTimers = () => { clearTimeout(timeout); clearInterval(ticker); };
    const cleanup = () => {
      clearTimers(); signal.removeEventListener('abort', abort);
      stream.getTracks().forEach(track => track.removeEventListener('ended', disconnected));
      recorder.ondataavailable = null; recorder.onerror = null; recorder.onstop = null;
      try { if (recorder.state !== 'inactive') recorder.stop(); } catch { /* Release the microphone even when the recorder has failed. */ }
      release();
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) { reject(error); return; }
      if (!bytes) { reject(new Error('No audio was recorded. Try singing or humming a short phrase.')); return; }
      const type = chunks[0]?.type || recorder.mimeType || 'audio/webm';
      const extension = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
      resolve(new File(chunks, `Voice motif.${extension}`, { type }));
    };
    const abort = () => finish(new DOMException('Recording cancelled.', 'AbortError'));
    const disconnected = () => finish(new Error('The microphone disconnected. Reconnect it and record again.'));
    stop = () => {
      if (settled || recorder.state === 'inactive') return;
      clearTimers();
      try { recorder.stop(); } catch (error) { finish(error instanceof Error ? error : new Error('Could not finish recording.')); }
      release();
    };
    recorder.ondataavailable = event => {
      if (!event.data.size || settled) return;
      bytes += event.data.size;
      if (bytes > MAX_CLIP_BYTES) { finish(new Error('The recording is too large. Try a shorter phrase.')); return; }
      chunks.push(event.data);
    };
    recorder.onerror = () => finish(new Error('The microphone recording failed. Please try again.'));
    recorder.onstop = () => finish();
    signal.addEventListener('abort', abort, { once: true });
    stream.getTracks().forEach(track => track.addEventListener('ended', disconnected));
    try {
      recorder.start(250);
      if (settled) return;
      const started = performance.now();
      ticker = setInterval(() => progress(Math.min(MAX_CLIP_SECONDS, (performance.now() - started) / 1000)), 250);
      // Reserve a little room for encoder padding within the 30-second clip limit.
      timeout = setTimeout(stop, (MAX_CLIP_SECONDS - .25) * 1000);
      progress(0);
    } catch (error) { finish(error instanceof Error ? error : new Error('Could not start recording.')); }
  });
  return { stop: () => stop(), result, stream };
}
