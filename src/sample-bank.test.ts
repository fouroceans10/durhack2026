import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { SampleBank, chooseSample, sampleDefinitions, samplePatches } from './sample-bank';
import { orchestra, isPitched } from './orchestra';

test('every instrument has bundled, traceable audio; WAV loops join the held body without reattacking', () => {
  const provenance = JSON.parse(readFileSync(new URL('../public/samples/provenance.json', import.meta.url), 'utf8'));
  assert.deepEqual(samplePatches.map(p => p.name), orchestra.map(p => p.name));
  for (const patch of samplePatches) {
    assert.ok(patch.samples.length);
    assert.ok(patch.samples.every(id => sampleDefinitions[id]));
  }
  for (const [id, sample] of Object.entries(sampleDefinitions)) {
    const bytes = readFileSync(new URL(`../public/samples/${sample.file}`, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), provenance.samples[id].sha256, sample.file);
    assert.ok(bytes.length > 1000 && Number.isInteger(sample.root));
    if (!sample.file.endsWith('.wav')) continue;
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.readUInt16LE(22), 1, 'PCM mono; seating supplies stereo positioning');
    assert.equal(bytes.readUInt32LE(24), 44100);
    assert.equal(bytes.readUInt16LE(34), 16);
    assert.equal(bytes.toString('ascii', 36, 40), 'data');
    const frames = bytes.readUInt32LE(40) / 2;
    let peak = 0;
    for (let i = 0; i < frames; i++) peak = Math.max(peak, Math.abs(bytes.readInt16LE(44 + i * 2)));
    assert.ok(peak > 1000 && peak <= 29491, `${id}: audible and below clipping`);
    if (sample.loop) {
      const [start, end] = sample.loop.map(n => Math.round(n * 44100));
      assert.ok(start > 10000 && end > start + 10000 && end < frames);
      assert.equal(bytes.readInt16LE(44 + (end - 1) * 2), bytes.readInt16LE(44 + (start - 1) * 2), `${id}: crossfade reaches the same phase at the loop boundary`);
    }
  }
});

test('pitch is preserved across keys and ornaments, short takes are used for staccato, and unpitched hits do not transpose', () => {
  const available = new Set(Object.keys(sampleDefinitions));
  samplePatches.forEach((patch, instrument) => {
    for (let midi = orchestra[instrument].base - 2; midi <= orchestra[instrument].base + 32; midi++) {
      const note = { midi, duration: .5, velocity: .6, articulation: 'tenuto' as const };
      const result = chooseSample(patch, note, available)!;
      assert.ok(result);
      assert.equal(result.sample.style, 'sustain');
      if (isPitched(instrument)) assert.ok(Math.abs(result.sample.root + 12 * Math.log2(result.rate) - midi) < 1e-8);
      else assert.equal(result.rate, 1);
      const short = chooseSample(patch, { ...note, articulation: 'staccato' }, available)!;
      if (patch.samples.some(id => sampleDefinitions[id].style === 'short')) assert.equal(short.sample.style, 'short');
    }
  });
  const snare = samplePatches[18], hit = { midi: 48, duration: .2, velocity: .6 };
  assert.notEqual(chooseSample(snare, hit, available, 0)!.id, chooseSample(snare, hit, available, 1)!.id);
  assert.equal(chooseSample(snare, hit, available, 0)!.id, chooseSample(snare, hit, available, 2)!.id);
  assert.equal(chooseSample(snare, hit, new Set()), undefined);
});

function fakeContext() {
  const calls: { source: any; gain: any }[] = [];
  let source: any;
  return {
    calls,
    async decodeAudioData() { return { length: 44100, duration: 1 } as AudioBuffer; },
    createBufferSource() {
      source = { playbackRate: { setValueAtTime(value: number) { source.rate = value; } }, connect() {}, disconnect() { source.disconnected = true; }, start(time: number) { source.startTime = time; }, stop(time: number) { source.stopTime = time; } };
      return source;
    },
    createGain() {
      const gain = { events: [] as number[][], gain: { setValueAtTime(value: number, time: number) { gain.events.push([value, time]); }, linearRampToValueAtTime(value: number, time: number) { gain.events.push([value, time]); } }, connect() {}, disconnect() { gain.disconnected = true; }, disconnected: false };
      calls.push({ source, gain }); return gain;
    },
  };
}

test('loading is bounded, decoded samples survive pause/resume, and playback respects duration/velocity and disposes nodes', async t => {
  let pending = 0, peak = 0, requests = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    requests++; pending++; peak = Math.max(peak, pending);
    await new Promise(resolve => setTimeout(resolve, 2)); pending--;
    return new Response(new ArrayBuffer(8));
  });
  const context = fakeContext(), bank = new SampleBank(context as unknown as BaseAudioContext), progress: number[] = [];
  const result = await bank.load([0], p => progress.push(p.loaded));
  assert.deepEqual(result.failed, []);
  assert.equal(result.loaded, samplePatches[0].samples.length);
  assert.ok(peak <= 6 && peak > 1);
  assert.equal(progress.at(-1), result.total);
  const note = { midi: 76, duration: .2, velocity: .7, articulation: 'staccato' as const };
  assert.equal(bank.play(0, note, 10, {} as AudioNode, .05), true);
  const { source, gain } = context.calls[0];
  assert.equal(source.startTime, 10);
  assert.ok(Math.abs(source.stopTime - 10.205) < 1e-9);
  assert.deepEqual(gain.events.at(-1), [0, 10.2]);
  assert.ok(Math.abs(gain.events[1][0] - .05 * 3 * .7) < 1e-9);
  assert.equal(source.loop, undefined, 'short samples must not loop');
  source.onended(); assert.equal(source.disconnected, true); assert.equal(gain.disconnected, true);
  bank.close(); assert.equal(bank.play(0, note, 11, {} as AudioNode, .05), false);
  const before = requests, resumed = new SampleBank(context as unknown as BaseAudioContext);
  assert.deepEqual((await resumed.load([0])).failed, []);
  assert.equal(requests, before, 'a new audio context reuses successful decodes');
  resumed.play(0, { ...note, duration: 4, articulation: 'legato' }, 20, {} as AudioNode, .05);
  assert.equal(context.calls.at(-1)!.source.loop, true);
  assert.deepEqual(context.calls.at(-1)!.gain.events.at(-1), [0, 24]);
  resumed.close();
});

test('failed files are reported, partial patches stay playable, and retries replace fallback', async t => {
  const context = fakeContext(), patch = samplePatches[21];
  const missing = sampleDefinitions[patch.samples[0]].file;
  let fail = true;
  t.mock.method(globalThis, 'fetch', async (url: string) => new Response(new ArrayBuffer(8), { status: fail && url.endsWith(missing) ? 404 : 200 }));
  const bank = new SampleBank(context as unknown as BaseAudioContext);
  assert.deepEqual((await bank.load([21])).failed, ['Triangle']);
  assert.equal(bank.play(21, { midi: 100, duration: .2, velocity: .8 }, 0, {} as AudioNode, .1), true);
  assert.equal(bank.play(22, { midi: 100, duration: .2, velocity: .8 }, 0, {} as AudioNode, .1), false);
  fail = false;
  const retry = await bank.load([21]);
  assert.deepEqual(retry.failed, []); assert.equal(retry.loaded, patch.samples.length);
  bank.close();
});

test('closing during loading cancels pending fetches and prevents delayed playback', async t => {
  let started = 0, cancelled = 0;
  t.mock.method(globalThis, 'fetch', (_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
    started++;
    options.signal!.addEventListener('abort', () => { cancelled++; reject(new DOMException('Cancelled', 'AbortError')); }, { once: true });
  }));
  const bank = new SampleBank(fakeContext() as unknown as BaseAudioContext);
  const loading = bank.load([18]);
  assert.equal(started, 2);
  bank.close();
  await assert.rejects(loading, { name: 'AbortError' });
  assert.equal(cancelled, started);
});
