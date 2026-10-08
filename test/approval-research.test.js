'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const vm = require('vm');
const Policy = require('../src/action-policy');
const { fixture } = require('./fixtures/renderer');
const { buildObserverScript } = require('../src/cdp-observer');
let passed = 0, failed = 0;
function check(name, fn) { try { fn(); passed++; } catch (error) { failed++; console.error(name, error); } }
const base = { enabled: true, paused: false, dryRun: false, policyVersion: 'approval-regression-v1',
    patterns: ['Submit', 'Accept'], permissionRules: [], builtInGrants: [], terminalWhitelist: [], blacklist: ['git reset --hard'],
    eventScheduler: true, approveMs: 100, scrollMs: 500 };
const source = fs.readFileSync(require.resolve('../media/runtime.js'), 'utf8').replace('/*{{ACTION_POLICY}}*/null', () => Policy.browserSource);
check('Policy hardening replaces the previous observer instead of reusing its evaluator', () => {
    const f = fixture(), policy = { ...base, permissionProfile: 'legacy' };
    const script = buildObserverScript(policy.patterns, policy.blacklist, false, 7000, false, false, policy);
    vm.runInContext(script.replaceAll('v4.0.22-trusted-input', 'v4.0.23-autopilot'), f.context);
    const previous = f.window.__gravObserver;
    vm.runInContext(script, f.context);
    assert.notEqual(f.window.__gravObserver, previous);
    assert.equal(f.window.__gravObserver.version, 'v4.0.22-trusted-input');
});
function load(executor, f, policy) {
    if (executor === 'cdp') vm.runInContext(buildObserverScript(policy.patterns, policy.blacklist, false, 7000, false, false, policy), f.context);
    else {
        vm.runInContext(source, f.context);
        const req = f.requests.find(r => r.method === 'GET');
        req.status = 200; req.responseText = JSON.stringify(policy); req.onload();
    }
}
for (const profile of ['legacy', 'terminal', 'edits', 'observe']) {
    check(profile + ' generic Submit never supplies a permission or answer', () => {
        assert.equal(Policy.evaluateAction('Submit', 'git status', { ...base, permissionProfile: profile }).decision, 'manual');
    });
    for (const executor of ['cdp', 'runtime']) {
        for (const label of ['Submit', 'Submit ↵']) {
            check(executor + ' ' + profile + ' ' + label + ' remains manual', () => {
                const f = fixture(), b = f.button(label);
                b.closest('[class*=tool]').innerText = 'Save rule to always allow running this command? command(tool deploy)';
                load(executor, f, { ...base, permissionProfile: profile }); f.advance(1200);
                assert.equal(b.calls, 0);
            });
        }
    }
}
for (const executor of ['cdp', 'runtime']) {
    for (const text of ['Read URL content?', 'Send command input?', 'Approve? Generic Tool', 'MCP tool server/tool', 'read_file(/outside/file)']) {
        check(executor + ' known non-edit Accept remains manual: ' + text, () => {
            const f = fixture(), b = f.button('Accept');
            b.closest('[class*=tool]').innerText = text;
            load(executor, f, { ...base, permissionProfile: 'legacy' }); f.advance(1200);
            assert.equal(b.calls, 0);
        });
    }
    check(executor + ' terminal Accept cannot bypass a blacklist', () => {
        const f = fixture(), b = f.button('Accept', 'git reset --hard');
        load(executor, f, { ...base, permissionProfile: 'legacy', terminalWhitelist: ['git'] }); f.advance(1200);
        assert.equal(b.calls, 0);
    });
    check(executor + ' terminal Accept preserves an explicit exact command grant', () => {
        const f = fixture(), b = f.button('Accept', 'tool status');
        load(executor, f, { ...base, permissionProfile: 'terminal', permissionRules: [{ id: 'status', effect: 'allow', match: 'exact', scope: 'user', argv: ['tool', 'status'], expiresAt: null }] });
        f.advance(1200); assert.equal(b.calls, 1);
    });
}
console.log(`Results: ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
