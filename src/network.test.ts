import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { Mesh } from './network';
import { createMusician, type Musician } from './engine';

class Channel {
  readyState = 'open'; bufferedAmount = 0;
  sent: string[] = [];
  onopen?: () => void;
  onclose?: () => void;
  onmessage?: (e: { data: string }) => void;
  forward?: (data: string) => void;
  send(data: string) { this.sent.push(data); this.forward?.(data); }
  deliver(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
}
class Socket {
  static OPEN = 1; readyState = 1;
  send() {} close() {}
}
class Connection {
  channel = new Channel(); localDescription = {};
  createDataChannel() { return this.channel; }
  async setLocalDescription() {}
  close() { this.channel.onclose?.(); }
}
function fakeNetwork(t: TestContext) {
  for (const [name, value] of [['WebSocket', Socket], ['RTCPeerConnection', Connection]] as const) {
    const old = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, configurable: true });
    t.after(() => { if (old) Object.defineProperty(globalThis, name, old); else Reflect.deleteProperty(globalThis, name); });
  }
}
const channel = (mesh: Mesh, id: string) => mesh.channels.get(id) as unknown as Channel;
const musicalMessages = (ch: Channel) => ch.sent.map(text => JSON.parse(text)).filter(m => m.type !== 'instrument');

test('selective WebRTC partitions block musical state in both directions, and reconnect cleanly', async t => {
  fakeNetwork(t);
  const heard: Musician[] = [];
  const mesh = new Mesh('ws://test', 'room', m => heard.push(m), () => {}, 0);
  t.after(() => mesh.close());
  await mesh.connect('flute', true); await mesh.connect('viola', true);
  const flute = channel(mesh, 'flute'), viola = channel(mesh, 'viola');
  flute.deliver({ type: 'instrument', id: 'flute', instrument: 5 });
  viola.deliver({ type: 'instrument', id: 'viola', instrument: 1 });
  mesh.setPartition({ kind: 'instrument', instrument: 5 });
  mesh.broadcast(createMusician(0));
  assert.equal(musicalMessages(flute).length, 0);
  assert.equal(musicalMessages(viola).length, 1);
  flute.deliver(createMusician(5, 'flute')); viola.deliver(createMusician(1, 'viola'));
  assert.deepEqual(heard.map(p => p.id), ['viola']);
  mesh.setPartition(null); mesh.broadcast(createMusician(0));
  flute.deliver(createMusician(5, 'flute'));
  assert.equal(musicalMessages(flute).length, 1);
  assert.deepEqual(heard.map(p => p.id), ['viola', 'flute']);
});

test('two peers can join with partitions already active without leaking music or deadlocking discovery', async t => {
  fakeNetwork(t);
  const heardA: Musician[] = [], heardB: Musician[] = [];
  const a = new Mesh('ws://test', 'room', m => heardA.push(m), () => {}, 0);
  const b = new Mesh('ws://test', 'room', m => heardB.push(m), () => {}, 1);
  t.after(() => { a.close(); b.close(); });
  a.setPartition({ kind: 'sections' }); b.setPartition({ kind: 'sections' });
  await a.connect(b.id, true); await b.connect(a.id, true);
  const ab = channel(a, b.id), ba = channel(b, a.id);
  a.broadcast(createMusician(0)); b.broadcast(createMusician(1));
  assert.equal(musicalMessages(ab).length + musicalMessages(ba).length, 0, 'Unknown roles cannot receive intentions');
  ab.forward = data => ba.onmessage?.({ data }); ba.forward = data => ab.onmessage?.({ data });
  ab.onopen?.(); ba.onopen?.();
  assert.ok(ab.sent.length + ba.sent.length <= 4, 'Role announcements must not loop');
  a.broadcast(createMusician(0)); b.broadcast(createMusician(1));
  assert.equal(heardA.length, 1); assert.equal(heardB.length, 1);
  a.setPartition({ kind: 'solo' });
  a.broadcast(createMusician(0)); b.broadcast(createMusician(1));
  assert.equal(heardA.length, 1); assert.equal(heardB.length, 1);
});

test('invalid role announcements, spoofed identities and buffered channels cannot bypass filters', async t => {
  fakeNetwork(t);
  const heard: Musician[] = [];
  const mesh = new Mesh('ws://test', 'room', m => heard.push(m), () => {});
  t.after(() => mesh.close());
  mesh.setPartition({ kind: 'sections' }); await mesh.connect('peer', true);
  const ch = channel(mesh, 'peer');
  for (const instrument of [-1, 26, '0', 1.5]) ch.deliver({ type: 'instrument', id: 'peer', instrument });
  ch.deliver({ type: 'instrument', id: 'spoofed', instrument: 0 });
  mesh.broadcast(createMusician(0));
  assert.equal(musicalMessages(ch).length, 0);
  ch.deliver(createMusician(0, 'spoofed'));
  assert.equal(heard.length, 0);
  ch.deliver({ type: 'instrument', id: 'peer', instrument: 1 });
  ch.bufferedAmount = 65536; mesh.broadcast(createMusician(0));
  assert.equal(musicalMessages(ch).length, 0);
  ch.bufferedAmount = 0; mesh.broadcast(createMusician(0));
  assert.equal(musicalMessages(ch).length, 1);
});
