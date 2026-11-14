import { WebSocketServer, WebSocket } from 'ws';
import { pathToFileURL } from 'node:url';

// One browser per instrument needs at least 26 seats; allow additional players.
export const ROOM_CAPACITY = 64;
export function createSignallingServer(port = Number(process.env.PORT || 8787)) {
  const server = new WebSocketServer({ port, maxPayload: 16384 });
  const rooms = new Map();
  server.on('connection', socket => {
    let room, id;
    socket.on('message', raw => {
      try {
        const m = JSON.parse(raw.toString());
        if (m.type === 'join' && !id && typeof m.room === 'string' && /^[a-zA-Z0-9-]{1,48}$/.test(m.room) && typeof m.id === 'string' && m.id.length > 0 && m.id.length < 100) {
          const peers = rooms.get(m.room) || new Map();
          if (peers.size >= ROOM_CAPACITY || peers.has(m.id)) {
            socket.close(1008, 'Room full or duplicate peer'); return;
          }
          room = m.room; id = m.id;
          socket.send(JSON.stringify({ type: 'peers', peers: [...peers.keys()] }));
          peers.set(id, socket); rooms.set(room, peers);
        } else if (m.type === 'signal' && id) {
          const peer = rooms.get(room)?.get(m.to);
          if (peer?.readyState === WebSocket.OPEN) peer.send(JSON.stringify({ type: 'signal', from: id, description: m.description, candidate: m.candidate }));
        }
      } catch { socket.close(1003); }
    });
    socket.on('close', () => {
      const peers = rooms.get(room);
      if (peers?.get(id) === socket) peers.delete(id);
      if (peers?.size === 0) rooms.delete(room);
    });
    socket.on('error', () => {});
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createSignallingServer();
  server.on('listening', () => console.log(`Signalling listening on :${server.address().port} (peer introductions only, ${ROOM_CAPACITY} seats per room)`));
}
