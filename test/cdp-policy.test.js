'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Policy = require('../src/action-policy');
const { DEFAULT_BLACKLIST } = require('../src/constants');
let checks = 0, id = 0;
const intervals = new Map(), messages = [];
const mock = { env: { appRoot: '/mock' }, workspace: { getConfiguration: () => ({ get: (key, fallback) => fallback }) } };
const context = vm.createContext({ module: { exports: {} }, console: { log() {}, error() {} }, URL,
    setInterval: (fn, ms) => { intervals.set(++id, { fn, ms }); return id; }, clearInterval: key => intervals.delete(key),
    setTimeout: () => ++id, clearTimeout() {},
    require: request => request === 'vscode' ? mock : request === './utils' ? { cfg: (key, fallback) => fallback, isWithinRoot: () => true } :
        request === './configuration' ? { getEffectiveConfig: () => ({ enabled: true, patterns: ['Accept'] }) } :
        request.startsWith('./') ? require(path.join(__dirname, '../src', request)) : require(request),
});
const source = fs.readFileSync(path.join(__dirname, '../src/cdp.js'), 'utf8');
vm.runInContext(source + `\nmodule.exports.test = {
    getPolicy,
    setup(provider) { _getPolicy = provider; _ws = { readyState: 1, close() {}, send(value) { capture(value); } }; _sessions.set('target', { sessionId: 'fixture', url: 'vscode-webview://fixture/antigravity-agent' }); },
    reply(value) { for (const id of [..._callbacks.keys()]) handleMessage({ id, result: value ? {result:{value}} : {} }); },
    sessions: () => [..._sessions.values()],
    startHeartbeat,
};`, context);
context.capture = value => messages.push(JSON.parse(value));
const cdp = context.module.exports;
function check(fn) { fn(); checks++; }
(async () => {
    let policy = { policyVersion: 'fixture-v1', enabled: true, paused: false, dryRun: true, patterns: ['Run', 'Dummy', 'Always Allow'], disabledPatterns: ['run'], blacklist: ['shutdown'], approveIntervalMs: 700, scrollIntervalMs: 300 };
    cdp.test.setup(() => policy);
    const resolved = cdp.test.getPolicy();
    check(() => assert.deepStrictEqual(JSON.parse(JSON.stringify(resolved.patterns)), ['Dummy', 'Always Allow']));
    check(() => assert(DEFAULT_BLACKLIST.every(pattern => resolved.blacklist.includes(pattern))));
    check(() => assert(resolved.blacklist.includes('shutdown')));
    check(() => assert.strictEqual(resolved.approveMs, 700));
    check(() => assert.strictEqual(resolved.scrollMs, 300));
    check(() => assert(!Policy.canAct(resolved)));
    check(() => assert.strictEqual(cdp.getRuntimeState().verified,false,'socket and attach are not readiness'));
    cdp.test.startHeartbeat();
    const heartbeat = [...intervals.values()].find(timer => timer.ms === 500);
    check(() => assert(heartbeat));
    heartbeat.fn(); const first = messages.length; cdp.test.reply(); await Promise.resolve();
    heartbeat.fn(); cdp.test.reply(); await Promise.resolve();
    check(() => assert(messages.length > first, 'identical policy still renews renderer lease'));
    check(() => assert(messages.at(-1).params.expression.includes('"approveMs":700')));
    policy = { ...policy, paused: true }; heartbeat.fn(); cdp.test.reply(); await Promise.resolve();
    check(() => assert(messages.at(-1).params.expression.includes('"paused":true')));
    policy={...policy,paused:false,policyVersion:'fixture-v2',terminalWhitelist:['customtool status']};
    heartbeat.fn();cdp.test.reply({adapterVersion:'adapter-v1',verified:true,policyVersion:'fixture-v1',expiresAt:Date.now()+2000});await new Promise(resolve=>setImmediate(resolve));
    check(()=>assert.strictEqual(cdp.getRuntimeState().verified,false,'stale ACK cannot verify current policy'));
    heartbeat.fn();cdp.test.reply({adapterVersion:'adapter-v1',verified:true,policyVersion:'fixture-v2',expiresAt:Date.now()+2000});await new Promise(resolve=>setImmediate(resolve));
    check(()=>assert.strictEqual(cdp.getRuntimeState().verified,true,'current ACK on verified target establishes ready executor'));
    check(()=>assert(messages.at(-1).params.expression.includes('customtool status'),'whitelist snapshot crosses CDP'));
    cdp.test.sessions()[0].policyAck.expiresAt=0;check(()=>assert.strictEqual(cdp.getRuntimeState().verified,false,'ACK lease expires'));
    heartbeat.fn();cdp.test.reply({adapterVersion:'adapter-v1',verified:true,policyVersion:'fixture-v2',expiresAt:Date.now()+2000});await new Promise(resolve=>setImmediate(resolve));
    heartbeat.fn();cdp.test.reply({adapterVersion:'adapter-v999',verified:true,policyVersion:'fixture-v2',expiresAt:Date.now()+2000});await new Promise(resolve=>setImmediate(resolve));
    check(()=>assert.strictEqual(cdp.getRuntimeState().verified,false,'adapter upgrade mismatch cannot verify'));
    check(()=>assert.strictEqual(cdp.getRuntimeState().reasonCode,'adapter-version-mismatch','version mismatch reason is visible'));
    cdp.test.sessions()[0].url='vscode-webview://fixture/browser';check(()=>assert.strictEqual(cdp.getRuntimeState().verified,false,'ACK on unverified target never means ready'));
    cdp.disconnect();
    const disposeIndex = messages.findIndex(message => message.method === 'Runtime.evaluate' && message.params.expression.includes('.dispose()'));
    const detachIndex = messages.findIndex(message => message.method === 'Target.detachFromTarget');
    check(() => assert(disposeIndex >= 0 && detachIndex > disposeIndex, 'renderer disposed before detach'));
    check(() => assert.strictEqual(intervals.size, 0, 'disconnect clears host heartbeat and policy timers'));
    const before = messages.length; await cdp.cdpNativeClick('Run', 'Run');
    check(() => assert.strictEqual(messages.length, before, 'console retry cannot issue native click'));
    console.log(`Results: ${checks} passed, 0 failed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
