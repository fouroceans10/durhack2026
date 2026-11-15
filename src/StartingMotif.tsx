import { useEffect, useRef, useState } from 'react';
import { AudioEngine, compose, configureHarmony, createMusician, seedMusician } from './engine';
import { analyseAudio } from './motif-upload';
import { recordingError, startVoiceRecording, type VoiceRecording } from './motif-recording';
import { RecordingWaveform } from './RecordingWaveform';
import { adaptMotif, type ExtractedMotif } from './motif-extraction';
import { degreeName, keyName, type Tonality } from './tonality';
import type { StartingMotif as Phrase } from './melody';

export function StartingMotif({ disabled, peerMode, activeName, onApply, randomPhrase, onGenerate, tonality }: {
  disabled: boolean; peerMode: boolean; activeName: string | null;
  onApply: (phrase: Phrase | null, name: string | null) => void;
  randomPhrase: Phrase; onGenerate: () => void; tonality: Tonality;
}) {
  const [clip, setClip] = useState<{ name: string; url: string; result: ExtractedMotif } | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [previewing, setPreviewing] = useState<'random' | 'audio' | null>(null);
  const [recordingState, setRecordingState] = useState<'idle' | 'requesting' | 'recording' | 'stopping'>('idle');
  const [recordedSeconds, setRecordedSeconds] = useState(0);
  const [recordingStream, setRecordingStream] = useState<MediaStream | null>(null);
  const recordingRequest = useRef<AbortController | null>(null);
  const recording = useRef<VoiceRecording | null>(null);
  const recordingActive = recordingState !== 'idle';
  const request = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  const original = useRef<HTMLAudioElement | null>(null);
  const preview = useRef<AudioEngine | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const adapted = clip ? adaptMotif(clip.result, tonality) : null;

  function stopPreview() {
    clearTimeout(timer.current); preview.current?.close(); preview.current = null; setPreviewing(null);
  }
  useEffect(() => () => { request.current?.abort(); recordingRequest.current?.abort(); clearTimeout(timer.current); preview.current?.close(); }, []);
  useEffect(() => () => { if (clip) URL.revokeObjectURL(clip.url); }, [clip]);
  useEffect(() => { if (disabled) { stopPreview(); original.current?.pause(); cancelRecording(); request.current?.abort(); setBusy(false); } }, [disabled]);
  useEffect(() => { stopPreview(); }, [tonality.tonic, tonality.mode]);

  async function load(file: File) {
    if (disabled || recordingRequest.current) return;
    request.current?.abort(); stopPreview(); original.current?.pause();
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError(''); setProgress(0);
    try {
      const result = await analyseAudio(file, controller.signal, value => {
        if (!controller.signal.aborted) setProgress(value);
      }, tonality);
      if (controller.signal.aborted) return;
      setClip({ name: file.name, url: URL.createObjectURL(file), result });
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Could not read this audio.');
    } finally { if (!controller.signal.aborted) setBusy(false); }
  }

  function cancelRecording() {
    recordingRequest.current?.abort(); recordingRequest.current = null;
    recording.current = null; setRecordingStream(null); setRecordingState('idle'); setRecordedSeconds(0);
  }

  async function recordVoice() {
    if (disabled || busy || recordingRequest.current) return;
    stopPreview(); original.current?.pause(); setError(''); setRecordedSeconds(0);
    const controller = new AbortController(); recordingRequest.current = controller;
    setRecordingState('requesting');
    try {
      const capture = await startVoiceRecording(controller.signal, seconds => {
        if (!controller.signal.aborted) setRecordedSeconds(seconds);
      });
      if (!controller.signal.aborted) { recording.current = capture; setRecordingStream(capture.stream); setRecordingState('recording'); }
      const file = await capture.result;
      if (controller.signal.aborted) return;
      recordingRequest.current = null; recording.current = null; setRecordingStream(null); setRecordingState('idle');
      await load(file);
    } catch (failure) {
      if (!controller.signal.aborted) setError(recordingError(failure));
    } finally {
      if (recordingRequest.current === controller) {
        recordingRequest.current = null; recording.current = null; setRecordingStream(null); setRecordingState('idle');
      }
    }
  }

  async function playPreview(phrase: Phrase, source: 'random' | 'audio') {
    if (preview.current) { stopPreview(); if (previewing === source) return; }
    if (disabled || recordingRequest.current) return;
    original.current?.pause(); setError('');
    const engine = new AudioEngine(); preview.current = engine;
    setPreviewing(source);
    try {
      await engine.resume();
      const sounds = await engine.prepare([23]);
      if (preview.current !== engine) return;
      if (sounds.failed.length) setError('Some harp samples could not load. Preview uses available recordings or synthesized fallback.');
      const musician = seedMusician(configureHarmony(createMusician(23), tonality, 'fixed'), phrase);
      const start = engine.context.currentTime + .05;
      for (let beat = 0; beat < 16; beat++) {
        const at = { ...musician, beat };
        engine.note(at, start + beat * 60 / 112 / 4, compose(at));
      }
      timer.current = setTimeout(stopPreview, (16 * 60 / 112 / 4 + 1) * 1000);
    } catch { if (preview.current === engine) { stopPreview(); setError('Preview audio could not start. Please try again.'); } }
  }

  return <section className="motif-panel" aria-labelledby="motif-heading">
    <div className="motif-intro">
      <span className="eyebrow">PRELUDE / A PHRASE OF YOUR OWN</span>
      <h2 id="motif-heading">You give the spark.<br /><em>They take it from here.</em></h2>
      <p>Let chance write the opening, or offer a melody of your own. Two bars together, then each musician finds a way forward.</p>
      <p className="motif-local">↳ Audio stays in this browser.</p>
      {activeName && <p className="motif-active" role="status"><span>OPENING MOTIF</span><strong>{activeName}</strong></p>}
    </div>
    <div className="motif-workbench">
      <div className="random-motif">
        <div className="random-motif-heading"><span className="eyebrow">LET CHANCE BEGIN</span><span>01 / GENERATED</span></div>
        <p>A fresh phrase, every time.</p>
        <div className="random-motif-notes" aria-label={`Generated melody in ${keyName(tonality)}: ${randomPhrase.motif.map(n => degreeName(n, tonality)).join(', ')}. Onsets: ${randomPhrase.rhythm.join(', ')}.`}>
          {randomPhrase.motif.map((note, i) => <span key={i}>{degreeName(note, tonality)}<small>{randomPhrase.rhythm[i] + 1}</small></span>)}
        </div>
        <div className="motif-actions"><button disabled={disabled || busy || recordingActive} onClick={() => void playPreview(randomPhrase, 'random')}>{previewing === 'random' ? '■ Stop random preview' : '▷ Hear random motif'}</button><button className="primary" disabled={disabled || busy || recordingActive} onClick={() => {
          stopPreview(); original.current?.pause(); onGenerate();
        }}>↻ Generate a new motif</button></div>
        <p className="motif-adaptation">A new opening is ready on each visit. Generate another to begin a fresh performance; pausing keeps your place.</p>
      </div>
      <p className="motif-alternative">02 / OR BEGIN WITH A RECORDING</p>
      <div className={`motif-drop ${dragging ? 'is-dragging' : ''}`} onDragOver={event => {
        event.preventDefault(); if (!disabled && !recordingActive) setDragging(true);
      }} onDragLeave={() => setDragging(false)} onDrop={event => {
        event.preventDefault(); setDragging(false);
        const file = event.dataTransfer.files[0]; if (file) void load(file);
      }}>
        <div><span className="motif-drop-mark" aria-hidden="true">♪</span><strong>{busy ? 'Listening for a melody…' : clip ? 'Try another beginning.' : 'Drop a little music here.'}</strong><span>MP3, WAV or other browser-supported audio · 30 sec / 15 MB max</span></div>
        <input ref={input} type="file" accept="audio/*,.mp3,.wav,.ogg,.flac,.m4a" aria-label="Upload starting motif" disabled={disabled || recordingActive} onChange={event => {
          const file = event.target.files?.[0]; event.target.value = ''; if (file) void load(file);
        }} />
        <button className="outline" disabled={disabled || recordingActive} onClick={() => input.current?.click()}>{clip ? 'Replace audio ↗' : 'Choose audio ↗'}</button>
      </div>
      <div className="motif-recording">
        <div><strong>Sing your own beginning.</strong><p>Sing or hum a short melody · up to 30 seconds.</p>
          <span role="status">{recordingState === 'requesting' ? 'Allow microphone access in your browser…' : recordingState === 'recording' ? 'Recording your voice…' : recordingState === 'stopping' ? 'Finishing your recording…' : 'Record, listen, then choose your opening.'}</span>
          {recordingActive && <span className="recording-time" role="timer" aria-label="Recording time">{Math.floor(recordedSeconds)} / 30 sec</span>}
        </div>
        <div className="motif-recording-actions">
          {recordingState === 'idle' ? <button disabled={disabled || busy} onClick={() => void recordVoice()}>● Record my voice</button>
            : <>{recordingState === 'recording' && <button className="primary" onClick={() => { setRecordingState('stopping'); recording.current?.stop(); }}>■ Stop recording</button>}<button onClick={cancelRecording}>Cancel recording</button></>}
        </div>
      </div>
      {recordingState === 'recording' && recordingStream && <RecordingWaveform stream={recordingStream} />}
      {busy && <div className="motif-progress" role="status"><progress max="100" value={progress} aria-label="Melody extraction progress" /><span>{progress ? `Finding notes · ${progress}%` : 'Decoding your snippet…'}</span><button onClick={() => { request.current?.abort(); setBusy(false); }}>Cancel</button></div>}
      {error && <p className="motif-error" role="alert">{error}</p>}
      {clip && adapted && <div className="motif-result" aria-busy={busy}>
        <div className="motif-file"><strong>{clip.name}</strong><span>{clip.result.duration.toFixed(1)} SEC / {clip.result.motif.length} NOTES</span></div>
        <svg className="motif-waveform" viewBox="0 0 600 48" preserveAspectRatio="none" role="img" aria-label="Waveform of your audio">
          <line x1="0" y1="24" x2="600" y2="24" />
          {clip.result.waveform.map((height, i) => <line key={i} x1={i * 6 + 3} x2={i * 6 + 3} y1={24 - Math.max(1, height * 22)} y2={24 + Math.max(1, height * 22)} />)}
        </svg>
        <label className="motif-original">YOUR RECORDING<audio ref={original} src={clip.url} controls preload="metadata" onPlay={() => { stopPreview(); if (disabled || recordingActive) original.current?.pause(); }} /></label>
        <div className="motif-score" role="img" aria-label={`Opening melody in ${keyName(tonality)}: ${adapted.motif.map(n => degreeName(n, tonality)).join(', ')}. Onsets: ${adapted.rhythm.join(', ')}.`}>
          {Array.from({ length: 16 }, (_, step) => {
            const index = adapted.rhythm.indexOf(step), degree = adapted.motif[index];
            return <div key={step} className={index >= 0 ? 'motif-pitch' : ''} style={{ '--pitch-height': `${(6 - (degree ?? 3)) * 5}px` } as React.CSSProperties}>{index >= 0 && <><i /><span>{degreeName(degree, tonality)}</span></>}<small>{step % 4 === 0 ? step / 4 + 1 : ''}</small></div>;
          })}
        </div>
        <p className="motif-adaptation">Adapted to {keyName(tonality)} · one bar at 112 BPM · octave-folded into each instrument’s register.{clip.result.detectedNotes > clip.result.motif.length ? ` Using ${clip.result.motif.length} of ${clip.result.detectedNotes} detected notes.` : ''}</p>
        <div className="motif-actions"><button disabled={disabled || busy || recordingActive} onClick={() => void playPreview(adapted, 'audio')}>{previewing === 'audio' ? '■ Stop preview' : '▷ Hear the motif'}</button><button className="primary" disabled={disabled || busy || recordingActive} onClick={() => {
          stopPreview(); original.current?.pause(); onApply(adapted, clip.name);
        }}>Use as opening ↗</button></div>
      </div>}
      <div className="motif-help"><p>{disabled ? 'Pause the performance to change its opening.' : 'A clear solo melody, humming or whistle works best. Dense mixes may need a cleaner excerpt.'}{peerMode ? ' In peer mode, this seeds your local instrument; others hear its notes as you play.' : ''}</p></div>
    </div>
  </section>;
}
