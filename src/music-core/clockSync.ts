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
