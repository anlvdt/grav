'use strict';
const assert = require('assert');
const Module = require('module');
const originalLoad = Module._load;
const callbacks = {}, sent = [], intervals = new Map();
let id = 0, checks = 0;
let policy = { policyVersion: 'fixture-v1', enabled: true, paused: false, dryRun: false, blacklist: [], autoFixEnabled: true };
const mock = {
    workspace: { getConfiguration: () => ({ get: (key, fallback) => fallback }) },
    window: { terminals: [], onDidStartTerminalShellExecution: fn => { callbacks.start = fn; return { dispose() {} }; },
        onDidEndTerminalShellExecution: fn => { callbacks.end = fn; return { dispose() {} }; },
        onDidOpenTerminal: () => ({ dispose() {} }) },
};
Module._load = function(request, parent, isMain) { return request === 'vscode' ? mock : originalLoad.call(this, request, parent, isMain); };
const oldInterval = global.setInterval, oldClear = global.clearInterval;
global.setInterval = fn => { intervals.set(++id, fn); return id; }; global.clearInterval = key => intervals.delete(key);
const records = [];
const ctx = { subscriptions: [] };
const { setup } = require('../src/terminal');
setup(ctx, { recordAction: (...args) => records.push(args) }, { getPolicy: () => policy });
function check(fn) { fn(); checks++; }
function end(command, exitCode) {
    callbacks.end({ exitCode, execution: { commandLine: { value: command } }, terminal: { name: 'dummy', sendText: text => sent.push(text) } });
}
for (const exitCode of [undefined, NaN, '1', 0]) end('gti status', exitCode);
check(() => assert.strictEqual(sent.length, 0, 'unknown/successful exit cannot trigger fixes'));
end('gti push --force', 1);
check(() => assert.strictEqual(sent.length, 0, 'corrected command checked against default blacklist'));
end('gti status; echo "$(touch dummy)"', 1);
check(() => assert.strictEqual(sent.length, 0, 'shell expansion not replayed'));
for (const gate of [{ enabled: false }, { paused: true }, { dryRun: true }, { active: false }, { autoFixEnabled: false }]) {
    policy = { policyVersion: 'fixture-v1', enabled: true, paused: false, dryRun: false, blacklist: [], autoFixEnabled: true, ...gate };
    end('gti status ' + Object.keys(gate)[0], 1);
    check(() => assert.strictEqual(sent.length, 0));
}
policy = { policyVersion: 'fixture-v1', enabled: true, paused: false, dryRun: false, autoFixEnabled: true, blacklist: ['git status'] };
end('gti status blocked', 1); check(() => assert.strictEqual(sent.length, 0, 'supplied blacklist honored'));
policy.blacklist = [];
end('gti status permitted', 1);
check(() => assert.deepStrictEqual(sent, ['git status permitted'], 'one authorized command, no shell echo'));
callbacks.start({ execution: { id: 'fixture', commandLine: { value: 'git status' } } });
check(() => assert.strictEqual(records.at(-1)[2].source, 'terminal-observation'));
ctx.subscriptions.forEach(s => s.dispose());
end('gti status disposed', 1);
check(() => assert.strictEqual(sent.length, 1));
check(() => assert.strictEqual(intervals.size, 0));
Module._load = originalLoad; global.setInterval = oldInterval; global.clearInterval = oldClear;
console.log(`Results: ${checks} passed, 0 failed`);
