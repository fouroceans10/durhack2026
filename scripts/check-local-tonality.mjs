// Real local inference in non-C keys, including an explicitly requested modulation.
import assert from 'node:assert/strict';
import { applyDecision, compose, configureHarmony, createMusician } from '../src/engine.ts';
import { buildMessages, responseSchema, realizeStrategy } from '../src/local-llm.ts';
import { currentKey, keyName, modes } from '../src/tonality.ts';
import { validDecision } from '../src/melody.ts';

for (const [key, policy, requestedChange] of [
  [{ tonic: 6, mode: 'major' }, 'fixed'],
  [{ tonic: 3, mode: 'dorian' }, 'agent'],
  [{ tonic: 2, mode: 'minor' }, 'agent', 'relative'],
]) {
  const self = { ...configureHarmony(createMusician(0), key, policy), beat: 16 };
  const neighbour = { ...configureHarmony(createMusician(5), { tonic: 6, mode: 'major' }, 'fixed'), beat: 16,
    recentNotes: [78, 82, 85].map((midi, i) => ({ midi, step: i * 4, duration: .4, velocity: .5 })) };
  const context = { self, neighbours: [neighbour], memory: [] }, format = responseSchema(context), messages = buildMessages(context);
  if (requestedChange) {
    format.properties.keyChange.enum = [requestedChange];
    messages[1].content += `\nFor this playback check, choose keyChange=${requestedChange}.`;
  }
  const response = await fetch('http://127.0.0.1:11434/api/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(60000),
    body: JSON.stringify({ model: 'qwen3:1.7b', messages, format, think: false, stream: false,
      keep_alive: '10m', options: { num_ctx: 4096, num_predict: 512, temperature: .55 } }),
  });
  assert.ok(response.ok);
  const result = await response.json(), strategy = JSON.parse(result.message.content);
  assert.ok(format.properties.keyChange.enum.includes(strategy.keyChange));
  const decision = realizeStrategy(context, strategy); assert.ok(validDecision(decision));
  const next = applyDecision(self, decision), finalKey = currentKey(next);
  assert.notEqual(next, self); assert.deepEqual(finalKey, decision.tonality);
  const notes = Array.from({ length: 16 }, (_, i) => compose({ ...next, beat: 16 + i })).flat();
  assert.ok(notes.length > 0 && notes.every(n => modes[finalKey.mode].some(interval => (finalKey.tonic + interval) % 12 === n.midi % 12)));
  console.log(JSON.stringify({ from: keyName(key), to: keyName(finalKey), requestedChange, strategy, pitches: [...new Set(notes.map(n => n.midi))], seconds: Number((result.total_duration / 1e9).toFixed(2)) }));
}
