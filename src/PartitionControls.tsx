import { useState } from 'react';
import { orchestra, sections, type Section } from './orchestra';
import { groupLetter, partitionDescription, partitionGroup, partitionNames, validPartition, type PartitionPlan } from './partitions';

export function PartitionControls({ active, peerMode, localInstrument, onApply, onReconnect }: {
  active: PartitionPlan | null; peerMode: boolean; localInstrument: number;
  onApply: (plan: PartitionPlan) => void; onReconnect: () => void;
}) {
  const [kind, setKind] = useState<PartitionPlan['kind']>(peerMode ? 'solo' : 'mixed');
  const [instrument, setInstrument] = useState(localInstrument);
  const [section, setSection] = useState<Section>('Strings');
  const [selected, setSelected] = useState<number[]>([0]);
  const plan: PartitionPlan = kind === 'instrument' ? { kind, instrument } : kind === 'section' ? { kind, section }
    : kind === 'custom' ? { kind, instruments: selected } : { kind };
  const groups = new Map<number, number[]>();
  orchestra.forEach((_, i) => {
    const group = partitionGroup(plan, i);
    groups.set(group, [...groups.get(group) ?? [], i]);
  });
  const unchanged = JSON.stringify(active) === JSON.stringify(plan);
  return <article className={`experiment ${active ? 'is-partitioned' : ''}`}>
    <div className="experiment-top"><span className="eyebrow">AN INVITATION TO INTERRUPT</span><span aria-hidden="true">↯</span></div>
    <h2>What if the<br /><em>network breaks?</em></h2>
    <p>{peerMode ? `Choose who ${orchestra[localInstrument].name} can exchange ideas with. Only this browser’s connections are affected.` : 'Separate a voice, a section or the whole ensemble. Each group keeps composing from what it can hear.'}</p>
    <div className="partition-controls">
      <label>Partition preset<select aria-label="Partition preset" value={kind} onChange={e => setKind(e.target.value as PartitionPlan['kind'])}>
        {Object.entries(partitionNames).map(([value, label]) => <option key={value} value={value}>{peerMode && value === 'solo' ? 'Isolate this browser' : label}</option>)}
      </select></label>
      {kind === 'instrument' && <label>Instrument to isolate<select aria-label="Instrument to isolate" value={instrument} onChange={e => setInstrument(Number(e.target.value))}>
        {sections.map(s => <optgroup key={s} label={s}>{orchestra.map((p, i) => p.section === s ? <option key={i} value={i}>{p.name}</option> : null)}</optgroup>)}
      </select></label>}
      {kind === 'section' && <label>Section to separate<select aria-label="Section to separate" value={section} onChange={e => setSection(e.target.value as Section)}>
        {sections.map(s => <option key={s}>{s}</option>)}
      </select></label>}
      {kind === 'custom' && <fieldset className="partition-members"><legend>Group A · choose instruments</legend>
        <p>Unchecked instruments form group B.</p>
        {sections.map(s => <div key={s}><span className="partition-section-name">{s}</span>{orchestra.map((p, i) => p.section === s ? <label key={i}>
          <input type="checkbox" checked={selected.includes(i)} onChange={e => setSelected(previous => e.target.checked ? [...previous, i].sort((a, b) => a - b) : previous.filter(n => n !== i))} />{p.name}
        </label> : null)}</div>)}
      </fieldset>}
    </div>
    <div className="partition-preview" aria-label="Partition preview">
      <span className="eyebrow">{peerMode ? 'CONNECTION PREVIEW' : 'GROUP PREVIEW'}</span>
      {peerMode ? <p>{kind === 'solo' ? 'This musician will compose without receiving or sending musical ideas.' : `This browser will only exchange ideas with instruments in group ${groupLetter(partitionGroup(plan, localInstrument))}. Other devices keep their own settings.`}</p>
        : kind === 'solo' ? <p>26 solo musicians · no shared ideas.</p>
          : <ul>{[...groups].sort(([a], [b]) => a - b).map(([group, members]) => <li key={group} title={members.map(i => orchestra[i].name).join(', ')}><b>{groupLetter(group)}</b><span>{kind === 'sections' ? sections[group] : kind === 'instrument' && group === 0 ? orchestra[instrument].name : kind === 'section' && group === 0 ? section : `Group ${groupLetter(group)}`}</span><strong>{members.length}</strong></li>)}</ul>}
      {!validPartition(plan) && <p role="alert">Choose at least one instrument for each group.</p>}
    </div>
    <div className="partition-actions">
      <button className="outline" disabled={!validPartition(plan) || unchanged} onClick={() => onApply(plan)}>{unchanged ? 'Partition applied' : active ? 'Update partition' : 'Apply partition'}</button>
      {active && <button className="primary" onClick={onReconnect}>↔ Reconnect musicians</button>}
    </div>
    <p className="hint" role="status">{active ? `Active: ${peerMode && active.kind === 'solo' ? 'This browser is isolated' : partitionDescription(active)}. Music continues; partitioning does not mute it.` : 'Connected. Preview a split, then apply it—even while playing.'}</p>
  </article>;
}
