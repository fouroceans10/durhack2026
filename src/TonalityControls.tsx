import type { Musician } from './engine';
import { isPitched, orchestra } from './orchestra';
import { currentKey, degreeName, homeKey, keyName, modes, modeNames, modulationNames, randomTonality, tonicNames, type Mode, type Modulation, type Tonality } from './tonality';

export function TonalityControls({ musician, disabled, peerMode, onChange }: {
  musician: Musician; disabled: boolean; peerMode: boolean; onChange: (key: Tonality, modulation: Modulation) => void;
}) {
  const home = homeKey(musician), current = currentKey(musician), policy = musician.harmony?.modulation ?? 'fixed';
  return <section className="tonality-panel" aria-labelledby="tonality-heading">
    <div className="tonality-heading"><div><span className="eyebrow">THE COLOUR OF THE CONVERSATION</span><h2 id="tonality-heading">Choose a home.<em> Let them wander.</em></h2></div><button className="outline" disabled={disabled} onClick={() => onChange(randomTonality(home), policy)}>↻ Surprise key</button></div>
    <div className="form-controls tonality-controls">
      <label>Home key<select aria-label="Home key" disabled={disabled} value={home.tonic} onChange={e => onChange({ ...home, tonic: Number(e.target.value) }, policy)}>{tonicNames.map((name, i) => <option key={i} value={i}>{name}</option>)}</select></label>
      <label>Scale / mode<select aria-label="Scale / mode" disabled={disabled} value={home.mode} onChange={e => onChange({ ...home, mode: e.target.value as Mode }, policy)}>{Object.entries(modeNames).map(([id, name]) => <option key={id} value={id}>{name[0].toUpperCase() + name.slice(1)}</option>)}</select></label>
      <label>Modulation<select aria-label="Modulation" disabled={disabled} value={policy} onChange={e => onChange(home, e.target.value as Modulation)}>{Object.entries(modulationNames).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
    </div>
    <div className="tonality-score"><ol aria-label={`Home scale: ${keyName(home)}`}>{modes[home.mode].map((_, i) => <li key={i}><small>{['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'][i]}</small>{degreeName(i, home)}</li>)}</ol><p role="status"><span>{peerMode ? 'YOUR INSTRUMENT' : orchestra[musician.instrument].name.toUpperCase()}</span><strong>{isPitched(musician.instrument) ? keyName(current) : 'Unpitched percussion'}</strong></p></div>
    <p className="form-footnote">{policy === 'form' ? 'Contrasting sections visit related keys; returning themes find their way home. Free development holds its key.' : policy === 'agent' ? 'Each local AI chooses related keys while listening to its neighbours, at most once per section. Returning themes keep their key.' : 'The chosen key stays with the music throughout the performance.'} {disabled ? 'Pause to change tonality.' : 'Changes transpose the current phrase and restart its form.'}{peerMode ? ' Controls apply to your instrument.' : ' Controls apply to all local instruments.'}</p>
  </section>;
}
