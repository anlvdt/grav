'use strict';
const assert = require('assert/strict');
const vm = require('vm'), fs = require('fs'), path = require('path');
const messages = [], remembered = [];
let checks = 0, policy = { enabled: true, paused: false, dryRun: false, policyVersion: 'current', patterns: ['Accept'] };
let point = { x: 50, y: 20, intentId: 'request:approval', policyVersion: 'current' };
const context = vm.createContext({ module: { exports: {} }, URL, console: { log() {}, error() {} },
    setTimeout, clearTimeout, setInterval, clearInterval,
    require: id => id === 'vscode' ? { env: { appRoot: '/mock' } } : id === './utils' ? { cfg: (key, fallback) => fallback, isWithinRoot: () => true } :
        id === './configuration' ? { getEffectiveConfig: () => policy } : id === './state' ? { attemptJournal: { remember: (...args) => remembered.push(args), isSaturated: () => false } } :
        id.startsWith('./') ? require(path.resolve(__dirname, '../src', id)) : require(id),
});
vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../src/cdp.js'), 'utf8') + `
module.exports.test = {
    setup(provider) {
        _getPolicy = provider;
        _ws = { readyState: 1, send(raw) { capture(JSON.parse(raw)); }, close() {} };
        _sessions.set('target', { sessionId: 'agent', url: 'vscode-webview://fixture/antigravity-agent' });
    },
    console: handleConsoleEvent,
    reply: handleMessage,
};`, context);
const cdp = context.module.exports;
context.capture = message => { messages.push(message); queueMicrotask(() => cdp.test.reply({ id: message.id, result: message.method === 'Runtime.evaluate' ? { result: { value: point } } : {} })); };
const flush = () => new Promise(resolve => setImmediate(resolve));
const request = (sid = 'agent', data = { ticket: 'ticket', policyVersion: 'current', x: 999, y: 999 }) => cdp.test.console({ args: [{ value: '[GRAV:INPUT] ' + JSON.stringify(data) }] }, sid);
(async () => {
    cdp.test.setup(() => policy);
    request(); await flush();
    assert.deepEqual(messages.map(m => m.method), ['Runtime.evaluate', 'Input.dispatchMouseEvent', 'Input.dispatchMouseEvent']); checks++;
    assert(messages.every(m => m.sessionId === 'agent')); checks++;
    assert.equal(messages[1].params.x, 50, 'coordinates come from renderer ticket, not console'); checks++;
    assert.equal(remembered.length, 1); checks++;
    messages.length = 0;
    request('foreign'); await flush(); assert.equal(messages.length, 0); checks++;
    policy.paused = true; request(); await flush(); assert.equal(messages.length, 0); checks++;
    policy.paused = false; policy.dryRun = true; request(); await flush(); assert.equal(messages.length, 0); checks++;
    policy.dryRun = false; policy.permissionProfile = 'observe'; request(); await flush(); assert.equal(messages.length, 0); checks++;
    policy.permissionProfile = 'terminal'; request('agent', { ticket: 'ticket', policyVersion: 'old' }); await flush(); assert.equal(messages.length, 0); checks++;
    point = null; request(); await flush(); assert.equal(messages.length, 1); checks++;
    assert.equal(messages[0].method, 'Runtime.evaluate'); checks++;
    messages.length = 0;
    cdp.test.console({ args: [{ value: '[GRAV:RETRY] {"p":"Run","b":"Run"}' }] }, 'agent'); await flush();
    assert.equal(messages.length, 0, 'legacy console retries remain non-actuating'); checks++;
    await cdp.disconnect();
    console.log(`Results: ${checks} passed, 0 failed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
