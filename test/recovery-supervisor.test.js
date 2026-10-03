'use strict';
const baseAssert = require('assert/strict');
let checks = 0;
const assert = new Proxy(baseAssert, {
    apply(target, receiver, args) { checks++; return Reflect.apply(target, receiver, args); },
    get(target, key) { const value = target[key]; return typeof value === 'function' ? (...args) => { checks++; return value(...args); } : value; },
});
const { createRecoverySupervisor } = require('../src/recovery-supervisor');
const { createCoordinator } = require('../src/intent-ledger');
(async () => {
    let ts = 0, installs = 0, release;
    const repair = createRecoverySupervisor({ now: () => ts, cooldownMs: 100 });
    const inFlight = repair.repair('renderer', () => new Promise(resolve => { release = resolve; }));
    assert.equal(await repair.repair('renderer', () => installs++), false, 'one repair per target at a time');
    release(); await inFlight;
    await repair.repair('renderer', () => installs++);
    await repair.repair('renderer', () => installs++);
    assert.equal(await repair.repair('renderer', () => installs++), false);
    ts = 100; assert.equal(await repair.repair('renderer', () => installs++), true, 'cooldown automatically permits next bounded burst');
    assert.equal(repair.healthy('renderer'), null);
    repair.unhealthy('renderer');
    assert.equal(repair.healthy('renderer'), null);
    assert.equal(repair.healthy('renderer'), null);
    ts = 120; assert.equal(repair.healthy('renderer'), 120, 'three consecutive healthy checks establish stability');
    assert.equal(repair.snapshot().stableRecoveries, 1);
    const root = {}, owner = createCoordinator(root, 'cdp');
    const intent = { key: 'host-request:approval', payload: 'run', evidence: 'host-attribute' };
    const claim = owner.claim(intent, 'policy'); owner.attempted(claim.entry);
    await repair.repair('renderer', () => {
        const reinstalled = createCoordinator(root, 'cdp');
        assert.equal(reinstalled.claim(intent, 'policy').ok, false, 'repair preserves attempted intent tombstones');
    });
    assert.equal(root.__gravIntentLedger.attempts, 1);
    console.log(`Results: ${checks} passed, 0 failed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
