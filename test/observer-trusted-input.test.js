'use strict';
const assert = require('assert/strict'), vm = require('vm');
const { fixture } = require('./fixtures/renderer');
const { buildObserverScript } = require('../src/cdp-observer');
let checks = 0;
const base = { enabled: true, paused: false, dryRun: false, policyVersion: 'current', patterns: ['Run'],
    permissionProfile: 'legacy', builtInGrants: [], terminalWhitelist: ['echo'], blacklist: [], trustedInput: true, approveMs: 100 };
function setup(policy = base) {
    const f = fixture(), b = f.button('Run', 'echo hello');
    b.ownerDocument = f.document;
    f.document.elementFromPoint = () => b;
    vm.runInContext(buildObserverScript(policy.patterns, [], false, 0, false, false, policy), f.context);
    f.advance(150);
    const input = f.logs.find(line => line.startsWith('[GRAV:INPUT]'));
    return { f, b, ticket: input ? JSON.parse(input.slice('[GRAV:INPUT] '.length)).ticket : null };
}
const live = setup();
assert(live.ticket); checks++;
assert.equal(live.b.calls, 0, 'trusted input never precedes with a DOM click'); checks++;
const point = live.f.window.__gravObserver.prepareClick(live.ticket);
assert.equal(point.x, 60); checks++;
assert.equal(point.y, 25); checks++;
assert.equal(point.policyVersion, 'current'); checks++;
assert.equal(live.f.window.__gravObserver.prepareClick(live.ticket), null); checks++;
live.f.advance(3000);
assert.equal(live.f.logs.filter(l => l.startsWith('[GRAV:INPUT]')).length, 1, 'unconfirmed activation is never replayed'); checks++;
for (const change of ['pause', 'dryRun', 'revoke', 'overlay', 'removed', 'expired', 'reinject']) {
    const { f, b, ticket } = setup();
    if (change === 'pause') f.window.__gravObserver.updateConfig({ ...base, paused: true });
    if (change === 'dryRun') f.window.__gravObserver.updateConfig({ ...base, dryRun: true });
    if (change === 'revoke') f.window.__gravObserver.updateConfig({ ...base, policyVersion: 'new', terminalWhitelist: [] });
    if (change === 'overlay') f.document.elementFromPoint = () => ({});
    if (change === 'removed') b.isConnected = false;
    if (change === 'expired') f.advance(1000);
    if (change === 'reinject') {
        f.window.__gravObserver.dispose();
        vm.runInContext(buildObserverScript(base.patterns, [], false, 0, false, false, base), f.context);
    }
    assert.equal(f.window.__gravObserver.prepareClick(ticket), null, change + ' cancels prepared pointer activation'); checks++;
    assert.equal(b.calls, 0); checks++;
}
const blocked = setup({ ...base, terminalWhitelist: [] });
assert.equal(blocked.ticket, null, 'unknown terminal command never queues input'); checks++;
console.log(`Results: ${checks} passed, 0 failed`);
