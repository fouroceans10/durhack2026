import { describe, expect, it } from "vitest";
import type { ClockPing, ClockPong } from "../../../../shared/types";
import {
  computeBeatMetrics,
  computeClockSample,
  computeKuramotoPhaseNudge,
  computeNextBarBoundaryMs,
  estimateConsensusEpochMs,
  estimatePeerClockOffset,
  wrapBeatPhaseDiff,
} from "../clockSync";

describe("clockSync module", () => {
  it("computes NTP clock offset and round-trip delay from 4 timestamps", () => {
    // Peer B clock is +50ms ahead of Peer A, network one-way delay is 10ms each way (RTT = 20ms)
    const ping: ClockPing = {
      type: "CLOCK_PING",
      pingId: "ping-1",
      senderId: "peer-A",
      t1: 1000,
    };
    const pong: ClockPong = {
      type: "CLOCK_PONG",
      pingId: "ping-1",
      senderId: "peer-A",
      responderId: "peer-B",
      t1: 1000,
      t2: 1060, // 1000 + 10ms transit + 50ms clock skew
      t3: 1065, // +5ms processing on B
    };
    const t4 = 1025; // 1065 - 50ms clock skew + 10ms return transit

    const sample = computeClockSample(ping, pong, t4);
    expect(sample.rttMs).toBe(20);
    expect(sample.offsetMs).toBe(50);
  });

  it("rejects high-RTT jitter spikes when estimating peer clock offset", () => {
    const samples = [
      { pingId: "1", peerId: "B", rttMs: 12, offsetMs: 40, sampledAtMs: 100 },
      { pingId: "2", peerId: "B", rttMs: 14, offsetMs: 42, sampledAtMs: 200 },
      { pingId: "3", peerId: "B", rttMs: 15, offsetMs: 41, sampledAtMs: 300 },
      { pingId: "4", peerId: "B", rttMs: 250, offsetMs: 180, sampledAtMs: 400 }, // asymmetric spike
    ];

    const estimated = estimatePeerClockOffset(samples, 3);
    expect(estimated).toBe(41);
  });

  it("converges symmetrically on consensus epoch time across peers", () => {
    // Peer A at 1000ms sees Peer B at +40ms (1040ms); Peer B at 1040ms sees Peer A at -40ms
    const consensusFromA = estimateConsensusEpochMs(1000, [40]);
    const consensusFromB = estimateConsensusEpochMs(1040, [-40]);
    expect(consensusFromA).toBe(1020);
    expect(consensusFromB).toBe(1020);
  });

  it("maps epoch time and BPM to barNumber, beatPhase [0..4), and 16th steps", () => {
    // At 120 BPM: 1 beat = 500ms, 1 bar (4 beats) = 2000ms
    const m0 = computeBeatMetrics(0, 120);
    expect(m0.barNumber).toBe(0);
    expect(m0.beatPhase).toBe(0);
    expect(m0.stepIndex16th).toBe(0);

    const mMid = computeBeatMetrics(2750, 120); // 1 full bar (2000ms) + 1.5 beats (750ms)
    expect(mMid.barNumber).toBe(1);
    expect(mMid.beatPhase).toBe(1.5);
    expect(mMid.stepIndex16th).toBe(6);
    expect(mMid.nextBarEpochMs).toBe(4000);

    expect(computeNextBarBoundaryMs(2750, 120)).toBe(4000);
  });

  it("wraps circular beatPhase differences across the 0.0 / 4.0 bar boundary", () => {
    expect(wrapBeatPhaseDiff(3.8, 0.2)).toBeCloseTo(0.4, 5);
    expect(wrapBeatPhaseDiff(0.2, 3.8)).toBeCloseTo(-0.4, 5);
    expect(wrapBeatPhaseDiff(1.0, 2.5)).toBeCloseTo(1.5, 5);
  });

  it("computes Kuramoto oscillator phase nudges toward phase lock", () => {
    // Local peer at beat 3.9, remote peer slightly ahead at beat 0.1 (wrapped +0.2 beats)
    const positiveNudge = computeKuramotoPhaseNudge(3.9, [0.1], 0.3);
    expect(positiveNudge).toBeGreaterThan(0);

    // Local peer at beat 0.1, remote peer behind at beat 3.9 (wrapped -0.2 beats)
    const negativeNudge = computeKuramotoPhaseNudge(0.1, [3.9], 0.3);
    expect(negativeNudge).toBeLessThan(0);
    expect(positiveNudge).toBeCloseTo(-negativeNudge, 5);
  });
});
