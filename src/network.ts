import { validState, type Musician } from './engine';
import { orchestra } from './orchestra';
import { canExchange, validPartition, type PartitionPlan } from './partitions';

type PartitionCommand = { type: 'partition-commit'; id: string; command: string; order: number; plan: PartitionPlan | null; states: Musician[] };
type PartitionHooks = { snapshot: () => Musician; apply: (plan: PartitionPlan | null, states: Musician[]) => void };
// Bridge motif collections are local playback data, not needed by observers.
const wireState = (m: Musician): Musician => m.ensemble?.bridge ? { ...m, ensemble: { ...m.ensemble,
  bridge: { ...m.ensemble.bridge, plan: { ...m.ensemble.bridge.plan, adoptedMotifs: [] } } } } : m;

export class Mesh {
  id = crypto.randomUUID();
  socket: WebSocket;
  peers = new Map<string, RTCPeerConnection>();
  channels = new Map<string, RTCDataChannel>();
  private peerInstruments = new Map<string, number>();
  private partition: PartitionPlan | null = null;
  private commandOrder = 0;
  private lastCommand?: PartitionCommand;
  private chunks = new Map<string, { transfer: string; parts: string[]; count: number; expires: number }>();
  private pending?: { command: string; plan: PartitionPlan | null; states: Map<string, Musician>; expected: Set<string>; timer: ReturnType<typeof setTimeout> };

  constructor(url: string, room: string, private receive: (m: Musician) => void, private status: (s: string) => void, private instrument = 0, private partitionHooks?: PartitionHooks) {
    this.socket = new WebSocket(url);
    this.socket.onopen = () => { this.send({ type: 'join', room, id: this.id }); status('Signalling connected'); };
    this.socket.onclose = () => status('Signalling offline · established peers continue');
    this.socket.onerror = () => status('Cannot reach signalling server');
    this.socket.onmessage = async e => {
      try {
        const m = JSON.parse(e.data);
        if (m.type === 'peers') {
          for (const id of m.peers) await this.connect(id, true);
        } else if (m.type === 'signal') {
          const pc = this.peers.get(m.from) ?? await this.connect(m.from, false);
          if (m.description) {
            await pc.setRemoteDescription(m.description);
            if (m.description.type === 'offer') { await pc.setLocalDescription(); this.send({ type: 'signal', to: m.from, description: pc.localDescription }); }
          } else if (m.candidate) await pc.addIceCandidate(m.candidate);
        }
      } catch { status('Peer negotiation failed; rejoin to retry'); }
    };
  }

  setPartition(plan: PartitionPlan | null) {
    if (plan && !validPartition(plan)) throw new Error('Invalid partition.');
    this.partition = plan ? structuredClone(plan) : null;
  }

  /** Control packets bypass musical partitions; every participant gets one snapshot set. */
  requestPartition(plan: PartitionPlan | null) {
    if (plan && !validPartition(plan)) throw new Error('Invalid partition.');
    if (!this.partitionHooks) { this.setPartition(plan); return; }
    if (this.pending) clearTimeout(this.pending.timer);
    const command = crypto.randomUUID();
    const self = wireState({ ...this.partitionHooks.snapshot(), id: this.id });
    const expected = new Set([...this.channels].filter(([, ch]) => ch.readyState === 'open').map(([id]) => id));
    this.pending = { command, plan: plan ? structuredClone(plan) : null, states: new Map([[this.id, self]]), expected,
      timer: setTimeout(() => this.finishPartition(), 500) };
    this.control({ type: 'partition-snapshot-request', id: this.id, command });
    if (!expected.size) this.finishPartition();
    else this.status('Collecting group snapshots for the shared partition change…');
  }

  private control(value: unknown, channel?: RTCDataChannel) {
    const message = JSON.stringify(value);
    if (message.length > 4_000_000) { this.status('Partition snapshot too large; retry with fewer connected peers'); return; }
    const transfer = crypto.randomUUID();
    for (const ch of channel ? [channel] : this.channels.values()) {
      if (ch.readyState !== 'open' || ch.bufferedAmount >= 65536) continue;
      if (message.length <= 12000) ch.send(message);
      else for (let offset = 0; offset < message.length; offset += 12000) {
        ch.send(JSON.stringify({ type: 'partition-chunk', id: this.id, transfer, index: offset / 12000,
          count: Math.ceil(message.length / 12000), data: message.slice(offset, offset + 12000) }));
      }
    }
  }

  private finishPartition() {
    const pending = this.pending;
    if (!pending) return;
    clearTimeout(pending.timer); this.pending = undefined;
    const command: PartitionCommand = { type: 'partition-commit', id: this.id, command: pending.command,
      order: Math.max(Date.now(), this.commandOrder + 1), plan: pending.plan, states: [...pending.states.values()] };
    this.control(command);
    this.acceptPartition(command);
    if (pending.expected.size) this.status(`Partition applied; ${pending.expected.size} unavailable peer snapshot(s) omitted`);
  }

  private acceptPartition(command: PartitionCommand) {
    if (!this.partitionHooks || command.order < this.commandOrder || command.order === this.commandOrder && this.lastCommand && command.command <= this.lastCommand.command) return;
    if (!Number.isSafeInteger(command.order) || typeof command.command !== 'string' || command.command.length > 100
      || command.plan !== null && !validPartition(command.plan) || !Array.isArray(command.states) || !command.states.length || command.states.length > 64
      || !command.states.every(validState) || new Set(command.states.map(s => s.id)).size !== command.states.length) return;
    this.commandOrder = command.order; this.lastCommand = command;
    this.setPartition(command.plan);
    this.partitionHooks.apply(command.plan, command.states);
    this.status(command.plan ? 'Shared partition applied' : 'Shared reunion started');
  }

  private canReach(id: string): boolean {
    if (!this.partition) return true;
    const instrument = this.peerInstruments.get(id);
    // Unknown peers exchange identity only until the role handshake completes.
    return instrument !== undefined && canExchange(this.partition, { id: this.id, instrument: this.instrument }, { id, instrument });
  }

  private announce(channel: RTCDataChannel) {
    if (channel.readyState === 'open' && channel.bufferedAmount < 65536) channel.send(JSON.stringify({ type: 'instrument', id: this.id, instrument: this.instrument }));
  }

  send(value: unknown) { if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(value)); }

  async connect(id: string, offer: boolean) {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    this.peers.set(id, pc);
    pc.onicecandidate = e => { if (e.candidate) this.send({ type: 'signal', to: id, candidate: e.candidate }); };
    const attach = (ch: RTCDataChannel) => {
      this.channels.set(id, ch);
      ch.onopen = () => { this.announce(ch); this.status(this.channels.size + ' peer connection(s)'); };
      ch.onmessage = e => {
        try {
          let m = JSON.parse(e.data);
          if (m.id !== id) return;
          if (m.type === 'partition-chunk') {
            if (typeof m.transfer !== 'string' || m.transfer.length > 100 || !Number.isInteger(m.count) || m.count < 1 || m.count > 334
              || !Number.isInteger(m.index) || m.index < 0 || m.index >= m.count || typeof m.data !== 'string' || m.data.length > 12000) return;
            let entry = this.chunks.get(id);
            if (!entry || entry.transfer !== m.transfer || entry.expires < Date.now()) {
              entry = { transfer: m.transfer, parts: [], count: m.count, expires: Date.now() + 5000 }; this.chunks.set(id, entry);
            }
            if (entry.count !== m.count) return;
            entry.parts[m.index] = m.data;
            if (entry.parts.filter(p => p !== undefined).length !== entry.count) return;
            this.chunks.delete(id);
            m = JSON.parse(entry.parts.join(''));
            if (m.id !== id || !['partition-commit', 'partition-snapshot'].includes(m.type)) return;
          }
          if (m.type === 'partition-snapshot-request' && this.partitionHooks) {
            if (typeof m.command !== 'string' || m.command.length > 100) return;
            this.control({ type: 'partition-snapshot', id: this.id, command: m.command, state: wireState({ ...this.partitionHooks.snapshot(), id: this.id }) }, ch);
          } else if (m.type === 'partition-snapshot' && this.pending && this.pending.command === m.command) {
            if (!validState(m.state) || m.state.id !== id || !this.pending.expected.has(id)) return;
            this.pending.states.set(id, m.state); this.pending.expected.delete(id);
            if (!this.pending.expected.size) this.finishPartition();
          } else if (m.type === 'partition-commit') {
            this.acceptPartition(m);
          } else if (m.type === 'instrument') {
            if (!Number.isInteger(m.instrument) || m.instrument < 0 || m.instrument >= orchestra.length) return;
            const changed = this.peerInstruments.get(id) !== m.instrument;
            this.peerInstruments.set(id, m.instrument);
            // Identity carries no notes or intentions and is allowed during a
            // partition, so two already-partitioned peers can discover roles.
            if (changed) {
              this.announce(ch);
              if (this.lastCommand) this.control({ ...this.lastCommand, id: this.id }, ch);
            }
          } else if (validState(m)) {
            this.peerInstruments.set(id, m.instrument);
            if (this.canReach(id)) this.receive(m);
          }
        } catch { /* Ignore malformed peer messages. */ }
      };
      ch.onclose = () => {
        if (this.channels.get(id) === ch) { this.channels.delete(id); this.peerInstruments.delete(id); }
        this.status(this.channels.size + ' peer connection(s)');
      };
    };
    pc.ondatachannel = e => attach(e.channel);
    if (offer) { attach(pc.createDataChannel('intentions')); await pc.setLocalDescription(); this.send({ type: 'signal', to: id, description: pc.localDescription }); }
    return pc;
  }

  broadcast(m: Musician) {
    if (m.instrument !== this.instrument) {
      this.instrument = m.instrument;
      for (const channel of this.channels.values()) this.announce(channel);
    }
    const message = JSON.stringify(wireState({ ...m, id: this.id }));
    for (const [id, ch] of this.channels) {
      if (this.canReach(id) && ch.readyState === 'open' && ch.bufferedAmount < 65536) ch.send(message);
    }
  }

  close() {
    if (this.pending) clearTimeout(this.pending.timer);
    this.pending = undefined;
    this.socket.onclose = null;
    for (const ch of this.channels.values()) { ch.onclose = null; ch.onmessage = null; }
    this.socket.close();
    for (const p of this.peers.values()) p.close();
    this.peers.clear(); this.channels.clear(); this.peerInstruments.clear(); this.chunks.clear();
  }
}
