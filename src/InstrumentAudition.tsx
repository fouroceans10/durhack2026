import { useEffect, useRef, useState } from 'react';
import { AudioEngine, createMusician } from './engine';
import { orchestra, isPitched, sections } from './orchestra';
import { samplePatches } from './sample-bank';

export function InstrumentAudition({ disabled }: { disabled: boolean }) {
  const [instrument, setInstrument] = useState(0);
  const [phase, setPhase] = useState<'idle' | 'loading' | 'playing'>('idle');
  const [error, setError] = useState('');
  const player = useRef<AudioEngine | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const patch = samplePatches[instrument];

  function stop() { clearTimeout(timer.current); player.current?.close(); player.current = null; setPhase('idle'); }
  useEffect(() => { if (disabled) stop(); }, [disabled]);
  useEffect(() => () => { clearTimeout(timer.current); player.current?.close(); player.current = null; }, []);

  async function audition() {
    if (player.current) { stop(); return; }
    if (disabled) return;
    const engine = new AudioEngine(); player.current = engine;
    setPhase('loading'); setError('');
    try {
      await engine.resume();
      const result = await engine.prepare([instrument]);
      if (player.current !== engine) return;
      if (result.failed.length) setError('Some recordings could not load. Playing the available samples, with synthesized fallback if needed.');
      setPhase('playing');
      engine.master.gain.value = .65;
      const musician = createMusician(instrument), base = orchestra[instrument].base;
      const start = engine.context.currentTime + .05;
      for (const [offset, degree, duration, articulation] of [
        [0, 0, .52, 'tenuto'], [.56, 4, .12, 'staccato'], [.8, 7, .12, 'staccato'], [1.04, 4, .12, 'staccato'], [1.3, 0, 1.05, 'legato'],
      ] as const) {
        engine.note(musician, start + offset, [{ midi: base + (isPitched(instrument) ? degree : 0), duration, velocity: .75, articulation }]);
      }
      timer.current = setTimeout(stop, 2600);
    } catch {
      if (player.current === engine) { stop(); setError('Could not start this instrument. Try again.'); }
    }
  }

  return <div className="instrument-audition">
    <div className="audition-controls"><label>LISTEN CLOSELY<select aria-label="Audition instrument" disabled={disabled} value={instrument} onChange={e => { stop(); setError(''); setInstrument(Number(e.target.value)); }}>
      {sections.map(section => <optgroup label={section} key={section}>{orchestra.map((p, i) => p.section === section ? <option key={p.name} value={i}>{p.name}</option> : null)}</optgroup>)}
    </select></label><button disabled={disabled} onClick={() => void audition()}>{phase === 'loading' ? '■ Stop loading' : phase === 'playing' ? '■ Stop audition' : '▷ Hear instrument'}</button></div>
    <p role="status">{phase === 'loading' ? 'Preparing recorded sounds…' : error || (disabled ? 'Pause the orchestra to audition a voice.' : 'A held note, three short notes, then a longer phrase.')}<br /><span>{patch.source}{patch.derived ? ` · ${patch.derived}` : ' · recorded instrument samples'} · <a href="/samples/CREDITS.txt" target="_blank" rel="noreferrer">Sound credits ↗</a></span></p>
  </div>;
}
