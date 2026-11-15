import {
  ANALYSIS_RATE,
  MAX_CLIP_BYTES,
  MAX_CLIP_SECONDS,
  extractMotif,
  type ExtractedMotif,
  type ScaleMode,
} from "./motifExtraction";

export async function analyseAudio(
  file: File,
  signal: AbortSignal,
  progress: (value: number) => void,
  keyRoot = "C",
  mode: ScaleMode = "major",
): Promise<ExtractedMotif> {
  if (!file.size || file.size > MAX_CLIP_BYTES) {
    throw new Error("Choose a non-empty audio file under 15 MB.");
  }
  if (
    !file.type.startsWith("audio/") &&
    !/\.(mp3|wav|ogg|flac|m4a|aac|webm)$/i.test(file.name)
  ) {
    throw new Error("Choose an audio file, such as MP3 or WAV.");
  }
  const bytes = await file.arrayBuffer();
  signal.throwIfAborted();

  let decoded: AudioBuffer;
  try {
    decoded = await new OfflineAudioContext(1, 1, ANALYSIS_RATE).decodeAudioData(
      bytes.slice(0),
    );
  } catch {
    throw new Error(
      "This audio could not be decoded. Try exporting the snippet as MP3 or WAV.",
    );
  }
  signal.throwIfAborted();
  if (decoded.duration < 0.25 || decoded.duration > MAX_CLIP_SECONDS + 0.05) {
    throw new Error("Choose a snippet between 0.25 and 30 seconds.");
  }

  let channel = 0;
  let strongest = -1;
  for (let c = 0; c < decoded.numberOfChannels; c++) {
    const data = decoded.getChannelData(c);
    let energy = 0;
    for (let i = 0; i < data.length; i += 8) {
      energy += data[i] ** 2;
    }
    if (energy > strongest) {
      channel = c;
      strongest = energy;
    }
  }

  const samples = new Float32Array(decoded.getChannelData(channel));

  if (typeof Worker === "undefined") {
    return extractMotif(samples, decoded.sampleRate, progress, keyRoot, mode);
  }

  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./motif.worker.ts", import.meta.url), {
        type: "module",
      });
    } catch {
      try {
        resolve(
          extractMotif(samples, decoded.sampleRate, progress, keyRoot, mode),
        );
      } catch (err) {
        reject(err);
      }
      return;
    }

    const finish = (error?: Error, result?: ExtractedMotif) => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      worker.terminate();
      if (error) reject(error);
      else resolve(result!);
    };

    const abort = () =>
      finish(new DOMException("Analysis cancelled.", "AbortError"));
    const timeout = setTimeout(
      () =>
        finish(new Error("Analysis took too long. Try a shorter snippet.")),
      20000,
    );
    signal.addEventListener("abort", abort, { once: true });

    worker.onmessage = (event) => {
      if (event.data.type === "progress") progress(event.data.progress);
      else if (event.data.type === "error") finish(new Error(event.data.message));
      else if (event.data.type === "result") finish(undefined, event.data.result);
    };
    worker.onerror = () => {
      try {
        const fallback = extractMotif(
          samples,
          decoded.sampleRate,
          progress,
          keyRoot,
          mode,
        );
        finish(undefined, fallback);
      } catch (err) {
        finish(
          err instanceof Error
            ? err
            : new Error("Audio analysis could not start."),
        );
      }
    };

    const copy = new Float32Array(samples);
    worker.postMessage(
      { samples: copy, sampleRate: decoded.sampleRate, keyRoot, mode },
      [copy.buffer],
    );
  });
}

export function encodeWavFile(
  samples: Float32Array,
  sampleRate: number,
  filename = "voice-motif.wav",
): File {
  const numSamples = samples.length;
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + numSamples * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // 16-bit
  writeString(36, "data");
  view.setUint32(40, numSamples * 2, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(
      offset,
      clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff,
      true,
    );
    offset += 2;
  }

  return new File([buffer], filename, { type: "audio/wav" });
}

export interface MicrophoneCaptureHandle {
  stop: () => Promise<File>;
  cancel: () => void;
}

export async function startMicrophoneCapture(
  onLevel?: (rms: number) => void,
): Promise<MicrophoneCaptureHandle> {
  if (
    typeof navigator === "undefined" ||
    !navigator.mediaDevices ||
    typeof navigator.mediaDevices.getUserMedia !== "function"
  ) {
    throw new Error("Microphone recording is not supported in this browser.");
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });

  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  const ctx = new AudioCtx({ sampleRate: ANALYSIS_RATE });
  const source = ctx.createMediaStreamSource(stream);
  const processor = ctx.createScriptProcessor(2048, 1, 1);
  const silentGain = ctx.createGain();
  silentGain.gain.value = 0;

  const chunks: Float32Array[] = [];
  let totalSamples = 0;
  const maxSamples = Math.ceil(MAX_CLIP_SECONDS * ctx.sampleRate);

  processor.onaudioprocess = (event) => {
    const input = event.inputBuffer.getChannelData(0);
    if (totalSamples < maxSamples) {
      const copy = new Float32Array(input.length);
      copy.set(input);
      chunks.push(copy);
      totalSamples += copy.length;
    }
    if (onLevel) {
      let sum = 0;
      for (let i = 0; i < input.length; i += 4) {
        sum += input[i] ** 2;
      }
      const rms = Math.sqrt(sum / (input.length / 4));
      onLevel(Math.min(1, rms * 5));
    }
  };

  source.connect(processor);
  processor.connect(silentGain);
  silentGain.connect(ctx.destination);

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    try {
      processor.disconnect();
      source.disconnect();
      silentGain.disconnect();
    } catch {
      // Ignore disconnect errors
    }
    for (const track of stream.getTracks()) {
      track.stop();
    }
    void ctx.close().catch(() => {});
  };

  return {
    stop: async () => {
      const rate = ctx.sampleRate || ANALYSIS_RATE;
      cleanup();
      const merged = new Float32Array(totalSamples);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.length;
      }
      const stamp = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      return encodeWavFile(merged, rate, `Voice Recording (${stamp}).wav`);
    },
    cancel: () => {
      cleanup();
    },
  };
}
