import type { Musician } from './engine';
import { orchestra, sections, type Section } from './orchestra';

export type PartitionPlan =
  | { kind: 'mixed' | 'sections' | 'solo' }
  | { kind: 'instrument'; instrument: number }
  | { kind: 'section'; section: Section }
  | { kind: 'custom'; instruments: number[] };
export const partitionNames: Record<PartitionPlan['kind'], string> = {
  mixed: 'Two mixed groups', instrument: 'Isolate an instrument', section: 'Separate one section',
  sections: 'Each section on its own', solo: 'Every instrument on its own', custom: 'Choose two groups',
};
const validInstrument = (n: number) => Number.isInteger(n) && n >= 0 && n < orchestra.length;
export function validPartition(plan: PartitionPlan): boolean {
  switch (plan.kind) {
    case 'mixed': case 'sections': case 'solo': return true;
    case 'instrument': return validInstrument(plan.instrument);
    case 'section': return sections.includes(plan.section);
    case 'custom': return plan.instruments.length > 0 && plan.instruments.length < orchestra.length
      && plan.instruments.every(validInstrument) && new Set(plan.instruments).size === plan.instruments.length;
    default: return false;
  }
}
export function partitionGroup(plan: PartitionPlan | null, instrument: number): number {
  switch (plan?.kind) {
    case 'instrument': return instrument === plan.instrument ? 0 : 1;
    case 'section': return orchestra[instrument].section === plan.section ? 0 : 1;
    case 'sections': return sections.indexOf(orchestra[instrument].section);
    case 'solo': return instrument;
    case 'custom': return plan.instruments.includes(instrument) ? 0 : 1;
    default: return instrument % 2;
  }
}
export const groupLetter = (group: number) => String.fromCharCode(65 + group);
type Player = Pick<Musician, 'id' | 'instrument'>;
// One reachability rule is shared by scheduling, model context, map links and
// WebRTC send/receive. Group numbers received from another browser are not trusted.
export function canExchange(plan: PartitionPlan | null, a: Player, b: Player): boolean {
  return a.id !== b.id && (!plan || plan.kind !== 'solo' && partitionGroup(plan, a.instrument) === partitionGroup(plan, b.instrument));
}
export function reachableMusicians(self: Musician, candidates: Musician[], plan: PartitionPlan | null): Musician[] {
  return candidates.filter(p => canExchange(plan, self, p)).map(p => {
    const group = partitionGroup(plan, p.instrument);
    return plan && p.group !== group ? { ...p, group } : p;
  });
}
export function assignPartition(musicians: Musician[], plan: PartitionPlan | null): Musician[] {
  return musicians.map(m => ({ ...m, group: partitionGroup(plan, m.instrument) }));
}
export function partitionDescription(plan: PartitionPlan): string {
  if (plan.kind === 'instrument') return `${orchestra[plan.instrument].name} isolated from the ensemble`;
  if (plan.kind === 'section') return `${plan.section} separated from the ensemble`;
  if (plan.kind === 'custom') return `Custom groups: ${plan.instruments.length} + ${orchestra.length - plan.instruments.length} instruments`;
  return partitionNames[plan.kind];
}
