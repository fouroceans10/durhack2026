// Compare complete independent instrument decisions; no combined orchestra prompt.
import assert from 'node:assert/strict';
import { createOrchestra, applyDecision, compose } from '../src/engine.ts';
import { ollamaDecider, selectNeighbours } from '../src/local-llm.ts';
import { orchestra } from '../src/orchestra.ts';
const concurrency = Number(process.argv[2] ?? 4);
assert.ok(Number.isInteger(concurrency) && concurrency >= 1 && concurrency <= 8);
const nativeFetch = globalThis.fetch;
globalThis.fetch = (url, options) => nativeFetch(String(url).replace('/api/local-llm/', 'http://127.0.0.1:11434/api/'), options);
const agents = createOrchestra().map(m => ({ ...m, beat: 16, recentNotes: [0, 4, 7].map((pitch, i) => ({ step: i * 4, midi: orchestra[m.instrument].base + pitch, duration: .3, velocity: .5 })) }));
const decide = ollamaDecider('qwen3:1.7b'), durations = [], failures = [];
let cursor = 0;
try {
  await decide({ self: agents[0], neighbours: selectNeighbours(agents[0], agents), memory: [] }, AbortSignal.timeout(60000));
  const start = performance.now();
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (cursor < agents.length) {
      const self = agents[cursor++], began = performance.now();
      try {
        const decision = await decide({ self, neighbours: selectNeighbours(self, agents), memory: [] }, AbortSignal.timeout(60000));
        const next = applyDecision(self, decision);
        assert.ok(next.decision && Array.from({ length: 16 }, (_, step) => compose({ ...next, beat: 16 + step })).flat().length);
        durations.push(performance.now() - began);
      } catch (error) { failures.push({ instrument: orchestra[self.instrument].name, error: error.message }); }
    }
  }));
  const seconds = (performance.now() - start) / 1000;
  const status = await nativeFetch('http://127.0.0.1:11434/api/ps'), { models } = await status.json();
  const model = models.find(m => m.name === 'qwen3:1.7b');
  console.log(JSON.stringify({ concurrency, instruments: agents.length, accepted: durations.length, seconds: Number(seconds.toFixed(2)),
    meanInferenceSeconds: Number((durations.reduce((sum, n) => sum + n, 0) / durations.length / 1000).toFixed(2)),
    gpuResidentPercent: model?.size ? Math.round(model.size_vram / model.size * 100) : 0, gpuMemoryGiB: Number((model?.size_vram / 1024 ** 3).toFixed(2)), failures }, null, 2));
  assert.deepEqual(failures, []);
} finally { globalThis.fetch = nativeFetch; }
