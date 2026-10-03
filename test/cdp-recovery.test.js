'use strict';
const baseAssert = require('assert/strict');
let checks = 0;
const assert = new Proxy(baseAssert, {
    apply(target, receiver, args) { checks++; return Reflect.apply(target, receiver, args); },
    get(target, key) { const value = target[key]; return typeof value === 'function' ? (...args) => { checks++; return value(...args); } : value; },
});
const fs = require('fs'), path = require('path'), vm = require('vm');
const { EventEmitter } = require('events');
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
    const timers = new Map(), intervals = new Map(), sockets = [], httpRequests = [], messages = [];
    let id = 0, observer = 'v4', holdMethod = null, automaticHttp = true;
    const policy = { policyVersion: 'current', enabled: true, patterns: ['Accept'] };
    const ack = () => ({ adapterVersion: 'adapter-v1', policyVersion: 'current', verified: true, expiresAt: Date.now() + 10000 });
    class Socket extends EventEmitter {
        constructor() { super(); this.readyState = 0; sockets.push(this); }
        send(raw) {
            const m = JSON.parse(raw); messages.push(m);
            if (holdMethod === m.method) return;
            let result = {};
            if (m.method === 'Target.getTargets') result = { targetInfos: [] };
            if (m.method === 'Target.attachToTarget') result = { sessionId: 'attached' };
            if (m.method === 'Runtime.evaluate') result = { result: { value: m.params.expression === 'window.__grav3' ? observer : m.params.expression.includes('.updateConfig(') ? ack() : undefined } };
            queueMicrotask(() => this.emit('message', Buffer.from(JSON.stringify({ id: m.id, result }))));
        }
        close() { this.readyState = 3; this.emit('close', 1000); }
        terminate() { this.close(); }
        open() { this.readyState = 1; this.emit('open'); }
    }
    const context = vm.createContext({ module: { exports: {} }, URL, console: { log() {}, error() {} },
        setTimeout(fn, ms) { timers.set(++id, { fn, ms }); return id; }, clearTimeout(id) { timers.delete(id); },
        setInterval(fn, ms) { intervals.set(++id, { fn, ms }); return id; }, clearInterval(id) { intervals.delete(id); },
        require(request) {
            if (request === 'vscode') return { env: { appRoot: '/mock' } };
            if (request === './utils') return { cfg: (key, fallback) => key === 'cdpPort' ? 9333 : fallback, isWithinRoot: () => true };
            if (request === './configuration') return { getEffectiveConfig: () => policy };
            if (request === './cdp-observer') return { buildObserverScript: () => 'fixture-observer-install' };
            if (request === 'ws') return Socket;
            if (request === 'http') return { get(url, opts, cb) {
                const req = Object.assign(new EventEmitter(), { destroy() {} });
                const reply = () => { const res = new EventEmitter(); cb(res); res.emit('data', '{"webSocketDebuggerUrl":"ws://127.0.0.1:9333/devtools/browser"}'); res.emit('end'); };
                httpRequests.push(reply); if (automaticHttp) queueMicrotask(reply); return req;
            } };
            if (request.startsWith('./')) return require(path.join(__dirname, '../src', request));
            return require(request);
        },
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/cdp.js'), 'utf8') + `\nmodule.exports.test = {
        send, attachToTarget, startHeartbeat,
        sessions: () => [..._sessions.values()],
        callbacks: () => _callbacks.size,
    };`, context);
    const cdp = context.module.exports;
    const tick = ms => { const row = [...timers.entries()].find(([, t]) => ms === undefined || t.ms === ms); assert(row, 'timer exists'); timers.delete(row[0]); row[1].fn(); };
    const heartbeat = async () => { const timer = [...intervals.values()].find(t => t.ms === 5000); assert(timer); await timer.fn(); await flush(); };
    const attachEvent = socket => socket.emit('message', Buffer.from(JSON.stringify({ method: 'Target.attachedToTarget', params: {
        sessionId: 'agent', targetInfo: { targetId: 'target', type: 'iframe', url: 'vscode-webview://fixture/antigravity-agent' } } })));
    return { cdp, timers, intervals, sockets, httpRequests, messages, tick, heartbeat, attachEvent,
        set hold(value) { holdMethod = value; }, set observer(value) { observer = value; }, set automaticHttp(value) { automaticHttp = value; } };
}
(async () => {
    const f = fixture();
    const first = f.cdp.connect(), concurrent = f.cdp.connect();
    assert.equal(first, concurrent, 'concurrent callers share the connect promise');
    await flush(); assert.equal(f.sockets.length, 1);
    f.sockets[0].open(); assert.equal(await first, true); await flush();
    f.attachEvent(f.sockets[0]); await flush(); assert.equal(f.cdp.getSessionCount(), 1);
    f.sockets[0].emit('message', Buffer.from(JSON.stringify({ method: 'Runtime.consoleAPICalled', sessionId: 'agent', params: { args: [{ value: '[GRAV:CLICK] '+JSON.stringify({ intentId: 'request-guard:approval', identityEvidence: 'host-attribute' }) }] } })));
    f.hold = 'Runtime.evaluate';
    const pending = f.cdp.test.send('Runtime.evaluate', { expression: 'held' });
    const rejection = assert.rejects(pending, /closed/);
    f.sockets[0].close(); await rejection;
    assert.equal(f.cdp.test.callbacks(), 0);
    assert.equal(f.intervals.size, 0);
    assert.equal(f.timers.size, 1, 'disconnect schedules exactly one reconnect');
    f.sockets[0].emit('error', new Error('late error')); assert.equal(f.timers.size, 1);
    f.hold = null; f.tick(); await flush();
    f.sockets[1].open(); await flush(); f.attachEvent(f.sockets[1]); await flush();
    assert(f.messages.some(m => m.params?.expression?.includes('request-guard:approval') && m.params.expression.endsWith('fixture-observer-install')), 'reconnected observer receives host attempt tombstones before installation');
    const liveCount = f.cdp.getSessionCount();
    f.attachEvent(f.sockets[0]); f.sockets[0].emit('close', 1006);
    assert.equal(f.cdp.getSessionCount(), liveCount, 'retired socket events cannot mutate current sessions');
    assert.equal(f.cdp.isConnected(), true);
    const before = f.messages.filter(m => m.params?.expression?.endsWith('fixture-observer-install')).length;
    f.observer = null;
    for (let n = 0; n < 5; n++) await f.heartbeat();
    assert.equal(f.messages.filter(m => m.params?.expression?.endsWith('fixture-observer-install')).length - before, 3, 'heartbeat applies bounded renderer installation budget');
    assert.equal(f.cdp.getDebugState().rendererRecovery.deferred, 2);
    f.observer = 'v4'; for (let n = 0; n < 3; n++) await f.heartbeat();
    assert.equal(f.cdp.getDebugState().rendererRecovery.stableRecoveries, 1);
    assert.equal(f.messages.some(m => m.method === 'Input.dispatchMouseEvent'), false, 'recovery never replays side effects');
    f.cdp.disconnect(); assert.equal(f.timers.size, 0); assert.equal(f.intervals.size, 0);
    f.sockets[1].emit('close', 1006); assert.equal(f.timers.size, 0, 'explicit stop suppresses delayed reconnect');

    const early = fixture(); const earlyConnect = early.cdp.connect(); await flush();
    early.sockets[0].close(); assert.equal(await earlyConnect, false, 'close before open settles the connect promise'); early.cdp.disconnect();
    const stuck = fixture(); const stuckConnect = stuck.cdp.connect(); await flush();
    stuck.tick(6000); assert.equal(await stuckConnect, false, 'handshake watchdog settles and recovers');
    assert.equal(stuck.timers.size, 1); stuck.cdp.disconnect();
    const http = fixture(); http.automaticHttp = false;
    const cancelled = http.cdp.connect(); http.cdp.disconnect(); http.httpRequests[0]();
    assert.equal(await cancelled, false); assert.equal(http.sockets.length, 0, 'stale HTTP discovery cannot create a socket after stop');

    const attaching = fixture(); let c = attaching.cdp.connect(); await flush(); attaching.sockets[0].open(); await c; await flush();
    attaching.hold = 'Target.attachToTarget';
    const a = attaching.cdp.test.attachToTarget('x', 'vscode-webview://fixture/antigravity-agent');
    const b = attaching.cdp.test.attachToTarget('x', 'vscode-webview://fixture/antigravity-agent');
    assert.equal(attaching.messages.filter(m => m.method === 'Target.attachToTarget').length, 1, 'discovery and target events share one attach attempt');
    attaching.cdp.disconnect(); await Promise.all([a, b]); assert.equal(attaching.cdp.getSessionCount(), 0);
    console.log(`Results: ${checks} passed, 0 failed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
