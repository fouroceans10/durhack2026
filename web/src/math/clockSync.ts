import type { ClockPing, ClockPong } from "../../../shared/types";

export interface ClockSample {
  pingId: string;
  peerId: string;
  rttMs: number;
  offsetMs: number;
  sampledAtMs: number;
}

export interface BeatMetrics {
  barNumber: number;
  beatPhase: number;       // 0.0 .. 4.0
  stepIndex16th: number;   // 0 .. 15 within current bar
  beatDurationMs: number;
  barDurationMs: number;
  nextBarEpochMs: number;
}

/**
 * Cristian / NTP 4-timestamp clock synchronization sample calculation.
 * Given `ping` (with `t1`), `pong` (with `t1`, `t2`, `t3`), and local receive timestamp `t4`:
 * - `rttMs = (t4 - t1) - (t3 - t2)`
 * - `offsetMs = ((t2 - t1) + (t3 - t4)) / 2`
 */
export function computeClockSample(
  ping: ClockPing,
  pong: ClockPong,
  t4: number
): ClockSample {
  if (ping.pingId !== pong.pingId) {
    throw new Error(
      `Mismatched pingId: expected "${ping.pingId}", got "${pong.pingId}"`
    );
  }
  const t1 = ping.t1;
  const { t2, t3 } = pong;
  const rawRtt = t4 - t1 - (t3 - t2);
  const rttMs = Math.max(0, rawRtt);
  const offsetMs = (t2 - t1 + (t3 - t4)) / 2;

  return {
    pingId: ping.pingId,
    peerId: pong.responderId,
    rttMs,
    offsetMs,
    sampledAtMs: t4,
  };
}

/**
 * Estimates a stable clock offset (ms) from recent NTP samples by selecting the
 * `bestK` lowest-RTT samples (least queuing delay) and returning their median offset.
 */
export function estimatePeerClockOffset(
  samples: readonly ClockSample[],
  bestK = 4
): number {
  if (samples.length === 0) {
    return 0;
  }

  const byLowestRtt = [...samples]
    .sort((a, b) => a.rttMs - b.rttMs || a.sampledAtMs - b.sampledAtMs)
    .slice(0, Math.max(1, bestK));

  const offsets = byLowestRtt.map((s) => s.offsetMs).sort((a, b) => a - b);
  const mid = Math.floor(offsets.length / 2);

  if (offsets.length % 2 === 1) {
    return offsets[mid];
  }
  return (offsets[mid - 1] + offsets[mid]) / 2;
}

/**
 * Computes decentralized consensus epoch time (ms) from local clock and active peer offsets.
 * Includes the local node (offset = 0) with equal weight so N peers converge symmetrically.
 */
export function estimateConsensusEpochMs(
  localEpochMs: number,
  peerOffsetsMs: readonly number[]
): number {
  if (peerOffsetsMs.length === 0) {
    return localEpochMs;
  }
  const sumOffsets = peerOffsetsMs.reduce((acc, offset) => acc + offset, 0);
  const meanOffset = sumOffsets / (peerOffsetsMs.length + 1);
  return localEpochMs + meanOffset;
}

/**
 * Deterministically maps an epoch timestamp (ms) and BPM to bar number,
 * beatPhase in [0.0, 4.0), and 16th-note step index in [0..15].
 */
export function computeBeatMetrics(
  epochTimeMs: number,
  bpm: number,
  originEpochMs = 0
): BeatMetrics {
  const safeBpm = Math.max(20, Math.min(300, bpm));
  const beatDurationMs = 60_000 / safeBpm;
  const barDurationMs = beatDurationMs * 4;
  const elapsedMs = Math.max(0, epochTimeMs - originEpochMs);

  const totalBarsFloat = elapsedMs / barDurationMs;
  const barNumber = Math.floor(totalBarsFloat);
  const barFraction = totalBarsFloat - barNumber; // [0.0, 1.0)
  const beatPhase = Number((barFraction * 4.0).toFixed(6)) % 4.0;
  const stepIndex16th = Math.min(15, Math.floor(barFraction * 16));
  const nextBarEpochMs = Math.ceil((barNumber + 1) * barDurationMs + originEpochMs);

  return {
    barNumber,
    beatPhase,
    stepIndex16th,
    beatDurationMs,
    barDurationMs,
    nextBarEpochMs,
  };
}

/**
 * Quantizes an epoch timestamp (ms) forward to the next deterministic bar boundary.
 */
export function computeNextBarBoundaryMs(
  epochTimeMs: number,
  bpm: number,
  originEpochMs = 0
): number {
  const safeBpm = Math.max(20, Math.min(300, bpm));
  const barDurationMs = (60_000 / safeBpm) * 4;
  const elapsedMs = Math.max(0, epochTimeMs - originEpochMs);
  const nextBarIndex = Math.floor(elapsedMs / barDurationMs) + 1;
  return Math.round(originEpochMs + nextBarIndex * barDurationMs);
}

/**
 * Shortest signed phase difference on a circular [0, beatsPerBar) ring,
 * returning a value in [-beatsPerBar / 2, +beatsPerBar / 2].
 */
export function wrapBeatPhaseDiff(
  fromPhase: number,
  toPhase: number,
  beatsPerBar = 4.0
): number {
  const half = beatsPerBar / 2;
  const raw =
    ((((toPhase - fromPhase) % beatsPerBar) + beatsPerBar + half) %
      beatsPerBar) -
    half;
  // Normalize -half tie to +half for determinism
  return raw === -half ? half : Number(raw.toFixed(6));
}

/**
 * Decentralized Kuramoto coupled-oscillator phase nudge on [0.0, 4.0):
 *   dPhi = (K / N) * sum_j (beatsPerBar / 2pi) * sin(2pi * (phi_j - phi_local) / beatsPerBar)
 * Smoothly pulls peers into beat-phase lock without a central conductor.
 */
export function computeKuramotoPhaseNudge(
  localBeatPhase: number,
  peerBeatPhases: readonly number[],
  couplingStrength = 0.25,
  beatsPerBar = 4.0
): number {
  if (peerBeatPhases.length === 0 || couplingStrength === 0) {
    return 0;
  }

  const twoPi = 2 * Math.PI;
  let sinSum = 0;
  for (const peerPhase of peerBeatPhases) {
    const angle = (twoPi * (peerPhase - localBeatPhase)) / beatsPerBar;
    sinSum += Math.sin(angle);
  }

  const nudge =
    (couplingStrength / peerBeatPhases.length) *
    (beatsPerBar / twoPi) *
    sinSum;

  return Number(nudge.toFixed(6));
}
