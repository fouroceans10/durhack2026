// Real-model checks for form awareness, constrained gestures, and playable decisions.
import assert from 'node:assert/strict';
import { advanceForm, applyDecision, compose, configureForm, createMusician } from '../src/engine.ts';
import { buildMessages, responseSchema, realizeStrategy } from '../src/local-llm.ts';
import { formPosition } from '../src/forms.ts';
import { validStrategy, validDecision } from '../src/melody.ts';

for (const [choice, sectionBeat, expression] of [['aba', 128, 'mordent'], ['pop', 320, 'arpeggio'], ['classical', 320, 'legato'], ['auto', 0, 'auto']]) {
  let self = configureForm(createMusician(0), { choice, bars: 4, expression });
  self = advanceForm(self);
  self = { ...advanceForm({ ...self, beat: sectionBeat }), beat: sectionBeat + 16 };
  const neighbour = { ...createMusician(5), beat: self.beat, recentNotes: [76, 79, 81].map((midi, i) => ({ step: self.beat - 4 + i, midi, duration: .3, velocity: .5 })) };
  const context = { self, neighbours: [neighbour], memory: [] };
  const response = await fetch('http://127.0.0.1:11434/api/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(60000),
    body: JSON.stringify({ model: 'qwen3:1.7b', messages: buildMessages(context), format: responseSchema(context),
      think: false, stream: false, keep_alive: '10m', options: { num_ctx: 4096, num_predict: 512, temperature: .55 } }),
  });
  assert.ok(response.ok, `Ollama returned ${response.status}`);
  const result = await response.json(), strategy = JSON.parse(result.message.content);
  assert.ok(validStrategy(strategy)); assert.ok(strategy.form && strategy.gesture && strategy.themeAction);
  if (choice !== 'auto') assert.equal(strategy.form, choice);
  if (expression !== 'auto') assert.equal(strategy.gesture, expression);
  const decision = realizeStrategy(context, strategy); assert.ok(validDecision(decision));
  const next = applyDecision(self, decision);
  assert.equal(next.form.selected, strategy.form);
  const notes = Array.from({ length: 16 }, (_, step) => compose({ ...next, beat: self.beat + step })).flat();
  assert.ok(notes.length > 0 && notes.every(n => Number.isFinite(n.midi)));
  if (expression === 'mordent' || expression === 'arpeggio') assert.ok(notes.some(n => n.offset > 0));
  console.log(JSON.stringify({ requested: choice, movement: formPosition(self.form, self.beat).movementName,
    section: formPosition(self.form, self.beat).label, strategy, notes: notes.length, seconds: Number((result.total_duration / 1e9).toFixed(2)) }));
}
