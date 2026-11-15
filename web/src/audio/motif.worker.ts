import { extractMotif, type ScaleMode } from "./motifExtraction";

self.onmessage = (
  event: MessageEvent<{
    samples: Float32Array;
    sampleRate: number;
    keyRoot: string;
    mode: ScaleMode;
  }>,
) => {
  try {
    const result = extractMotif(
      event.data.samples,
      event.data.sampleRate,
      (progress) => self.postMessage({ type: "progress", progress }),
      event.data.keyRoot,
      event.data.mode,
    );
    self.postMessage({ type: "result", result });
  } catch (error) {
    self.postMessage({
      type: "error",
      message:
        error instanceof Error ? error.message : "Could not extract a melody.",
    });
  }
};
