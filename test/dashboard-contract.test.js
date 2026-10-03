'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');
const filename = path.join(__dirname, '../src/dashboard.js');
const localRequire = createRequire(filename);
let handler, dispose, viewChanged, policyChanges = 0, failUpdate = false, failFeedback = false, failed = 0, passed = 0;
let state = { stats: { Accept: 4 }, totalClicks: 4, log: [{ cmd: 'old' }] };
const writes = [], messages = [], timers = [], feedbackCalls = [], executedCommands = [];
const config = { get: (key, fallback) => fallback, update: async (key, value) => {
    if (failUpdate) throw new Error('write rejected');
    writes.push([key, value]);
} };
const panel = { visible: true, webview: { postMessage: m => messages.push(m), onDidReceiveMessage: fn => { handler = fn; } },
    onDidChangeViewState: fn => { viewChanged = fn; }, onDidDispose: fn => { dispose = fn; }, dispose: () => dispose() };
const vscode = { workspace: { getConfiguration: () => config }, ConfigurationTarget: { Global: 1 }, Uri: { file: p => p },
    ViewColumn: { One: 1 }, window: { createWebviewPanel: () => panel }, commands: { executeCommand(command) { executedCommands.push(command); } } };
const exportsObject = { exports: {} };
vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module: exportsObject, __dirname: path.dirname(filename), require: name => name === 'vscode' ? vscode : name === './utils' ? { cfg: (key, fallback) => config.get(key, fallback) } : localRequire(name),
    setInterval: (fn, delay) => { timers.push({ fn, delay }); return timers.length; }, clearInterval() {},
}, { filename });
const dashboard = exportsObject.exports;
const persisted = {};
const ctx = { extensionPath: path.join(__dirname, '..'), subscriptions: [], globalState: {
    get: (key, fallback) => persisted[key] ?? fallback,
    update: async (key, value) => { persisted[key] = value; },
} };
const learning = { getWhitelist: () => [], getBlacklist: () => [], getPromotedCommands: () => [], getEpoch: () => 1,
    getData: () => ({}), getPatternCache: () => [] };
const wiki = { getWiki: () => ({ index: {}, concepts: {}, log: [] }), getContradictions: () => [] };
let saves = 0;
// Fixture for the engine contract: getState().runtime and decision trace entries.
const runtimeFixture = { status: 'paused', reasonCode: 'dashboard-visible', reason: 'Dashboard is open', workspace: 'grav-fixture', policyVersion: 'p-7' };
const traceFixture = { trace: [{ id: 'trace-9', decision: 'deny', reasonCode: 'terminal-blacklist', reason: 'Blacklisted command', matchedRules: [{ type: 'blacklist', source: 'default', pattern: 'rm -rf', argv: ['rm', '-rf'] }], scope: { type: 'terminal', source: 'argv', argvPrefix: ['rm', '-rf'], broad: true }, policyVersion: 'p-7', outcome: 'unknown' }] };
const deps = { recordFeedback: (kind, meta) => { if (failFeedback) throw new Error('Trace ID expired'); feedbackCalls.push([kind, meta]); }, getTraceSnapshot: () => traceFixture,
    onPolicyChanged: () => { policyChanges++; }, learning, wiki, getState: () => ({ ...state }), setState: patch => { state = { ...state, ...patch }; }, onSave: async () => { saves++; } };
const data = { enabled: true, scrollOn: true, skipBrowser: true, skipTerminalAccept: true, dryRun: false,
    pauseMs: 15000, scrollMs: 500, approveMs: 1200, patterns: ['Accept', 'Custom label'], disabledPatterns: [], operationMode: 'custom', presetMode: 'custom' };
async function check(name, fn) { try { await fn(); passed++; } catch (e) { failed++; console.error(name, e); } }
(async () => {
    dashboard.toggle(ctx, deps);
    await check('Visibility changes notify policy immediately', () => {
        assert.equal(policyChanges, 1);
        panel.visible = false; viewChanged();
        assert.equal(policyChanges, 2);
        panel.visible = true; viewChanged();
    });
    await check('Autopilot setup routes to the configured command without changing policy', async () => {
        const before = writes.length;
        await handler({ command: 'configureAutopilot' });
        assert.equal(executedCommands.at(-1), 'grav.configureAutopilot');
        assert.equal(writes.length, before);
        assert.match(panel.webview.html, /type="button" id="btnConfigureAutopilot"/);
    });
    await check('Configured approval interval renders', () => assert.match(panel.webview.html, /value="1000"/));
    await check('CSP event attributes absent', () => assert.doesNotMatch(panel.webview.html, /\son\w+=/i));
    await check('Hostile JSON cannot terminate nonce script', () => {
        const html = dashboard.buildHtml({ patterns: ['</script><script>bad()</script>'], version: '<bad>' });
        assert.equal((html.match(/<script /g) || []).length, 1);
        assert.ok(html.includes('\\u003c/script\\u003e'));
        new vm.Script(html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1]);
    });
    await check('Invalid complete payload writes nothing', async () => {
        for (const patch of [{ pauseMs: NaN }, { enabled: 'true' }, { patterns: [null] }, { disabledPatterns: [''] }, { operationMode: 'bogus' }, { presetMode: '1.24+' }]) {
            const before = writes.length;
            await handler({ command: 'save', data: { ...data, ...patch } });
            assert.equal(writes.length, before);
            assert.equal(messages.at(-1).success, false);
        }
    });
    await check('Custom pattern configuration commits presetMode and awaits save', async () => {
        await handler({ command: 'save', data });
        assert.ok(writes.some(([key, value]) => key === 'presetMode' && value === 'custom'));
        assert.equal(saves, 1);
        assert.equal(messages.at(-1).success, true);
    });
    await check('Named preset commits effective pattern policy', async () => {
        const preset = localRequire('./operation-presets').buildOperationPreset('safe');
        await handler({ command: 'save', data: { ...data, enabled: preset.enabled, scrollOn: preset.autoScroll,
            skipBrowser: preset.skipBrowserAgent, skipTerminalAccept: preset.skipTerminalAccept,
            approveMs: preset.approveIntervalMs, patterns: preset.approvePatterns, disabledPatterns: preset.disabledPatterns, operationMode: 'safe' } });
        assert.equal(messages.at(-1).success, true);
        await handler({ command: 'save', data: { ...data, operationMode: 'safe' } });
        assert.equal(messages.at(-1).success, false);
    });
    await check('Rejected update sends failed ACK', async () => {
        failUpdate = true;
        await handler({ command: 'save', data });
        failUpdate = false;
        assert.equal(messages.at(-1).success, false);
    });
    await check('Reset uses actual state setter and persists', async () => {
        await handler({ command: 'resetStats' });
        assert.equal(state.totalClicks, 0);
        assert.equal(Object.keys(state.stats).length, 0);
        assert.equal(persisted.totalClicks, 0);
        state = { ...state, stats: { Retry: 1 }, totalClicks: 1 };
        timers.find(t => t.delay === 2500).fn();
        assert.equal(messages.at(-1).totalClicks, 1);
        assert.equal(messages.at(-1).stats.Retry, 1);
    });
    await check('Clear log survives rerender and next event', async () => {
        await handler({ command: 'clearLog' });
        assert.equal(state.log.length, 0);
        assert.equal(persisted.clickLog.length, 0);
        state.log.push({ cmd: 'new' });
        await handler({ command: 'getLog' });
        assert.equal(messages.at(-1).log.length, 1);
        assert.equal(messages.at(-1).log[0].cmd, 'new');
        dashboard.render();
    });
    const sent = command => messages.filter(m => m.command === command);
    await check('Missing runtime snapshot renders as null, not an inferred status', () => {
        assert.match(panel.webview.html, /let _runtimeState = null;/);
        assert.doesNotMatch(panel.webview.html, /id="chkSkipTerminal"/);
    });
    await check('Runtime snapshot is embedded and pushed once per change', () => {
        state = { ...state, runtime: runtimeFixture };
        dashboard.render();
        assert.ok(panel.webview.html.includes('"reasonCode":"dashboard-visible"'));
        const before = sent('runtimeUpdated').length;
        timers.find(t => t.delay === 2500).fn();
        assert.equal(sent('runtimeUpdated').length, before + 1);
        assert.deepEqual(sent('runtimeUpdated').at(-1).runtime, runtimeFixture);
        timers.find(t => t.delay === 2500).fn();
        assert.equal(sent('runtimeUpdated').length, before + 1);
        state = { ...state, runtime: undefined };
        timers.find(t => t.delay === 2500).fn();
        assert.equal(sent('runtimeUpdated').at(-1).runtime, null);
    });
    await check('Save ACK follows a runtime refresh', async () => {
        state = { ...state, runtime: { ...runtimeFixture, status: 'ready' } };
        await handler({ command: 'save', data });
        const tail = messages.slice(-2);
        assert.equal(tail[0].command, 'runtimeUpdated');
        assert.equal(tail[0].runtime.status, 'ready');
        assert.equal(tail[1].command, 'saveResult');
        assert.equal(tail[1].success, true);
    });
    await check('Feedback sends the specific trace ID and acknowledges it', async () => {
        await handler({ command: 'feedback', kind: 'falsePositive', traceId: ' trace-9 ', reason: 'dashboard feedback' });
        // The meta object is created inside the vm realm, so compare serialized values.
        assert.equal(JSON.stringify(feedbackCalls.at(-1)), JSON.stringify(['falsePositive', { reason: 'dashboard feedback', traceId: 'trace-9' }]));
        const result = messages.at(-1);
        assert.equal(result.command, 'feedbackResult');
        assert.equal(result.success, true);
        assert.equal(result.traceId, 'trace-9');
        assert.equal(messages.at(-2).command, 'traceUpdated');
    });
    await check('Feedback without a valid trace ID or kind never reaches the backend', async () => {
        const before = feedbackCalls.length;
        for (const patch of [{ traceId: undefined }, { traceId: '  ' }, { traceId: 42 }, { traceId: 'x'.repeat(101) }, { kind: 'bogus' }]) {
            await handler({ command: 'feedback', kind: 'falseNegative', traceId: 'trace-9', ...patch });
            assert.equal(messages.at(-1).success, false);
        }
        assert.equal(feedbackCalls.length, before);
    });
    await check('Backend rejection of an expired trace ID is reported', async () => {
        failFeedback = true;
        await handler({ command: 'feedback', kind: 'falseNegative', traceId: 'trace-1' });
        failFeedback = false;
        assert.equal(messages.at(-1).success, false);
        assert.equal(messages.at(-1).error, 'Trace ID expired');
        assert.equal(messages.at(-1).traceId, 'trace-1');
    });
    await check('Invalid envelope ignored', async () => { await handler(null); });
    const beforeDispose = policyChanges;
    dashboard.toggle(ctx, deps);
    await check('Dispose notifies policy after panel is cleared', () => { assert.equal(policyChanges, beforeDispose + 1); assert.equal(dashboard.getPanel(), null); });
    console.log(`Results: ${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
})();
