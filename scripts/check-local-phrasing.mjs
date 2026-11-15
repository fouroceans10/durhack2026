// Exercise the production adapter and real local model across successive phrases.
import assert from 'node:assert/strict';
import { applyDecision, compose, createMusician, recordPerformance, validState } from '../src/engine.ts';
import { ollamaDecider } from '../src/local-llm.ts';
import { noteValueNames } from '../src/phrasing.ts';

const nativeFetch = globalThis.fetch;
globalThis.fetch = (url, options) => nativeFetch(String(url).replace('/api/local-llm/', 'http://127.0.0.1:11434/api/'), options);
const decide = ollamaDecider('qwen3:1.7b'), values = new Set(), articulations = new Set(), patterns = new Set(), melodies = new Set();
try {
  for (const instrument of [0, 5, 12]) {
    let self = { ...createMusician(instrument), beat: 16 };
    const memory = [];
    const instrumentMelodies = new Set();
    for (let phrase = 0; phrase < 3; phrase++) {
      const neighbour = { ...createMusician(1), beat: self.beat, recentNotes: [64, 67, 69].map((midi, i) => ({ step: self.beat - 4 + i, midi, duration: .25, velocity: .5, noteValue: 2, articulation: 'staccato' })) };
      const decision = await decide({ self, neighbours: [neighbour], memory }, AbortSignal.timeout(60000));
      assert.ok(decision.variation, 'The model should choose a melodic transformation.');
      assert.equal(decision.durations.length, decision.rhythm.length);
      assert.equal(decision.articulations.length, decision.rhythm.length);
      assert.notDeepEqual(decision.rhythm, self.rhythm, 'Developing phrases must change note entrances.');
      assert.ok(memory.every(previous => previous.rhythm.join() !== decision.rhythm.join()), 'Do not recycle recent rhythmic patterns.');
      self = applyDecision(self, decision); assert.ok(self.decision);
      const byStep = Array.from({ length: 16 }, (_, i) => compose({ ...self, beat: self.beat + i }));
      assert.deepEqual(byStep.flatMap((notes, i) => notes.length ? [i] : []), decision.rhythm, 'Chosen entrances must reach playback.');
      const notes = byStep.flat();
      assert.ok(notes.length > 0); assert.ok(validState(recordPerformance(self, notes, true)));
      decision.durations.forEach(v => values.add(v)); notes.forEach(n => articulations.add(n.articulation)); patterns.add(decision.rhythm.join());
      instrumentMelodies.add(decision.motif.join()); melodies.add(decision.motif.join());
      console.log(JSON.stringify({ instrument, phrase, motif: decision.motif, variation: decision.variation, rhythm: decision.rhythm, durations: decision.durations, articulation: decision.articulations, gesture: decision.gesture, reason: decision.reason }));
      memory.push(decision); self = { ...self, beat: self.beat + 16 };
    }
    assert.ok(instrumentMelodies.size >= 2, 'Each instrument should vary its pitches, not only rhythm and articulation.');
  }
  assert.ok(values.has(1) && values.has(2) && [...values].some(v => v >= 4), 'The model should try short and held note values.');
  assert.ok(articulations.size >= 2 && patterns.size >= 3, 'Successive real decisions should vary rhythm and articulation.');
  console.log(JSON.stringify({ noteValues: [...values].map(v => noteValueNames[v]), articulations: [...articulations], distinctRhythms: patterns.size, distinctMelodies: melodies.size }));
} finally { globalThis.fetch = nativeFetch; }
