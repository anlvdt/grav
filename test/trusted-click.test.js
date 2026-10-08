'use strict';
const assert = require('assert/strict');
const { createClickTickets, dispatchTrustedClick } = require('../src/trusted-click');
let checks = 0;
function check(fn) { fn(); checks++; }
(async () => {
    let now = 0, allowed = true, attempts = 0;
    const document = { elementFromPoint: () => button };
    const button = { ownerDocument: document, isConnected: true, disabled: false,
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 30 }) };
    const tickets = createClickTickets(document, () => now);
    const enqueue = () => tickets.enqueue(button, () => allowed, () => { attempts++; return { intentId: 'intent', policyVersion: 'policy' }; });
    const ticket = enqueue();
    check(() => assert.equal(attempts, 0, 'queueing is not an attempt'));
    check(() => assert.equal(tickets.prepare('forged'), null));
    check(() => assert.deepEqual(tickets.prepare(ticket), { x: 50, y: 15, intentId: 'intent', policyVersion: 'policy' }));
    check(() => assert.equal(tickets.prepare(ticket), null, 'ticket consumed once'));
    check(() => assert.equal(attempts, 1));
    const stale = enqueue(); now = 1500;
    check(() => assert.equal(tickets.prepare(stale), null, 'expired request cannot click'));
    now = 0; const revoked = enqueue(); allowed = false;
    check(() => assert.equal(tickets.prepare(revoked), null, 'live policy revocation wins'));
    allowed = true; const covered = enqueue(); document.elementFromPoint = () => ({});
    check(() => assert.equal(tickets.prepare(covered), null, 'overlay cannot receive approval click'));
    document.elementFromPoint = () => button;
    button.ownerDocument = {}; check(() => assert.equal(enqueue(), null, 'iframe coordinates stay on DOM path'));
    button.ownerDocument = document; const removed = enqueue(); button.isConnected = false;
    check(() => assert.equal(tickets.prepare(removed), null)); button.isConnected = true;
    const disposed = enqueue(); tickets.clear(); check(() => assert.equal(tickets.prepare(disposed), null));
    const messages = [], journal = [];
    let live = true;
    const send = async (method, params) => { messages.push({ method, params }); return { result: { value: { x: 0, y: 0, policyVersion: 'policy', intentId: 'intent' } } }; };
    const options = { ticket: 'ticket', policyVersion: 'policy', isCurrent: () => live, send, remember: data => journal.push(data) };
    assert.equal(await dispatchTrustedClick(options), true); checks++;
    check(() => assert.deepEqual(messages.map(m => m.method), ['Runtime.evaluate', 'Input.dispatchMouseEvent', 'Input.dispatchMouseEvent']));
    check(() => assert.equal(messages[1].params.type, 'mousePressed'));
    check(() => assert.equal(messages[2].params.type, 'mouseReleased'));
    check(() => assert.equal(journal.length, 1, 'journal before input dispatch'));
    messages.length = 0; live = false;
    assert.equal(await dispatchTrustedClick(options), false); checks++;
    check(() => assert.equal(messages.length, 0));
    live = true;
    assert.equal(await dispatchTrustedClick({ ...options, send: async () => { live = false; return { result: { value: { x: 5, y: 5, intentId: 'intent', policyVersion: 'policy' } } }; } }), false); checks++;
    check(() => assert.equal(journal.length, 2, 'prepared intent retained even if host policy revoked'));
    live = true;
    messages.length = 0;
    assert.equal(await dispatchTrustedClick({ ...options, remember: () => false }), false); checks++;
    check(() => assert.equal(messages.length, 1, 'journal refusal prevents input dispatch'));
    for (const value of [null, { x: NaN, y: 1 }, { x: 1, y: 2, intentId: 'intent', policyVersion: 'old' }]) {
        assert.equal(await dispatchTrustedClick({ ...options, send: async () => ({ result: { value } }) }), false); checks++;
    }
    let calls = 0;
    await assert.rejects(dispatchTrustedClick({ ...options, send: async (method) => { calls++; if (method === 'Runtime.evaluate') return { result: { value: { x: 1, y: 1, intentId: 'intent', policyVersion: 'policy' } } }; throw new Error('timeout'); } }), /timeout/); checks++;
    check(() => assert.equal(calls, 3, 'failed press still sends release, never retries press'));
    console.log(`Results: ${checks} passed, 0 failed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
