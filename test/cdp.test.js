'use strict';

let _passed = 0, _failed = 0;
function assert(condition, msg) {
    if (condition) { _passed++; }
    else { _failed++; console.error(`  x FAIL: ${msg}`); }
}
function section(name) { console.log(`\n── ${name} ──`); }

const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, isMain, options) {
    if (request === 'vscode') return 'vscode';
    return origResolve.call(this, request, parent, isMain, options);
};
require.cache.vscode = {
    id: 'vscode',
    filename: 'vscode',
    loaded: true,
    exports: {
        env: { appRoot: '/mock' },
        workspace: { getConfiguration: () => ({ get: (k, d) => d }) },
        window: { showWarningMessage: async () => null },
    },
    children: [],
    paths: [],
};

const { isAgentTarget } = require('../src/cdp');

section('Workbench targets');
assert(isAgentTarget({ type: 'page', url: 'file:///mock/out/vs/code/electron-sandbox/workbench/workbench.html', title: 'workspace' }), 'main workbench accepted');

section('Blocked targets');
assert(!isAgentTarget({ type: 'iframe', url: 'vscode-webview://abc/settings', title: 'Settings' }), 'settings webview rejected');
assert(!isAgentTarget({ type: 'webview', url: 'vscode-webview://abc/simple-browser', title: 'Browser' }), 'browser webview rejected');
assert(!isAgentTarget({ type: 'iframe', url: 'vscode-webview://abc/marketplace', title: 'Extensions' }), 'extensions webview rejected');

section('Agent targets');
assert(isAgentTarget({ type: 'iframe', url: 'vscode-webview://abc/antigravity-agent', title: 'Agent Chat' }), 'agent webview accepted');
assert(!isAgentTarget({ type: 'other', url: '', title: 'Cascade approval' }), 'title alone cannot establish target identity');

section('Unknown webviews');
assert(!isAgentTarget({ type: 'page', url: 'vscode-webview://abc/random-panel', title: 'Random Panel' }), 'unknown non-iframe webview rejected');
assert(!isAgentTarget({ type: 'iframe', url: 'https://example.com', title: 'External' }), 'external iframe rejected');

section('Target identity matrix');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');
const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'grav-target-'));
const installation = path.join(fixtureRoot, 'ide');
const workbench = path.join(installation, 'out/vs/code/electron-sandbox/workbench/workbench.html');
fs.mkdirSync(path.dirname(workbench), { recursive: true }); fs.writeFileSync(workbench, 'fixture');
require.cache.vscode.exports.env.appRoot = installation;
assert(isAgentTarget({ type: 'page', url: pathToFileURL(workbench).href }), 'physical IDE workbench accepted');
assert(isAgentTarget({ type: 'page', url: 'vscode-file://vscode-app' + workbench }), 'IDE vscode-file workbench accepted');
for (const url of [
    'https://example.invalid/workbench.html', 'https://example.invalid/antigravity-agent',
    'http://localhost/antigravity-agent', 'file:///tmp/workbench.html',
    'vscode-file://vscode-app/untrusted/out/vs/workbench/workbench.html',
    'vscode-file://unknown' + workbench,
    'vscode-webview://abc/random-panel', 'vscode-webview://abc/browser/antigravity-agent',
    'vscode-webview://abc/%ZZ', '', 'about:blank',
]) assert(!isAgentTarget({ type: 'iframe', url, title: 'Agent Chat' }), 'untrusted target rejected: ' + url);
for (const identity of ['antigravity-agent', 'windsurf-agent', 'codeium-chat', 'cascade', 'cortex']) {
    assert(isAgentTarget({ type: 'iframe', url: 'vscode-webview://abc/' + identity }), 'explicit agent identity accepted: ' + identity);
}
const sibling = installation + '-other';
fs.mkdirSync(sibling); fs.writeFileSync(path.join(sibling, 'workbench.html'), 'fixture');
fs.symlinkSync(sibling, path.join(installation, 'escape'));
assert(!isAgentTarget({ type: 'page', url: pathToFileURL(path.join(installation, 'escape/workbench.html')).href }), 'symlink escape rejected');
const { isWithinRoot } = require('../src/utils');
assert(!isWithinRoot(path.join(sibling, 'new-file'), installation), 'sibling-prefix write rejected');
assert(!isWithinRoot(path.join(installation, 'escape/new-file'), installation), 'absent file below symlink escape rejected');
assert(isWithinRoot(path.join(installation, 'new-directory/new-file'), installation), 'absent file within installation accepted');
fs.rmSync(fixtureRoot, { recursive: true, force: true });

console.log(`\n${'═'.repeat(40)}`);
console.log(`Results: ${_passed} passed, ${_failed} failed`);
process.exit(_failed > 0 ? 1 : 0);
