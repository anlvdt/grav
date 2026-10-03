'use strict';
const baseAssert = require('assert/strict');
let checks = 0;
const assert = new Proxy(baseAssert, {
    apply(target, receiver, args) { checks++; return Reflect.apply(target, receiver, args); },
    get(target, key) { const value = target[key]; return typeof value === 'function' ? (...args) => { checks++; return value(...args); } : value; },
});
const vm = require('vm');
const { createAttemptJournal } = require('../src/state');
const { createCoordinator } = require('../src/intent-ledger');
const journal = createAttemptJournal();
const surface = 'vscode-webview://window/antigravity-agent';
assert.equal(journal.remember(surface, { intentId: 'request-1:approval', identityEvidence: 'host-attribute' }), true);
const remounted = {};
vm.runInNewContext(journal.seedScript(surface), { window: remounted, Map });
const owner = createCoordinator(remounted, 'cdp');
assert.equal(owner.claim({ key: 'request-1:approval', payload: 'run' }, 'policy').ok, false, 'host tombstone blocks known side effect after complete document remount');
assert.equal(owner.claim({ key: 'request-2:approval', payload: 'new task' }, 'policy').ok, true, 'unrelated pending intent can proceed');
const previous = remounted.__gravIntentLedger;
vm.runInNewContext(journal.seedScript(surface), { window: remounted, Map });
assert.equal(remounted.__gravIntentLedger, previous, 'reinjection preserves the live ledger object');
assert.equal(journal.snapshot('vscode-webview://other/antigravity-agent').entries.length, 0, 'target attribution does not cross surfaces');
assert.equal(journal.remember(surface, { intentId: 'dry', dryRun: true }), false);
const capped = createAttemptJournal({ maxEntries: 1 }); capped.remember(surface, { intentId: 'first' }); capped.remember(surface, { intentId: 'second' });
assert.equal(capped.isSaturated(), true, 'bounded journal never drops tombstones into replay permission');
assert.equal(capped.snapshot(surface).entries[0].key, 'first');
console.log(`Results: ${checks} passed, 0 failed`);
