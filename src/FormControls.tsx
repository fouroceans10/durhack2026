import type { Musician } from './engine';
import { formNames, formPlans, formPosition, gestures, type FormChoice, type FormSettings, type Gesture } from './forms';
import { orchestra } from './orchestra';
import { PhraseNotation } from './PhraseNotation';

export function FormControls({ musician, disabled, peerMode, onChange }: {
  musician: Musician; disabled: boolean; peerMode: boolean; onChange: (settings: FormSettings) => void;
}) {
  const form = musician.form;
  const settings: FormSettings = { choice: form?.choice ?? 'auto', bars: form?.bars ?? 8, expression: form?.expression ?? 'auto' };
  const position = formPosition(form, musician.beat);
  const plan = form?.selected ? formPlans[form.selected] : [];
  return <section className="form-panel" aria-labelledby="form-heading">
    <div className="form-heading"><div><span className="eyebrow">THE LONGER CONVERSATION</span><h2 id="form-heading">A theme. A departure.<br /><em>A way home.</em></h2></div><p>Musicians remember their themes, move through contrasting sections, and return with something to say.</p></div>
    <div className="form-controls">
      <label>Musical form<select aria-label="Musical form" disabled={disabled} value={settings.choice} onChange={e => onChange({ ...settings, choice: e.target.value as FormChoice })}>{Object.entries(formNames).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label>Bars per section<select aria-label="Bars per section" disabled={disabled} value={settings.bars} onChange={e => onChange({ ...settings, bars: Number(e.target.value) })}>{[4, 8, 16, 32].map(n => <option key={n} value={n}>{n} bars</option>)}</select></label>
      <label>Gesture focus<select aria-label="Gesture focus" disabled={disabled} value={settings.expression} onChange={e => onChange({ ...settings, expression: e.target.value as 'auto' | Gesture })}><option value="auto">Let each agent choose</option>{gestures.map(g => <option key={g} value={g}>{g[0].toUpperCase() + g.slice(1)}</option>)}</select></label>
    </div>
    <div className="form-position" role="status"><strong>{form?.selected ? formNames[form.selected] : 'Agents will choose their forms after the opening'}</strong><span>{position.waiting ? 'Opening / listening' : `${position.movementName} · ${position.label} · bar ${position.bar}/${position.bars} · cycle ${position.cycle}`}</span></div>
    {plan.length > 0 && <ol className="form-itinerary" aria-label="Form sections">{plan.map((s, i) => <li key={i} aria-current={!position.waiting && i === position.index ? 'step' : undefined}><span>{s.movementName === 'One movement' ? String(i + 1).padStart(2, '0') : s.movementName}</span><strong>{s.label}</strong></li>)}</ol>}
    <div className="phrasing-heading"><span className="eyebrow">THE SHAPE OF A BAR / {orchestra[musician.instrument].name.toUpperCase()}</span><p>Quick runs, held notes, room to breathe. Each voice chooses its own lengths and articulation.</p></div>
    <PhraseNotation musician={musician} />
    <p className="form-footnote phrasing-help">Semiquaver = ¼ beat · quaver = ½ · crotchet = 1 · minim = 2 · semibreve = 4. Dots add half the value. Legato connects; staccato detaches. Leave gesture focus on agent choice for variety, or choose Legato / Staccato to hold that phrasing after the opening.</p>
    <p className="form-footnote">{peerMode ? 'Your local instrument' : `${orchestra[musician.instrument].name} shown; each instrument follows its own clock`}. Forms repeat while the performance runs. {disabled ? 'Pause to change the form or gesture focus.' : 'Changing these controls restarts the form from the current phrase.'} Unpitched percussion follows the section’s rhythm and energy.</p>
  </section>;
}
