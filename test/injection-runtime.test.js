'use strict';
const assert = require('assert');
const vm = require('vm');
const path = require('path');
const Module = require('module');
const originalLoad = Module._load;
const vscode = {
    env: { appRoot: '/fixture' },
    workspace: { getConfiguration: () => ({ get: (key, fallback) => key === 'presetMode' ? 'custom' : fallback }) },
};
Module._load = function(request, parent, isMain) {
    return request === 'vscode' ? vscode : originalLoad.call(this, request, parent, isMain);
};
const injection = require('../src/injection');
Module._load = originalLoad;
const ctx = { extensionPath: path.resolve(__dirname, '..'), globalState: { get: (key, fallback) => fallback } };
let checks = 0;
function check(fn) { fn(); checks++; }
function fixture() {
    let now = 100000, id = 0;
    const timers = new Map(), observers = [], listeners = new Map(), logs = [], requests = [];
    const buttons = [], toasts = [];
    const addTimer = (fn, ms, repeat) => { const key = ++id; timers.set(key, { fn, ms, at: now + ms, repeat }); return key; };
    class Element { attachShadow() { return { querySelectorAll: () => [], host: this }; } }
    const originalShadow = Element.prototype.attachShadow;
    class MutationObserver {
        constructor(fn) { this.fn = fn; this.active = true; observers.push(this); }
        observe() {}
        disconnect() { this.active = false; }
    }
    class XMLHttpRequest {
        constructor() { requests.push(this); }
        addEventListener() {}
        open(method, url) { this.method = method; this.url = url; }
        setRequestHeader() {}
        send() {}
        abort() { this.aborted = true; }
    }
    const body = { querySelectorAll: () => [], parentElement: null };
    const document = { body, documentElement: body, title: 'Agent Chat',
        querySelectorAll: selector => selector === '*' || selector === 'iframe' ? [] : selector.includes('notification') ? toasts : buttons,
        querySelector: () => null };
    const window = { setTimeout: (fn, ms) => addTimer(fn, ms, false), setInterval: (fn, ms) => addTimer(fn, ms, true),
        clearTimeout: key => timers.delete(key), clearInterval: key => timers.delete(key),
        addEventListener: (name, fn) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
        removeEventListener: (name, fn) => listeners.get(name)?.delete(fn), MutationObserver, XMLHttpRequest,
        getComputedStyle: () => ({ visibility: 'visible', display: 'block', opacity: '1', pointerEvents: 'auto' }), innerWidth: 1000, innerHeight: 1000 };
    const context = vm.createContext({ window, document, Element, MutationObserver, XMLHttpRequest, location: { href: 'vscode-webview://abc/antigravity-agent' },
        console: { log: (...args) => logs.push(args.join(' ')), error: (...args) => logs.push(args.join(' ')) },
        Date: class extends Date { static now() { return now; } },
        clearTimeout: window.clearTimeout, clearInterval: window.clearInterval, getComputedStyle: window.getComputedStyle });
    function button(label, command) {
        const attributes = {};
        const step = { className: 'tool-step', innerText: command || '', querySelectorAll: () => command === undefined ? [] : [{ textContent: command, getAttribute: () => null }] };
        const b = { disabled: false, offsetWidth: 100, offsetHeight: 30, childNodes: [], innerText: label, textContent: label,
            isConnected: true, className: 'agent-button', tagName: 'BUTTON', parentElement: null, calls: 0,
            getAttribute: name => name === 'aria-label' ? label : attributes[name] || '',
            setAttribute: (name, value) => { attributes[name] = value; }, hasAttribute: name => name in attributes,
            closest: selector => selector.includes('[class*=tool]') ? step : selector === '.antigravity-agent-side-panel' || selector === '[class*=agent]' ? step : null,
            querySelectorAll: () => [], getBoundingClientRect: () => ({ top: 10, left: 10, width: 100, height: 30, right: 110, bottom: 40 }),
            click: () => { b.calls++; } };
        buttons.push(b); return b;
    }
    function advance(ms) {
        const end = now + ms;
        for (let count = 0; count < 10000; count++) {
            const due = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
            if (!due) break;
            const [key, timer] = due; now = timer.at;
            if (timer.repeat) timer.at += timer.ms; else timers.delete(key);
            timer.fn();
        }
        now = end;
    }
    return { context, window, timers, observers, listeners, logs, requests, button, advance, originalShadow, Element };
}

function authorize(f, source) {
    const config = JSON.parse(source.match(/var initialPolicy = (.*);/)[1]);
    const request = f.requests.find(request => request.method === 'GET' && request.url.includes('/grav-status'));
    request.status = 200; request.responseText = JSON.stringify(config); request.onload();
}

let livePolicy = { policyVersion: 'fixture-v1', enabled: true, paused: false, dryRun: false, patterns: ['Expand'], blacklist: ['shutdown', '/forbidden/'],
    scrollEnabled: true, approveIntervalMs: 100, scrollIntervalMs: 300, permissionProfile: 'terminal', permissionRules: [], autopilotProfile: { enabled: true, grants: [{ id: 'read', effect: 'allow', operation: 'read_file', target: '/fixture/input', scope: 'once' }] }, interactionHost: 'ide-2.5.5-unified-permission-dom', resumeToken: 4, eventScheduler: true };
injection.setPolicyProvider(() => livePolicy);
try {
    const source = injection.buildRuntime(ctx);
    const initialPolicy = JSON.parse(source.match(/var initialPolicy = (.*);/)[1]);
    for (const field of ['permissionProfile', 'permissionRules', 'autopilotProfile', 'interactionHost', 'resumeToken', 'eventScheduler']) {
        check(() => assert.deepStrictEqual(initialPolicy[field], livePolicy[field], 'generated transport ' + field));
    }
    check(() => assert(!source.includes('/*{{ACTION_POLICY}}*/') && !source.includes('/*{{POLICY}}*/')));
    check(() => assert(source.includes('"paused":false') && source.includes('"dryRun":false') && source.includes('"shutdown"') && source.includes('"/forbidden/"') && source.includes('"git push --force"')));
    const f = fixture(); const b = f.button('Expand');
    vm.runInContext(source, f.context);
    f.advance(250);
    check(() => assert.strictEqual(b.calls, 0, 'generated initial policy cannot authorize before live bridge reply'));
    authorize(f, source); f.advance(250);
    check(() => assert.strictEqual(b.calls, 1, 'live bridge authorizes safe navigation once'));
    check(() => assert.strictEqual(f.window.__gravEnabled, true));
    f.window.__gravRuntime.dispose();
    check(() => assert.strictEqual(f.timers.size, 0));
    for (const gate of [{ enabled: false }, { paused: true }, { dryRun: true }, { active: false }]) {
        livePolicy = { policyVersion: 'fixture-v1', enabled: true, paused: false, dryRun: false, patterns: ['Expand'], blacklist: [],
            approveIntervalMs: 100, ...gate };
        const f = fixture(); const b = f.button('Expand');
        const source = injection.buildRuntime(ctx);
        vm.runInContext(source, f.context); authorize(f, source); f.advance(500);
        check(() => assert.strictEqual(b.calls, 0, 'generated gate ' + JSON.stringify(gate)));
        f.window.__gravRuntime.dispose();
    }
    livePolicy = { policyVersion: 'fixture-v1', enabled: true, paused: false, dryRun: false, patterns: ['Approve'], blacklist: ['shutdown'], approveIntervalMs: 100 };
    const blockedFixture = fixture(); const blocked = blockedFixture.button('Approve', 'shutdown now');
    const blockedSource = injection.buildRuntime(ctx);
    vm.runInContext(blockedSource, blockedFixture.context); authorize(blockedFixture, blockedSource); blockedFixture.advance(1000);
    check(() => assert.strictEqual(blocked.calls, 0, 'generated blacklist blocks command-bearing approval'));
    blockedFixture.window.__gravRuntime.dispose();
    livePolicy.blacklist = [];
    const defaultFixture = fixture(); const destructive = defaultFixture.button('Approve', 'git push --force');
    const defaultSource = injection.buildRuntime(ctx);
    vm.runInContext(defaultSource, defaultFixture.context); authorize(defaultFixture, defaultSource); defaultFixture.advance(1000);
    check(() => assert.strictEqual(destructive.calls, 0, 'live rendered evaluator preserves default blacklist'));
    defaultFixture.window.__gravRuntime.dispose();
} finally { injection.setPolicyProvider(null); }
console.log(`Results: ${checks} passed, 0 failed`);
