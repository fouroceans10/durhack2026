import { validState, type Musician } from './engine';
import { orchestra } from './orchestra';
import { canExchange, validPartition, type PartitionPlan } from './partitions';

export class Mesh {
  id = crypto.randomUUID();
  socket: WebSocket;
  peers = new Map<string, RTCPeerConnection>();
  channels = new Map<string, RTCDataChannel>();
  private peerInstruments = new Map<string, number>();
  private partition: PartitionPlan | null = null;

  constructor(url: string, room: string, private receive: (m: Musician) => void, private status: (s: string) => void, private instrument = 0) {
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
          const m = JSON.parse(e.data);
          if (m.id !== id) return;
          if (m.type === 'instrument') {
            if (!Number.isInteger(m.instrument) || m.instrument < 0 || m.instrument >= orchestra.length) return;
            const changed = this.peerInstruments.get(id) !== m.instrument;
            this.peerInstruments.set(id, m.instrument);
            // Identity carries no notes or intentions and is allowed during a
            // partition, so two already-partitioned peers can discover roles.
            if (changed) this.announce(ch);
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
    const message = JSON.stringify({ ...m, id: this.id });
    for (const [id, ch] of this.channels) {
      if (this.canReach(id) && ch.readyState === 'open' && ch.bufferedAmount < 65536) ch.send(message);
    }
  }

  close() {
    this.socket.onclose = null;
    for (const ch of this.channels.values()) { ch.onclose = null; ch.onmessage = null; }
    this.socket.close();
    for (const p of this.peers.values()) p.close();
    this.peers.clear(); this.channels.clear(); this.peerInstruments.clear();
  }
}
