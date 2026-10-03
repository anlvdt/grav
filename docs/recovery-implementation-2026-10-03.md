# Recovery and job lifecycle implementation — 2026-10-03

## Scope and audit findings

Audited the marketplace learning report at `/Users/anle/.codex/worktrees/5d28/Grav/docs/marketplace-learning-2026-10-03.md` against the current dirty checkout. Its recovery recommendation is applicable, but CDP already owned reconnect, heartbeat, discovery, policy renewal and observer installation timers. Those existing paths were hardened rather than adding a parallel supervisor loop. There is no separate native worker in these owned modules to restart.

The lifecycle recommendation also applies: approval clicks, disappearing controls, message-end and terminal command exit do not establish a full job's completion. No authoritative full-job producer is available in these sources, so live completion rates remain unknown until such a producer is mapped. The implemented host API and fixtures demonstrate the metrics contract without claiming live host support.

## Implemented behavior and source wiring

- `src/cdp.js`: single-flight connect; connection epochs fence retired socket, HTTP discovery, policy ACK, discovery, attach and heartbeat callbacks; pre-open close and handshake watchdog settle their promises; pending commands reject on disconnect; explicit stop suppresses delayed reconnect. Socket error/close produces one existing reconnect timer. Automatic-port failures rediscover instead of retaining a dead port. Backoff resets after three verified executor policy ACKs, rather than WebSocket open. The old fifth-attempt manual restart warning was removed.
- `src/recovery-supervisor.js`: no timers and no interaction executor. CDP's existing heartbeat invokes at most three installations per target per burst, followed by a 60-second cooldown and automatic retry. Three consecutive fresh policy-backed healthy heartbeat checks establish stable repair. Overlap is excluded; unhealthy checks reset stability. Existing renderer intent coordinator remains the actuation authority.
- `src/state.js`: bounded host attempt tombstones keyed by stable renderer URL. Known CDP CLICK intent IDs are retained across disconnect and document replacement; `injectObserver` merges them into the renderer ledger **before** observer installation. It preserves existing ledger state and unknown outcomes. Journal saturation disables further CDP policy actuation rather than evicting tombstones into retry permission.
- `src/bridge.js`: listener error/unexpected close restarts automatically; first three repairs use 1/2/4-second delays, then 60 seconds. Error plus close cannot duplicate the restart. Explicit stop cancels it. Server generations exclude stale listen callbacks and request bodies. The previous listener port is preferred; runtime's existing port rediscovery remains responsible for rebinding its client. Host settings are untouched.
- Bridge status carries authoritative `interactionHost`, `autopilotProfile`, `permissionProfile`, `permissionRules`, `resumeToken`, and `eventScheduler`; unsupported decision rules are omitted. It additionally exposes scoped `intentTombstones` from the URL query `surfaceUrl`. Runtime click-log events with `surfaceUrl` contribute observed attempts to the host journal.
- Bridge chat-event and CDP CHAT paths call optional `onJobObservation` with forced `type: 'progress'` and `evidence: 'renderer-observation'`. A renderer-supplied completion/evidence claim cannot become host completion through these paths. The extension owner has wired these observation callbacks and exposed `jobMetrics` through the third `summarizePilot` argument in the shared checkout.
- `src/job-tracker.js`, `src/observability.js`, `src/pilot-metrics.js`: persisted job ledger independent of the 60-entry UI trace. Host-confirmed starts form the denominator; failed and unknown jobs remain in it. Only host-confirmed completion can enter success/unattended counts. Setup interventions are separate; waits are attributed to approval/question/quota/recovery/other. Recovery duration ends on host progress or completion, never socket open. Automatic recovery rate excludes recovery episodes with intervening human actions. Duplicate event IDs, stale host sequences and events after a terminal job state cannot replay lifecycle transitions. Capacity refuses additional evidence rather than reporting success.

## Integration contract

`createObservabilityState()` now exposes:

```js
observability.recordJobEvent({
    jobId: 'stable-host-job-id',
    eventId: 'unique-host-event-id',
    type: 'started',
    evidence: 'host-job-lifecycle',
    sequence: 1, // optional, monotonically increasing within the host job
});
```

Supported types: `started`, `progress`, `waiting`, `completed`, `failed`, `intervention`, `recovery-start`. `waiting` uses `waitReason` in `approval|question|quota|recovery|other`; interventions use `phase: 'setup'` only for initial setup. A host producer should supply a new job ID for a distinct run and a stable unique event ID for deduplication; host sequences reject out-of-order callbacks. Renderer observations do not advance the authoritative host sequence.

`observability.snapshot().jobMetrics` reports observed/completed/failed/unknown jobs, unattended completion rate, setup/runtime interventions, wait duration percentiles and ongoing waits, recovery attempts, unattended recoveries, automatic recovery rate, recovery-to-host-progress percentiles, and rejected evidence. `exportState().jobState` persists the evidence. `summarizePilot(opportunities, provenance, jobMetrics)` attaches it without relabeling approval attempts as success.

**Required remaining host mapping:** wire an actual full job lifecycle producer into `recordJobEvent`, preserving full job identity and explicit completion semantics. Current DOM message/tool activity lacks that evidence. A terminal shell exit may prove a command outcome; it must not be silently promoted to full job completion.

**Runtime document replacement hook (integrated by the runtime worker):** runtime now sends `surfaceUrl: location.href` in runtime click-log events and `surfaceUrl=encodeURIComponent(location.href)` in both bridge discovery/status polls. Before renewing the enabled policy lease, it merges returned `intentTombstones.entries` into `window.__gravIntentLedger.entries` as unknown outcomes, preserving its object/generation and existing entries. A saturated journal must disable actuation. These hooks were integrated and replay-tested by the runtime worker; this recovery worker did not edit runtime. Known runtime attempts can now be restored before the enabled lease, subject to the identity and delivery limitations below.

No recovery path restarts a task, issues a native click, deletes an attempted intent or retries an unknown side effect. Missing/undelivered attempt observations, changed renderer identity and an extension-host process restart cannot be recovered as known tombstones by this in-memory journal; those remain limits rather than inferred command success. This is not an exactly-once host transaction protocol.

## Verification

Meaningful deterministic failure injection and assertions, all passing:

- `node test/cdp-recovery.test.js`: 36 assertions; disconnect/reconnect, one connect/attach attempt, pending rejection, old socket exclusion, pre-open close, handshake watchdog, stale HTTP discovery, bounded installation, stable recovery and actual source wiring of remount tombstones.
- `node test/bridge-recovery.test.js`: 15 assertions; unexpected listener restart, one timer for error/close, bounded fast repair/backoff, explicit stop, stale body exclusion and renderer completion downgrade.
- `node test/recovery-supervisor.test.js`: 10 assertions; repair overlap, budget/cooldown, consecutive health and existing intent coordinator continuity.
- `node test/recovery-intents.test.js`: 8 assertions; full document replacement receives unknown tombstones before execution, unrelated intent proceeds, scope attribution and bounded journal behavior.
- `node test/job-tracker.test.js`: 28 assertions; host completion only, unknown/failure denominator, interventions, approval/quota/recovery durations, event deduplication, host sequence fencing, persistence and observability/pilot wiring.
- `node test/bridge-policy.test.js`: 13 cases; existing stats/policy behavior, authoritative profile/host transport and scoped tombstone transport.
- Existing CDP target/policy, observability, observer, runtime injection, injection transaction and pilot replay checks pass. New tests emit the numeric `Results` format required by `test/run-all.js`; that runner was not edited by this worker.

Fixtures avoid real network ports, user settings, native workers, publications and commits. Live IDE fault-injection/unattended completion has not been performed.
