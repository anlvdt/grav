'use strict';

const vscode = require('vscode');
const http = require('http');
const url = require('url');

const { PORT_START, PORT_END, DEFAULT_PATTERNS } = require('./constants');
const { cfg } = require('./utils');
const Policy = require('./action-policy');
const { attemptJournal } = require('./state');

let _server = null, _port = 0, _ctx = null, _deps = null;
let _generation = 0, _restartTimer = null, _restartAttempts = 0, _stopped = true;
let _lastError = '';
const MAX_BODY = 64 * 1024;

// Rate limiting: max requests per IP per window
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute
const RATE_LIMIT_MAX = 120;         // 120 requests per minute
const _rateLimits = new Map();      // ip → { count, resetAt }

function isRateLimited(ip) {
    const now = Date.now();
    let entry = _rateLimits.get(ip);
    if (!entry || now > entry.resetAt) {
        entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
    }
    entry.count++;
    _rateLimits.set(ip, entry);
    // Prune stale entries periodically
    if (_rateLimits.size > 50) {
        for (const [k, v] of _rateLimits) { if (now > v.resetAt) _rateLimits.delete(k); }
    }
    return entry.count > RATE_LIMIT_MAX;
}

const readBody = (req, cb) => {
    let body = '', size = 0;
    req.on('data', chunk => { size += chunk.length; if (size > MAX_BODY) { req.destroy(); return; } body += chunk; });
    req.on('end', () => { if (req.bridgeGeneration === _generation && !_stopped) cb(body); });
};

const parseJSON = (str) => { try { return JSON.parse(str); } catch (_) { return null; } };
const isStr = (v, maxLen = 500) => typeof v === 'string' && v.length > 0 && v.length <= maxLen;

function start(ctx, deps) {
    if (_server || _restartTimer) return;
    _ctx = ctx;
    _deps = deps;
    _stopped = false;
    openServer();
}

function openServer() {
    const generation = ++_generation;
    const server = http.createServer((req, res) => {
        if (generation !== _generation || _stopped) { res.writeHead(503); res.end(); return; }
        handleRequest(req, res);
    });
    _server = server;
    const current = () => generation === _generation && _server === server && !_stopped;
    let candidate = _port || PORT_START;
    const retry = error => {
        if (!current()) return;
        _lastError = error?.message || 'bridge closed';
        _server = null;
        ++_generation; // Ignore body/close/listen callbacks belonging to the old listener.
        try { server.close(); } catch (_) {}
        if (_restartTimer || _stopped) return;
        // Bound fast repairs to three, then keep unattended discovery at a slow cadence.
        const delay = _restartAttempts++ < 3 ? 1000 * Math.pow(2, _restartAttempts - 1) : 60000;
        _restartTimer = setTimeout(() => { _restartTimer = null; if (!_stopped) openServer(); }, delay);
    };
    server.on('error', error => {
        if (!current()) return;
        if (error.code === 'EADDRINUSE' && candidate < PORT_END) { listen(++candidate); return; }
        retry(error);
    });
    server.on('close', () => retry());
    function listen(port) {
        try {
            server.listen(port, '127.0.0.1', () => {
                if (!current()) return;
                _port = port; _lastError = '';
                // A bind alone is not stable recovery; reset the budget on a fresh request.
            });
        } catch (error) { retry(error); }
    }
    listen(candidate);
}

function stop() {
    _stopped = true; ++_generation;
    if (_restartTimer) clearTimeout(_restartTimer);
    _restartTimer = null;
    const server = _server; _server = null;
    if (server) try { server.close(); } catch (_) { /* cleanup */ }
    _port = 0; _ctx = null; _deps = null; _restartAttempts = 0;
}
function getPort() { return _server?.listening === false ? 0 : _port; }
function getRecoveryState() { return { connected: !!_server && _server.listening !== false && _port > 0, retryPending: !!_restartTimer, attempts: _restartAttempts, lastError: _lastError }; }

function handleRequest(req, res) {
    req.bridgeGeneration = _generation;
    _restartAttempts = 0;
    // Rate limiting
    const clientIp = req.socket.remoteAddress || '127.0.0.1';
    if (isRateLimited(clientIp)) {
        res.writeHead(429);
        res.end('{"error":"rate limited"}');
        return;
    }

    const origin = req.headers.origin || '';
    const isLocal = !origin || origin.startsWith('vscode-webview://') || origin === 'http://127.0.0.1' || origin.startsWith('http://127.0.0.1:');
    res.setHeader('Access-Control-Allow-Origin', isLocal ? (origin || '*') : 'null');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (!isLocal && origin) { res.writeHead(403); res.end('{"error":"forbidden"}'); return; }

    const u = url.parse(req.url, true);
    const state = _deps.getState();
    const policy = _deps.getPolicy ? _deps.getPolicy() : { enabled: state.enabled, paused: state.paused, dryRun: state.dryRun };
    const actionsAllowed = policy.enabled && !policy.paused && !policy.dryRun;

    // Stats from runtime
    if (actionsAllowed && u.query && u.query.stats) {
        try { const inc = parseJSON(decodeURIComponent(u.query.stats)); if (inc && typeof inc === 'object') { for (const k in inc) { if (Number.isSafeInteger(inc[k]) && inc[k] > 0 && inc[k] <= 100) state.stats[k] = (state.stats[k] || 0) + inc[k]; } state.totalClicks = Object.values(state.stats).reduce((a, b) => a + b, 0); _deps.onStatsUpdated(); } } catch (_) { /* non-critical */ }
    }

    // Click log
    if (u.pathname === '/api/click-log' && req.method === 'POST') {
        readBody(req, body => {
            const d = parseJSON(body);
            if (!d) { res.writeHead(400); res.end('{"error":"invalid json"}'); return; }
            attemptJournal.remember(d.surfaceUrl, d);
            const latest = _deps.getPolicy ? _deps.getPolicy() : policy;
            if (!latest.enabled || latest.paused || latest.dryRun || d.dryRun) { res.writeHead(200); res.end('{"ok":true}'); return; }
            const state = _deps.getState();
            const now = new Date();
            const ts = [now.getHours(), now.getMinutes(), now.getSeconds()].map(n => n < 10 ? '0' + n : n).join(':');
            const pattern = isStr(d.pattern, 60) ? d.pattern : 'click';
            const button = isStr(d.button, 80) ? d.button.substring(0, 80) : '';
            state.log.unshift({ time: ts, pattern, button });
            if (state.log.length > 50) state.log.pop();
            if (d.source === 'grav' || d.source === 'runtime') {
                state.stats[pattern] = (state.stats[pattern] || 0) + 1;
                state.session.approveCount++;
                _deps.onStatsUpdated();
            }
            _deps.onClickLogged(d);
            res.writeHead(200); res.end('{"ok":true}');
        });
        return;
    }

    // Command evaluation
    if (u.pathname === '/api/eval-command' && req.method === 'POST') {
        readBody(req, body => {
            const d = parseJSON(body);
            if (!d || !isStr(d.command)) { res.writeHead(400); res.end('{"error":"missing command"}'); return; }
            const result = Policy.evaluateCommand(d.command, _deps.getPolicy ? _deps.getPolicy() : policy);
            res.writeHead(200); res.end(JSON.stringify(result));
        });
        return;
    }

    // Wiki query
    if (u.pathname === '/api/wiki-query' && req.method === 'POST') {
        readBody(req, body => {
            const d = parseJSON(body);
            if (!d || !isStr(d.command)) { res.writeHead(400); res.end('{"error":"missing command"}'); return; }
            const result = _deps.wiki.query(d.command);
            res.writeHead(200); res.end(JSON.stringify(result || { error: 'not found' }));
        });
        return;
    }

    // Wiki status
    if (u.pathname === '/api/wiki-status') {
        const w = _deps.wiki.getWiki();
        res.writeHead(200); res.end(JSON.stringify({ pages: Object.keys(w.index).length, concepts: Object.keys(w.concepts).length, contradictions: _deps.wiki.getContradictions().length }));
        return;
    }

    // Learn command
    if (u.pathname === '/api/learn-command' && req.method === 'POST') {
        readBody(req, body => {
            const d = parseJSON(body);
            if (!d || !isStr(d.command) || !isStr(d.action, 10)) { res.writeHead(400); res.end('{"error":"missing command/action"}'); return; }
            if (d.action !== 'approve' && d.action !== 'reject') { res.writeHead(400); res.end('{"error":"action must be approve or reject"}'); return; }
            _deps.learning.recordAction(d.command, d.action, { exitCode: typeof d.exitCode === 'number' ? d.exitCode : undefined, project: isStr(d.project, 100) ? d.project : (vscode.workspace.workspaceFolders?.[0]?.name) });
            res.writeHead(200); res.end('{"ok":true}');
        });
        return;
    }

    // Chat event
    if (u.pathname === '/api/chat-event' && req.method === 'POST') {
        readBody(req, body => {
            const d = parseJSON(body);
            if (!d || !isStr(d.type, 30)) { res.writeHead(200); res.end('{"ok":true}'); return; }
            if (_deps.onJobObservation) _deps.onJobObservation({ ...d, evidence: 'renderer-observation', type: 'progress' });
            _deps.onChatEvent(d);
            res.writeHead(200); res.end('{"ok":true}');
        });
        return;
    }

    // Terminal event
    if (u.pathname === '/api/terminal-event' && req.method === 'POST') {
        readBody(req, body => {
            const d = parseJSON(body);
            if (!d || !isStr(d.cmd)) { res.writeHead(200); res.end('{"ok":true}'); return; }
            _deps.onTerminalEvent(d);
            res.writeHead(200); res.end('{"ok":true}');
        });
        return;
    }

    // Command blocked
    if (u.pathname === '/api/command-blocked' && req.method === 'POST') {
        readBody(req, body => {
            const d = parseJSON(body);
            if (d && isStr(d.cmd) && isStr(d.reason, 100)) _deps.onCommandBlocked(d.cmd, d.reason, d);
            res.writeHead(200); res.end('{"ok":true}');
        });
        return;
    }

    // Pattern discovered
    if (u.pathname === '/api/pattern-discovered' && req.method === 'POST') {
        readBody(req, body => {
            const d = parseJSON(body);
            if (!d || !Array.isArray(d.patterns)) { res.writeHead(200); res.end('{"ok":true}'); return; }
            const safe = d.patterns.filter(p => isStr(p, 60)).slice(0, 20);
            if (safe.length > 0) _deps.onPatternsDiscovered(safe);
            res.writeHead(200); res.end('{"ok":true}');
        });
        return;
    }

    // Behavior stats
    if (u.pathname === '/api/behavior-stats') {
        res.writeHead(200); res.end(JSON.stringify(_deps.getSessionSafe()));
        return;
    }

    // Status
    const dp = _ctx ? _ctx.globalState.get('disabledPatterns', []) : [];
    const pats = policy.patterns || cfg('approvePatterns', DEFAULT_PATTERNS).filter(p => !dp.includes(p));
    res.writeHead(200);
    res.end(JSON.stringify({ interactionHost: policy.interactionHost, intentTombstones: attemptJournal.snapshot(u.query.surfaceUrl), autopilotProfile: policy.autopilotProfile || { enabled: false, grants: [] }, decisionPolicy: policy.decisionPolicy || { enabled: false }, permissionProfile: policy.permissionProfile || 'legacy', permissionRules: policy.permissionRules || [], resumeToken: policy.resumeToken ?? 0, eventScheduler: policy.eventScheduler === true, policyVersion: policy.policyVersion, workspace: policy.workspace, runtime: state.runtime, terminalWhitelist: policy.terminalWhitelist || [], builtInGrants: policy.builtInGrants, pauseReasonCode: policy.pauseReasonCode, pauseReason: policy.pauseReason, enabled: policy.enabled && !attemptJournal.isSaturated(), paused: !!policy.paused, dryRun: !!policy.dryRun, scrollEnabled: policy.enabled && !policy.paused && !policy.dryRun && state.scrollOn, patterns: pats, blacklist: policy.blacklist || [], acceptInChatOnly: cfg('approvePatterns', []).includes('Accept') && !dp.includes('Accept'), pauseMs: policy.scrollPauseMs ?? cfg('scrollPauseMs', 15000), scrollMs: policy.scrollIntervalMs ?? cfg('scrollIntervalMs', 500), approveMs: policy.approveIntervalMs ?? cfg('approveIntervalMs', 1000) }));
}

module.exports = { start, stop, getPort, getRecoveryState };
