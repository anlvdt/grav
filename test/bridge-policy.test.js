'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { EventEmitter } = require('events');
const constants = require('../src/constants');

let passed = 0, failed = 0;
function test(name, fn) {
    try { fn(); passed++; console.log('  v ' + name); }
    catch (e) { failed++; console.error('  x ' + name + ': ' + e.message); }
}

// Exercise the public start API with an in-memory server: no ports or user files.
function fixture() {
    let handler;
    const server = Object.assign(new EventEmitter(), { listen(port, host, cb) { cb(); }, close() {} });
    const sandbox = {
        module: { exports: {} },
        require: id => {
            if (id === 'http') return { createServer: fn => { handler = fn; return server; } };
            if (id === 'vscode') return { workspace: { workspaceFolders: [] } };
            if (id === './utils') return { cfg: (key, fallback) => fallback };
            if (id === './constants') return constants;
            if (id === './state') return require('../src/state');
            if (id === './action-policy') return require('../src/action-policy');
            return require(id);
        },
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/bridge.js'), 'utf8'), sandbox);
    let state = { stats: {}, totalClicks: 0, log: [], session: { approveCount: 0 }, scrollOn: true };
    let policy = { policyVersion: 'fixture-v1', terminalWhitelist: ['customtool status'], workspace: '/fixture', enabled: true, paused: false, dryRun: false, patterns: ['Accept'], blacklist: ['shutdown'],
        scrollPauseMs: 9000, scrollIntervalMs: 250, approveIntervalMs: 400 };
    const calls = { stats: 0, clicks: 0 };
    sandbox.module.exports.start({ globalState: { get: (key, fallback) => fallback } }, {
        // Like extension.getState(), return a fresh wrapper containing current references.
        getState: () => ({ ...state }), getPolicy: () => ({ ...policy }),
        onStatsUpdated: () => { calls.stats++; state.totalClicks = Object.values(state.stats).reduce((a, b) => a + b, 0); },
        onClickLogged: () => { calls.clicks++; },
    });
    function request(url = '/api/click-log', method = 'POST') {
        const req = new EventEmitter();
        Object.assign(req, { url, method, socket: { remoteAddress: '127.0.0.1' }, headers: {} });
        const res = { status: 0, body: '', setHeader() {}, writeHead(status) { this.status = status; }, end(body) { this.body = body; } };
        handler(req, res);
        return { req, res, finish: value => {
            req.emit('data', Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)));
            req.emit('end'); return res;
        } };
    }
    return { request, calls, get state() { return state; }, set state(next) { state = next; },
        get policy() { return policy; }, set policy(next) { policy = next; } };
}
const click = source => ({ source, pattern: 'Accept', button: 'Accept' });
function expectNoMetrics(f) {
    assert.deepStrictEqual(f.state.stats, {});
    assert.strictEqual(f.state.totalClicks, 0);
    assert.strictEqual(f.state.session.approveCount, 0);
    assert.strictEqual(f.state.log.length, 0);
    assert.deepStrictEqual(f.calls, { stats: 0, clicks: 0 });
}

for (const source of ['runtime', 'grav']) test(source + ' click counts once across stats/session/log callbacks', () => {
    const f = fixture(); const res = f.request().finish(click(source));
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(f.state.stats, { Accept: 1 });
    assert.strictEqual(f.state.totalClicks, 1);
    assert.strictEqual(f.state.session.approveCount, 1);
    assert.strictEqual(f.state.log.length, 1);
    assert.strictEqual(f.state.log[0].pattern, 'Accept');
    assert.deepStrictEqual(f.calls, { stats: 1, clicks: 1 });
});

test('multiple confirmed clicks count per event and cap the log', () => {
    const f = fixture();
    for (let i = 0; i < 51; i++) f.request().finish(click(i % 2 ? 'grav' : 'runtime'));
    assert.strictEqual(f.state.stats.Accept, 51);
    assert.strictEqual(f.state.totalClicks, 51);
    assert.strictEqual(f.state.session.approveCount, 51);
    assert.strictEqual(f.state.log.length, 50);
    assert.deepStrictEqual(f.calls, { stats: 51, clicks: 51 });
});

test('dry-run event never contributes metrics even when current policy permits actions', () => {
    const f = fixture(); f.request().finish({ ...click('runtime'), dryRun: true }); expectNoMetrics(f);
});

for (const gate of [{ enabled: false }, { paused: true }, { dryRun: true }]) test('pending body rechecks ' + JSON.stringify(gate), () => {
    const f = fixture(); const pending = f.request();
    f.policy = { ...f.policy, ...gate };
    assert.strictEqual(pending.finish(click('runtime')).status, 200);
    expectNoMetrics(f);
});

test('malformed JSON returns 400 without metric effects', () => {
    const f = fixture(); assert.strictEqual(f.request().finish('{bad').status, 400); expectNoMetrics(f);
});

test('bridge status carries effective policy, blacklist and timing', () => {
    const f = fixture(); f.policy = { ...f.policy, dryRun: true, patterns: ['Expand'] };
    const { res } = f.request('/grav-status', 'GET');
    const out = JSON.parse(res.body);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(out.policyVersion, 'fixture-v1');assert.deepStrictEqual(out.terminalWhitelist,['customtool status']);assert.strictEqual(out.workspace,'/fixture');
    assert.strictEqual(out.enabled, true); assert.strictEqual(out.paused, false); assert.strictEqual(out.dryRun, true);
    assert.strictEqual(out.scrollEnabled, false);
    assert.deepStrictEqual(out.patterns, ['Expand']); assert.deepStrictEqual(out.blacklist, ['shutdown']);
    assert.strictEqual(out.pauseMs, 9000); assert.strictEqual(out.scrollMs, 250); assert.strictEqual(out.approveMs, 400);
});

test('bridge transports authoritative autonomy and scoped permission policy', () => {
    const f = fixture();
    f.policy = { ...f.policy, autopilotProfile: { enabled: true, grants: [{ operation: 'readUrlContent', domain: 'example.com' }] },
        interactionHost: { name: 'Antigravity', build: 'verified-build', verified: true }, permissionProfile: 'terminal', permissionRules: [{ action: 'allow', executable: 'git' }], resumeToken: 7, eventScheduler: true };
    const out = JSON.parse(f.request('/grav-status', 'GET').res.body);
    for (const key of ['interactionHost', 'autopilotProfile', 'permissionProfile', 'permissionRules', 'resumeToken', 'eventScheduler']) assert.deepStrictEqual(out[key], f.policy[key]);
    assert.strictEqual(out.decisionRules, undefined);
    const defaults = JSON.parse(fixture().request('/grav-status', 'GET').res.body);
    assert.deepStrictEqual(defaults.autopilotProfile, { enabled: false, grants: [] });
    assert.deepStrictEqual(defaults.permissionRules, []);
    assert.strictEqual(defaults.permissionProfile, 'legacy');
    assert.strictEqual(defaults.eventScheduler, false);
});

test('bridge journals observed attempts by renderer surface identity', () => {
    const f = fixture(), surfaceUrl = 'vscode-webview://journal-fixture/antigravity-agent';
    f.request().finish({ source: 'runtime', button: 'Accept', intentId: 'host-request:approval', surfaceUrl });
    const out = JSON.parse(f.request('/grav-status?surfaceUrl=' + encodeURIComponent(surfaceUrl), 'GET').res.body);
    assert.strictEqual(out.intentTombstones.entries[0].key, 'host-request:approval');
    assert.strictEqual(out.intentTombstones.entries[0].outcome, 'unknown');
    assert.strictEqual(out.intentTombstones.saturated, false);
});

test('pending click after reset updates the current stats/log references', () => {
    const f = fixture(); const pending = f.request();
    const old = f.state;
    f.state = { ...old, stats: {}, log: [], totalClicks: 0 };
    pending.finish(click('runtime'));
    assert.deepStrictEqual(f.state.stats, { Accept: 1 });
    assert.strictEqual(f.state.totalClicks, 1);
    assert.strictEqual(f.state.log.length, 1);
    assert.deepStrictEqual(old.stats, {});
    assert.strictEqual(old.log.length, 0);
});

test('bridge evaluation shares argv prefix and refreshes policy',()=>{
    const f=fixture();
    let result=JSON.parse(f.request('/api/eval-command').finish({command:'customtool status --short'}).body);
    assert.strictEqual(result.decision,'allow');assert.strictEqual(result.policyVersion,'fixture-v1');
    f.policy={...f.policy,policyVersion:'fixture-v2',blacklist:['customtool status']};
    result=JSON.parse(f.request('/api/eval-command').finish({command:'customtool status --short'}).body);
    assert.strictEqual(result.decision,'deny');assert.strictEqual(result.policyVersion,'fixture-v2');
});
console.log(`Results: ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
