'use strict';

function createEventScheduler(run, options) {
    let pending = null, cancelled = false;
    const metrics = { events: 0, coalesced: 0, scans: 0, cancelled: 0 };
    function trigger() {
        metrics.events++;
        if (cancelled) return;
        if (pending !== null) { metrics.coalesced++; return; }
        pending = options.setTimeout(() => { pending = null; if (!cancelled) { metrics.scans++; run(); } }, options.delay);
    }
    function cancel() { if (pending !== null) { options.clearTimeout(pending); metrics.cancelled++; } pending = null; cancelled = true; }
    function resume() { cancelled = false; }
    return { trigger, cancel, resume, snapshot: () => ({ ...metrics, pending: pending !== null }) };
}
async function runTargets(items, visit, concurrency = 4) {
    let index = 0;
    return Promise.allSettled(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (index < items.length) {
            const item = items[index++];
            try { await visit(item); } catch (_) { /* One failed target cannot stop healthy targets. */ }
        }
    }));
}
module.exports = { createEventScheduler, runTargets };
