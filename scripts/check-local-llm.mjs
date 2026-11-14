// Optional integration check against local Ollama. test:gpu also requires GPU residency.
import assert from 'node:assert/strict';
import { createMusician, applyDecision, compose } from '../src/engine.ts';
import { buildMessages, responseSchema, realizeStrategy } from '../src/local-llm.ts';
import { validStrategy } from '../src/melody.ts';
const requireGpu = process.argv.includes('--require-gpu');
const self = { ...createMusician(0), beat: 16 };
const neighbour = { ...createMusician(5), beat: 16, recentNotes: [{ step: 0, midi: 76, duration: .4, velocity: .5 }, { step: 4, midi: 79, duration: .4, velocity: .5 }, { step: 8, midi: 81, duration: .4, velocity: .5 }] };
const response = await fetch('http://127.0.0.1:11434/api/chat', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(60000),
  body: JSON.stringify({ model: 'qwen3:1.7b', messages: buildMessages({ self, neighbours: [neighbour], memory: [] }), stream: false, think: false, keep_alive: '10m', format: responseSchema({ self, neighbours: [neighbour], memory: [] }), options: { temperature: .55, num_ctx: 4096, num_predict: 512 } }),
});
assert.ok(response.ok, `Ollama returned ${response.status}`);
const result = await response.json();
const strategy = JSON.parse(result.message.content);
assert.ok(validStrategy(strategy), `Invalid musical strategy: ${JSON.stringify(strategy)}`);
const decision = realizeStrategy({ self, neighbours: [neighbour], memory: [] }, strategy);
const next = applyDecision(self, decision);
assert.deepEqual(next.motif, decision.motif);
assert.notDeepEqual(next.motif, self.motif, 'The model must actually change the melody.');
assert.equal(decision.respondTo, 'Flute');
assert.ok(Array.from({length: 16}, (_, step) => compose({...next, beat: 16 + step})).flat().length > 0);
const changedNeighbour = { ...neighbour, recentNotes: neighbour.recentNotes.map((note, i) => ({ ...note, midi: [77, 81, 83][i] })) };
const changedDecision = realizeStrategy({ self, neighbours: [changedNeighbour], memory: [] }, strategy);
assert.notDeepEqual(changedDecision.motif, decision.motif, 'The same model strategy must respond to different heard notes.');
const status = await fetch('http://127.0.0.1:11434/api/ps', { signal: AbortSignal.timeout(5000) });
assert.ok(status.ok, `Ollama status returned ${status.status}`);
const { models } = await status.json();
const loaded = models.find(model => model.name === result.model || model.model === result.model);
assert.ok(loaded, 'The tested model should still be loaded.');
if (requireGpu) assert.ok(loaded.size_vram > 0, 'Inference used the CPU. Check your GPU driver and Ollama GPU backend, then restart npm run llm:serve.');
console.log(JSON.stringify({
  changedNeighbourMotif: changedDecision.motif,
  model: result.model,
  seconds: Number((result.total_duration / 1e9).toFixed(2)),
  generationTokensPerSecond: result.eval_duration > 0 ? Number((result.eval_count / (result.eval_duration / 1e9)).toFixed(1)) : null,
  gpuMemoryGiB: Number(((loaded.size_vram || 0) / 1024 ** 3).toFixed(2)),
  gpuResidentPercent: loaded.size > 0 ? Math.round((loaded.size_vram || 0) / loaded.size * 100) : 0,
  decision,
}, null, 2));
