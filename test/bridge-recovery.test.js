'use strict';
const baseAssert = require('assert/strict');
let checks = 0;
const assert = new Proxy(baseAssert, {
    apply(target, receiver, args) { checks++; return Reflect.apply(target, receiver, args); },
    get(target, key) { const value = target[key]; return typeof value === 'function' ? (...args) => { checks++; return value(...args); } : value; },
});
const fs = require('fs'), path = require('path'), vm = require('vm');
const { EventEmitter } = require('events');
const timers = new Map(), servers = [];
let timerId = 0, observations = [], clicks = 0;
const sandbox = { module: { exports: {} },
    setTimeout(fn, ms) { timers.set(++timerId, { fn, ms }); return timerId; }, clearTimeout(id) { timers.delete(id); },
    require(id) {
        if (id === 'vscode') return { workspace: { workspaceFolders: [] } };
        if (id === 'http') return { createServer(handler) {
            const server = Object.assign(new EventEmitter(), { handler, listening: false,
                listen(port, host, cb) { this.port = port; this.listening = true; cb(); },
                close() { this.listening = false; this.emit('close'); } });
            servers.push(server); return server;
        } };
        if (id === './utils') return { cfg: (key, fallback) => fallback };
        if (id.startsWith('./')) return require(path.join(__dirname, '../src', id));
        return require(id);
    },
};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/bridge.js'), 'utf8'), sandbox);
const bridge = sandbox.module.exports;
const deps = { getPolicy: () => ({ enabled: true }), getState: () => ({ stats: {}, log: [], session: {} }),
    onClickLogged: () => clicks++, onStatsUpdated() {}, onChatEvent() {}, onJobObservation: e => observations.push(e) };
const ctx = { globalState: { get: (_, fallback) => fallback } };
const request = (server, endpoint) => {
    const req = Object.assign(new EventEmitter(), { url: endpoint, method: 'POST', headers: {}, socket: { remoteAddress: '127.0.0.1' } });
    const res = { setHeader() {}, writeHead() {}, end() {} };
    server.handler(req, res); return { finish(body) { req.emit('data', JSON.stringify(body)); req.emit('end'); } };
};
const tick = () => { const [id, timer] = [...timers.entries()][0]; timers.delete(id); timer.fn(); return timer.ms; };
bridge.start(ctx, deps);
const first = servers[0], late = request(first, '/api/click-log');
first.emit('error', new Error('listener failure'));
assert.equal(timers.size, 1);
first.emit('close'); assert.equal(timers.size, 1, 'close/error produce one restart');
assert.equal(tick(), 1000);
late.finish({ pattern: 'Accept', source: 'runtime' });
assert.equal(clicks, 0, 'old request body cannot mutate replacement state');
first.emit('error', new Error('stale')); assert.equal(timers.size, 0);
for (const delay of [2000, 4000, 60000]) {
    servers.at(-1).emit('error', new Error('still failing')); assert.equal(tick(), delay);
}
request(servers.at(-1), '/api/chat-event').finish({ type: 'completed', jobId: 'job', eventId: 'event', evidence: 'host-job-lifecycle' });
assert.equal(observations[0].evidence, 'renderer-observation');
assert.equal(observations[0].type, 'progress', 'untrusted renderer cannot assert host completion');
servers.at(-1).emit('error', new Error('failure after activity'));
assert.equal([...timers.values()][0].ms, 1000, 'fresh request resets recovery burst');
bridge.stop(); assert.equal(timers.size, 0);
assert.equal(bridge.getPort(), 0);
first.emit('close'); assert.equal(timers.size, 0, 'explicit stop never restarts');
bridge.start(ctx, deps); assert(bridge.getPort() > 0); bridge.stop();
console.log(`Results: ${checks} passed, 0 failed`);
