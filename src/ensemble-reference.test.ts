import assert from 'node:assert/strict';
import { test } from 'node:test';
import { advanceForm, applyDecision, compose, configureForm, configureHarmony, createMusician, createOrchestra, evolve, recordPerformance, seedMusician, validState, type Musician } from './engine';
import { enableEnsemble, ensembleChord, partitionEnsemble, prepareEnsemble } from './ensemble';
import { musicRole } from './music-roles';
import { reachableMusicians } from './partitions';
import { currentKey, modes, type Mode } from './tonality';
import { buildMessages } from './local-llm';
import type { MelodyDecision } from './melody';

const player = (instrument: number) => enableEnsemble(createMusician(instrument));
const onsets = (m: Musician) => Array.from({ length: 16 }, (_, beat) => compose({ ...m, beat }).length ? beat : -1).filter(n => n >= 0);
const energy = (m: Musician, value: number) => ({ ...m, ensemble: { ...m.ensemble!, drumsEnergy: value } });
const decision: MelodyDecision = { motif: [5, 2, 3], rhythm: [0, 3, 10], durations: [2, 4, 4], articulations: ['legato', 'staccato', 'tenuto'], energy: .6, approach: 'echo', interval: 0, respondTo: 'self', reason: 'Answer with space.' };

test('all 26 voices map to the four arranging roles without replacing instruments', () => {
  const counts = Object.fromEntries(['drums', 'bass', 'piano', 'lead'].map(role => [role, createOrchestra().filter(m => musicRole(m.instrument) === role).length]));
  assert.deepEqual(counts, { drums: 4, bass: 8, piano: 6, lead: 8 });
});

test('role onsets match low, medium and high energy reference patterns', () => {
  assert.deepEqual(onsets(energy(player(19), .44)), [0, 8]);
  assert.deepEqual(onsets(energy(player(19), .45)), [0, 8, 10]);
  assert.deepEqual(onsets(energy(player(19), .75)), [0, 3, 8, 10, 14]);
  assert.deepEqual(onsets(energy(player(18), .69)), [4, 12]);
  assert.deepEqual(onsets(energy(player(18), .7)), [4, 7, 12, 15]);
  assert.equal(compose({ ...energy(player(18), .7), beat: 7 })[0].velocity, .35);
  assert.equal(onsets(energy(player(20), .64)).length, 8);
  assert.equal(onsets(energy(player(20), .65)).length, 16);
  assert.deepEqual(onsets(energy(player(3), .44)), [0, 4, 8, 12]);
  assert.deepEqual(onsets(energy(player(3), .45)), [0, 4, 6, 8, 12, 14]);
  assert.deepEqual(onsets(energy(player(3), .7)), [0, 2, 3, 4, 6, 7, 8, 10, 11, 12, 14, 15]);
  assert.deepEqual(onsets(energy(player(24), .69)), [0, 8]);
  assert.deepEqual(onsets(energy(player(24), .7)), [0, 3, 6, 8, 11, 14]);
});

test('reference progression, bass pitches and octave-crossing motifs reach playback', () => {
  assert.deepEqual([0, 16, 32, 48].map(beat => ensembleChord({ ...player(24), beat })), ['C', 'G', 'Am', 'F']);
  const bass = energy(player(3), .8);
  assert.deepEqual([0, 2, 3, 4].map(beat => compose({ ...bass, beat })[0].midi), [36, 48, 40, 43]);
  assert.deepEqual(compose(energy(player(24), .8)).map(n => n.midi), [60, 64, 67]);
  const lead = player(0);
  lead.ensemble!.motif = { ...lead.ensemble!.motif, scaleDegrees: [-1, 7, 9], rhythmSteps: [0, 4, 8] };
  assert.deepEqual([0, 4, 8].map(beat => compose({ ...lead, beat })[0].midi), [71, 84, 88]);
});

test('role split diverges to G major / A minor and reaches the reference drift limits', () => {
  const plan = { kind: 'roles' as const };
  let players = partitionEnsemble(createOrchestra().map(playerFrom => enableEnsemble(playerFrom)), plan);
  assert.equal(players[19].tempo, 128); assert.deepEqual(currentKey(players[19]), { tonic: 7, mode: 'major' });
  assert.equal(players[0].tempo, 108); assert.deepEqual(currentKey(players[0]), { tonic: 9, mode: 'minor' });
  for (let step = 0; step < 64; step++) {
    const snapshot = players;
    players = players.map(m => evolve(prepareEnsemble(m, reachableMusicians(m, snapshot, plan)), []));
  }
  assert.equal(players[19].tempo, 132); assert.equal(players[0].tempo, 106);
  assert.ok(players.every(validState));
  const replaced = partitionEnsemble(players, { kind: 'lead' });
  assert.equal(replaced[0].tempo, 108, 'Updating the split retains the original baseline');
});

test('healing weights groups equally, shares pivot then tonic and resolves after exactly 64 steps', () => {
  // Three rhythm players vs one melody player: the average must be 118, not 123.
  const split = partitionEnsemble([player(19), player(18), player(3), player(0)], { kind: 'roles' });
  let healed = partitionEnsemble(split, null);
  const reversed = partitionEnsemble(split, null, [...split].reverse());
  assert.deepEqual(healed[0].ensemble!.bridge!.plan, reversed[0].ensemble!.bridge!.plan);
  const plan = healed[0].ensemble!.bridge!.plan;
  assert.equal(plan.targetBpm, 118); assert.equal(plan.targetKeyRoot, 'D'); assert.equal(plan.targetMode, 'dorian');
  assert.ok(plan.adoptedMotifs.some(m => m.authorRole === 'lead'));
  for (let step = 0; step < 64; step++) {
    healed = healed.map(m => prepareEnsemble(m, []));
    assert.ok(healed.every(validState));
    if (step < 32) assert.ok(healed.every(m => ensembleChord(m) === plan.pivotChord));
    if (step === 32) assert.ok(healed.every(m => currentKey(m).tonic === 2 && ensembleChord(m) === 'Dm'));
    if (step < 63) assert.ok(healed.every(m => m.ensemble!.mode === 'bridging'));
    healed = healed.map(m => evolve(m, []));
  }
  assert.ok(healed.every(m => m.tempo === 118 && m.ensemble!.mode === 'unified' && m.ensemble!.tension === .2));
});

test('forms and LLM cannot overwrite the bridge; melodic LLM phrasing resumes afterwards', () => {
  const split = partitionEnsemble([configureForm(player(0), { choice: 'aba', bars: 4 }), player(19)], { kind: 'roles' });
  let m = partitionEnsemble(split, null)[0];
  assert.equal(advanceForm(m), m); assert.equal(applyDecision(m, decision), m);
  for (let i = 0; i < 64; i++) m = evolve(prepareEnsemble(m, []), []);
  m = { ...m, form: undefined };
  const accepted = applyDecision(m, decision);
  assert.deepEqual(accepted.motif, decision.motif); assert.deepEqual(accepted.rhythm, decision.rhythm);
  assert.deepEqual(onsets(accepted), [0, 3, 10]);
  assert.equal(compose({ ...accepted, beat: 3 })[0].articulation, 'staccato');
  assert.equal(accepted.ensemble!.motif.id, `${accepted.id}:phrase:${accepted.beat}`);
});

test('recorded openings remain audible and resetting them preserves the role engine', () => {
  const m = seedMusician(player(0), { motif: [0, 4], rhythm: [0, 8], durations: [4, 4], articulations: ['normal', 'normal'] });
  assert.ok(m.ensemble); assert.deepEqual(onsets(m), [0, 8]);
  assert.deepEqual([0, 8].map(beat => compose({ ...m, beat })[0].midi), [72, 79]);
});

test('an earlier form entrance does not hide the adopted reunion motif', () => {
  const lead = advanceForm(configureForm(player(0), { choice: 'aba', bars: 8 }));
  const split = partitionEnsemble([lead, player(19)], { kind: 'roles' });
  let m = partitionEnsemble(split, null)[0];
  for (let i = 0; i < 64; i++) m = evolve(prepareEnsemble(m, []), []);
  assert.notEqual(m.ensemble!.motif.id, `${m.id}:phrase:${m.form!.enteredAt}`);
  const expected = m.ensemble!.motif.rhythmSteps;
  // Quiet drums prevent extra pickup notes so entrances are exactly the adopted motif.
  assert.deepEqual(onsets(energy(m, .3)), expected);
});

test('all supported keys and voices produce valid wire states across role playback and healing', () => {
  for (const mode of Object.keys(modes) as Mode[]) for (let tonic = 0; tonic < 12; tonic++) {
    let players = createOrchestra().map(m => enableEnsemble(configureHarmony(m, { tonic, mode }, 'fixed')));
    players = partitionEnsemble(players, { kind: 'roles' });
    players = partitionEnsemble(players, null);
    for (const m of players) for (const beat of [0, 3, 7, 8, 14, 15]) {
      const prepared = prepareEnsemble({ ...m, beat }, players.filter(p => p.id !== m.id));
      assert.ok(validState(recordPerformance(prepared, compose(prepared), true)), `${tonic} ${mode} ${m.instrument}`);
    }
  }
});

test('LLM context reports the real role and chord, and malformed ensemble packets are rejected', () => {
  const m = player(24);
  const context = JSON.parse(buildMessages({ self: m, neighbours: [], memory: [] })[1].content);
  assert.equal(context.self.arrangingRole, 'piano'); assert.equal(context.harmony.accompaniment.symbol, 'C');
  assert.equal(validState({ ...m, ensemble: { ...m.ensemble!, motif: { ...m.ensemble!.motif, scaleDegrees: [NaN] } } }), false);
  assert.equal(validState({ ...m, ensemble: { ...m.ensemble!, bridge: {} } }), false);
});
