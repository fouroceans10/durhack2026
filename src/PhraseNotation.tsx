import { musicianPhrasing, type Musician } from './engine';
import { noteValueNames, onsetGap, type NoteValue } from './phrasing';

function NoteMark({ value }: { value: NoteValue }) {
  const dotted = [3, 6, 12].includes(value);
  return <svg viewBox="0 0 38 44" aria-hidden="true"><ellipse cx="13" cy="31" rx="7" ry="4.5" transform="rotate(-20 13 31)" fill={value >= 8 ? 'none' : 'currentColor'} stroke="currentColor" strokeWidth="1.6" />
    {value < 16 && <path d="M19 30V5" fill="none" stroke="currentColor" strokeWidth="1.6" />}
    {value <= 3 && <path d="M19 5Q34 12 24 21Q29 13 19 12Z" fill="currentColor" />}
    {value === 1 && <path d="M19 13Q34 20 24 29Q29 21 19 20Z" fill="currentColor" />}
    {dotted && <circle cx="31" cy="30" r="1.8" />}
  </svg>;
}

export function PhraseNotation({ musician }: { musician: Musician }) {
  const phrase = musicianPhrasing(musician);
  return <ol className="phrase-notation" aria-label="Note values and phrasing for this bar">
    {phrase.rhythm[0] > 0 && <li className="phrase-leading-rest"><span className="phrase-count">1</span><strong>{phrase.rhythm[0] / 4} beat rest</strong><small>Breathe</small></li>}
    {phrase.rhythm.map((step, i) => {
      const value = phrase.durations[i], articulation = phrase.articulations[i], rest = onsetGap(phrase.rhythm, i) - value;
      return <li key={step} data-articulation={articulation} title={`Step ${step}: ${noteValueNames[value]}, ${articulation}${rest ? `, then ${rest / 4} beat rest` : ''}`}>
        <span className="phrase-count">{Math.floor(step / 4) + 1}{['', 'e', '&', 'a'][step % 4]}</span>
        <NoteMark value={value} /><strong>{noteValueNames[value]}</strong><small>{articulation === 'normal' ? 'Ordinary' : articulation}</small>
        {rest > 0 && <span className="phrase-rest">{rest / 4} beat rest</span>}
      </li>;
    })}
  </ol>;
}
