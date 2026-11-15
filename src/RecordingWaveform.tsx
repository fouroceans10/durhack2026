import { useEffect, useRef, useState } from 'react';

export function RecordingWaveform({ stream }: { stream: MediaStream }) {
  const trace = useRef<SVGPathElement | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let context: AudioContext | undefined, source: MediaStreamAudioSourceNode | undefined, analyser: AnalyserNode | undefined;
    let frame = 0, disposed = false, lastDraw = -Infinity;
    setUnavailable(false);
    const cleanup = () => {
      disposed = true;
      cancelAnimationFrame(frame);
      source?.disconnect(); analyser?.disconnect();
      if (context && context.state !== 'closed') void context.close().catch(() => {});
    };
    const fail = () => { if (!disposed) setUnavailable(true); cleanup(); };
    try {
      context = new AudioContext();
      source = context.createMediaStreamSource(stream);
      analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      // Analyse the existing microphone stream without playing it through speakers.
      source.connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      const draw = (now: number) => {
        if (disposed) return;
        if (now - lastDraw >= 1000 / 30) {
          analyser!.getByteTimeDomainData(samples);
          const points = Array.from({ length: 256 }, (_, i) => {
            const sample = (samples[Math.floor(i * (samples.length - 1) / 255)] - 128) / 128;
            const y = 36 - Math.max(-1, Math.min(1, sample * 2.5)) * 30;
            return `${i ? 'L' : 'M'}${(i * 600 / 255).toFixed(1)},${y.toFixed(1)}`;
          });
          trace.current?.setAttribute('d', points.join(' '));
          lastDraw = now;
        }
        frame = requestAnimationFrame(draw);
      };
      void context.resume().then(() => { if (!disposed) frame = requestAnimationFrame(draw); }).catch(fail);
    } catch { fail(); }
    // The recorder owns the tracks; this view only owns the analysis graph.
    return cleanup;
  }, [stream]);

  return <div className="recording-waveform">
    <span className="eyebrow">{unavailable ? 'Waveform unavailable · recording continues' : 'LIVE MICROPHONE'}</span>
    {!unavailable && <svg className="motif-waveform" viewBox="0 0 600 72" preserveAspectRatio="none" role="img" aria-label="Live waveform of your microphone">
      <line x1="0" y1="36" x2="600" y2="36" />
      <path ref={trace} d="M0,36 L600,36" fill="none" vectorEffect="non-scaling-stroke" />
    </svg>}
  </div>;
}
