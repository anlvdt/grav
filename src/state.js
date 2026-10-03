'use strict';

// Extension-host tombstones outlive renderer documents. This records observed
// attempts, never approval permissions, and never turns unknown outcomes into retries.
function createAttemptJournal(options = {}) {
    const scopes = new Map(), maxScopes = options.maxScopes || 2000, maxEntries = options.maxEntries || 256;
    let saturated = false;
    function remember(surfaceUrl, event = {}) {
        if (typeof surfaceUrl !== 'string' || !surfaceUrl || surfaceUrl.length > 2000 ||
            typeof event.intentId !== 'string' || !event.intentId || event.intentId.length > 300 || event.dryRun) return false;
        let entries = scopes.get(surfaceUrl);
        if (!entries) {
            if (scopes.size >= maxScopes) { saturated = true; return false; }
            entries = new Map(); scopes.set(surfaceUrl, entries);
        }
        if (!entries.has(event.intentId) && entries.size < maxEntries) entries.set(event.intentId, {
            key: event.intentId, outcome: 'unknown', at: Date.now(), expiresAt: Date.now() + 30 * 60 * 1000,
            evidence: event.identityEvidence || 'observed-attempt',
        });
        else if (!entries.has(event.intentId)) saturated = true;
        return true;
    }
    function snapshot(surfaceUrl) { return { entries: [...(scopes.get(surfaceUrl)?.values() || [])].map(e => ({ ...e })), saturated }; }
    function seedScript(surfaceUrl) {
        const saved = snapshot(surfaceUrl);
        return `(function(){var saved=${JSON.stringify(saved)};var state=window.__gravIntentLedger || (window.__gravIntentLedger={entries:new Map(),generation:0,attempts:0,errors:0,stopped:null,resumeToken:null});
            saved.entries.forEach(function(e){var prior=state.entries.get(e.key);if(!prior || prior.outcome==='pending' || prior.outcome==='cancelled')state.entries.set(e.key,e);});
            ${saved.saturated ? "state.stopped='intent-budget';" : ''}})();`;
    }
    return { remember, snapshot, seedScript, isSaturated: () => saturated };
}
const attemptJournal = createAttemptJournal();
module.exports = { createAttemptJournal, attemptJournal };
