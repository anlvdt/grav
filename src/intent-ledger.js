'use strict';

// Embedded unchanged in both renderer adapters. State belongs to a document,
// not an adapter, so CDP/runtime reinjection cannot reset attempted intents.
function createCoordinator(root, owner, options = {}) {
    const now = options.now || (() => Date.now());
    const max = options.max || 256, ttl = options.ttl || 30 * 60 * 1000;
    const state = root.__gravIntentLedger || (root.__gravIntentLedger = { entries: new Map(), generation: 0, attempts: 0, errors: 0, stopped: null, resumeToken: null });
    const generation = ++state.generation;
    const hash = text => { let n = 2166136261; for (let i = 0; i < text.length; i++) n = Math.imul(n ^ text.charCodeAt(i), 16777619); return (n >>> 0).toString(16); };
    function identity(button, label, command) {
        const step = button.closest && button.closest('[class*=tool], [class*=step], [class*=action], [class*=approval]');
        const attr = node => {
            for (const name of ['data-request-id', 'data-tool-call-id', 'data-prompt-id']) {
                const value = node && node.getAttribute && node.getAttribute(name);
                if (typeof value === 'string' && value && value.length <= 200) return name + ':' + value;
            }
            return null;
        };
        const request = attr(button) || attr(step);
        const payload = JSON.stringify([label, command]);
        // Anonymous identity is explicitly a conservative local fingerprint.
        // A new identical prompt without host identity must be handled manually.
        const kind = /^expand$/i.test(label) ? 'expand' : /^skip$/i.test(label) ? 'skip' : 'approval';
        return { key: (request || 'anonymous:' + hash(JSON.stringify([kind, command || label.replace(/ all$/i, '').toLowerCase()]))) + ':' + kind, request, payload, evidence: request ? 'host-attribute' : 'local-fingerprint' };
    }
    function claim(intent, policyVersion) {
        if (state.generation !== generation) return { ok: false, reasonCode: 'stale-owner' };
        if (state.stopped) return { ok: false, reasonCode: state.stopped };
        const prior = state.entries.get(intent.key);
        if (prior && prior.outcome !== 'cancelled' && !(prior.outcome === 'pending' && prior.generation !== generation)) return { ok: false, reasonCode: 'intent-already-claimed' };
        if (state.entries.size >= max && !prior) { state.stopped = 'intent-budget'; return { ok: false, reasonCode: state.stopped }; }
        const entry = { ...intent, owner, generation, policyVersion, at: now(), expiresAt: now() + ttl, outcome: 'pending' };
        state.entries.set(intent.key, entry);
        return { ok: true, entry };
    }
    function valid(entry, intent, policyVersion) {
        // Identity must match too: a host step swap keeps an equal payload but a
        // different key, and acting on the old claim would submit the wrong step.
        return state.entries.get(entry.key) === entry && entry.generation === generation && state.generation === generation && entry.key === intent.key && entry.outcome === 'pending' && entry.payload === intent.payload && entry.policyVersion === policyVersion && now() - entry.at < ttl && !state.stopped;
    }
    function cancelPending() { for (const e of state.entries.values()) if (e.owner === owner && e.outcome === 'pending') e.outcome = 'cancelled'; }
    function attempted(entry) { entry.outcome = 'unknown'; state.attempts++; }
    function postcondition(entry, button) {
        if (entry.outcome !== 'unknown') return;
        // Disappearance/disabled is an approval UI postcondition, not command completion.
        if (button.isConnected === false || button.disabled) { entry.postcondition = 'approval-ui-changed'; state.errors = 0; }
        else { entry.postcondition = 'unconfirmed'; if (++state.errors >= (options.noProgressLimit || 3)) state.stopped = 'no-progress'; }
    }
    function resume(token) {
        if (token === undefined || token === state.resumeToken) return;
        state.resumeToken = token; state.stopped = null; state.errors = 0;
        // Resume never deletes attempted intents or blindly retries unknown results.
    }
    function snapshot() {
        // Retain bounded tombstones for unknown results; expiry never becomes retry permission.
        for (const e of state.entries.values()) if (e.expiresAt <= now()) { delete e.payload; e.expired = true; if (e.outcome === 'pending') e.outcome = 'cancelled'; }
        return { version: 'intent-v1', owner, generation, currentOwner: state.generation === generation, entries: state.entries.size, attempts: state.attempts, reasonCode: state.stopped, unresolved: [...state.entries.values()].filter(e => e.outcome === 'unknown').length, uiAcknowledged: [...state.entries.values()].filter(e => e.postcondition === 'approval-ui-changed').length };
    }
    return { identity, claim, valid, cancelPending, attempted, postcondition, resume, snapshot };
}
module.exports = { createCoordinator };
