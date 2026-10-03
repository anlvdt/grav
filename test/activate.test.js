// Smoke-test activation of the local extension with mocked vscode
'use strict';

const path = require('path');
const extPath = path.resolve(__dirname, '..');

let _passed = 0, _failed = 0;
function assert(condition, msg) {
    if (condition) { _passed++; }
    else { _failed++; console.error(`  x FAIL: ${msg}`); }
}

const mockDisposable = { dispose() {} };
const mockSubs = [];

const vscode = {
    env: { appName: 'Antigravity', appRoot: '/mock' },
    window: {
        createStatusBarItem: () => ({
            show() {},
            hide() {},
            dispose() {},
            text: '',
            color: '',
            tooltip: '',
            command: '',
            backgroundColor: undefined,
        }),
        showQuickPick: async () => null,
        showInformationMessage: async () => null,
        showWarningMessage: async () => null,
        showErrorMessage: async () => null,
        showInputBox: async () => null,
        setStatusBarMessage: () => {},
        terminals: [],
        onDidChangeTextEditorSelection: () => mockDisposable,
        onDidOpenTerminal: () => mockDisposable,
        onDidCloseTerminal: () => mockDisposable,
    },
    workspace: {
        getConfiguration: () => ({ get: (k, d) => d, update: async () => {} }),
        workspaceFolders: [{ uri: { fsPath: '/tmp/test' }, name: 'test' }],
        onDidChangeConfiguration: () => mockDisposable,
        onDidChangeTextDocument: () => mockDisposable,
        createFileSystemWatcher: () => ({
            onDidChange() { return mockDisposable; },
            onDidCreate() { return mockDisposable; },
            onDidDelete() { return mockDisposable; },
            dispose() {},
        }),
    },
    commands: {
        getCommands: async () => ['antigravity.accept', 'antigravity.acceptAll', 'workbench.action.chat.applyAll'],
        executeCommand: async () => {},
        registerCommand: () => mockDisposable,
    },
    StatusBarAlignment: { Right: 2, Left: 1 },
    ThemeColor: class ThemeColor { constructor(v) { this.v = v; } },
    ConfigurationTarget: { Global: 1, Workspace: 2 },
    RelativePattern: class RelativePattern { constructor() {} },
    Uri: { file: (p) => ({ fsPath: p }) },
};

const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent) {
    if (request === 'vscode') return 'vscode';
    return origResolve.apply(this, arguments);
};
require.cache.vscode = { id: 'vscode', filename: 'vscode', loaded: true, exports: vscode };

// Lifecycle smoke tests must never patch the developer's real IDE/profile or bind ports.
const calls = { inject: 0, argv: 0, cache: 0 };
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
    if (parent?.filename === path.join(extPath, 'src/extension.js')) {
        if (request === './argv') return { ensureCdpInArgv: () => {
            calls.argv++;
            return { changed: false, path: '/mock/argv.json', backupPath: null, port: 9333 };
        } };
        if (request === './injection') return {
            setPolicyProvider() {}, isInjected: () => false,
            inject: () => { calls.inject++; return true; },
            patchChecksums: () => true, writeRuntimeConfig: () => true,
            hotUpdateRuntime: () => true, eject: () => true,
            clearCodeCache: () => { calls.cache++; },
        };
        if (request === './cdp') return null;
        if (request === './bridge') return { start() {}, stop() {} };
    }
    return originalLoad.call(this, request, parent, isMain);
};

(async () => {
    try {
        const ext = require(path.join(extPath, 'src/extension.js'));
        const ctx = {
            extensionPath: extPath,
            globalState: { get: (k, d) => d, update: async () => {} },
            subscriptions: mockSubs,
            extension: { packageJSON: { version: '4.0.15' } },
        };
        await ext.activate(ctx);
        assert(mockSubs.length > 0, 'activation registers subscriptions');
        assert(calls.inject === 1, 'supported host injection uses stub');
        assert(calls.argv === 1, 'supported host argv configuration uses stub');
        assert(calls.cache === 0, 'activation does not clear IDE cache');
        ext.deactivate();
    } catch (e) {
        assert(false, e && e.message ? e.message : String(e));
    }

    console.log(`\n${'═'.repeat(40)}`);
    console.log(`Results: ${_passed} passed, ${_failed} failed`);
    process.exit(_failed > 0 ? 1 : 0);
})();
