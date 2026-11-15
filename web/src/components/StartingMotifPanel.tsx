import React, { useEffect, useRef, useState } from "react";
import type { InstrumentRole, MotifRecord } from "@shared/types";
import {
  adaptMotif,
  degreeName,
  generateStartingMotif,
  toMotifRecord,
  type ExtractedMotif,
  type ScaleMode,
  type StartingPhrase,
} from "../audio/motifExtraction";
import {
  analyseAudio,
  startMicrophoneCapture,
  type MicrophoneCaptureHandle,
} from "../audio/motifUpload";

export interface StartingMotifPanelProps {
  keyRoot: string;
  mode: ScaleMode;
  bpm: number;
  role: InstrumentRole;
  partitionGroupId: string;
  activeMotifName: string;
  onApplyMotif: (motif: MotifRecord, label: string) => void;
}

export const StartingMotifPanel: React.FC<StartingMotifPanelProps> = ({
  keyRoot,
  mode,
  bpm,
  role,
  partitionGroupId,
  activeMotifName,
  onApplyMotif,
}) => {
  const [randomPhrase, setRandomPhrase] = useState<StartingPhrase>(() =>
    generateStartingMotif(undefined, keyRoot, mode),
  );
  const [clip, setClip] = useState<{
    name: string;
    url: string;
    result: ExtractedMotif;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [micLevel, setMicLevel] = useState(0);

  const requestRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const micHandleRef = useRef<MicrophoneCaptureHandle | null>(null);
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const adapted = clip ? adaptMotif(clip.result, keyRoot, mode) : null;

  useEffect(() => {
    return () => {
      requestRef.current?.abort();
      micHandleRef.current?.cancel();
      if (recTimerRef.current) clearInterval(recTimerRef.current);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (clip) URL.revokeObjectURL(clip.url);
    };
  }, [clip]);

  async function loadAudioFile(file: File) {
    requestRef.current?.abort();
    audioRef.current?.pause();
    const controller = new AbortController();
    requestRef.current = controller;
    setBusy(true);
    setError("");
    setProgress(0);
    try {
      const result = await analyseAudio(
        file,
        controller.signal,
        (val) => {
          if (!controller.signal.aborted) setProgress(val);
        },
        keyRoot,
        mode,
      );
      if (controller.signal.aborted) return;
      const nextClip = {
        name: file.name,
        url: URL.createObjectURL(file),
        result,
      };
      setClip(nextClip);
    } catch (failure) {
      if (!controller.signal.aborted) {
        setError(
          failure instanceof Error
            ? failure.message
            : "Could not read this audio.",
        );
      }
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  async function handleToggleVoiceRecording() {
    if (isRecording) {
      if (recTimerRef.current) {
        clearInterval(recTimerRef.current);
        recTimerRef.current = null;
      }
      setIsRecording(false);
      setMicLevel(0);
      const handle = micHandleRef.current;
      micHandleRef.current = null;
      if (!handle) return;
      try {
        const recordedFile = await handle.stop();
        await loadAudioFile(recordedFile);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Could not process voice recording.",
        );
      }
      return;
    }

    setError("");
    setRecordingSeconds(0);
    setMicLevel(0);
    try {
      const handle = await startMicrophoneCapture((rms) => setMicLevel(rms));
      micHandleRef.current = handle;
      setIsRecording(true);
      const startedAt = Date.now();
      recTimerRef.current = setInterval(() => {
        const elapsed = (Date.now() - startedAt) / 1000;
        setRecordingSeconds(elapsed);
        if (elapsed >= 29.5) {
          void handleToggleVoiceRecording();
        }
      }, 100);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Microphone access was denied or unavailable.",
      );
    }
  }

  function handleCancelVoiceRecording() {
    if (recTimerRef.current) {
      clearInterval(recTimerRef.current);
      recTimerRef.current = null;
    }
    micHandleRef.current?.cancel();
    micHandleRef.current = null;
    setIsRecording(false);
    setMicLevel(0);
    setRecordingSeconds(0);
  }

  function handleGenerateRandom() {
    const next = generateStartingMotif(randomPhrase, keyRoot, mode);
    setRandomPhrase(next);
    const record = toMotifRecord(
      next,
      role,
      partitionGroupId,
      bpm,
      "Generated motif",
    );
    onApplyMotif(record, "Generated motif");
  }

  function handleApplyAdaptedClip() {
    if (!clip || !adapted) return;
    audioRef.current?.pause();
    const record = toMotifRecord(
      adapted,
      role,
      partitionGroupId,
      bpm,
      clip.name,
    );
    onApplyMotif(record, clip.name);
  }

  return (
    <section
      className="grid grid-cols-1 lg:grid-cols-12 gap-8 py-8 border-b border-[var(--ink)]"
      aria-labelledby="motif-heading"
    >
      {/* Left Column: Editorial Prelude Intro */}
      <div className="lg:col-span-4 flex flex-col justify-between">
        <div>
          <span className="eyebrow text-[var(--red)]">
            PRELUDE / A PHRASE OF YOUR OWN
          </span>
          <h2
            id="motif-heading"
            className="font-display text-3xl sm:text-4xl font-medium tracking-tight leading-tight my-3 text-[var(--ink)]"
          >
            You give the spark.
            <br />
            <em className="italic font-medium text-[var(--red)]">
              They take it from here.
            </em>
          </h2>
          <p className="text-[18px] leading-snug text-[var(--muted)] max-w-sm">
            Let chance write the opening, hum or whistle into your microphone,
            or drop an audio snippet of your own. Each autonomous peer adapts
            your melody to the active key and develops it across the mesh.
          </p>
          <p className="font-mono text-[10px] text-[var(--woodwinds)] mt-3">
            ↳ Voice recording &amp; pitch extraction stay 100% in this browser.
          </p>
        </div>

        <div
          className="mt-5 pl-3.5 py-1 border-l-2 border-[var(--red)]"
          role="status"
        >
          <span className="block font-mono text-[9px] tracking-widest uppercase text-[var(--muted)] mb-1">
            OPENING MOTIF SEED
          </span>
          <strong className="font-normal text-lg text-[var(--ink)]">
            {activeMotifName || "Generated motif"}
          </strong>
        </div>
      </div>

      {/* Right Column: Motif Workbench */}
      <div className="lg:col-span-8 min-w-0">
        {/* 01 / GENERATED */}
        <div className="border-y border-[var(--ink)] py-4">
          <div className="flex items-center justify-between gap-4 text-[var(--red)]">
            <span className="eyebrow text-[var(--red)]">LET CHANCE BEGIN</span>
            <span className="font-mono text-[9px] tracking-wider text-[var(--muted)]">
              01 / GENERATED
            </span>
          </div>
          <p className="font-display text-2xl my-2.5 text-[var(--ink)]">
            A fresh phrase, every time.
          </p>
          <div
            className="flex items-center my-3 staff-lines-bg py-1"
            aria-label={`Generated melody in ${keyRoot} ${mode}: ${randomPhrase.motif
              .map((n) => degreeName(n, keyRoot, mode))
              .join(", ")}`}
          >
            {randomPhrase.motif.map((note, i) => (
              <span
                key={i}
                className="flex-1 font-display text-2xl sm:text-3xl text-center text-[var(--red)]"
              >
                {degreeName(note, keyRoot, mode)}
                <small className="block font-mono text-[9px] text-[var(--muted)] pt-1">
                  {(randomPhrase.rhythm[i] ?? i * 2) + 1}
                </small>
              </span>
            ))}
          </div>
          <div className="flex flex-wrap gap-2.5 mt-3">
            <button
              type="button"
              disabled={busy || isRecording}
              onClick={handleGenerateRandom}
              className="editorial-btn-primary flex-1"
            >
              ↻ Generate a new motif
            </button>
          </div>
        </div>

        {/* 02 / VOICE RECORDING OR AUDIO DROP */}
        <div className="flex items-center justify-between mt-5 mb-2.5">
          <p className="font-mono text-[9px] tracking-wider text-[var(--muted)] m-0">
            02 / OR RECORD YOUR VOICE &amp; UPLOAD AUDIO
          </p>
          <span className="font-mono text-[9px] text-[var(--muted)]">
            PITCHY DSP · 16-STEP QUANTIZER
          </span>
        </div>

        <div
          className={`relative flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 border border-dashed transition-colors ${
            dragging
              ? "border-[var(--red)] bg-[#bc382412]"
              : isRecording
              ? "border-[var(--red)] bg-[#bc38240d]"
              : "border-[var(--muted)] bg-[var(--paper-light)]"
          }`}
          onDragOver={(event) => {
            event.preventDefault();
            if (!busy && !isRecording) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            const file = event.dataTransfer.files[0];
            if (file) void loadAudioFile(file);
          }}
        >
          <div className="flex items-start gap-3 min-w-0">
            <span
              className="font-display text-3xl leading-none text-[var(--red)] select-none"
              aria-hidden="true"
            >
              {isRecording ? "●" : "♪"}
            </span>
            <div className="min-w-0">
              <strong className="block text-xl font-normal text-[var(--ink)]">
                {isRecording
                  ? `Recording voice / hum… ${recordingSeconds.toFixed(1)}s`
                  : busy
                  ? "Listening for a melody…"
                  : clip
                  ? "Try another voice recording or audio snippet."
                  : "Hum into your mic or drop a little music here."}
              </strong>
              <span className="block font-mono text-[9px] leading-relaxed text-[var(--muted)] mt-0.5">
                {isRecording
                  ? "Sing, hum, or whistle a clear solo melody (0.5–30 sec) · click Stop to extract notes"
                  : "Live microphone capture OR MP3, WAV, OGG, FLAC, M4A · 30 sec / 15 MB max"}
              </span>
              {isRecording && (
                <div className="mt-2 flex items-center gap-2">
                  <div className="h-1.5 w-36 bg-[var(--rule)] overflow-hidden">
                    <div
                      className="h-full bg-[var(--red)] transition-all duration-75"
                      style={{ width: `${Math.round(micLevel * 100)}%` }}
                    />
                  </div>
                  <span className="font-mono text-[9px] text-[var(--red)]">
                    LIVE MIC
                  </span>
                </div>
              )}
            </div>
          </div>

          <input
            ref={inputRef}
            type="file"
            accept="audio/*,.mp3,.wav,.ogg,.flac,.m4a,.webm"
            aria-label="Upload starting motif"
            disabled={busy || isRecording}
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void loadAudioFile(file);
            }}
          />

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleToggleVoiceRecording()}
              className={
                isRecording ? "editorial-btn-primary" : "editorial-btn"
              }
            >
              {isRecording ? "■ Stop & extract" : "● Record voice"}
            </button>
            {isRecording ? (
              <button
                type="button"
                onClick={handleCancelVoiceRecording}
                className="editorial-btn text-sm"
              >
                Cancel
              </button>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={() => inputRef.current?.click()}
                className="editorial-btn"
              >
                {clip ? "Replace audio ↗" : "Choose audio ↗"}
              </button>
            )}
          </div>
        </div>

        {/* Progress Bar */}
        {busy && (
          <div
            className="flex items-center gap-3 font-mono text-[10px] pt-3"
            role="status"
          >
            <progress
              max="100"
              value={progress}
              aria-label="Melody extraction progress"
              className="w-24 accent-[var(--red)]"
            />
            <span>
              {progress
                ? `Finding notes · ${progress}%`
                : "Decoding your snippet…"}
            </span>
            <button
              type="button"
              onClick={() => {
                requestRef.current?.abort();
                setBusy(false);
              }}
              className="editorial-btn ml-auto py-1 px-2.5 text-xs"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Error Alert */}
        {error && (
          <p
            className="text-[var(--red-deep)] border-l-2 border-[var(--red)] pl-3 text-[16px] mt-3 mb-0"
            role="alert"
          >
            {error}
          </p>
        )}

        {/* Extracted Result Score & Waveform */}
        {clip && adapted && (
          <div
            className="mt-4 p-4 bg-[var(--paper-light)] border border-[var(--rule)]"
            aria-busy={busy}
          >
            <div className="flex items-baseline justify-between gap-4">
              <strong className="text-lg font-normal text-[var(--ink)] truncate">
                {clip.name}
              </strong>
              <span className="font-mono text-[9px] text-[var(--muted)] shrink-0">
                {clip.result.duration.toFixed(1)} SEC /{" "}
                {clip.result.motif.length} NOTES (
                {Math.round(clip.result.confidence * 100)}% CLARITY)
              </span>
            </div>

            <svg
              className="w-full h-12 block my-2.5 stroke-[var(--red)] stroke-2"
              viewBox="0 0 600 48"
              preserveAspectRatio="none"
              role="img"
              aria-label="Waveform of your recorded or uploaded audio"
            >
              <line
                x1="0"
                y1="24"
                x2="600"
                y2="24"
                stroke="var(--rule)"
                strokeWidth="0.5"
              />
              {clip.result.waveform.map((height, i) => (
                <line
                  key={i}
                  x1={i * 6 + 3}
                  x2={i * 6 + 3}
                  y1={24 - Math.max(1, height * 22)}
                  y2={24 + Math.max(1, height * 22)}
                />
              ))}
            </svg>

            <label className="flex items-center gap-4 font-mono text-[9px] text-[var(--muted)]">
              <span className="shrink-0">YOUR RECORDING</span>
              <audio
                ref={audioRef}
                src={clip.url}
                controls
                preload="metadata"
                className="w-full h-8"
              />
            </label>

            {/* 16-Step Staff Score */}
            <div
              className="motif-score-staff mt-4"
              role="img"
              aria-label={`Opening melody in ${keyRoot} ${mode}: ${adapted.motif
                .map((n) => degreeName(n, keyRoot, mode))
                .join(", ")}. Onsets: ${adapted.rhythm.join(", ")}.`}
            >
              {Array.from({ length: 16 }, (_, step) => {
                const index = adapted.rhythm.indexOf(step);
                const degree = adapted.motif[index];
                return (
                  <div
                    key={step}
                    style={
                      {
                        "--pitch-height": `${(6 - (degree ?? 3)) * 5}px`,
                      } as React.CSSProperties
                    }
                  >
                    {index >= 0 && (
                      <>
                        <i />
                        <span>{degreeName(degree, keyRoot, mode)}</span>
                      </>
                    )}
                    <small>{step % 4 === 0 ? step / 4 + 1 : ""}</small>
                  </div>
                );
              })}
            </div>

            <p className="font-mono text-[9px] text-[var(--muted)] leading-relaxed my-3">
              Adapted to {keyRoot} {mode} · one bar at {Math.round(bpm)} BPM ·
              octave-folded into each instrument’s register.
              {clip.result.detectedNotes > clip.result.motif.length
                ? ` Using ${clip.result.motif.length} of ${clip.result.detectedNotes} detected notes.`
                : ""}
            </p>

            <div className="flex flex-wrap gap-2.5">
              <button
                type="button"
                disabled={busy}
                onClick={handleApplyAdaptedClip}
                className="editorial-btn-primary flex-1"
              >
                Use as opening motif ↗
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
