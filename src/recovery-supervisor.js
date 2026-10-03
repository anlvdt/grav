'use strict';

// Uses the transport's existing heartbeat; this supervisor owns no timers and
// never retries an interaction. Only executor installation may be repaired.
function createRecoverySupervisor(options = {}) {
    const now = options.now || Date.now;
    const limit = options.limit || 3, cooldownMs = options.cooldownMs || 60000;
    const records = new Map();
    const totals = { repairs: 0, deferred: 0, stableRecoveries: 0 };
    function record(key) {
        if (!records.has(key)) records.set(key, { attempts: 0, stable: 0, startedAt: null, retryAt: 0, inFlight: false });
        return records.get(key);
    }
    async function repair(key, run) {
        if (!records.has(key) && records.size >= 2000) { totals.deferred++; return false; }
        const r = record(key), ts = now();
        r.stable = 0;
        if (r.inFlight || ts < r.retryAt) { totals.deferred++; return false; }
        if (r.attempts >= limit) r.attempts = 0;
        r.inFlight = true;
        if (r.startedAt === null) r.startedAt = ts;
        r.attempts++; totals.repairs++;
        if (r.attempts >= limit) r.retryAt = ts + cooldownMs;
        try { await run(); return true; } finally { r.inFlight = false; }
    }
    function healthy(key) {
        const r = records.get(key);
        if (!r || r.inFlight || r.startedAt === null) return null;
        if (++r.stable < 3) return null;
        const recoveryMs = now() - r.startedAt;
        r.startedAt = null; r.attempts = 0; r.retryAt = 0; r.stable = 0;
        totals.stableRecoveries++;
        return recoveryMs;
    }
    function unhealthy(key) { const r = records.get(key); if (r) r.stable = 0; }
    function forget(key) { records.delete(key); }
    return { repair, healthy, unhealthy, forget, snapshot: () => ({ ...totals, pending: [...records.values()].filter(r => r.startedAt !== null).length }) };
}
module.exports = { createRecoverySupervisor };
