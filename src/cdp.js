// ═══════════════════════════════════════════════════════════════
//  Grav v3.0 — CDP Engine (Primary Mechanism)
//
//  CDP is now the ONLY reliable way to reach Antigravity's
//  agent panel buttons (OOPIF since v1.19.6+).
//
//  Architecture:
//    1. Auto-connect to --remote-debugging-port (argv.json patched)
//    2. Discover ALL webview targets (broad matching)
//    3. Attach + inject self-contained observer
//    4. Observer handles: auto-click, auto-scroll, safety guard
//    5. Communication: console.log('[GRAV:...]') → CDP event capture
//    6. Aggressive heartbeat: 5s check, auto-re-inject dead observers
//    7. Auto-reconnect on Electron restart
//
//  Zero-config: argv.json auto-patched, CDP auto-connects.
// ═══════════════════════════════════════════════════════════════
'use strict';

const vscode = require('vscode');
const http = require('http');

const { DEFAULT_BLACKLIST, DEFAULT_PATTERNS, PRESET_PATTERNS, SAFE_TERMINAL_CMDS } = require('./constants');
const { cfg, isWithinRoot } = require('./utils');
const { buildObserverScript } = require('./cdp-observer');
const { runTargets } = require('./event-scheduler');
const { createRecoverySupervisor } = require('./recovery-supervisor');
const { attemptJournal } = require('./state');
const Policy = require('./action-policy');
const { getEffectiveConfig } = require('./configuration');

let _getPolicy = null;
let _policyTimer = null;
function getPolicy() {
    try {
        const supplied = _getPolicy ? _getPolicy() : getEffectiveConfig();
        if (!supplied) return { enabled: false };
        const policy = { enabled: cfg('enabled', true), paused: false, dryRun: cfg('dryRun', false),
            presetMode: cfg('presetMode', '1.24+'), approvePatterns: cfg('approvePatterns', DEFAULT_PATTERNS),
            terminalWhitelist: cfg('terminalWhitelist', []), builtInGrants: SAFE_TERMINAL_CMDS, disabledPatterns: cfg('disabledPatterns', []), blacklist: [...DEFAULT_BLACKLIST, ...cfg('terminalBlacklist', [])],
            scrollEnabled: cfg('autoScroll', true), scrollPauseMs: cfg('scrollPauseMs', 7000),
            approveMs: cfg('approveIntervalMs', 1000), scrollMs: cfg('scrollIntervalMs', 800),
            skipBrowserAgent: cfg('skipBrowserAgent', false), ...supplied };
        policy.blacklist = [...new Set([...DEFAULT_BLACKLIST, ...(supplied.blacklist || supplied.terminalBlacklist || cfg('terminalBlacklist', []))])];
        policy.approveMs = supplied.approveMs ?? supplied.approveIntervalMs ?? policy.approveMs;
        policy.scrollMs = supplied.scrollMs ?? supplied.scrollIntervalMs ?? policy.scrollMs;
        policy.patterns = Policy.resolvePatterns({ ...policy, patterns: supplied.patterns ?? supplied.approvePatterns }, PRESET_PATTERNS, DEFAULT_PATTERNS);
        return policy;
    } catch (_) { return { enabled: false }; }
}
async function updatePolicy() {
    const epoch = _epoch;
    const policy = getPolicy();
    const snapshot = JSON.stringify(attemptJournal.isSaturated() ? { ...policy, enabled: false } : policy);
    await runTargets([..._sessions.values()], async session => {
        if (epoch !== _epoch || session.policyPending) return;
        session.policyPending = true;
        try {
            const reply = await send('Runtime.evaluate', {
                expression: `window.__gravObserver && window.__gravObserver.updateConfig(${snapshot})`, returnByValue: true,
            }, session.sessionId);
            if (epoch !== _epoch || ![..._sessions.values()].includes(session)) return;
            const ack = reply && !reply.exceptionDetails && reply.result && reply.result.value;
            session.policyAck = ack && ack.adapterVersion === 'adapter-v1' && ack.verified === true && ack.expiresAt > Date.now() && typeof policy.policyVersion === 'string' && ack.policyVersion === policy.policyVersion ?
                { ...ack, expiresAt: Date.now() + 1500 } : ack ? { verified: false, reasonCode: ack.adapterVersion !== 'adapter-v1' ? 'adapter-version-mismatch' : ack.reasonCode || 'executor-unverified' } : null;
        } catch (_) { session.policyAck = null; } finally { session.policyPending = false; }
        session.stableAcks = session.policyAck?.verified ? (session.stableAcks || 0) + 1 : 0;
        if (session.stableAcks >= 3) _reconnectAttempts = 0;
        if (session.policyAck?.verified && _recoveryStartedAt) { _lastRecoveryMs = Date.now() - _recoveryStartedAt; _recoveryStartedAt = 0; }
    });
}

function getRuntimeState(policy = getPolicy()) {
    const session = [..._sessions.values()].find(s => isAgentTarget({ type: 'page', url: s.url }) &&
        s.policyAck && s.policyAck.verified && s.policyAck.policyVersion === policy.policyVersion && s.policyAck.expiresAt > Date.now());
    const stopped = [..._sessions.values()].find(s => s.policyAck?.reasonCode);
    return { connected: isConnected(), verified: !!session, reasonCode: stopped?.policyAck?.reasonCode, ...(session ? session.policyAck : {}) };
}

// ── State ────────────────────────────────────────────────────
let _ws = null;
let _epoch = 0, _connectPromise = null, _stopped = false;
const _repairs = createRecoverySupervisor();
const _attaching = new Set();
let _enabled = true;     // Always enabled by default
let _port = 0;
let _configuredPort = 0;
let _msgId = 0;
let _sessions = new Map();  // targetId → { sessionId, alive, lastCheck, url }
let _heartbeat = null;
let _reconnectTimer = null;
let _callbacks = new Map();  // msgId → { resolve, reject, timer }
let _blockedLog = [];
let _onBlocked = null;
let _onClicked = null;
let _onChatEvent = null;
let _onJobObservation = null;
let _totalClicks = 0;
let _clickLog = [];
let _lastError = '';       // last connect/WS error (for diagnostics)
let _recoveryStartedAt = 0, _lastRecoveryMs = null;
let _lastPhase = 'init';   // init|disabled|discoverPort|fetchVersion|connecting|open|closed|error|reconnecting
let _debugLog = [];       // observer debug payloads (last N)
const MAX_DEBUG_LOG = 20;
let _connectWatchdog = null;
let _lastTargets = [];       // last discovered targets (for diagnostics)
let _heartbeatRunning = false;  // prevent concurrent heartbeat ticks
let _discoverRunning = false;   // prevent concurrent discoverTargets() calls

const CDP_PORTS = [9333, 9222, 9229, 9230, 9234, 9235, 9236];
const WS_TIMEOUT = 5000;
const HEARTBEAT_MS = 5000;       // 5s — aggressive self-healing
const HEARTBEAT_PING_MS = 2000;  // 2s — fast fail for session alive-checks
const RECONNECT_MS = 3000;       // 3s — fast reconnect
const MAX_BLOCKED = 50;
const DEAD_AFTER_MS = 30000;     // prune dead sessions after 30s (was 15s)

let _reconnectAttempts = 0;
let _phaseAtMs = 0;

function setPhase(p) {
    _lastPhase = p;
    _phaseAtMs = Date.now();
}

/**
 * Initialize CDP module — auto-connect immediately.
 */
function init(opts = {}) {
    _stopped = false;
    _getPolicy = opts.getPolicy || null;
    _onBlocked = opts.onBlocked || null;
    _onClicked = opts.onClicked || null;
    _onChatEvent = opts.onChatEvent || null;
    _onJobObservation = opts.onJobObservation || null;
    _port = cfg('cdpPort', 0);
    _configuredPort = _port;
    _enabled = cfg('cdpEnabled', true);

    // Always attempt to connect — this is the primary mechanism
    connect();
}

function isEnabled() { return _enabled; }
function isConnected() { return !!(_ws && _ws.readyState === 1); }
function getLastError() { return _lastError || ''; }
function getPhase() { return _lastPhase; }
function getReconnectAttempts() { return _reconnectAttempts; }
function getDebugLog() { return _debugLog; }
function getLastTargets() { return _lastTargets; }
function getSessionSummaries() {
    const out = [];
    for (const [targetId, s] of _sessions) {
        out.push({
            targetId,
            sessionId: s.sessionId,
            url: s.url || '',
            title: s.title || '',
            alive: !!s.alive,
            adapterVersion: s.policyAck?.adapterVersion || null, ledger: s.policyAck?.ledger || null, scheduler: s.policyAck?.scheduler || null,
        });
    }
    return out;
}
function getDebugState() {
    return {
        enabled: _enabled,
        port: _port,
        phase: _lastPhase,
        phaseAgeMs: _phaseAtMs ? (Date.now() - _phaseAtMs) : 0,
        lastError: _lastError || '',
        reconnectAttempts: _reconnectAttempts,
        wsReadyState: _ws ? _ws.readyState : null,
        sessions: _sessions.size,
        recoveryMs: _lastRecoveryMs,
        recoveryEvidence: 'executor-policy-ack', rendererRecovery: _repairs.snapshot(),
    };
}
function getBlockedLog() { return _blockedLog; }
function getTotalClicks() { return _totalClicks; }
function getClickLog() { return _clickLog; }
function getSessionCount() { return _sessions.size; }

function setEnabled(val) {
    _enabled = val;
    if (val) { _stopped = false; connect(); }
    else disconnect();
}

// ── Connection ───────────────────────────────────────────────
function connect() {
    if (_connectPromise) return _connectPromise;
    _stopped = false;
    const epoch = _epoch;
    const pending = connectOnce(epoch);
    _connectPromise = pending;
    pending.finally(() => { if (_connectPromise === pending) _connectPromise = null; });
    return pending;
}

async function connectOnce(epoch) {
    if (!_enabled) {
        _lastError = 'disabled (grav.cdpEnabled=false)';
        setPhase('disabled');
        return false;
    }
    if (_ws && _ws.readyState === 1) return true; // already connected
    if (_ws) return false; // A connecting socket belongs to the single-flight attempt.

    setPhase('discoverPort');
    const port = _port || await discoverPort();
    if (epoch !== _epoch || _stopped || !_enabled) return false;
    if (!port) {
        _reconnectAttempts++;
        _lastError = 'no debug port found';
        setPhase('discoverPort');
        console.log(`[Grav CDP] No debug port found (attempt ${_reconnectAttempts}) — will retry`);
        scheduleReconnect();
        return false;
    }
    _port = port;

    try {
        setPhase('fetchVersion');
        const info = await httpGet(`http://127.0.0.1:${port}/json/version`);
        if (epoch !== _epoch || _stopped || !_enabled) return false;
        let parsed;
        try { parsed = JSON.parse(info); }
        catch (e) { throw new Error('Invalid /json/version JSON: ' + String(info).slice(0, 200)); }
        const wsUrl = parsed.webSocketDebuggerUrl;
        if (!wsUrl) throw new Error('No webSocketDebuggerUrl in /json/version response');

        // Security check: DNS Rebinding protection (Must point to localhost/127.0.0.1/[::1])
        if (!wsUrl.startsWith('ws://127.0.0.1:') && !wsUrl.startsWith('ws://localhost:') && !wsUrl.startsWith('ws://[::1]:')) {
            throw new Error(`Security Alert: Non-local WebSocket connection blocked: ${wsUrl.slice(0, 80)}`);
        }

        return await new Promise((resolve) => {
            const WebSocket = require('ws');
            _lastError = '';
            console.log('[Grav CDP] Connecting WS:', wsUrl);
            setPhase('connecting');
            const socket = new WebSocket(wsUrl, { handshakeTimeout: WS_TIMEOUT });
            _ws = socket;
            const current = () => epoch === _epoch && _ws === socket && !_stopped;

            // Watchdog: sometimes sockets stay stuck in CONNECTING without error/close.
            if (_connectWatchdog) clearTimeout(_connectWatchdog);
            _connectWatchdog = setTimeout(() => {
                try {
                    if (current() && socket.readyState === 0) {
                        _lastError = 'handshake stuck (watchdog timeout)';
                        setPhase('error');
                        console.error('[Grav CDP] WS stuck in CONNECTING — forcing close');
                        _reconnectAttempts++;
                        cleanup();
                        try { socket.terminate(); } catch (_) { try { socket.close(); } catch (_) { } }
                        resolve(false);
                        if (_enabled && !_stopped) scheduleReconnect();
                    }
                } catch (_) { }
            }, WS_TIMEOUT + 1000);

            socket.on('open', () => {
                if (!current()) { resolve(false); return; }
                console.log('[Grav CDP] Connected on port', port);
                // Reset backoff only after stable executor policy acknowledgments.
                _lastError = '';
                setPhase('open');
                if (_connectWatchdog) clearTimeout(_connectWatchdog);
                _connectWatchdog = null;
                startHeartbeat();
                discoverTargets();
                resolve(true);
            });

            socket.on('message', (data) => {
                if (!current()) return;
                try { handleMessage(JSON.parse(data.toString())); } catch (e) { console.error('[Grav CDP] message parse error:', e.message); }
            });

            socket.on('close', (code, reason) => {
                if (!current()) { resolve(false); return; }
                console.log(`[Grav CDP] Disconnected (code: ${code}, reason: ${reason || 'none'})`);
                _lastError = `closed (code ${code})`;
                setPhase('closed');
                if (_connectWatchdog) clearTimeout(_connectWatchdog);
                _connectWatchdog = null;
                _reconnectAttempts++;
                cleanup();
                if (_enabled && !_stopped) scheduleReconnect();
                resolve(false);
            });

            socket.on('error', (err) => {
                if (!current()) { resolve(false); return; }
                console.error('[Grav CDP] WS error:', err.message);
                _lastError = err && err.message ? err.message : 'ws error';
                setPhase('error');
                if (_connectWatchdog) clearTimeout(_connectWatchdog);
                _connectWatchdog = null;
                _reconnectAttempts++;
                cleanup();
                try { socket.terminate(); } catch (_) {}
                if (_enabled && !_stopped) scheduleReconnect();
                resolve(false);
            });
        });
    } catch (e) {
        if (epoch !== _epoch || _stopped) return false;
        if (!_configuredPort) _port = 0;
        console.error('[Grav CDP] Connect failed:', e.message);
        _lastError = e && e.message ? e.message : 'connect failed';
        setPhase('error');
        _reconnectAttempts++;
        if (_enabled) scheduleReconnect();
        return false;
    }
}

function disconnect() {
    _stopped = true;
    const socket = _ws;
    cleanup();
    if (socket) try { socket.close(); } catch (_) { }
}

function cleanup() {
    if (_ws && !_recoveryStartedAt) _recoveryStartedAt = Date.now();
    if (_policyTimer) clearInterval(_policyTimer);
    _policyTimer = null;
    if (_heartbeat) clearInterval(_heartbeat);
    _heartbeat = null;
    if (_reconnectTimer) clearTimeout(_reconnectTimer);
    _reconnectTimer = null;
    if (_connectWatchdog) clearTimeout(_connectWatchdog);
    _connectWatchdog = null;
    // NOTE: Do NOT reset _reconnectAttempts here — it must persist across
    // disconnect/reconnect cycles so retry backoff persists across failures.
    // It resets only after stable executor policy acknowledgments.

    // Properly detach from all CDP sessions before clearing — prevents session leak
    // accumulation across reconnect cycles (each reconnect would orphan the old sessions
    // unless explicitly detached).
    if (_ws && _ws.readyState === 1 /* OPEN */) {
        for (const [, s] of _sessions) {
            if (s.sessionId) {
                try { _ws.send(JSON.stringify({ id: ++_msgId, method: 'Runtime.evaluate', sessionId: s.sessionId, params: { expression: 'window.__gravObserver && window.__gravObserver.dispose()' } })); } catch (_) { }
                try { _ws.send(JSON.stringify({ id: 0, method: 'Target.detachFromTarget', params: { sessionId: s.sessionId } })); } catch (_) { }
            }
        }
    }
    _ws = null;
    _epoch++;
    _connectPromise = null;
    _attaching.clear();
    _sessions.clear();
    _heartbeatRunning = false;
    _discoverRunning = false;
    for (const [, cb] of _callbacks) {
        clearTimeout(cb.timer);
        try { cb.reject(new Error('closed')); } catch (_) { }
    }
    _callbacks.clear();
}

function scheduleReconnect() {
    if (_stopped || !_enabled || _reconnectTimer) return;
    setPhase('reconnecting');
    // Exponential backoff: 3s, 6s, 12s, 24s... capped at 30s
    const base = Math.min(RECONNECT_MS * Math.pow(2, Math.min(_reconnectAttempts, 4)), 30000);
    const delay = Math.round(base * (0.8 + Math.random() * 0.4));
    console.log(`[Grav CDP] Reconnect in ${delay}ms (attempt ${_reconnectAttempts + 1})`);
    _reconnectTimer = setTimeout(() => {
        _reconnectTimer = null;
        if (_enabled && !_stopped) connect();
    }, delay);
}

// ── Port Discovery ───────────────────────────────────────────
async function discoverPort() {
    return new Promise((resolve) => {
        let resolved = false;
        let pending = CDP_PORTS.length;
        if (pending === 0) return resolve(0);
        
        CDP_PORTS.forEach(port => {
            const check = async (host) => {
                try {
                    const res = await httpGet(`http://${host}:${port}/json/version`);
                    if (res && res.includes('webSocketDebuggerUrl') && !resolved) {
                        resolved = true;
                        resolve(port);
                    }
                } catch (_) {}
            };
            
            Promise.all([check('127.0.0.1'), check('[::1]')]).finally(() => {
                pending--;
                if (pending === 0 && !resolved) {
                    resolve(0);
                }
            });
        });
    });
}

function httpGet(url) {
    return new Promise((resolve, reject) => {
        const req = http.get(url, { timeout: 2000 }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                if (res.statusCode && res.statusCode >= 400) {
                    return reject(new Error(`http ${res.statusCode} for ${url}`));
                }
                resolve(data);
            });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    });
}

// ── CDP Messaging ────────────────────────────────────────────
function send(method, params = {}, sessionId = null, timeoutMs = WS_TIMEOUT, epoch = _epoch) {
    if (epoch !== _epoch) return Promise.reject(new Error('stale connection'));
    if (!_ws || _ws.readyState !== 1) return Promise.reject(new Error('not connected'));
    const id = ++_msgId;
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;

    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            _callbacks.delete(id);
            reject(new Error('timeout'));
        }, timeoutMs);
        _callbacks.set(id, { resolve, reject, timer });
        try { _ws.send(JSON.stringify(msg)); }
        catch (error) { clearTimeout(timer); _callbacks.delete(id); reject(error); }
    });
}

function handleMessage(msg) {
    // Response to our request
    if (msg.id && _callbacks.has(msg.id)) {
        const cb = _callbacks.get(msg.id);
        _callbacks.delete(msg.id);
        clearTimeout(cb.timer);
        if (msg.error) cb.reject(new Error(msg.error.message));
        else cb.resolve(msg.result);
        return;
    }

    if (msg.method === 'Target.targetDestroyed') {
        const tid = msg.params.targetId;
        _sessions.delete(tid); _repairs.forget(tid);
    }

    // Event: new target created
    if (msg.method === 'Target.targetCreated') {
        const info = msg.params.targetInfo;
        const isAgent = isAgentTarget(info);
        _debugLog.unshift({ ts: Date.now(), type: 'TARGET', event: 'created', targetType: info.type, url: (info.url || '').slice(0, 100), title: (info.title || '').slice(0, 50), isAgent });
        if (_debugLog.length > MAX_DEBUG_LOG) _debugLog.pop();
        if (isAgent) {
            attachToTarget(info.targetId, info.url, info.title || '');
        }
    }

    // Event: auto-attach succeeded (OOPIF / webview subtargets)
    if (msg.method === 'Target.attachedToTarget') {
        const info = msg.params.targetInfo;
        const sessionId = msg.params.sessionId;
        try {
            const isAgent = isAgentTarget(info);
            _debugLog.unshift({ ts: Date.now(), type: 'TARGET', event: 'attached', targetType: info.type, url: (info.url || '').slice(0, 100), title: (info.title || '').slice(0, 50), isAgent, sessionId: (sessionId || '').slice(0, 16) });
            if (_debugLog.length > MAX_DEBUG_LOG) _debugLog.pop();
            console.log('[Grav CDP] Target.attachedToTarget event:', info.type, info.title || '', (info.url || '').substring(0, 80), '| isAgent:', isAgent);
            if (isAgent && sessionId) {
                // Map by targetId so we don't double-inject
                if (!_sessions.has(info.targetId)) {
                    _sessions.set(info.targetId, {
                        sessionId, alive: true,
                        lastCheck: Date.now(), url: info.url || '', title: info.title || '',
                    });
                    console.log('[Grav CDP] Auto-attached:', info.targetId, info.title || '', info.url || '');
                    // CRITICAL: Recursively enable auto-attach on this session too
                    // This allows nested OOPIFs (webviews inside webviews) to be discovered
                    enableAutoAttach(sessionId).catch(() => {});
                    // Enable domains and inject observer
                    send('Runtime.enable', {}, sessionId).catch(() => { });
                    send('DOM.enable', {}, sessionId).catch(() => { });
                    send('Input.enable', {}, sessionId).catch(() => { });
                    injectObserver(sessionId);
                }
            } else if (sessionId) {
                send('Target.detachFromTarget', { sessionId }).catch(() => {});
            }
        } catch (_) { }
    }

    if (msg.method === 'Target.detachedFromTarget') {
        // Best-effort: remove any target with this sessionId
        const sid = msg.params.sessionId;
        if (sid) {
            for (const [tid, s] of _sessions) {
                if (s.sessionId === sid) _sessions.delete(tid);
            }
        }
    }

    // Event: target info changed (URL update after navigation)
    if (msg.method === 'Target.targetInfoChanged') {
        const info = msg.params.targetInfo;
        if (!isAgentTarget(info) && _sessions.has(info.targetId)) {
            const session = _sessions.get(info.targetId);
            send('Runtime.evaluate', { expression: 'window.__gravObserver && window.__gravObserver.dispose()' }, session.sessionId).catch(() => {});
            send('Target.detachFromTarget', { sessionId: session.sessionId }).catch(() => {});
            _sessions.delete(info.targetId);
        }
        if (isAgentTarget(info) && !_sessions.has(info.targetId)) {
            attachToTarget(info.targetId, info.url, info.title || '');
        }
    }

    // Event: target destroyed
    if (msg.method === 'Target.targetDestroyed') {
        _sessions.delete(msg.params.targetId);
    }

    // Event: console message from injected observer
    if (msg.method === 'Runtime.consoleAPICalled') {
        handleConsoleEvent(msg.params, msg.sessionId);
    }
}

// ── Console Event Handler (communication from observer) ──────
function handleConsoleEvent(params, sessionId) {
    if (![..._sessions.values()].some(s => s.sessionId === sessionId)) return;
    if (!params.args || !params.args.length) return;
    const text = params.args[0]?.value || '';
    if (typeof text !== 'string') return;

    // Parse structured messages: [GRAV:type] payload
    const m = text.match(/^\[GRAV:(\w+)\]\s*(.*)/);
    if (!m) return;

    const type = m[1];
    const payload = m[2];

    if (type === 'CLICK') {
        _totalClicks++;
        const now = new Date();
        const ts = [now.getHours(), now.getMinutes(), now.getSeconds()]
            .map(n => n < 10 ? '0' + n : n).join(':');
        try {
            const data = JSON.parse(payload);
            const session = [..._sessions.values()].find(s => s.sessionId === sessionId);
            attemptJournal.remember(session?.url, data);
            _clickLog.unshift({ time: ts, pattern: data.p || '', button: data.b || '' });
            if (_clickLog.length > 50) _clickLog.pop();
            if (_onClicked) _onClicked({ ...data, targetSessionId: sessionId });
        } catch (_) {
            _clickLog.unshift({ time: ts, pattern: payload, button: payload });
            if (_clickLog.length > 50) _clickLog.pop();
        }
    }

    // RETRY: Observer click failed — escalate to CDP Input.dispatchMouseEvent
    // This sends TRUSTED mouse events at the browser level, bypassing all JS interception
    if (type === 'RETRY') {
        try {
            const data = JSON.parse(payload);
            cdpNativeClick(data.p || '', data.b || '');
        } catch (_) { }
    }

    if (type === 'BLOCKED') {
        try {
            const data = JSON.parse(payload);
            logBlocked(data.cmd || payload, data.reason || 'manual review', data);
        } catch (_) {
            logBlocked(payload, 'blacklisted');
        }
    }

    if (type === 'DRYRUN') {
        try {
            const data = JSON.parse(payload);
            const now = new Date();
            const ts = [now.getHours(), now.getMinutes(), now.getSeconds()]
                .map(n => n < 10 ? '0' + n : n).join(':');
            _clickLog.unshift({ time: ts, pattern: '[DRY] ' + (data.p || ''), button: data.b || '', dryRun: true });
            if (_clickLog.length > 50) _clickLog.pop();
            console.log('[Grav DRY] Would click:', data.p, '-', data.b);
            if (_onClicked) _onClicked({ ...data, dryRun: true });
        } catch (_) { }
    }

    // JOB: verified host job lifecycle events from the injected
    // agentStateProvider producer (streamAgentStateUpdates).
    if (type === 'JOB') {
        try {
            const data = JSON.parse(payload);
            if (_onJobObservation) _onJobObservation({ ...data, targetSessionId: sessionId, evidence: 'host-job-lifecycle' });
        } catch (e) { console.error('[Grav CDP] JOB parse error:', e.message); }
    }

    if (type === 'CHAT') {
        try {
            const data = JSON.parse(payload);
            if (_onJobObservation) _onJobObservation({ ...data, targetSessionId: sessionId, evidence: 'renderer-observation', type: 'progress' });
            if (_onChatEvent) _onChatEvent(data);
        } catch (e) { console.error('[Grav CDP] CHAT parse error:', e.message); }
    }

    // DEBUG/BOOT: capture observer introspection (labels, counts, url)
    // Tag each entry with sessionId (first 12 chars) so dashboard can group by webview.
    if (type === 'DEBUG' || type === 'BOOT') {
        const sid = sessionId ? sessionId.slice(0, 12) : '';
        try {
            const obj = JSON.parse(payload);
            _debugLog.unshift({ ts: Date.now(), type, sid, ...obj });
            if (_debugLog.length > MAX_DEBUG_LOG) _debugLog.pop();
        } catch (_) {
            _debugLog.unshift({ ts: Date.now(), type, sid, raw: payload });
            if (_debugLog.length > MAX_DEBUG_LOG) _debugLog.pop();
        }
    }
}

// ══════════════════════════════════════════════════════════════
//  CDP Native Click — Input.dispatchMouseEvent
//  This is the nuclear option: sends trusted mouse events through
//  the browser's input pipeline, identical to real user clicks.
//  Used when JS-level clicks fail (RETRY events from observer).
//
//  Learned from Puppeteer's page.click() implementation:
//  1. DOM.querySelector to find the button
//  2. DOM.getBoxModel to get coordinates
//  3. Input.dispatchMouseEvent sequence: mouseMoved → mousePressed → mouseReleased
// ══════════════════════════════════════════════════════════════
async function cdpNativeClick() {
    // An unchanged label is not evidence that activation failed. Never replay approvals
    // from renderer console messages (which are untrusted input).
    return false;
}

// ── Target Discovery & Attachment ────────────────────────────
/**
 * Determine if a CDP target is the Antigravity agent/chat panel.
 *
 * Antigravity 1.19.6+ architecture (OOPIF):
 *   - Main workbench: file:///...antigravity.app/.../workbench.html (type: page)
 *   - Agent panel:    vscode-webview://... (type: iframe/other/webview)
 *   - Settings:       vscode-webview://...settings... (MUST SKIP)
 *   - Browser:        vscode-webview://...simple-browser... (MUST SKIP)
 *   - Extensions:     vscode-webview://...extensions... (MUST SKIP)
 *
 * Strategy: 2-layer filtering
 *   Layer 1 (host-side): Accept workbench + agent webviews, BLOCK all non-agent panels
 *   Layer 2 (observer-side): inEditorContext() blocks buttons in wrong containers
 *
 * CRITICAL: We MUST NOT inject into Settings, Browser, Editor, Extensions
 * panels — clicking buttons there would change user preferences.
 */
function isAgentTarget(info) {
    if (!info || !['page', 'iframe', 'webview', 'other'].includes(info.type)) return false;
    let url;
    try { url = new URL(info.url); } catch (_) { return false; }
    if (url.protocol === 'file:' || url.protocol === 'vscode-file:') {
        const path = require('path');
        const { fileURLToPath } = require('url');
        if (url.protocol === 'vscode-file:' && url.hostname !== 'vscode-app') return false;
        try {
            const physical = fileURLToPath(url.protocol === 'file:' ? url : new URL('file://' + url.pathname));
            if (!isWithinRoot(physical, vscode.env.appRoot)) return false;
            const relative = path.relative(path.resolve(vscode.env.appRoot), physical).split(path.sep).join('/');
            return /^out\/vs\/(?:code\/(?:electron-sandbox|electron-browser|browser|electron-main)\/)?workbench\/workbench\.html$/.test(relative);
        } catch (_) { return false; }
    }
    if (url.protocol !== 'vscode-webview:') return false;
    let identity;
    try { identity = decodeURIComponent(url.pathname).toLowerCase(); } catch (_) { return false; }
    if (/(?:^|\/)grav(?:[-/]|$)|browser|preview|settings|marketplace|extension/.test(identity)) return false;
    return /(?:^|[/])(?:antigravity-agent|windsurf-agent|codeium-chat|cascade|cortex)(?:[/]|$)/.test(identity);
}

async function enableAutoAttach(sessionId = null, epoch = _epoch) {
    try {
        await send('Target.setAutoAttach', {
            autoAttach: true,
            waitForDebuggerOnStart: false,
            flatten: true,
            filter: [
                { type: 'page', exclude: false },
                { type: 'iframe', exclude: false },
                { type: 'webview', exclude: false },
                { type: 'other', exclude: false }
            ]
        }, sessionId, WS_TIMEOUT, epoch);
    } catch (_) {
        if (epoch !== _epoch) return;
        try {
            await send('Target.setAutoAttach', {
                autoAttach: true,
                waitForDebuggerOnStart: false,
                flatten: true
            }, sessionId, WS_TIMEOUT, epoch);
        } catch (_) { }
    }
}

async function discoverTargets() {
    if (_discoverRunning) return;
    _discoverRunning = true;
    const epoch = _epoch;
    const command = (method, params = {}, sid = null) => send(method, params, sid, WS_TIMEOUT, epoch);
    try {
        // ══════════════════════════════════════════════════════════
        //  CRITICAL: Enable auto-attach BEFORE discovering targets
        //  This is required for Antigravity 1.19.6+ where agent UI
        //  runs in OOPIF (Out-of-Process Iframe).
        //
        //  Order matters:
        //  1. setAutoAttach (enables automatic attachment to new targets)
        //  2. setDiscoverTargets (starts receiving target events)
        //  3. getTargets (gets current list)
        //  4. Attach to main pages first (they contain nested webviews)
        // ══════════════════════════════════════════════════════════
        // Enable auto-attach with flatten=true for OOPIF support
        await enableAutoAttach(null, epoch);
        if (epoch !== _epoch) return;
        await command('Target.setDiscoverTargets', { discover: true });
        const { targetInfos } = await command('Target.getTargets');
        if (epoch !== _epoch) return;
        _lastTargets = (targetInfos || []).map(t => ({
            type: t.type, title: t.title || '', url: t.url || '', targetId: t.targetId,
        })).slice(0, 200);

        // Count target types for diagnostics
        const typeCounts = {};
        const webviewTargets = [];
        for (const info of targetInfos) {
            typeCounts[info.type] = (typeCounts[info.type] || 0) + 1;
            if ((info.url || '').includes('vscode-webview://')) {
                webviewTargets.push(info);
            }
        }
        console.log('[Grav CDP] Found', targetInfos.length, 'targets. Types:', JSON.stringify(typeCounts),
            '| Webviews:', webviewTargets.length);

        // Log webview targets specifically (these are where agent buttons live)
        for (const wv of webviewTargets) {
            console.log('[Grav CDP] WEBVIEW:', wv.type, '|', wv.title || 'no-title', '|', (wv.url || '').substring(0, 100));
        }

        for (const info of targetInfos) {
            if (epoch !== _epoch) return;
            const match = isAgentTarget(info);
            if (match && !_sessions.has(info.targetId)) {
                console.log('[Grav CDP] Attaching:', info.type, '|', (info.title || '').substring(0, 60), '|', (info.url || '').substring(0, 100));
                await attachToTarget(info.targetId, info.url, info.title || '');
            }
        }
    } catch (e) {
        console.error('[Grav CDP] Target discovery failed:', e.message);
    } finally {
        if (epoch === _epoch) _discoverRunning = false;
    }
}

async function attachToTarget(targetId, url, title = '') {
    if (_sessions.has(targetId) || _attaching.has(targetId)) return;
    const epoch = _epoch;
    const command = (method, params = {}, sid = null) => send(method, params, sid, WS_TIMEOUT, epoch);
    _attaching.add(targetId);
    try {
        const { sessionId } = await command('Target.attachToTarget', {
            targetId, flatten: true,
        });
        if (epoch !== _epoch) return;
        if (_sessions.has(targetId)) {
            if (_sessions.get(targetId).sessionId !== sessionId) await command('Target.detachFromTarget', { sessionId });
            return;
        }
        _sessions.set(targetId, {
            sessionId, alive: true,
            lastCheck: Date.now(), url: url || '', title: title || '',
        });
        console.log('[Grav CDP] Attached:', targetId, url || '');

        // CRITICAL: Enable auto-attach recursively on THIS session
        // This allows OOPIF/webview frames nested inside this target to be discovered
        await enableAutoAttach(sessionId, epoch);

        // Enable Runtime + Console + DOM + Input for this session
        await command('Runtime.enable', {}, sessionId);
        // Sanity ping: verify console events flow back to extension host
        try {
            await command('Runtime.evaluate', {
                expression: `console.log('[GRAV:DEBUG] ' + JSON.stringify({ ping: 1, ts: Date.now(), url: location && location.href ? String(location.href).slice(0,120) : '' }))`,
            }, sessionId);
        } catch (_) { }
        // DOM + Input needed for CDP native click fallback
        try { await command('DOM.enable', {}, sessionId); } catch (_) { }
        try { await command('Input.enable', {}, sessionId); } catch (_) { }

        // Inject the observer
        await injectObserver(sessionId);
    } catch (e) {
        console.error('[Grav CDP] Attach failed:', e.message);
    } finally { if (epoch === _epoch) _attaching.delete(targetId); }
}

// ── Observer Injection ───────────────────────────────────────
async function injectObserver(sessionId) {
    const session = [..._sessions.values()].find(s => s.sessionId === sessionId);
    if (!session || session.injecting) return;
    const epoch = _epoch;
    session.injecting = true;
    const policy = getPolicy();
    const script = attemptJournal.seedScript(session.url) + buildObserverScript(policy.patterns, policy.blacklist, policy.scrollEnabled,
        policy.scrollPauseMs, policy.dryRun, policy.skipBrowserAgent, attemptJournal.isSaturated() ? { ...policy, enabled: false } : policy);

    try {
        await send('Runtime.evaluate', {
            expression: script,
            awaitPromise: false,
            returnByValue: false,
        }, sessionId, WS_TIMEOUT, epoch);
        if (epoch === _epoch && [..._sessions.values()].includes(session)) await updatePolicy();
    } catch (e) {
        console.error('[Grav CDP] Observer inject failed:', e.message);
    } finally { session.injecting = false; }
}

/**
 * Actively probe attached targets for accept/approve-like buttons.
 * This is used by diagnostics because observer debug snapshots can miss late dialogs.
 * @returns {Promise<Array<{sessionId:string, url?:string, acceptLike:string[], sample:string[]}>>}
 */
async function probeAcceptLike() {
    const out = [];
    const expr = `(function(){
        function textOf(el){
            try{
                var t = (el.innerText || el.textContent || '').trim();
                if (!t) t = (el.getAttribute && (el.getAttribute('aria-label')||el.getAttribute('title')||'')) || '';
                t = (t||'').trim().split('\\n')[0].trim();
                if (t.length > 80) t = t.slice(0,80);
                return t;
            }catch(e){return '';}
        }
        // Prefer prefix match to avoid false positives from long sentences ("Terminal ... run ...")
        var acceptRe = /^(accept\\s+all|accept|approve|retry|proceed|run|expand)\\b/i;
        var sel = 'button,[role=\"button\"],[role=\"menuitem\"],a.action-label,vscode-button,a,[tabindex],span.cursor-pointer,[class*=\"cursor-pointer\"],[class*=\"flux-button\"],[class*=\"flux-action\"],[data-testid*=\"accept\"],[data-testid*=\"approve\"],[class*=\"clickable\"]';

        function collectFromRoot(root, into){
            if (!root) return;
            try {
                var list = root.querySelectorAll(sel);
                for (var i=0;i<list.length;i++) into.push(list[i]);
            } catch(e){}
        }

        // Collect from main doc + open shadow roots + same-origin iframes
        var nodes = [];
        collectFromRoot(document, nodes);
        function scanShadow(root) {
            if (!root) return;
            try {
                var all = root.querySelectorAll('*');
                for (var i=0;i<all.length;i++){
                    var sr = all[i].shadowRoot;
                    if (sr) {
                        collectFromRoot(sr, nodes);
                        scanShadow(sr);
                    }
                }
            } catch(e){}
        }
        scanShadow(document);
        try {
            var iframes = document.querySelectorAll('iframe');
            for (var j=0;j<iframes.length;j++){
                try{
                    var doc = iframes[j].contentDocument;
                    if (doc) collectFromRoot(doc, nodes);
                } catch(e2){}
            }
        } catch(e){}

        var sample = [];
        var acceptLike = [];
        for (var i=0; i<nodes.length && (sample.length<120 || acceptLike.length<80); i++){
            var el = nodes[i];
            try{
                if (el.disabled) continue;
                var r = el.getBoundingClientRect && el.getBoundingClientRect();
                if (r && r.width===0 && r.height===0) continue;
            }catch(e){}
            var t = textOf(el);
            if (!t) continue;
            if (sample.length < 120) sample.push(t);
            if (acceptRe.test(t) && acceptLike.indexOf(t) === -1) acceptLike.push(t);
        }
        return { url: (location && location.href ? String(location.href).slice(0,140) : ''), acceptLike: acceptLike, sample: sample.slice(0,60) };
    })()`;

    for (const [, session] of _sessions) {
        try {
            const res = await send('Runtime.evaluate', { expression: expr, returnByValue: true }, session.sessionId);
            const val = res?.result?.value || {};
            out.push({
                sessionId: session.sessionId,
                url: val.url || session.url || '',
                acceptLike: Array.isArray(val.acceptLike) ? val.acceptLike : [],
                sample: Array.isArray(val.sample) ? val.sample : [],
            });
        } catch (e) {
            out.push({
                sessionId: session.sessionId,
                url: session.url || '',
                acceptLike: [],
                sample: [`probe failed: ${e.message || String(e)}`],
            });
        }
    }
    return out;
}


// ── Heartbeat & Self-Healing ─────────────────────────────────
let _lastFullDiscovery = 0;
const FULL_DISCOVERY_INTERVAL = 15000; // Full re-discovery every 15s

function startHeartbeat() {
    if (_policyTimer) clearInterval(_policyTimer);
    _policyTimer = setInterval(() => {
        updatePolicy().catch(() => {});
    }, 500);
    if (_heartbeat) clearInterval(_heartbeat);
    _heartbeat = setInterval(async () => {
        // Prevent overlapping ticks — if the previous tick is still running, skip this one.
        // Without this guard, setInterval fires every 5s regardless of async completion,
        // causing concurrent ticks that each issue CDP commands and cascade timeouts.
        if (_heartbeatRunning) return;
        if (!_ws || _ws.readyState !== 1) return;
        _heartbeatRunning = true;
        const epoch = _epoch;
        try {
            // Check each attached session
            await runTargets([..._sessions], async ([targetId, session]) => {
                if (epoch !== _epoch || _sessions.get(targetId) !== session) return;
                try {
                    // Use short timeout for ping — if observer is alive it responds instantly.
                    // Fast failure prevents blocking the entire heartbeat tick.
                    const result = await send('Runtime.evaluate', {
                        expression: 'window.__grav3',
                        returnByValue: true,
                    }, session.sessionId, HEARTBEAT_PING_MS, epoch);

                    if (epoch !== _epoch || _sessions.get(targetId) !== session) return;
                    if (!result || !result.result || typeof result.result.value !== 'string' || !result.result.value.startsWith('v')) {
                        // Observer died or was never injected — re-inject
                        await _repairs.repair(targetId, () => {
                            console.log('[Grav CDP] Re-injecting observer for', targetId);
                            return injectObserver(session.sessionId);
                        });
                    } else if (session.policyAck?.verified && session.policyAck.expiresAt > Date.now()) {
                        _repairs.healthy(targetId);
                    } else { _repairs.unhealthy(targetId); }
                    if (epoch !== _epoch || _sessions.get(targetId) !== session) return;
                    session.alive = true;
                    session.lastCheck = Date.now();
                } catch (e) {
                    if (epoch !== _epoch || _sessions.get(targetId) !== session) return;
                    _repairs.unhealthy(targetId);
                    session.alive = false;
                    if (Date.now() - session.lastCheck > DEAD_AFTER_MS) {
                        _sessions.delete(targetId);
                        console.log('[Grav CDP] Pruned dead session:', targetId);
                    }
                }
            });

            // Re-discover targets (new webviews may have appeared)
            // Do full discovery less frequently to avoid overwhelming CDP
            if (epoch !== _epoch) return;
            const now = Date.now();
            if (now - _lastFullDiscovery > FULL_DISCOVERY_INTERVAL || _sessions.size === 0) {
                _lastFullDiscovery = now;
                await discoverTargets();
            }

            // If no sessions after discovery, something is wrong - log diagnostic
            if (_sessions.size === 0) {
                console.log('[Grav CDP] WARNING: No active sessions. Targets:', _lastTargets.length);
            }
        } finally {
            if (epoch === _epoch) _heartbeatRunning = false;
        }
    }, HEARTBEAT_MS);
}

// ── Hot-Update Observer Config ───────────────────────────────
async function hotUpdate() {
    const enabled = cfg('cdpEnabled', true);
    const port = cfg('cdpPort', 0);
    const reconnect = enabled !== _enabled || port !== _configuredPort;
    _enabled = enabled;
    _configuredPort = port;
    if (reconnect) {
        disconnect();
        _port = port;
        if (_enabled) await connect();
        return;
    }
    await updatePolicy();
    for (const session of _sessions.values()) await injectObserver(session.sessionId);
}

// ── Force Reconnect (for manual recovery) ────────────────────
async function forceReconnect() {
    console.log('[Grav CDP] Force reconnect requested');
    _port = 0; // Reset port to re-discover
    _reconnectAttempts = 0;
    disconnect();
    return connect();
}

// ── Blocked Command Logging ──────────────────────────────────
function logBlocked(cmd, reason, metadata = {}) {
    const ts = new Date().toISOString().slice(11, 19);
    _blockedLog.unshift({ time: ts, cmd: cmd.slice(0, 200), reason });
    if (_blockedLog.length > MAX_BLOCKED) _blockedLog.pop();
    if (_onBlocked) _onBlocked(cmd, reason, metadata);
}

function resetStats() { _totalClicks = 0; _clickLog = []; _blockedLog = []; }

module.exports = {
    init, connect, disconnect, forceReconnect,
    isEnabled, isConnected, setEnabled,
    getBlockedLog, getTotalClicks, getClickLog, getSessionCount,
    getLastError, getPhase, getReconnectAttempts, getRuntimeState,
    getDebugState,
    getDebugLog,
    getLastTargets,
    getSessionSummaries,
    probeAcceptLike,
    isAgentTarget,
    hotUpdate, updatePolicy, cdpNativeClick, resetStats,
};
