import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createSignallingServer } from './signalling.mjs';

test('a full 26-instrument orchestra can join a room and exchange introductions', { timeout: 10000 }, async t => {
  const server = createSignallingServer(0), clients = [];
  t.after(async () => {
    for (const client of clients) client.terminate();
    for (const client of server.clients) client.terminate();
    await new Promise(resolve => server.close(resolve));
  });
  await once(server, 'listening');
  for (let i = 0; i < 26; i++) {
    const socket = new WebSocket(`ws://localhost:${server.address().port}`);
    clients.push(socket);
    await once(socket, 'open');
    const reply = once(socket, 'message');
    socket.send(JSON.stringify({ type: 'join', room: 'full-orchestra', id: `instrument-${i}` }));
    const [raw] = await reply, message = JSON.parse(raw.toString());
    assert.equal(message.type, 'peers');
    assert.deepEqual(message.peers, Array.from({ length: i }, (_, j) => `instrument-${j}`));
  }
  const reply = once(clients[25], 'message');
  clients[0].send(JSON.stringify({ type: 'signal', to: 'instrument-25', description: { type: 'offer', sdp: 'test' } }));
  const [raw] = await reply;
  assert.deepEqual(JSON.parse(raw.toString()), { type: 'signal', from: 'instrument-0', description: { type: 'offer', sdp: 'test' } });
});
