---
trigger: always_on
---

# Symphony Without a Conductor — Strict Workspace Invariants

1. **Zero React State or Timers in the Audio Loop:**
   - NEVER trigger `Tone.js` notes inside React `useEffect`, `useState` setters, or `setInterval`.
   - All synthesis scheduling MUST run inside `Tone.Transport.scheduleRepeat` or `Tone.Loop`, reading exclusively from a mutable engine reference (`engineStateRef.current`).
2. **Signalling Server Fault Tolerance:**
   - `signalling/server.ts` is strictly a stateless WebSocket SDP/ICE relay.
   - It must hold zero musical state, zero clock state, and zero conductor logic. Killing the signalling server mid-performance must have zero effect on connected peers.
3. **Deterministic Mathematical Reconciliation:**
   - When partitioned sub-groups reconnect, neither overwrites the other. Both sides must independently compute the exact same `ReconcilePlan` (symmetric `targetBpm`, shared Circle-of-Fifths `pivotChord`, and combined `adoptedMotifs`) from exchanged `IntentPacket`s regardless of packet arrival order.
4. **Always Verify Before Completing a Task:**
   - Always run `npm run typecheck` and `npm test` after modifying engine, math, or networking files.
