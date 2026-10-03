'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const vm = require('vm');
const Policy = require('../src/action-policy');
const { normalize } = require('../src/autopilot-profile');
const { fixture } = require('./fixtures/renderer');
const { buildObserverScript } = require('../src/cdp-observer');
let passed = 0, failed = 0;
const check = (name, fn) => { try { fn(); passed++; } catch (e) { failed++; console.error(name, e); } };
const headings = { command: 'Allow running this command?', read_file: 'Allow read access to this path?', write_file: 'Allow write access to this path?', read_url: 'Allow reading this URL?', execute_url: 'Allow executing actions on this URL?', mcp: 'Allow using this MCP tool?' };
const scopes = { once: 'Yes, allow this time', conversation: 'Yes, and always allow in this conversation', project: 'Yes, and always allow in this project', workspace: 'Yes, and always allow in this workspace', global: 'Yes, and always allow' };
const targets = { command: 'tool status', read_file: '/fixture/input.txt', write_file: '/fixture/output.txt', read_url: 'docs.example.test', execute_url: 'app.example.test', mcp: 'local/status' };
function card(f, operation = 'read_file', scope = 'once') {
    const b = f.button('Submit ↵');
    b.setAttribute('data-testid', 'interaction-continue-button');
    const step = b.closest('[class*=tool]');
    const heading = { textContent: headings[operation] };
    const editor = { value: targets[operation], getAttribute: name => name === 'aria-label' ? 'Edit permission target' : null };
    const span = { textContent: scopes[scope] };
    const label = { innerText: '1 ' + scopes[scope], querySelectorAll: () => [span] };
    const radio = { checked: true, disabled: false, value: '1', closest: () => label };
    step.innerText = headings[operation] + '\n' + targets[operation] + '\n' + scopes[scope];
    step.querySelectorAll = selector => selector.startsWith('textarea[aria-label') ? [editor] : selector === 'svg mask[id="mask0_1041_504"]' ? operation === 'command' ? [{ getAttribute: name => name === 'id' ? 'mask0_1041_504' : null }] : [] : selector === 'span' ? [heading] : selector === 'input[type="radio"]' ? [radio] : [];
    return { b, step, heading, editor, radio, span };
}
function fiber(c, operation = 'read_file', scope = 'once', stepIndex = 1) {
    const owner = { memoizedProps: { permissionSpec: { resource: { action: operation, target: c.editor.value } }, cascadeId: 'cascade-fixture', trajectoryId: 'trajectory-fixture', stepIndex }, return: null };
    const interaction = { memoizedProps: { toolName: 'ask_permission', permissionAction: operation, questions: [{ question: operation + '(' + c.editor.value + ')', isMultiSelect: false, options: [{ id: '1', text: scopes[scope] }] }], selections: [['1']] }, return: owner };
    c.b.__reactFiber$fixture = { memoizedProps: {}, return: interaction };
    return { owner, interaction };
}
function policy(operation = 'read_file', scope = 'once', extra = {}) {
    return { enabled: true, paused: false, dryRun: false, active: true, policyVersion: 'autopilot-v1', patterns: ['Accept'],
        permissionProfile: 'terminal', permissionRules: [], blacklist: [], builtInGrants: [], terminalWhitelist: [], workspace: '/fixture',
        interactionHost: 'ide-2.5.5-unified-permission-dom', eventScheduler: true, approveMs: 100, scrollMs: 500,
        autopilotProfile: { enabled: true, grants: [{ id: 'configured', effect: 'allow', operation, target: targets[operation], scope }] }, ...extra };
}
const source = fs.readFileSync(require.resolve('../media/runtime.js'), 'utf8').replace('/*{{ACTION_POLICY}}*/null', () => Policy.browserSource);
function load(executor, f, p) {
    if (executor === 'cdp') vm.runInContext(buildObserverScript(p.patterns, p.blacklist, false, 7000, p.dryRun, false, p), f.context);
    else {
        vm.runInContext(source, f.context);
        const req = f.requests.find(r => r.method === 'GET');
        req.status = 200; req.responseText = JSON.stringify(p); req.onload();
    }
}
check('profile defaults off and rejects malformed grants', () => {
    assert.equal(normalize(null).enabled, false);
    assert.equal(normalize({ enabled: true, grants: [{ id: 'bad' }] }).error, 'invalid-autopilot-profile');
    assert.equal(normalize({ enabled: true, grants: [{ ...policy().autopilotProfile.grants[0], target: '*' }] }).enabled, false);
});
for (const operation of Object.keys(targets)) {
    check(operation + ' embedded evaluator parity', () => {
        const request = { kind: 'permission', operation, target: targets[operation], scope: 'once' }, p = policy(operation);
        const browser = vm.runInNewContext(Policy.browserSource);
        assert.deepEqual(JSON.parse(JSON.stringify(browser.evaluateInteraction(request, p))), Policy.evaluateInteraction(request, p));
    });
}
for (const executor of ['cdp', 'runtime']) {
    for (const operation of Object.keys(targets)) {
        check(executor + ' configured ' + operation + ' grant reaches actuation', () => {
            const f = fixture(), c = card(f, operation); load(executor, f, policy(operation)); f.advance(1200);
            assert.equal(c.b.calls, 1); assert.equal(f.window.__gravIntentLedger.attempts, 1);
        });
    }
    for (const scope of Object.keys(scopes)) {
        check(executor + ' explicit selected ' + scope + ' is preserved', () => {
            const f = fixture(), c = card(f, 'read_url', scope); load(executor, f, policy('read_url', scope)); f.advance(1200);
            assert.equal(c.b.calls, 1); assert.equal(c.radio.value, '1');
        });
    }
    for (const mode of ['dryRun', 'paused', 'observe', 'disabled', 'unconfigured']) {
        check(executor + ' respects ' + mode, () => {
            const f = fixture(), c = card(f), p = policy();
            if (mode === 'observe') p.permissionProfile = 'observe'; else if (mode === 'disabled') p.enabled = false;
            else if (mode === 'unconfigured') p.autopilotProfile.enabled = false; else p[mode] = true;
            load(executor, f, p); f.advance(1200); assert.equal(c.b.calls, 0);
        });
    }
    check(executor + ' explicit deny wins across scopes', () => {
        const f = fixture(), c = card(f), p = policy();
        p.autopilotProfile.grants.push({ ...p.autopilotProfile.grants[0], id: 'deny', effect: 'deny', scope: 'global' });
        load(executor, f, p); f.advance(1200); assert.equal(c.b.calls, 0);
    });
    check(executor + ' command blacklist overrides configured grant', () => {
        const f = fixture(), c = card(f, 'command'); load(executor, f, policy('command', 'once', { blacklist: ['tool status'] })); f.advance(1200); assert.equal(c.b.calls, 0);
    });
    check(executor + ' command rule deny overrides configured grant', () => {
        const f = fixture(), c = card(f, 'command'); load(executor, f, policy('command', 'once', { permissionRules: [{ id: 'deny', effect: 'deny', match: 'exact', scope: 'user', argv: ['tool', 'status'], expiresAt: null }] })); f.advance(1200); assert.equal(c.b.calls, 0);
    });
    check(executor + ' cannot upgrade once to conversation', () => {
        const f = fixture(), c = card(f, 'read_file', 'conversation'); load(executor, f, policy()); f.advance(1200); assert.equal(c.b.calls, 0);
    });
    check(executor + ' question sharing submit cannot inherit a grant', () => {
        const f = fixture(), c = card(f); c.heading.textContent = 'Which permission should I use?';
        load(executor, f, policy()); f.advance(1200); assert.equal(c.b.calls, 0);
    });
    check(executor + ' command description cannot impersonate URL permission', () => {
        const f = fixture(), c = card(f, 'command'); c.heading.textContent = headings.read_url; c.editor.value = targets.read_url;
        load(executor, f, policy('read_url')); f.advance(1200); assert.equal(c.b.calls, 0);
    });
    check(executor + ' write-in denial cannot become approval', () => {
        const f = fixture(), c = card(f), old = c.step.querySelectorAll;
        c.step.querySelectorAll = selector => selector.includes('ask-question-writein') ? [{ value: 'No' }] : old(selector);
        load(executor, f, policy()); f.advance(1200); assert.equal(c.b.calls, 0);
    });
    check(executor + ' Ask hook constraint remains unsupported', () => {
        const f = fixture(), c = card(f); c.step.innerText += '\nRequires manual confirmation.';
        load(executor, f, policy()); f.advance(1200); assert.equal(c.b.calls, 0);
    });
    check(executor + ' suggested wider persist pattern remains unsupported', () => {
        const f = fixture(), c = card(f, 'read_url', 'conversation'); c.span.textContent = "Yes, and always allow 'example.test' in this conversation";
        load(executor, f, policy('read_url', 'conversation')); f.advance(1200); assert.equal(c.b.calls, 0);
    });
    check(executor + ' grants restricted to configured project', () => {
        const f = fixture(), c = card(f), p = policy(); p.autopilotProfile.grants[0].workspace = '/different';
        load(executor, f, p); f.advance(1200); assert.equal(c.b.calls, 0);
    });
    for (const mutation of ['payload', 'scope', 'operation']) {
        check(executor + ' revalidates ' + mutation + ' after claim', () => {
            const f = fixture(), c = card(f), p = policy();
            // Both states are explicitly allowed, so the ledger must detect mutation.
            p.autopilotProfile.grants.push({ ...p.autopilotProfile.grants[0], id: 'second', target: '/fixture/other.txt' });
            p.autopilotProfile.grants.push({ ...p.autopilotProfile.grants[0], id: 'scope', scope: 'conversation' });
            p.autopilotProfile.grants.push({ ...p.autopilotProfile.grants[0], id: 'write', operation: 'write_file' });
            c.b.setAttribute('data-request-id', 'stable-request');
            let mutated = false, identityReads = 0; const get = c.b.getAttribute;
            c.b.getAttribute = name => {
                if (name === 'data-request-id' && ++identityReads === 2 && !mutated) {
                    mutated = true;
                    if (mutation === 'payload') c.editor.value = '/fixture/other.txt';
                    if (mutation === 'scope') c.span.textContent = scopes.conversation;
                    if (mutation === 'operation') c.heading.textContent = headings.write_file;
                }
                return get(name);
            };
            load(executor, f, p); f.advance(1200); assert(mutated); assert.equal(c.b.calls, 0);
        });
    }
    for (const change of ['paused', 'dryRun', 'revoked']) {
        check(executor + ' current policy ' + change + ' fences pending actuation', () => {
            const f = fixture(), c = card(f), p = policy();
            let reads = 0; const get = c.b.getAttribute;
            c.b.getAttribute = name => {
                if (name === 'data-request-id' && ++reads === 2) {
                    const next = { ...p, policyVersion: 'autopilot-v2' };
                    if (change === 'revoked') next.autopilotProfile = { enabled: true, grants: [] }; else next[change] = true;
                    (executor === 'cdp' ? f.window.__gravObserver : f.window.__gravRuntime).updateConfig(next);
                }
                return get(name);
            };
            load(executor, f, p); f.advance(1200); assert.equal(c.b.calls, 0);
        });
    }
    check(executor + ' unknown host build never receives typed actuation', () => {
        const f = fixture(), c = card(f); load(executor, f, policy('read_file', 'once', { interactionHost: null })); f.advance(1200); assert.equal(c.b.calls, 0);
    });
    check(executor + ' persistent grant cannot bypass a narrower local deny', () => {
        const f = fixture(), c = card(f, 'read_url', 'conversation'), p = policy('read_url', 'conversation');
        p.autopilotProfile.grants.push({ ...p.autopilotProfile.grants[0], id: 'deny-subdomain', effect: 'deny', target: 'private.docs.example.test', scope: 'once' });
        load(executor, f, p); f.advance(1200); assert.equal(c.b.calls, 0);
    });
    check(executor + ' recurring equal content uses actual host step identity', () => {
        const f = fixture(), first = card(f), p = policy(); fiber(first, 'read_file', 'once', 1);
        load(executor, f, p); f.advance(600); assert.equal(first.b.calls, 1); first.b.isConnected = false;
        const second = card(f); fiber(second, 'read_file', 'once', 2);
        f.advance(900); assert.equal(second.b.calls, 1);
        const entries = [...f.window.__gravIntentLedger.entries.values()]; assert.equal(entries.length, 2); assert(entries.every(e => e.evidence === 'host-react-props'));
    });
    check(executor + ' host step swap during claim cancels before click', () => {
        const f = fixture(), c = card(f), p = policy(), props = fiber(c);
        const get = c.b.getAttribute; let reads = 0, swapped = false;
        c.b.getAttribute = name => {
            if (name === 'data-request-id' && ++reads === 2) { props.owner.memoizedProps.stepIndex = 2; swapped = true; }
            return get(name);
        };
        load(executor, f, p); f.advance(550); assert(swapped); assert.equal(c.b.calls, 0);
        const pending = [...f.window.__gravIntentLedger.entries.values()]; assert.equal(pending.length, 1); assert.equal(pending[0].outcome, 'pending');
    });
    check(executor + ' same DOM reused for a distinct host step can progress', () => {
        const f = fixture(), c = card(f), p = policy(), props = fiber(c);
        load(executor, f, p); f.advance(600); assert.equal(c.b.calls, 1); props.owner.memoizedProps.stepIndex = 2;
        f.advance(900); assert.equal(c.b.calls, 2);
        if (executor === 'runtime') {
            const receipts = f.requests.filter(r => r.method === 'POST' && r.url.includes('click-log')).map(r => JSON.parse(r.body));
            assert.equal(receipts.length, 2); assert(receipts.every(r => r.surfaceUrl === 'vscode-webview://abc/antigravity-agent' && r.identityEvidence === 'host-react-props'));
        }
    });
    check(executor + ' equal host step remount is suppressed', () => {
        const f = fixture(), first = card(f), p = policy(); fiber(first);
        load(executor, f, p); f.advance(600); assert.equal(first.b.calls, 1); first.b.isConnected = false;
        const second = card(f); fiber(second);
        f.advance(900); assert.equal(second.b.calls, 0);
    });
    check(executor + ' mismatched props remain conservative anonymous', () => {
        const f = fixture(), first = card(f), p = policy(); fiber(first, 'write_file');
        load(executor, f, p); f.advance(600); assert.equal(first.b.calls, 1); first.b.isConnected = false;
        const second = card(f); fiber(second, 'write_file', 'once', 2);
        f.advance(900); assert.equal(second.b.calls, 0); assert.equal([...f.window.__gravIntentLedger.entries.values()][0].evidence, 'local-fingerprint');
    });
    check(executor + ' fresh document retains expired unknown typed tombstone', () => {
        const f = fixture(), c = card(f), p = policy(); fiber(c); load(executor, f, p); f.advance(600); assert.equal(c.b.calls, 1);
        const entries = [...f.window.__gravIntentLedger.entries.values()].map(e => ({ key: e.key, outcome: 'unknown', at: 1, expiresAt: 2, evidence: e.evidence }));
        const fresh = fixture(), replacement = card(fresh); fiber(replacement);
        if (executor === 'cdp') {
            const ledger = Policy.createCoordinator(fresh.window, 'seed'); assert(Policy.mergeTombstones(fresh.window, { entries, saturated: false }));
        }
        load(executor, fresh, { ...p, intentTombstones: { entries, saturated: false } }); fresh.advance(1200); assert.equal(replacement.b.calls, 0);
        if (executor === 'runtime') assert(fresh.requests.find(r => r.method === 'GET').url.includes('surfaceUrl='));
    });
    check(executor + ' shared ledger prevents second executor attempt', () => {
        const f = fixture(), c = card(f), p = policy(); load(executor, f, p); f.advance(1200);
        load(executor === 'cdp' ? 'runtime' : 'cdp', f, p); f.advance(1200); assert.equal(c.b.calls, 1);
    });
}
check('bounded fiber traversal and stale selection never fabricate host identity', () => {
    const f = fixture(), c = card(f), p = policy(), props = fiber(c);
    props.interaction.memoizedProps.selections = [['other']];
    assert.equal(Policy.actionIdentity(Policy.createCoordinator(f.window, 'test'), c.b, 'Submit', p).evidence, 'local-fingerprint');
    c.b.__reactFiber$fixture.return = c.b.__reactFiber$fixture;
    assert.equal(Policy.actionIdentity(Policy.createCoordinator(f.window, 'test2'), c.b, 'Submit', p).evidence, 'local-fingerprint');
});
check('saturated or malformed recovery journal cannot enable runtime', () => {
    for (const intentTombstones of [{ entries: [], saturated: true }, { entries: [{ key: 'x', outcome: 'allow' }], saturated: false }]) {
        const f = fixture(), c = card(f); fiber(c); load('runtime', f, { ...policy(), intentTombstones }); f.advance(1200); assert.equal(c.b.calls, 0);
    }
});
check('generated injection profile and current policy drive a real runtime decision', () => {
    const Module = require('module'), path = require('path'), oldLoad = Module._load;
    let injection;
    Module._load = function(name, parent, main) {
        return name === 'vscode' ? { env: { appRoot: '/fixture' }, workspace: { workspaceFolders: [{ uri: { fsPath: '/fixture' } }], getConfiguration: () => ({ get: (key, fallback) => fallback }) } } : oldLoad.call(this, name, parent, main);
    };
    try { injection = require('../src/injection'); } finally { Module._load = oldLoad; }
    const p = { ...policy(), approveIntervalMs: 100 }; injection.setPolicyProvider(() => p);
    try {
        const built = injection.buildRuntime({ extensionPath: path.resolve(__dirname, '..'), globalState: { get: (key, fallback) => fallback } });
        const config = JSON.parse(built.match(/var initialPolicy = (.*);/)[1]);
        assert.deepEqual(config.autopilotProfile, p.autopilotProfile); assert.equal(config.interactionHost, p.interactionHost);
        assert.deepEqual(config.permissionRules, p.permissionRules); assert.equal(config.permissionProfile, 'terminal');
        const f = fixture(), c = card(f); vm.runInContext(built, f.context);
        const req = f.requests.find(r => r.method === 'GET'); req.status = 200; req.responseText = JSON.stringify(config); req.onload();
        f.advance(1600); assert.equal(c.b.calls, 1);
    } finally { injection.setPolicyProvider(null); }
});
console.log(`Results: ${passed} passed, ${failed} failed`); process.exitCode = failed ? 1 : 0;
