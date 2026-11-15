import {
  type ClockPing,
  type ClockPong,
  type InstrumentRole,
  type IntentPacket,
  type PartitionCommand,
  type PartitionPreset,
  type PeerWireMessage,
  type SignalEnvelope,
  type SignallingStatus,
  type TransportMode,
} from "../../../shared/types";
import {
  type ClockSample,
  computeClockSample,
  estimateConsensusEpochMs,
  estimatePeerClockOffset,
} from "../math/clockSync";

export interface KnownPeerState {
  peerId: string;
  role: InstrumentRole;
  lastSeenMs: number;
  reachable: boolean;
  clockSamples: ClockSample[];
  clockOffsetMs: number;
  latestRttMs: number;
  lastIntentPacket: IntentPacket | null;
}

export interface PartitionChangeEvent {
  partitionGroupId: string;
  previousPartitionGroupId: string;
  isPartitioned: boolean;
  wasPartitioned: boolean;
  reconnected: boolean;
  preset: PartitionPreset | null;
  reachablePeers: string[];
  reachableRoles: InstrumentRole[];
  knownPeers: string[];
  blockedEdges: string[];
  leaderPeerId: string;
  isLeader: boolean;
  reconcilePackets: IntentPacket[];
}

export interface PeerClockUpdateEvent {
  peerId: string;
  peerOffsetMs: number;
  rttMs: number;
  consensusOffsetMs: number;
  consensusEpochMs: number;
}

export interface PacketEdgePulseEvent {
  fromPeerId: string;
  toPeerId: string;
  type: PeerWireMessage["type"];
  timestampMs: number;
}

export interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export interface RTCDataChannelLike {
  readyState: "connecting" | "open" | "closing" | "closed";
  send(data: string): void;
  close(): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export interface RTCPeerConnectionLike {
  connectionState?: string;
  createDataChannel(label: string): RTCDataChannelLike;
  createOffer(): Promise<{ type: string; sdp?: string }>;
  createAnswer(): Promise<{ type: string; sdp?: string }>;
  setLocalDescription(desc: { type: string; sdp?: string }): Promise<void>;
  setRemoteDescription(desc: { type: string; sdp?: string }): Promise<void>;
  addIceCandidate(candidate: Record<string, unknown>): Promise<void>;
  close(): void;
  onicecandidate: ((ev: { candidate: unknown }) => void) | null;
  ondatachannel: ((ev: { channel: RTCDataChannelLike }) => void) | null;
  onconnectionstatechange: ((ev: unknown) => void) | null;
}

export interface PeerMeshOptions {
  peerId: string;
  role: InstrumentRole;
  roomId?: string;
  transportMode?: TransportMode;
  signallingUrl?: string;
  broadcastChannelName?: string;
  heartbeatIntervalMs?: number;
  clockSyncIntervalMs?: number;
  peerTimeoutMs?: number;
  autoStartTimers?: boolean;
  now?: () => number;
  webSocketFactory?: (url: string) => WebSocketLike;
  rtcPeerConnectionFactory?: (
    config: RTCConfiguration
  ) => RTCPeerConnectionLike;
}

interface WireFrame {
  frameId: string;
  roomId: string;
  senderPeerId: string;
  senderRole: InstrumentRole;
  targetPeerId?: string;
  message: PeerWireMessage;
}

/**
 * In-process BroadcastChannel hub so multiple PeerMesh instances in the same
 * JS runtime (e.g. Vitest or single-page multi-node simulation) exchange frames
 * deterministically alongside native browser BroadcastChannel across tabs.
 */
const inMemoryBroadcastBus = new Map<
  string,
  Set<(frame: WireFrame) => void>
>();
const inMemoryBroadcastQueue: Array<{
  channelName: string;
  senderReceiver: ((frame: WireFrame) => void) | null;
  frame: WireFrame;
}> = [];
let isFlushingBroadcastQueue = false;

/**
 * Normalizes an undirected edge key between two identifiers ("peerA::peerB" or "roleA::roleB")
 * in canonical lexicographical order so normalizeEdgeKey(a, b) === normalizeEdgeKey(b, a).
 */
export function normalizeEdgeKey(idA: string, idB: string): string {
  return idA <= idB ? `${idA}::${idB}` : `${idB}::${idA}`;
}

/**
 * Computes the canonical blocked role-edge pairs for a PartitionPreset.
 */
export function getPresetBlockedRoleEdges(preset: PartitionPreset): string[] {
  if (preset === "SPLIT_2V2") {
    const groupA: InstrumentRole[] = ["drums", "bass"];
    const groupB: InstrumentRole[] = ["piano", "lead"];
    const edges: string[] = [];
    for (const a of groupA) {
      for (const b of groupB) {
        edges.push(normalizeEdgeKey(a, b));
      }
    }
    return edges.sort();
  }

  if (preset === "ISOLATE_LEAD") {
    const others: InstrumentRole[] = ["drums", "bass", "piano"];
    return others.map((r) => normalizeEdgeKey("lead", r)).sort();
  }

  return [];
}

/**
 * Dual-Transport P2P Mesh & Software Partition Matrix (`PeerMesh`).
 *
 * Adheres to `.agent/rules/symphony-invariants.md`:
 * - Signalling Server Fault Tolerance (Invariant #2): Closing or killing the WebSocket
 *   signalling server mid-performance has zero effect on open P2P DataChannels.
 * - Deterministic Subgroup & Partition Reconciliation (Invariant #3): Computes
 *   deterministic `partitionGroupId` and subgroup leadership, and delivers
 *   pre-heal `IntentPacket`s on reconnection.
 */
export class PeerMesh {
  public readonly peerId: string;
  public readonly role: InstrumentRole;
  public readonly roomId: string;

  private transportMode: TransportMode;
  private readonly signallingUrl: string;
  private readonly broadcastChannelName: string;
  private readonly heartbeatIntervalMs: number;
  private readonly clockSyncIntervalMs: number;
  private readonly peerTimeoutMs: number;
  private readonly now: () => number;
  private readonly webSocketFactory?: (url: string) => WebSocketLike;
  private readonly rtcPeerConnectionFactory?: (
    config: RTCConfiguration
  ) => RTCPeerConnectionLike;

  private signallingStatus: SignallingStatus = "offline";
  private ws: WebSocketLike | null = null;
  private peerConnections = new Map<string, RTCPeerConnectionLike>();
  private dataChannels = new Map<string, RTCDataChannelLike>();
  private nativeBroadcastChannel: BroadcastChannel | null = null;
  private inMemoryReceiver: ((frame: WireFrame) => void) | null = null;

  private knownPeers = new Map<string, KnownPeerState>();
  private blockedEdges = new Set<string>();
  private activePreset: PartitionPreset | null = null;
  private seenPartitionIds = new Set<string>();
  private seenFrameIds = new Set<string>();
  private pendingPings = new Map<string, ClockPing>();
  private frameCounter = 0;
  private pingCounter = 0;

  private localIntentPacket: IntentPacket | null = null;
  private currentPartitionGroupId: string;
  private currentlyPartitioned = false;

  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private clockSyncTimer: ReturnType<typeof setInterval> | null = null;

  private intentListeners = new Set<
    (packet: IntentPacket, fromPeerId: string) => void
  >();
  private partitionListeners = new Set<
    (event: PartitionChangeEvent) => void
  >();
  private signallingListeners = new Set<(status: SignallingStatus) => void>();
  private clockListeners = new Set<(event: PeerClockUpdateEvent) => void>();
  private pulseListeners = new Set<(event: PacketEdgePulseEvent) => void>();

  constructor(options: PeerMeshOptions) {
    this.peerId = options.peerId;
    this.role = options.role;
    this.roomId = options.roomId ?? "symphony-room";
    this.transportMode = options.transportMode ?? "broadcast";
    this.signallingUrl = options.signallingUrl ?? resolveSignallingUrl();
    this.broadcastChannelName =
      options.broadcastChannelName ?? "symphony-mesh";
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 250;
    this.clockSyncIntervalMs = options.clockSyncIntervalMs ?? 500;
    this.peerTimeoutMs = options.peerTimeoutMs ?? 1500;
    this.now = options.now ?? (() => Date.now());
    this.webSocketFactory = options.webSocketFactory;
    this.rtcPeerConnectionFactory = options.rtcPeerConnectionFactory;

    this.currentPartitionGroupId = this.computePartitionGroupId();

    this.startTransport();
    if (options.autoStartTimers !== false) {
      this.startTimers();
    }
  }

  // ---------------------------------------------------------------------------
  // Event Listener Subscriptions
  // ---------------------------------------------------------------------------

  public onIntentPacket(
    listener: (packet: IntentPacket, fromPeerId: string) => void
  ): () => void {
    this.intentListeners.add(listener);
    return () => {
      this.intentListeners.delete(listener);
    };
  }

  public onPartitionChange(
    listener: (event: PartitionChangeEvent) => void
  ): () => void {
    this.partitionListeners.add(listener);
    return () => {
      this.partitionListeners.delete(listener);
    };
  }

  public onSignallingStatusChange(
    listener: (status: SignallingStatus) => void
  ): () => void {
    this.signallingListeners.add(listener);
    return () => {
      this.signallingListeners.delete(listener);
    };
  }

  public onPeerClockUpdate(
    listener: (event: PeerClockUpdateEvent) => void
  ): () => void {
    this.clockListeners.add(listener);
    return () => {
      this.clockListeners.delete(listener);
    };
  }

  public onPacketEdgePulse(
    listener: (event: PacketEdgePulseEvent) => void
  ): () => void {
    this.pulseListeners.add(listener);
    return () => {
      this.pulseListeners.delete(listener);
    };
  }

  // ---------------------------------------------------------------------------
  // Public State Getters & Subgroup Helpers
  // ---------------------------------------------------------------------------

  public getTransportMode(): TransportMode {
    return this.transportMode;
  }

  public getSignallingUrl(): string {
    return this.signallingUrl;
  }

  public getSignallingStatus(): SignallingStatus {
    return this.signallingStatus;
  }

  public getBlockedEdges(): string[] {
    return Array.from(this.blockedEdges).sort();
  }

  public isEdgeBlocked(
    peerOrRoleA: string,
    peerOrRoleB: string,
    roleA?: InstrumentRole,
    roleB?: InstrumentRole
  ): boolean {
    if (peerOrRoleA === peerOrRoleB) {
      return false;
    }
    if (this.blockedEdges.has(normalizeEdgeKey(peerOrRoleA, peerOrRoleB))) {
      return true;
    }
    const resolvedRoleA = roleA ?? this.resolveRole(peerOrRoleA);
    const resolvedRoleB = roleB ?? this.resolveRole(peerOrRoleB);
    if (resolvedRoleA && resolvedRoleB && resolvedRoleA !== resolvedRoleB) {
      if (this.blockedEdges.has(normalizeEdgeKey(resolvedRoleA, resolvedRoleB))) {
        return true;
      }
    }
    return false;
  }

  public setEdgeBlocked(
    idA: string,
    idB: string,
    blocked: boolean,
    propagate = false
  ): void {
    const key = normalizeEdgeKey(idA, idB);
    if (blocked) {
      this.blockedEdges.add(key);
      this.expandRoleBlockedEdgesToKnownPeers();
    } else {
      this.blockedEdges.delete(key);
      const roleA = this.resolveRole(idA);
      const roleB = this.resolveRole(idB);
      if (roleA && roleB) {
        this.blockedEdges.delete(normalizeEdgeKey(roleA, roleB));
        const allNodes: Array<{ peerId: string; role: InstrumentRole }> = [
          { peerId: this.peerId, role: this.role },
          ...Array.from(this.knownPeers.values()).map((p) => ({
            peerId: p.peerId,
            role: p.role,
          })),
        ];
        for (const a of allNodes) {
          for (const b of allNodes) {
            if (
              (a.role === roleA && b.role === roleB) ||
              (a.role === roleB && b.role === roleA)
            ) {
              this.blockedEdges.delete(normalizeEdgeKey(a.peerId, b.peerId));
            }
          }
        }
      }
    }

    const isHeal = this.blockedEdges.size === 0;
    const preset: PartitionPreset | null = isHeal ? "HEAL_ALL" : null;
    this.activePreset = preset;

    if (propagate) {
      const command: PartitionCommand = {
        type: "PARTITION_COMMAND",
        action: isHeal ? "heal" : "split",
        preset: isHeal ? "HEAL_ALL" : undefined,
        partitionId: `edge-${this.peerId}-${this.now()}-${++this.frameCounter}`,
        groups: {},
        blockedEdges: this.getBlockedEdges(),
        issuedAtMs: this.now(),
      };
      this.seenPartitionIds.add(command.partitionId);
      this.transmitControlMessage(command);
    }

    if (isHeal && this.localIntentPacket) {
      this.sendDataMessage({
        type: "INTENT_PACKET",
        packet: this.localIntentPacket,
      });
    }

    this.syncReachabilityWithMatrix(preset);
  }

  public toggleEdgeBlock(
    idA: string,
    idB: string,
    propagate = true
  ): boolean {
    const nextBlocked = !this.isEdgeBlocked(idA, idB);
    this.setEdgeBlocked(idA, idB, nextBlocked, propagate);
    return nextBlocked;
  }

  /**
   * Returns sorted list of currently reachable peerIds (including `this.peerId`).
   */
  public getReachablePeerIds(): string[] {
    const ids = [this.peerId];
    for (const peer of this.knownPeers.values()) {
      if (
        peer.reachable &&
        !this.isEdgeBlocked(this.peerId, peer.peerId, this.role, peer.role)
      ) {
        ids.push(peer.peerId);
      }
    }
    return ids.sort((a, b) => a.localeCompare(b));
  }

  /**
   * Returns sorted list of currently reachable InstrumentRoles (including `this.role`).
   */
  public getReachableRoles(): InstrumentRole[] {
    const roles = new Set<InstrumentRole>([this.role]);
    for (const peer of this.knownPeers.values()) {
      if (
        peer.reachable &&
        !this.isEdgeBlocked(this.peerId, peer.peerId, this.role, peer.role)
      ) {
        roles.add(peer.role);
      }
    }
    return Array.from(roles).sort((a, b) => a.localeCompare(b)) as InstrumentRole[];
  }

  /**
   * Returns sorted list of all known orchestra peerIds (including `this.peerId`).
   */
  public getKnownPeerIds(): string[] {
    return [this.peerId, ...Array.from(this.knownPeers.keys())].sort((a, b) =>
      a.localeCompare(b)
    );
  }

  public getKnownPeers(): KnownPeerState[] {
    return Array.from(this.knownPeers.values());
  }

  /**
   * Computes deterministic `partitionGroupId` from the sorted list of currently
   * reachable roles and peerIds (including self).
   */
  public computePartitionGroupId(): string {
    const roles = this.getReachableRoles();
    const peers = this.getReachablePeerIds();
    return `part:${roles.join("-")}|${peers.join("+")}`;
  }

  public getPartitionGroupId(): string {
    return this.currentPartitionGroupId;
  }

  /**
   * Returns true when `reachableCount < totalKnownOrchestraCount` or any edge
   * involving this node is blocked.
   */
  public isPartitioned(): boolean {
    const totalKnown = 1 + this.knownPeers.size;
    if (totalKnown <= 1) {
      return this.blockedEdges.size > 0;
    }
    const reachableCount = this.getReachablePeerIds().length;
    return reachableCount < totalKnown;
  }

  /**
   * Deterministic subgroup leader tie-breaker based on lowest lexicographical
   * `peerId` (with `role` tie-breaker) within the reachable subgroup.
   */
  public getSubgroupLeaderPeerId(): string {
    const reachableIds = this.getReachablePeerIds();
    return reachableIds[0] ?? this.peerId;
  }

  public isSubgroupLeader(): boolean {
    return this.getSubgroupLeaderPeerId() === this.peerId;
  }

  public getPeerClockOffset(peerId: string): number {
    return this.knownPeers.get(peerId)?.clockOffsetMs ?? 0;
  }

  public getLocalIntentPacket(): IntentPacket | null {
    return this.localIntentPacket;
  }

  /**
   * Returns all latest known IntentPackets across the reachable subgroup
   * (including this node's own latest IntentPacket), suitable for passing
   * directly into `computeReconcilePlan`.
   */
  public getReconcilePackets(): IntentPacket[] {
    const packets: IntentPacket[] = [];
    if (this.localIntentPacket) {
      packets.push(this.localIntentPacket);
    }
    for (const peer of this.knownPeers.values()) {
      if (
        peer.reachable &&
        !this.isEdgeBlocked(this.peerId, peer.peerId, this.role, peer.role) &&
        peer.lastIntentPacket
      ) {
        packets.push(peer.lastIntentPacket);
      }
    }
    return packets;
  }

  /**
   * Computes the shared consensus clock offset (ms) across reachable peers in the subgroup.
   */
  public getConsensusClockOffsetMs(): number {
    const reachableOffsets: number[] = [];
    for (const peer of this.knownPeers.values()) {
      if (
        peer.reachable &&
        !this.isEdgeBlocked(this.peerId, peer.peerId, this.role, peer.role) &&
        peer.clockSamples.length > 0
      ) {
        reachableOffsets.push(peer.clockOffsetMs);
      }
    }
    const localNow = this.now();
    return estimateConsensusEpochMs(localNow, reachableOffsets) - localNow;
  }

  public getConsensusEpochMs(): number {
    return this.now() + this.getConsensusClockOffsetMs();
  }

  // ---------------------------------------------------------------------------
  // Software Partition Matrix & Preset Control
  // ---------------------------------------------------------------------------

  /**
   * Applies a live demo partition preset ("SPLIT_2V2", "ISOLATE_LEAD", or "HEAL_ALL")
   * locally and propagates the `PartitionCommand` to all active nodes so clicking
   * a preset button in one tab updates the entire orchestra simultaneously.
   */
  public applyPartitionPreset(preset: PartitionPreset): PartitionCommand {
    const roleEdges = getPresetBlockedRoleEdges(preset);
    const expandedEdges = new Set<string>(roleEdges);

    // Also include explicit peerId::peerId pairs for all currently known peers
    const allNodes: Array<{ peerId: string; role: InstrumentRole }> = [
      { peerId: this.peerId, role: this.role },
      ...Array.from(this.knownPeers.values()).map((p) => ({
        peerId: p.peerId,
        role: p.role,
      })),
    ];

    for (let i = 0; i < allNodes.length; i++) {
      for (let j = i + 1; j < allNodes.length; j++) {
        const a = allNodes[i];
        const b = allNodes[j];
        if (expandedEdges.has(normalizeEdgeKey(a.role, b.role))) {
          expandedEdges.add(normalizeEdgeKey(a.peerId, b.peerId));
        }
      }
    }

    const groups: Record<string, string> = {};
    for (const node of allNodes) {
      if (preset === "SPLIT_2V2") {
        const g =
          node.role === "drums" || node.role === "bass"
            ? "subgroup-rhythm"
            : "subgroup-harmonic";
        groups[node.peerId] = g;
        groups[node.role] = g;
      } else if (preset === "ISOLATE_LEAD") {
        const g =
          node.role === "lead" ? "subgroup-solo-lead" : "subgroup-trio";
        groups[node.peerId] = g;
        groups[node.role] = g;
      } else {
        groups[node.peerId] = "subgroup-unified";
        groups[node.role] = "subgroup-unified";
      }
    }

    const command: PartitionCommand = {
      type: "PARTITION_COMMAND",
      action: preset === "HEAL_ALL" ? "heal" : "split",
      preset,
      partitionId: `${preset}-${this.peerId}-${this.now()}-${++this.frameCounter}`,
      groups,
      blockedEdges: Array.from(expandedEdges).sort(),
      issuedAtMs: this.now(),
    };

    this.applyPartitionCommandInternal(command, true);
    return command;
  }

  public applyPartitionCommand(command: PartitionCommand): void {
    this.applyPartitionCommandInternal(command, false);
  }

  private applyPartitionCommandInternal(
    command: PartitionCommand,
    propagate: boolean
  ): void {
    if (this.seenPartitionIds.has(command.partitionId)) {
      return;
    }
    this.seenPartitionIds.add(command.partitionId);

    if (command.action === "heal" || command.preset === "HEAL_ALL") {
      this.blockedEdges.clear();
      this.activePreset = "HEAL_ALL";
    } else {
      this.blockedEdges.clear();
      const edges =
        command.blockedEdges ??
        (command.preset ? getPresetBlockedRoleEdges(command.preset) : []);
      for (const edge of edges) {
        const parts = edge.split("::");
        if (parts.length === 2) {
          this.blockedEdges.add(normalizeEdgeKey(parts[0], parts[1]));
        }
      }
      if (command.preset) {
        this.activePreset = command.preset;
      }
      this.expandRoleBlockedEdgesToKnownPeers();
    }

    if (propagate) {
      // Control broadcast bypasses the data-plane partition filter so all tabs
      // apply the exact same Software Partition Matrix.
      this.transmitControlMessage(command);
    }

    // When healing, immediately exchange pre-heal IntentPackets across newly
    // unblocked edges BEFORE overwriting partitionGroupId so all nodes can
    // compute the exact same ReconcilePlan from pre-heal subgroup packets.
    if (
      (command.action === "heal" || command.preset === "HEAL_ALL") &&
      this.localIntentPacket
    ) {
      this.sendDataMessage({
        type: "INTENT_PACKET",
        packet: this.localIntentPacket,
      });
    }

    this.syncReachabilityWithMatrix(command.preset ?? null);
  }

  private expandRoleBlockedEdgesToKnownPeers(): void {
    const allNodes: Array<{ peerId: string; role: InstrumentRole }> = [
      { peerId: this.peerId, role: this.role },
      ...Array.from(this.knownPeers.values()).map((p) => ({
        peerId: p.peerId,
        role: p.role,
      })),
    ];

    for (let i = 0; i < allNodes.length; i++) {
      for (let j = i + 1; j < allNodes.length; j++) {
        const a = allNodes[i];
        const b = allNodes[j];
        if (this.blockedEdges.has(normalizeEdgeKey(a.role, b.role))) {
          this.blockedEdges.add(normalizeEdgeKey(a.peerId, b.peerId));
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Packet Broadcasting, Clock Sync & Heartbeat
  // ---------------------------------------------------------------------------

  public broadcastIntentPacket(packet: IntentPacket): void {
    const stamped: IntentPacket = {
      ...packet,
      peerId: this.peerId,
      role: this.role,
      partitionGroupId: this.currentPartitionGroupId,
    };
    this.localIntentPacket = stamped;
    this.sendDataMessage({
      type: "INTENT_PACKET",
      packet: stamped,
    });
  }

  public sendHeartbeat(): void {
    this.announcePresence();
    if (this.localIntentPacket) {
      this.broadcastIntentPacket({
        ...this.localIntentPacket,
        epochTimeMs: this.getConsensusEpochMs(),
      });
    }
    this.pruneTimedOutPeers();
  }

  public sendClockPingNow(): void {
    const ping: ClockPing = {
      type: "CLOCK_PING",
      pingId: `ping-${this.peerId}-${++this.pingCounter}`,
      senderId: this.peerId,
      t1: this.now(),
    };
    this.pendingPings.set(ping.pingId, ping);
    if (this.pendingPings.size > 64) {
      const oldestKey = this.pendingPings.keys().next().value;
      if (oldestKey) {
        this.pendingPings.delete(oldestKey);
      }
    }
    this.sendDataMessage(ping);
  }

  public announcePresence(): void {
    this.sendDataMessage({
      type: "PEER_HELLO",
      peerId: this.peerId,
      role: this.role,
      sentAtMs: this.now(),
    });
  }

  public pruneTimedOutPeers(): void {
    const currentMs = this.now();
    let changed = false;

    for (const peer of this.knownPeers.values()) {
      const blocked = this.isEdgeBlocked(
        this.peerId,
        peer.peerId,
        this.role,
        peer.role
      );
      const timedOut = currentMs - peer.lastSeenMs > this.peerTimeoutMs;
      const shouldBeReachable = !blocked && !timedOut;

      if (peer.reachable !== shouldBeReachable) {
        peer.reachable = shouldBeReachable;
        changed = true;
      }
    }

    if (changed) {
      this.recomputePartitionState(this.activePreset);
    }
  }

  // ---------------------------------------------------------------------------
  // Transport Switching & Lifecycle
  // ---------------------------------------------------------------------------

  public switchTransportMode(mode: TransportMode): void {
    if (this.transportMode === mode) {
      return;
    }
    this.stopTransport();
    this.transportMode = mode;
    this.startTransport();
  }

  public startTimers(): void {
    this.stopTimers();
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat();
    }, this.heartbeatIntervalMs);

    this.clockSyncTimer = setInterval(() => {
      this.sendClockPingNow();
    }, this.clockSyncIntervalMs);
  }

  public stopTimers(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.clockSyncTimer) {
      clearInterval(this.clockSyncTimer);
      this.clockSyncTimer = null;
    }
  }

  public destroy(): void {
    this.stopTimers();
    this.stopTransport();
    this.intentListeners.clear();
    this.partitionListeners.clear();
    this.signallingListeners.clear();
    this.clockListeners.clear();
    this.pulseListeners.clear();
  }

  // ---------------------------------------------------------------------------
  // Internal Transport Implementations ("broadcast" and "webrtc")
  // ---------------------------------------------------------------------------

  private startTransport(): void {
    if (this.transportMode === "broadcast") {
      this.setSignallingStatus("offline");
      this.startBroadcastTransport();
      this.announcePresence();
    } else {
      this.startWebRtcTransport();
    }
  }

  private stopTransport(): void {
    // Clean up BroadcastChannel
    if (this.inMemoryReceiver) {
      const busSet = inMemoryBroadcastBus.get(this.broadcastChannelName);
      busSet?.delete(this.inMemoryReceiver);
      this.inMemoryReceiver = null;
    }
    if (this.nativeBroadcastChannel) {
      try {
        this.nativeBroadcastChannel.close();
      } catch {
        // Ignore close errors
      }
      this.nativeBroadcastChannel = null;
    }

    // Clean up WebSocket signalling
    if (this.ws) {
      try {
        this.ws.onclose = null;
        this.ws.onerror = null;
        this.ws.onmessage = null;
        this.ws.onopen = null;
        this.ws.close();
      } catch {
        // Ignore close errors
      }
      this.ws = null;
    }

    // Clean up WebRTC DataChannels & PeerConnections
    for (const dc of this.dataChannels.values()) {
      try {
        dc.close();
      } catch {
        // Ignore
      }
    }
    this.dataChannels.clear();

    for (const pc of this.peerConnections.values()) {
      try {
        pc.close();
      } catch {
        // Ignore
      }
    }
    this.peerConnections.clear();
  }

  private startBroadcastTransport(): void {
    let busSet = inMemoryBroadcastBus.get(this.broadcastChannelName);
    if (!busSet) {
      busSet = new Set();
      inMemoryBroadcastBus.set(this.broadcastChannelName, busSet);
    }

    this.inMemoryReceiver = (frame: WireFrame) => {
      this.onIncomingWireFrame(frame);
    };
    busSet.add(this.inMemoryReceiver);

    // Also attach browser BroadcastChannel when running in a browser window
    if (
      typeof window !== "undefined" &&
      typeof window.BroadcastChannel !== "undefined"
    ) {
      try {
        const bc = new window.BroadcastChannel(this.broadcastChannelName);
        bc.onmessage = (ev: MessageEvent) => {
          if (ev?.data && typeof ev.data === "object") {
            this.onIncomingWireFrame(ev.data as WireFrame);
          }
        };
        this.nativeBroadcastChannel = bc;
      } catch {
        this.nativeBroadcastChannel = null;
      }
    }
  }

  private startWebRtcTransport(): void {
    this.setSignallingStatus("connecting");

    let socket: WebSocketLike | null = null;
    try {
      if (this.webSocketFactory) {
        socket = this.webSocketFactory(this.signallingUrl);
      } else if (typeof WebSocket !== "undefined") {
        socket = new WebSocket(this.signallingUrl) as unknown as WebSocketLike;
      }
    } catch {
      this.setSignallingStatus("disconnected");
      return;
    }

    if (!socket) {
      this.setSignallingStatus("disconnected");
      return;
    }

    this.ws = socket;

    socket.onopen = () => {
      this.setSignallingStatus("connected");
      this.sendSignalEnvelope({
        roomId: this.roomId,
        senderPeerId: this.peerId,
        payload: {
          type: "PEER_ANNOUNCE",
          role: this.role,
        },
      });
    };

    socket.onmessage = (ev) => {
      try {
        const raw =
          typeof ev.data === "string" ? ev.data : String(ev.data ?? "");
        const envelope = JSON.parse(raw) as SignalEnvelope;
        this.handleSignalEnvelope(envelope);
      } catch {
        // Ignore malformed signalling packets
      }
    };

    // INVARIANT #2: Closing or killing the signalling server mid-performance
    // must NOT drop open RTCDataChannels or throw unhandled errors.
    socket.onerror = () => {
      // Handled gracefully; status transitions on close or immediately
    };

    socket.onclose = () => {
      this.ws = null;
      this.setSignallingStatus("disconnected");
    };
  }

  private sendSignalEnvelope(envelope: SignalEnvelope): void {
    if (!this.ws || this.ws.readyState !== 1) {
      return;
    }
    try {
      this.ws.send(JSON.stringify(envelope));
    } catch {
      // Ignore send errors if signalling server disconnected
    }
  }

  private handleSignalEnvelope(envelope: SignalEnvelope): void {
    if (
      !envelope ||
      envelope.roomId !== this.roomId ||
      envelope.senderPeerId === this.peerId
    ) {
      return;
    }
    if (envelope.targetPeerId && envelope.targetPeerId !== this.peerId) {
      return;
    }

    const remotePeerId = envelope.senderPeerId;
    const payload = envelope.payload;

    if ("role" in payload && payload.role) {
      this.registerKnownPeer(remotePeerId, payload.role, false);
    }

    switch (payload.type) {
      case "PEER_ANNOUNCE":
      case "peer-join": {
        // Reply with targeted announce if this wasn't already targeted to us
        if (!envelope.targetPeerId) {
          this.sendSignalEnvelope({
            roomId: this.roomId,
            senderPeerId: this.peerId,
            targetPeerId: remotePeerId,
            payload: {
              type: "PEER_ANNOUNCE",
              role: this.role,
            },
          });
        }
        // Deterministic initiator rule: lower peerId initiates offer
        if (
          this.peerId < remotePeerId &&
          !this.peerConnections.has(remotePeerId)
        ) {
          void this.initiateWebRtcOffer(remotePeerId);
        }
        break;
      }

      case "SDP_OFFER":
      case "sdp-offer": {
        void this.handleWebRtcOffer(remotePeerId, payload.sdp);
        break;
      }

      case "SDP_ANSWER":
      case "sdp-answer": {
        void this.handleWebRtcAnswer(remotePeerId, payload.sdp);
        break;
      }

      case "ICE_CANDIDATE":
      case "ice-candidate": {
        const pc = this.peerConnections.get(remotePeerId);
        if (pc && payload.candidate) {
          void pc
            .addIceCandidate(payload.candidate as Record<string, unknown>)
            .catch(() => {});
        }
        break;
      }

      case "PARTITION_COMMAND":
      case "partition-command": {
        this.applyPartitionCommandInternal(payload.command, false);
        break;
      }

      case "PEER_LEAVE":
      case "peer-leave": {
        // INVARIANT #2: If we have an open RTCDataChannel to remotePeerId,
        // do NOT drop it when the signalling server emits PEER_LEAVE.
        const dc = this.dataChannels.get(remotePeerId);
        if (!dc || dc.readyState !== "open") {
          const peer = this.knownPeers.get(remotePeerId);
          if (peer && peer.reachable) {
            peer.reachable = false;
            this.recomputePartitionState(this.activePreset);
          }
        }
        break;
      }
    }
  }

  private createOrGetPeerConnection(
    remotePeerId: string
  ): RTCPeerConnectionLike | null {
    const existing = this.peerConnections.get(remotePeerId);
    if (existing) {
      return existing;
    }

    const config: RTCConfiguration = {
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    };

    let pc: RTCPeerConnectionLike | null = null;
    if (this.rtcPeerConnectionFactory) {
      pc = this.rtcPeerConnectionFactory(config);
    } else if (typeof RTCPeerConnection !== "undefined") {
      pc = new RTCPeerConnection(config) as unknown as RTCPeerConnectionLike;
    }

    if (!pc) {
      return null;
    }

    this.peerConnections.set(remotePeerId, pc);

    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        this.sendSignalEnvelope({
          roomId: this.roomId,
          senderPeerId: this.peerId,
          targetPeerId: remotePeerId,
          payload: {
            type: "ICE_CANDIDATE",
            candidate: ev.candidate as Record<string, unknown>,
          },
        });
      }
    };

    pc.ondatachannel = (ev) => {
      if (ev.channel) {
        this.attachDataChannel(remotePeerId, ev.channel);
      }
    };

    return pc;
  }

  private async initiateWebRtcOffer(remotePeerId: string): Promise<void> {
    const pc = this.createOrGetPeerConnection(remotePeerId);
    if (!pc) {
      return;
    }
    const dc = pc.createDataChannel("symphony-data");
    this.attachDataChannel(remotePeerId, dc);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    this.sendSignalEnvelope({
      roomId: this.roomId,
      senderPeerId: this.peerId,
      targetPeerId: remotePeerId,
      payload: {
        type: "SDP_OFFER",
        sdp: offer,
        role: this.role,
      },
    });
  }

  private async handleWebRtcOffer(
    remotePeerId: string,
    sdp: { type: string; sdp?: string }
  ): Promise<void> {
    const pc = this.createOrGetPeerConnection(remotePeerId);
    if (!pc) {
      return;
    }
    await pc.setRemoteDescription(sdp);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    this.sendSignalEnvelope({
      roomId: this.roomId,
      senderPeerId: this.peerId,
      targetPeerId: remotePeerId,
      payload: {
        type: "SDP_ANSWER",
        sdp: answer,
        role: this.role,
      },
    });
  }

  private async handleWebRtcAnswer(
    remotePeerId: string,
    sdp: { type: string; sdp?: string }
  ): Promise<void> {
    const pc = this.peerConnections.get(remotePeerId);
    if (!pc) {
      return;
    }
    await pc.setRemoteDescription(sdp);
  }

  private attachDataChannel(
    remotePeerId: string,
    dc: RTCDataChannelLike
  ): void {
    this.dataChannels.set(remotePeerId, dc);

    const onOpen = () => {
      this.announcePresence();
      this.sendClockPingNow();
      if (this.localIntentPacket) {
        this.broadcastIntentPacket(this.localIntentPacket);
      }
    };

    dc.onopen = onOpen;
    if (dc.readyState === "open") {
      onOpen();
    }

    dc.onmessage = (ev) => {
      try {
        const text =
          typeof ev.data === "string" ? ev.data : String(ev.data ?? "");
        const frame = JSON.parse(text) as WireFrame;
        this.onIncomingWireFrame(frame);
      } catch {
        // Ignore malformed data channel frames
      }
    };

    dc.onclose = () => {
      this.dataChannels.delete(remotePeerId);
      const peer = this.knownPeers.get(remotePeerId);
      if (peer && peer.reachable) {
        peer.reachable = false;
        this.recomputePartitionState(this.activePreset);
      }
    };
  }

  // ---------------------------------------------------------------------------
  // Data-Plane vs Control-Plane Wire Routing & Software Partition Matrix Filter
  // ---------------------------------------------------------------------------

  private sendDataMessage(
    message: PeerWireMessage,
    targetPeerId?: string
  ): void {
    if (this.transportMode === "broadcast") {
      // If we have known peers, check edge blocking per recipient
      if (targetPeerId) {
        const targetPeer = this.knownPeers.get(targetPeerId);
        if (
          this.isEdgeBlocked(
            this.peerId,
            targetPeerId,
            this.role,
            targetPeer?.role
          )
        ) {
          return;
        }
        this.emitBroadcastFrame(message, targetPeerId);
        this.emitPulse(this.peerId, targetPeerId, message.type);
        return;
      }

      // Broadcast frame to channel; receivers and sender both enforce the Software Partition Matrix
      this.emitBroadcastFrame(message);
      for (const peer of this.knownPeers.values()) {
        if (
          !this.isEdgeBlocked(this.peerId, peer.peerId, this.role, peer.role)
        ) {
          this.emitPulse(this.peerId, peer.peerId, message.type);
        }
      }
      return;
    }

    // WebRTC mode: send over open RTCDataChannels for non-blocked peers
    for (const [remotePeerId, dc] of this.dataChannels.entries()) {
      if (targetPeerId && remotePeerId !== targetPeerId) {
        continue;
      }
      if (dc.readyState !== "open") {
        continue;
      }
      const peer = this.knownPeers.get(remotePeerId);
      if (
        this.isEdgeBlocked(this.peerId, remotePeerId, this.role, peer?.role)
      ) {
        // Software Partition Matrix: drop data-plane traffic while keeping RTCDataChannel open!
        continue;
      }

      const frame: WireFrame = {
        frameId: `${this.peerId}-${++this.frameCounter}`,
        roomId: this.roomId,
        senderPeerId: this.peerId,
        senderRole: this.role,
        targetPeerId: remotePeerId,
        message,
      };
      try {
        dc.send(JSON.stringify(frame));
        this.emitPulse(this.peerId, remotePeerId, message.type);
      } catch {
        // Ignore transient channel errors
      }
    }
  }

  /**
   * Sends a `PartitionCommand` over the control path (bypassing blocked edges)
   * so all tabs/nodes update their Software Partition Matrix in lockstep.
   */
  private transmitControlMessage(command: PartitionCommand): void {
    if (this.transportMode === "broadcast") {
      this.emitBroadcastFrame(command);
      return;
    }

    // Send over all open RTCDataChannels regardless of software partition blocks
    for (const [remotePeerId, dc] of this.dataChannels.entries()) {
      if (dc.readyState !== "open") {
        continue;
      }
      const frame: WireFrame = {
        frameId: `${this.peerId}-${++this.frameCounter}`,
        roomId: this.roomId,
        senderPeerId: this.peerId,
        senderRole: this.role,
        targetPeerId: remotePeerId,
        message: command,
      };
      try {
        dc.send(JSON.stringify(frame));
      } catch {
        // Ignore
      }
    }

    // Also broadcast via signalling server if connected
    this.sendSignalEnvelope({
      roomId: this.roomId,
      senderPeerId: this.peerId,
      payload: {
        type: "PARTITION_COMMAND",
        command,
      },
    });
  }

  private emitBroadcastFrame(
    message: PeerWireMessage,
    targetPeerId?: string
  ): void {
    const frame: WireFrame = {
      frameId: `${this.peerId}-${++this.frameCounter}`,
      roomId: this.roomId,
      senderPeerId: this.peerId,
      senderRole: this.role,
      targetPeerId,
      message,
    };

    const busSet = inMemoryBroadcastBus.get(this.broadcastChannelName);
    if (busSet) {
      inMemoryBroadcastQueue.push({
        channelName: this.broadcastChannelName,
        senderReceiver: this.inMemoryReceiver,
        frame,
      });

      if (!isFlushingBroadcastQueue) {
        isFlushingBroadcastQueue = true;
        try {
          while (inMemoryBroadcastQueue.length > 0) {
            const item = inMemoryBroadcastQueue.shift()!;
            const receivers = inMemoryBroadcastBus.get(item.channelName);
            if (!receivers) {
              continue;
            }
            for (const receiver of Array.from(receivers)) {
              if (receiver !== item.senderReceiver) {
                receiver(item.frame);
              }
            }
          }
        } finally {
          isFlushingBroadcastQueue = false;
        }
      }
    }

    if (this.nativeBroadcastChannel) {
      try {
        this.nativeBroadcastChannel.postMessage(frame);
      } catch {
        // Ignore
      }
    }
  }

  private onIncomingWireFrame(frame: WireFrame): void {
    if (
      !frame ||
      frame.roomId !== this.roomId ||
      frame.senderPeerId === this.peerId
    ) {
      return;
    }
    if (frame.targetPeerId && frame.targetPeerId !== this.peerId) {
      return;
    }
    if (this.seenFrameIds.has(frame.frameId)) {
      return;
    }
    this.seenFrameIds.add(frame.frameId);
    if (this.seenFrameIds.size > 512) {
      const oldest = this.seenFrameIds.values().next().value;
      if (oldest) {
        this.seenFrameIds.delete(oldest);
      }
    }

    const { senderPeerId, senderRole, message } = frame;

    // Control plane: PartitionCommands always apply across all nodes
    if (message.type === "PARTITION_COMMAND") {
      this.registerKnownPeer(senderPeerId, senderRole, false);
      this.applyPartitionCommandInternal(message, false);
      return;
    }

    const isNewPeer = !this.knownPeers.has(senderPeerId);
    // Register that the peer exists in the orchestra
    this.registerKnownPeer(senderPeerId, senderRole, false);

    // Software Partition Matrix check: drop all data-plane packets (IntentPacket,
    // ClockPing, ClockPong, PEER_HELLO) across blocked edges!
    if (this.isEdgeBlocked(this.peerId, senderPeerId, this.role, senderRole)) {
      return;
    }

    // Edge is unblocked: update reachability & lastSeenMs
    const peer = this.knownPeers.get(senderPeerId)!;
    const wasReachable = peer.reachable;
    peer.lastSeenMs = this.now();
    peer.reachable = true;

    if (isNewPeer) {
      // Reply with presence so newly joined peer immediately discovers us too
      this.sendDataMessage(
        {
          type: "PEER_HELLO",
          peerId: this.peerId,
          role: this.role,
          sentAtMs: this.now(),
        },
        senderPeerId
      );
    }

    if (!wasReachable || isNewPeer) {
      this.recomputePartitionState(this.activePreset);
    }

    this.emitPulse(senderPeerId, this.peerId, message.type);

    switch (message.type) {
      case "PEER_HELLO": {
        break;
      }

      case "INTENT_PACKET": {
        peer.lastIntentPacket = message.packet;
        for (const listener of this.intentListeners) {
          listener(message.packet, senderPeerId);
        }
        break;
      }

      case "CLOCK_PING": {
        const t2 = this.now();
        const pong: ClockPong = {
          type: "CLOCK_PONG",
          pingId: message.pingId,
          senderId: message.senderId,
          responderId: this.peerId,
          t1: message.t1,
          t2,
          t3: this.now(),
        };
        this.sendDataMessage(pong, senderPeerId);
        break;
      }

      case "CLOCK_PONG": {
        if (message.senderId !== this.peerId) {
          break;
        }
        const ping = this.pendingPings.get(message.pingId);
        if (!ping) {
          break;
        }
        const t4 = this.now();
        const sample = computeClockSample(ping, message, t4);

        peer.clockSamples.push(sample);
        if (peer.clockSamples.length > 8) {
          peer.clockSamples.shift();
        }
        peer.latestRttMs = sample.rttMs;
        peer.clockOffsetMs = estimatePeerClockOffset(peer.clockSamples, 4);

        const consensusOffsetMs = this.getConsensusClockOffsetMs();
        const updateEvent: PeerClockUpdateEvent = {
          peerId: senderPeerId,
          peerOffsetMs: peer.clockOffsetMs,
          rttMs: sample.rttMs,
          consensusOffsetMs,
          consensusEpochMs: this.now() + consensusOffsetMs,
        };
        for (const listener of this.clockListeners) {
          listener(updateEvent);
        }
        break;
      }
    }
  }

  private registerKnownPeer(
    peerId: string,
    role: InstrumentRole,
    markReachable: boolean
  ): void {
    let existing = this.knownPeers.get(peerId);
    if (!existing) {
      existing = {
        peerId,
        role,
        lastSeenMs: this.now(),
        reachable:
          markReachable &&
          !this.isEdgeBlocked(this.peerId, peerId, this.role, role),
      clockSamples: [],
        clockOffsetMs: 0,
        latestRttMs: 0,
        lastIntentPacket: null,
      };
      this.knownPeers.set(peerId, existing);
      this.expandRoleBlockedEdgesToKnownPeers();
    } else {
      existing.role = role;
    }
  }

  private resolveRole(peerOrRole: string): InstrumentRole | undefined {
    if (
      peerOrRole === "drums" ||
      peerOrRole === "bass" ||
      peerOrRole === "piano" ||
      peerOrRole === "lead"
    ) {
      return peerOrRole;
    }
    if (peerOrRole === this.peerId) {
      return this.role;
    }
    return this.knownPeers.get(peerOrRole)?.role;
  }

  private syncReachabilityWithMatrix(preset: PartitionPreset | null): void {
    const currentMs = this.now();
    for (const peer of this.knownPeers.values()) {
      const blocked = this.isEdgeBlocked(
        this.peerId,
        peer.peerId,
        this.role,
        peer.role
      );
      if (blocked) {
        peer.reachable = false;
      } else {
        // In broadcast mode or with an open DataChannel, unblocking immediately
        // restores link reachability for zero-handshake healing.
        const hasOpenChannel =
          this.transportMode === "broadcast" ||
          this.dataChannels.get(peer.peerId)?.readyState === "open";
        if (hasOpenChannel) {
          peer.reachable = true;
          peer.lastSeenMs = currentMs;
        }
      }
    }
    this.recomputePartitionState(preset);
  }

  private recomputePartitionState(preset: PartitionPreset | null): void {
    const previousPartitionGroupId = this.currentPartitionGroupId;
    const wasPartitioned = this.currentlyPartitioned;

    const nextPartitionGroupId = this.computePartitionGroupId();
    const nextIsPartitioned = this.isPartitioned();

    this.currentPartitionGroupId = nextPartitionGroupId;
    this.currentlyPartitioned = nextIsPartitioned;

    if (
      previousPartitionGroupId === nextPartitionGroupId &&
      wasPartitioned === nextIsPartitioned &&
      preset === null
    ) {
      return;
    }

    const reconnected =
      (wasPartitioned && !nextIsPartitioned) ||
      preset === "HEAL_ALL";

    const reconcilePackets: IntentPacket[] = [];
    if (this.localIntentPacket) {
      reconcilePackets.push(this.localIntentPacket);
    }
    for (const peer of this.knownPeers.values()) {
      if (peer.reachable && peer.lastIntentPacket) {
        reconcilePackets.push(peer.lastIntentPacket);
      }
    }

    const leaderPeerId = this.getSubgroupLeaderPeerId();
    const event: PartitionChangeEvent = {
      partitionGroupId: nextPartitionGroupId,
      previousPartitionGroupId,
      isPartitioned: nextIsPartitioned,
      wasPartitioned,
      reconnected,
      preset,
      reachablePeers: this.getReachablePeerIds(),
      reachableRoles: this.getReachableRoles(),
      knownPeers: this.getKnownPeerIds(),
      blockedEdges: this.getBlockedEdges(),
      leaderPeerId,
      isLeader: leaderPeerId === this.peerId,
      reconcilePackets,
    };

    for (const listener of this.partitionListeners) {
      listener(event);
    }
  }

  private setSignallingStatus(status: SignallingStatus): void {
    if (this.signallingStatus === status) {
      return;
    }
    this.signallingStatus = status;
    for (const listener of this.signallingListeners) {
      listener(status);
    }
  }

  private emitPulse(
    fromPeerId: string,
    toPeerId: string,
    type: PeerWireMessage["type"]
  ): void {
    const pulse: PacketEdgePulseEvent = {
      fromPeerId,
      toPeerId,
      type,
      timestampMs: this.now(),
    };
    for (const listener of this.pulseListeners) {
      listener(pulse);
    }
  }
}

/**
 * Helper to resolve initial transport mode from URL search params (`?transport=webrtc|broadcast`),
 * defaulting to `"broadcast"` for zero-config local multi-tab operation.
 */
export function resolveInitialTransportMode(
  search: string = typeof window !== "undefined" ? window.location.search : ""
): TransportMode {
  const params = new URLSearchParams(search);
  const mode = params.get("transport");
  if (mode === "webrtc" || mode === "broadcast") {
    return mode;
  }
  return "broadcast";
}

/**
 * Resolves the WebSocket signalling URL for WebRTC discovery:
 * 1. Uses `?signal=ws://...` query parameter if provided.
 * 2. Otherwise defaults to `ws://${window.location.hostname || "localhost"}:8080`
 *    so multi-laptop LAN/hotspot connections automatically use the host's LAN IP.
 */
export function resolveSignallingUrl(
  search: string = typeof window !== "undefined" ? window.location.search : "",
  hostname: string = typeof window !== "undefined" && window.location.hostname
    ? window.location.hostname
    : "localhost"
): string {
  const params = new URLSearchParams(search);
  const override = params.get("signal")?.trim();
  if (override && (override.startsWith("ws://") || override.startsWith("wss://"))) {
    return override;
  }
  const safeHost = hostname.trim() || "localhost";
  return `ws://${safeHost}:8080`;
}
