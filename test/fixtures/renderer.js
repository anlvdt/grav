'use strict';
const vm = require('vm');
function fixture() {
    let now = 100000, id = 0, wakeups = 0;
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
        send(body) { this.body = body; }
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
            wakeups++; timer.fn();
        }
        now = end;
    }
    return { getWakeups: () => wakeups, context, window, document, toasts, timers, observers, listeners, logs, requests, button, advance, originalShadow, Element };
}
module.exports = { fixture };
