'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { DEFAULT_PATTERNS, RISKY_PATTERNS, SAFE_TERMINAL_CMDS, DEFAULT_BLACKLIST } = require('./constants');
const { deriveDynamicAcceptCommands, partitionAcceptCommands, isSafeNativeAcceptCommand } = require('./accept-commands');
const { cfg } = require('./utils');
const { getEffectiveConfig, setProjectProvider, withPolicyVersion } = require('./configuration');
const Policy = require('./action-policy');
const { manageRules } = require('./permission-rules');
const { capabilityManifest } = require('./capabilities');
const { summarizePilot } = require('./pilot-metrics');
const { redact } = require('./redaction');
let _resumeToken = 0, _nativeIdentityWarned = false, _hostBuild = 'unknown', _interactionHost = null;
const injection = require('./injection');
const learning = require('./learning');
const wiki = require('./wiki');
const bridge = require('./bridge');
const terminal = require('./terminal');
const dashboard = require('./dashboard');
const { buildOperationPreset, getOperationPresets, normalizeOperationMode } = require('./operation-presets');
const { createObservabilityState } = require('./observability');

const roi = require('./roi');
const idle = require('./idle');

let cdp = null;
try { cdp = require('./cdp'); } catch (_) { /* optional CDP module */ }

const CDP_PORT = 9333;
let _ctx, _enabled = true, _scrollOn = true, _stats = {}, _log = [], _totalClicks = 0;
let _acceptTimer, _termLog = [], _acceptPaused = false, _dynamicAcceptCmds = [], _failedCmds = new Set();
let _active = false;
let _projectConfig = {};
let _dryRun = false;  // Dry run: scan buttons but don't click
let _skipBrowserAgent = false;  // Skip auto-click when browser agent is active
let _nextAcceptDue = 0;         // Timestamp for next slow-cycle accept tick
let _sessionState = { startMs: 0, msgCount: 0, toolCalls: [], responseTimes: [], lastActivityMs: 0, aiTyping: false, approveCount: 0, rejectCount: 0, toolBreakdown: {} };
let _sbMain, _sbCdp, _sbScroll, _sbSkip, _sbDry, _isAntigravity = false;
let _observability = createObservabilityState();
let _lastFilteredSignature = '';
const _nativeTraceCooldown = new Map();

// ── Detection & Config ───────────────────────────────────────
const isAntigravity = () => /antigravity|windsurf/.test(((vscode.env.appName || '') + ' ' + (vscode.env.appRoot || '')).toLowerCase());

// ── State & Handlers ─────────────────────────────────────────
const getState = () => ({
    enabled: _enabled,
    scrollOn: _scrollOn,
    stats: _stats,
    log: _log,
    totalClicks: _totalClicks,
    session: _sessionState,
    termLog: _termLog,
    cdpConnected: cdp ? cdp.isConnected() : false,
    cdpSessions: cdp ? cdp.getSessionCount() : 0,
    dryRun: getEffectiveConfig(_ctx).dryRun,
    paused: _acceptPaused,
    projectPatterns: _projectPatterns,
    runtime: getRuntime(),
    operationMode: normalizeOperationMode(cfg('operationMode', 'custom')),
});
const getPolicy = () => {
    const config = getEffectiveConfig(_ctx);
    const pauseReasonCode = _acceptPaused ? 'manual-pause' : !idle.isIdle() ? 'typing' : dashboard.getPanel()?.visible ? 'dashboard' : null;
    const pauseReason = { 'manual-pause': 'Manual pause.', typing: 'Paused while the user is typing.', dashboard: 'Paused while the Antigravity Auto Submit dashboard is visible.' }[pauseReasonCode] || null;
    return withPolicyVersion({ ...config, enabled: _active && _enabled && config.enabled, paused: !!pauseReasonCode, pauseReasonCode, pauseReason,
        interactionHost: _interactionHost, resumeToken: _resumeToken, patterns: config.approvePatterns, blacklist: [...new Set([...DEFAULT_BLACKLIST, ...config.terminalBlacklist])], scrollEnabled: _scrollOn });
};
const getRuntime = (policy = getPolicy()) => Policy.runtimeState(policy, cdp?.getRuntimeState ? cdp.getRuntimeState(policy) : { connected: cdp ? cdp.isConnected() : false });
const canAct = () => { const p = getPolicy(); return p.enabled && !p.paused && !p.dryRun; };
const syncPolicy = () => { if (cdp && _isAntigravity) cdp.hotUpdate(); if (_ctx && _isAntigravity) injection.writeRuntimeConfig(_ctx); };
const setState = (p) => {
    if (p.enabled !== undefined) _enabled = p.enabled;
    if (p.scrollOn !== undefined) _scrollOn = p.scrollOn;
    if (p.stats !== undefined) _stats = p.stats;
    if (p.log !== undefined) { _log = p.log; if (_ctx) _ctx.globalState.update('clickLog', _log); }
    if (p.totalClicks !== undefined) { _totalClicks = p.totalClicks; _sessionState.approveCount = 0; if (cdp?.resetStats) cdp.resetStats(); }
    onStatsUpdated(); syncPolicy();
};
const getSessionSafe = () => {
    const now = Date.now();
    const sessionMs = _sessionState.startMs ? now - _sessionState.startMs : 0;
    const avgResponseMs = _sessionState.responseTimes.length > 0 ? Math.round(_sessionState.responseTimes.reduce((a, b) => a + b, 0) / _sessionState.responseTimes.length) : 0;
    return {
        sessionMs,
        msgCount: _sessionState.msgCount,
        approveCount: _sessionState.approveCount,
        aiTyping: _sessionState.aiTyping,
        avgResponseMs,
        toolBreakdown: _sessionState.toolBreakdown,
        recentTools: _sessionState.toolCalls.slice(-20),
        learningHealth: wiki.learningHealth(),
        cdpConnected: cdp ? cdp.isConnected() : false,
        cdpSessions: cdp ? cdp.getSessionCount() : 0,
        roi: roi.getSummary(),
        idle: idle.isIdle(),
        operationMode: normalizeOperationMode(cfg('operationMode', 'custom')),
    };
};

const refreshBar = () => {
    if (!_sbMain) return;

    const runtime = getRuntime();
    const icons = { off: 'circle-slash', paused: 'debug-pause', 'dry-run': 'eye', disconnected: 'debug-disconnect', ready: 'rocket', unknown: 'question' };
    _sbMain.text = `$(${icons[runtime.status]}) Antigravity Auto Submit`;
    _sbMain.color = runtime.status === 'ready' ? '#6ee7b7' : runtime.status === 'off' ? '#f87171' : '#fbbf24';
    _sbMain.backgroundColor = runtime.status === 'off' ? new vscode.ThemeColor('statusBarItem.errorBackground') : undefined;
    _sbMain.tooltip = `Antigravity Auto Submit [${runtime.status}] | ${runtime.reason} | ${_totalClicks} click attempts — click to open menu`;

    // ── CDP: connection + scroll ──
    if (_sbCdp) {
        const cdpConnected = cdp && cdp.isConnected();
        const cdpSessions = cdp ? cdp.getSessionCount() : 0;
        const cdpPhase = cdp ? (cdp.getPhase ? cdp.getPhase() : '') : '';
        const cdpReconnecting = !cdpConnected && (cdpPhase === 'reconnecting' || cdpPhase === 'connecting' || cdpPhase === 'discoverPort' || cdpPhase === 'fetchVersion');
        if (cdpConnected) {
            const scrollIcon = _scrollOn ? '$(fold-down)' : '$(fold-up)';
            _sbCdp.text = `$(plug) ${cdpSessions > 0 ? cdpSessions : ''} ${scrollIcon}`.trim();
            _sbCdp.color = '#6ee7b7';
            _sbCdp.tooltip = `CDP: ${cdpSessions} session(s) — Auto-Scroll: ${_scrollOn ? 'ON' : 'OFF'}\nClick to force reconnect`;
        } else if (cdpReconnecting) {
            const attempts = cdp.getReconnectAttempts ? cdp.getReconnectAttempts() : '';
            _sbCdp.text = `$(sync~spin)`;
            _sbCdp.color = '#fbbf24';
            _sbCdp.tooltip = `CDP: reconnecting${attempts ? ` (attempt ${attempts})` : ''}…\nClick to force reconnect`;
        } else {
            _sbCdp.text = `$(debug-disconnect)`;
            _sbCdp.color = '#f87171';
            _sbCdp.tooltip = `CDP: disconnected\nClick to reconnect`;
        }
        _sbCdp.show();
    }

    // ── Skip SubAgent ──
    if (_sbSkip) {
        if (_skipBrowserAgent) {
            _sbSkip.text = `$(debug-step-over) Browser Skip`;
            _sbSkip.color = '#94a3b8';
            _sbSkip.tooltip = `Browser SubAgent: auto-skip\nClick to disable`;
            _sbSkip.show();
        } else {
            _sbSkip.hide();
        }
    }

    // ── Dry Run ──
    if (_sbDry) {
        if (runtime.status === 'dry-run') {
            _sbDry.text = `$(eye) DRY`;
            _sbDry.color = '#a78bfa';
            _sbDry.tooltip = `Dry Run: ON — scanning buttons without clicking\nClick to disable`;
            _sbDry.show();
        } else {
            _sbDry.hide();
        }
    }
};

const onStatsUpdated = () => { _totalClicks = Object.values(_stats).reduce((a, b) => a + b, 0); refreshBar(); if (_ctx) { _ctx.globalState.update('stats', _stats); _ctx.globalState.update('totalClicks', _totalClicks); } };
const onClickLogged = (d) => { recordTrace({ ...d, source: 'runtime', action: 'clicked', label: d.button, outcome: 'attempted' }); if (_ctx) _ctx.globalState.update('clickLog', _log); dashboard.postMessage({ command: 'logUpdated', log: _log }); if (d.pattern) roi.recordClick(d.pattern); if (cfg('learnEnabled', true) && d.button) { const btn = d.button.trim(); const cmdMatch = btn.match(/[`']([^`']+)[`']/) || btn.match(/^(?:Run|Allow|Execute)\s+(.+)/i); if (cmdMatch) learning.recordAction(cmdMatch[1].trim(), 'approve', { project: vscode.workspace.workspaceFolders?.[0]?.name }); } };

const onChatEvent = (d) => {
    const now = Date.now();
    _sessionState.lastActivityMs = now;
    if (d.type === 'message-start') _sessionState.aiTyping = true;
    else if (d.type === 'message-end') { _sessionState.aiTyping = false; _sessionState.msgCount++; if (d.responseMs > 0) { _sessionState.responseTimes.push(d.responseMs); if (_sessionState.responseTimes.length > 50) _sessionState.responseTimes.shift(); } }
    else if (d.type === 'tool-call') {
        const tool = d.tool || 'tool-call';
        _sessionState.toolCalls.push({ tool, startMs: now, endMs: 0, durationMs: 0 });
        if (_sessionState.toolCalls.length > 100) _sessionState.toolCalls.shift();
        // Adaptive boost: run_command approval dialog may appear in next few seconds
        if (tool === 'run_command' || tool === 'tool-call') boostAcceptLoop();
        if (tool === 'run_command' || tool.includes('browser') || tool.includes('computer')) {
            recordTrace({ source: 'bridge', action: 'tool-call', label: tool, tool, reason: 'tool started' });
        }
    }
    else if (d.type === 'tool-result') {
        const tool = d.tool || 'tool-call';
        for (let i = _sessionState.toolCalls.length - 1; i >= 0; i--) {
            const tc = _sessionState.toolCalls[i];
            if (tc.tool === tool && tc.endMs === 0) {
                tc.endMs = now;
                tc.durationMs = d.durationMs || (now - tc.startMs);
                break;
            }
        }
        if (!_sessionState.toolBreakdown[tool]) _sessionState.toolBreakdown[tool] = { count: 0, totalMs: 0 };
        _sessionState.toolBreakdown[tool].count++;
        _sessionState.toolBreakdown[tool].totalMs += d.durationMs || 0;
        if (tool === 'run_command' || tool.includes('browser') || tool.includes('computer')) {
            recordTrace({
                source: 'bridge',
                action: 'tool-result',
                label: tool,
                tool,
                reason: `${d.durationMs || 0}ms`,
            });
        }
    }
    dashboard.postMessage({ command: 'sessionUpdated', session: getSessionSafe() });
};
const onTerminalEvent = (d) => {
    const cmd = (d.cmd || '').trim();
    if (!cmd || cmd.length < 2) return;
    const now = Date.now();
    const recent = _termLog.find(t => t.cmd === cmd && (now - t._ts) < 10000);
    if (recent) return;
    _termLog.unshift({ time: new Date(now).toISOString().slice(11, 19), cmd, source: d.source || 'ui', _ts: now });
    if (_termLog.length > 100) _termLog.pop();
    // Execution observations do not establish user approval.
    recordTrace({ source: 'terminal', action: 'observed-command', label: cmd, cmd, reason: d.source || 'ui' });
    dashboard.postMessage({ command: 'termLogUpdated', termLog: _termLog.slice(0, 30) });
};
const onPatternsDiscovered = (patterns) => {
    const discovered = _ctx ? _ctx.globalState.get('discoveredPatterns', []) : [];
    let changed = false;
    for (const p of patterns) { if (!discovered.includes(p) && !DEFAULT_PATTERNS.includes(p)) { discovered.push(p); changed = true; } }
    if (changed && _ctx) {
        _ctx.globalState.update('discoveredPatterns', discovered.slice(-50));
        vscode.window.showInformationMessage(`[Antigravity Auto Submit] Discovered: ${patterns.slice(0, 3).join(', ')}`, 'Add to auto-click', 'Ignore').then(async pick => {
            if (pick !== 'Add to auto-click' || !_active) return;
            const currentPatterns = [...getEffectiveConfig(_ctx).approvePatterns];
            const disabled = _ctx.globalState.get('disabledPatterns', []).map(p => p.toLowerCase());
            for (const p of patterns) if (!currentPatterns.includes(p) && !disabled.includes(p.toLowerCase())) currentPatterns.push(p);
            const config = vscode.workspace.getConfiguration('grav');
            await config.update('approvePatterns', currentPatterns, vscode.ConfigurationTarget.Global);
            await config.update('presetMode', 'custom', vscode.ConfigurationTarget.Global);
            await config.update('operationMode', 'custom', vscode.ConfigurationTarget.Global);
            onSave();
        }).catch(e => console.warn('[Antigravity Auto Submit] Pattern update failed:', e.message));
    }
};
const onSave = () => { syncPolicy(); startAcceptLoop(); refreshBar(); maybeTraceFilteredNative('save'); publishTrace(); };
const onProjectConfigChange = () => { loadProjectConfig(); syncPolicy(); maybeTraceFilteredNative('project'); publishTrace(); };

// ── Per-project patterns (.vscode/grav.json) ─────────────────
let _projectPatterns = [];
const PROJ_CONFIG_FILE = '.vscode/grav.json';

const loadProjectConfig = () => {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) { _projectPatterns = []; _projectConfig = {}; return; }
    const cfgPath = path.join(folders[0].uri.fsPath, PROJ_CONFIG_FILE);
    try {
        if (fs.existsSync(cfgPath)) {
            const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
            _projectPatterns = Array.isArray(raw.patterns) ? raw.patterns.filter(p => typeof p === 'string' && p.length > 0 && p.length <= 60) : [];
            _projectConfig = { patterns: _projectPatterns, blacklist: Array.isArray(raw.blacklist) ? raw.blacklist.filter(p => typeof p === 'string' && p.length <= 500) : [], dryRun: raw.dryRun === true };
            if (_projectPatterns.length > 0) console.log(`[Antigravity Auto Submit] Project patterns (${_projectPatterns.length}):`, _projectPatterns.slice(0, 5));
        } else { _projectPatterns = []; _projectConfig = {}; }
    } catch (e) { _projectPatterns = []; _projectConfig = {}; console.warn('[Antigravity Auto Submit] grav.json parse error:', e.message); }
};

const getDynamicAcceptPolicy = () => ({
    skipTerminalAccept: cfg('skipTerminalAccept', true),
    skipBrowserAgent: _skipBrowserAgent,
});

const getRunnableDynamicAcceptCmds = () => {
    const result = partitionAcceptCommands(_dynamicAcceptCmds, getDynamicAcceptPolicy());
    const patterns = getEffectiveConfig(_ctx).approvePatterns.map(p => p.toLowerCase());
    const allowed = [], filtered = [...result.filtered];
    for (const cmd of result.allowed) {
        const label = /applyall/i.test(cmd) ? 'accept all' : 'accept';
        // Native APIs expose no proposed command, so only known edit-accept APIs are eligible.
        if (isSafeNativeAcceptCommand(cmd) && patterns.includes(label)) allowed.push(cmd);
        else filtered.push(cmd);
    }
    return { allowed, filtered };
};

const persistObservability = () => {
    if (_ctx) _ctx.globalState.update('observabilityState', _observability.exportState());
};

const onJobObservation = event => {
    if (_observability.recordJobEvent?.(event)) persistObservability();
};
const getTraceSnapshot = () => {
    const dynamicAccept = getRunnableDynamicAcceptCmds();
    return _observability.snapshot({
        executors: cdp?.getSessionSummaries?.() || [],
        learningEvidence: learning.getStats?.().commands || [],
        permissionProfile: getPolicy().permissionProfile || 'legacy',
        permissionRules: (getPolicy().permissionRules || []).slice(0, 30),
        capabilities: capabilityManifest({ name: vscode.env.appName, version: _hostBuild, cdpVerified: getRuntime().status === 'ready' }),
        reconnectRecoveryMs: cdp?.getDebugState?.().recoveryMs ?? null,
        metrics: summarizePilot(_observability.snapshot().trace.filter(t => t.source !== 'feedback').map(t => ({ intentId: (t.targetSessionId || t.source) + ':' + (t.intentId || t.id), legitimate: t.reviewerLegitimate, attempted: t.outcome === 'attempted', outcome: 'unknown', latencyMs: t.latencyMs })), { policyVersion: getPolicy().policyVersion, adapterVersion: 'adapter-v1', source: 'bounded-live-trace', labeled: false }, _observability.snapshot().jobMetrics),
        operationMode: normalizeOperationMode(cfg('operationMode', 'custom')),
        operationPresets: getOperationPresets(),
        filteredCommands: dynamicAccept.filtered,
        allowedNativeCount: dynamicAccept.allowed.length,
        totalNativeCount: _dynamicAcceptCmds.length,
        skipTerminalAccept: cfg('skipTerminalAccept', true),
        skipBrowserAgent: _skipBrowserAgent,
        cdpConnected: cdp ? cdp.isConnected() : false,
        cdpSessions: cdp ? cdp.getSessionCount() : 0,
    });
};

const publishTrace = () => {
    dashboard.postMessage({ command: 'traceUpdated', trace: getTraceSnapshot() });
};

const recordTrace = (event) => {
    const policy = getPolicy();
    const decision = event.decision ? {} : event.action === 'native-accept' ? Policy.evaluateAction('Accept', '', policy) :
        event.cmd ? Policy.evaluateCommand(event.cmd, policy) : { decision: 'manual', reasonCode: 'unknown-context', matchedRules: [], scope: null, policyVersion: policy.policyVersion };
    _observability.push({ ...decision, ...event });
    persistObservability();
    publishTrace();
};

const recordFeedback = (kind, meta = {}) => {
    const entry = _observability.recordFeedback(kind, meta);
    persistObservability();
    publishTrace();
    return entry;
};

const maybeTraceFilteredNative = (source = 'config') => {
    const { filtered } = getRunnableDynamicAcceptCmds();
    const signature = filtered.join('|');
    if (!signature) {
        _lastFilteredSignature = '';
        return;
    }
    const scopedSignature = source + ':' + signature;
    if (scopedSignature === _lastFilteredSignature) return;
    _lastFilteredSignature = scopedSignature;
    recordTrace({
        source: 'native',
        action: 'filtered',
        label: `${filtered.length} native accept command(s) filtered`,
        cmd: filtered.join(', '),
        reason: `policy/${source}`,
    });
};

const traceNativeAccept = (cmd, reason) => {
    const key = `${reason}:${cmd}`;
    const now = Date.now();
    const lastTs = _nativeTraceCooldown.get(key) || 0;
    if (now - lastTs < 15000) return;
    _nativeTraceCooldown.set(key, now);
    recordTrace({
        source: 'native',
        action: 'native-accept',
        label: cmd,
        cmd,
        reason,
    });
};

const applyOperationPreset = async (mode, source = 'command') => {
    const preset = buildOperationPreset(mode);
    if (!preset) return false;
    const config = vscode.workspace.getConfiguration('grav');

    await config.update('enabled', preset.enabled, vscode.ConfigurationTarget.Global);
    await config.update('autoScroll', preset.autoScroll, vscode.ConfigurationTarget.Global);
    await config.update('skipBrowserAgent', preset.skipBrowserAgent, vscode.ConfigurationTarget.Global);
    await config.update('skipTerminalAccept', preset.skipTerminalAccept, vscode.ConfigurationTarget.Global);
    await config.update('approveIntervalMs', preset.approveIntervalMs, vscode.ConfigurationTarget.Global);
    await config.update('approvePatterns', preset.approvePatterns, vscode.ConfigurationTarget.Global);
    await config.update('presetMode', preset.presetMode, vscode.ConfigurationTarget.Global);
    await config.update('operationMode', preset.operationMode, vscode.ConfigurationTarget.Global);
    await config.update('dryRun', preset.dryRun, vscode.ConfigurationTarget.Global);
    await _ctx.globalState.update('disabledPatterns', preset.disabledPatterns);

    _enabled = preset.enabled;
    _scrollOn = preset.autoScroll;
    _skipBrowserAgent = preset.skipBrowserAgent;
    _dryRun = preset.dryRun;

    onSave();
    maybeTraceFilteredNative(`preset:${mode}`);
    recordTrace({
        source: 'preset',
        action: 'preset-applied',
        label: preset.label,
        reason: `${preset.description} (${source})`,
        cmd: preset.approvePatterns.join(', '),
    });
    return true;
};

// ── Accept Loop ───────────────────────────────────────────────
const discoverAcceptCommands = async () => {
    try {
        const allCmds = await vscode.commands.getCommands(true);
        _dynamicAcceptCmds = deriveDynamicAcceptCommands(allCmds);
        console.log(`[Antigravity Auto Submit] Discovered ${_dynamicAcceptCmds.length} accept commands:`, _dynamicAcceptCmds.slice(0, 10));
    } catch (_) { /* non-critical */ }
};

let _adaptiveBoostUntil = 0; // ms timestamp until which to use fast interval

const boostAcceptLoop = () => {
    _adaptiveBoostUntil = Date.now() + 10000; // boost for 10s
};

const startAcceptLoop = () => {
    if (_acceptTimer) clearInterval(_acceptTimer);
    const BASE_INTERVAL = Math.max(cfg('approveIntervalMs', 1000), 100);
    const FAST_INTERVAL = Math.min(BASE_INTERVAL, 800);
    _acceptTimer = setInterval(() => {
        if (!canAct()) return;
        // Skip native accept when Grav dashboard is the active panel
        if (dashboard.getPanel()?.visible) return;
        // Skip when CDP observer is connected and has active sessions —
        // CDP handles clicking Accept/Run buttons directly in the DOM.
        // Firing native commands on top causes the Accept chip to flash
        // repeatedly with no actual effect.
        if (cdp && cdp.isConnected() && cdp.getSessionCount() > 0) return;
        const now = Date.now();
        // Adaptive: if a run_command/tool event just fired, skip slow cycles
        if (now < _adaptiveBoostUntil) {
            // Running fast — do the accept work
        } else {
            // Slow cycle: only run every BASE_INTERVAL effectively
            // We run the timer at FAST_INTERVAL but skip if not due
            if (!_nextAcceptDue) _nextAcceptDue = now + BASE_INTERVAL;
            if (now < _nextAcceptDue) return;
            _nextAcceptDue = now + BASE_INTERVAL;
        }
        // There is no verified native request identity/receipt to fence a repeat.
        // Explicit Grav: Accept All remains available under the edit guard.
        if (!_nativeIdentityWarned) {
            _nativeIdentityWarned = true;
            recordTrace({ source: 'native', action: 'blocked', decision: 'manual', reasonCode: 'native-identity-unavailable', reason: 'Native automatic approval needs a verified request identity. Use explicit Accept All for known edits.', outcome: 'unknown' });
        }
    }, FAST_INTERVAL);
};

// ── Activate ─────────────────────────────────────────────────
async function activate(ctx) {
    _ctx = ctx;
    try { _hostBuild = JSON.parse(fs.readFileSync(path.join(vscode.env.appRoot, 'package.json'), 'utf8')).version || 'unknown'; } catch (_) { _hostBuild = 'unknown'; }
    try {
        const product = JSON.parse(fs.readFileSync(path.join(vscode.env.appRoot, 'product.json'), 'utf8'));
        _interactionHost = product.ideVersion === '2.5.5' && product.commit === 'ecfbad74d93962fc8ca485d93ab9b4f3d4cb6cf8' && process.platform === 'darwin' ? 'ide-2.5.5-unified-permission-dom' : null;
    } catch (_) { _interactionHost = null; }
    _active = true;
    if (injection.setPolicyProvider) injection.setPolicyProvider(getPolicy);
    if (learning.setPolicyProvider) learning.setPolicyProvider(getPolicy);
    setProjectProvider(() => _projectConfig);
    _isAntigravity = isAntigravity();
    console.log(`[Antigravity Auto Submit] IDE: "${vscode.env.appName}" | Antigravity: ${_isAntigravity}`);
    // Native VS Code commands remain available; installation patching is IDE-specific.

    _stats = ctx.globalState.get('stats', {});
    _totalClicks = ctx.globalState.get('totalClicks', 0);
    _log = ctx.globalState.get('clickLog', []) || [];
    _enabled = cfg('enabled', true);
    _scrollOn = cfg('autoScroll', true);
    _observability = createObservabilityState(ctx.globalState.get('observabilityState', {}));
    _sessionState.startMs = Date.now();

    // Pattern migration
    const userPatterns = cfg('approvePatterns', null);
    const isFirstInstall = !userPatterns;

    if (isFirstInstall) {
        const safePatterns = DEFAULT_PATTERNS.filter(p => !RISKY_PATTERNS.includes(p));
        await vscode.workspace.getConfiguration('grav').update('approvePatterns', [...safePatterns], vscode.ConfigurationTarget.Global);
        await vscode.workspace.getConfiguration('grav').update('operationMode', 'custom', vscode.ConfigurationTarget.Global);
        await ctx.globalState.update('disabledPatterns', [...RISKY_PATTERNS]);

        vscode.window.showInformationMessage('Welcome to Antigravity Auto Submit! Autopilot for Antigravity installed.', 'Open Dashboard').then(pick => {
            if (pick === 'Open Dashboard') vscode.commands.executeCommand('grav.dashboard');
        });
    } else if (Array.isArray(userPatterns)) {
        let merged = userPatterns.filter(p => typeof p === 'string' && p.trim() && p.length <= 60);
        let dp = ctx.globalState.get('disabledPatterns', []).filter(p => typeof p === 'string' && p.trim() && p.length <= 60);
        let changed = merged.length !== userPatterns.length || dp.length !== ctx.globalState.get('disabledPatterns', []).length;
        for (const p of DEFAULT_PATTERNS) { if (!merged.includes(p) && !dp.includes(p)) { RISKY_PATTERNS.includes(p) ? dp.push(p) : merged.push(p); changed = true; } }
        for (const p of RISKY_PATTERNS) { if (!merged.includes(p) && !dp.includes(p)) { dp.push(p); changed = true; } }
        if (changed) { await vscode.workspace.getConfiguration('grav').update('approvePatterns', merged, vscode.ConfigurationTarget.Global); await ctx.globalState.update('disabledPatterns', dp); }
    }

    // Migration: strip 'Review Changes' variants (removed from defaults in 4.0.18)
    {
        const REVIEW_REMOVE = ['Review Changes', 'Review All', 'Review all'];
        const curPatterns = cfg('approvePatterns', []);
        const cleaned = curPatterns.filter(p => !REVIEW_REMOVE.includes(p));
        if (cleaned.length !== curPatterns.length) {
            await vscode.workspace.getConfiguration('grav').update('approvePatterns', cleaned, vscode.ConfigurationTarget.Global);
            console.log('[Antigravity Auto Submit] Migration: removed Review Changes from patterns');
        }
    }

    // Load project config
    loadProjectConfig();
    _dryRun = cfg('dryRun', false);
    _skipBrowserAgent = cfg('skipBrowserAgent', false);

    wiki.init(ctx, () => learning.getData(), () => learning.getEpoch());
    learning.init(ctx, wiki);

    // Auto-purge bad learning entries on startup (numbers, flags, versions learned incorrectly)
    setTimeout(() => {
        const purged = learning.purgeBadEntries();
        if (purged > 0) console.log(`[Antigravity Auto Submit] Auto-purged ${purged} bad learning entries on startup`);
    }, 3000);
    roi.init(ctx);

    idle.init(ctx, { onIdleChange: (isIdle) => { console.log('[Antigravity Auto Submit] Idle:', isIdle); dashboard.postMessage({ command: 'idleChanged', idle: isIdle }); syncPolicy(); refreshBar(); } });

    // CDP + Injection
    if (_isAntigravity && _enabled && cfg('cdpEnabled', true)) {
        try {
            const result = require('./argv').ensureCdpInArgv({ appRoot: vscode.env.appRoot, port: cfg('cdpPort', 9333) });
            if (result.changed) vscode.window.showInformationMessage('[Antigravity Auto Submit] CDP configured. Quit & restart the IDE fully.', 'OK');
        } catch (e) { console.warn('[Antigravity Auto Submit] CDP profile unchanged:', e.message); }
    }
    if (cdp && _isAntigravity) {
        cdp.init({
            getPolicy, onJobObservation,
            onBlocked: (cmd, reason, metadata = {}) => {
                console.log(`[Antigravity Auto Submit Safety] Blocked: ${reason}`);
                recordTrace({ ...metadata, source: 'cdp', action: 'blocked', label: reason, cmd: cmd.slice(0, 200), reason });
                dashboard.postMessage({ command: 'commandBlocked', cmd: cmd.slice(0, 200), reason });
            },
            onClicked: (data) => {
                if (!data.dryRun) {
                    _sessionState.approveCount++;
                    const pattern = data.p || 'click';
                    _stats[pattern] = (_stats[pattern] || 0) + 1;
                    _log.unshift({ time: new Date().toISOString().slice(11, 19), pattern, button: data.b || pattern });
                    _log = _log.slice(0, 50);
                    roi.recordClick(pattern); onStatsUpdated();
                    _ctx.globalState.update('clickLog', _log);
                }
                recordTrace({
                    ...data, source: 'cdp',
                    action: data.dryRun ? 'dry-run' : 'clicked',
                    pattern: data.p || '',
                    label: data.b || data.p || '',
                    cmd: data.cmd || '',
                    dryRun: !!data.dryRun,
                    reason: data.reason || (data.dryRun ? 'observer scan only' : 'observer click attempt'),
                });
                refreshBar();
                dashboard.postMessage({ command: 'logUpdated', log: _log });
            },
            onChatEvent,
        });
        const currentVer = ctx.extension?.packageJSON?.version || '0';
        const lastCdpVer = ctx.globalState.get('grav-cdp-version', '0');
        if (currentVer !== lastCdpVer) { ctx.globalState.update('grav-cdp-version', currentVer); setTimeout(() => { if (cdp.isConnected()) cdp.hotUpdate(); }, 3000); }
    }

    if (_isAntigravity && _enabled) {
        const ver = ctx.extension?.packageJSON?.version || '0';
        const lastVer = ctx.globalState.get('grav-version', '0');
        try {
            if (!injection.isInjected() || ver !== lastVer) {
                if (injection.inject(ctx)) {
                    await ctx.globalState.update('grav-version', ver);
                    injection.patchChecksums();
                }
            } else injection.hotUpdateRuntime(ctx);
        } catch (e) { console.error('[Antigravity Auto Submit] inject:', e.message); }
    }

    // Bridge
    bridge.start(ctx, {
        learning, wiki, injection, getState, setState, getSessionSafe, getPolicy,
        onStatsUpdated, onClickLogged, onChatEvent, onJobObservation,
        onTerminalEvent, onPatternsDiscovered,
        onCommandBlocked: (cmd, reason, metadata = {}) => {
            console.log(`[Antigravity Auto Submit Safety] Blocked: ${reason}`);
            recordTrace({ ...metadata, source: 'bridge', action: 'blocked', label: reason, cmd: cmd.slice(0, 200), reason });
            dashboard.postMessage({ command: 'commandBlocked', cmd: cmd.slice(0, 200), reason });
        },
    });

    // Start
    await discoverAcceptCommands();
    maybeTraceFilteredNative('activate');
    startAcceptLoop();
    if (_isAntigravity) injection.writeRuntimeConfig(ctx);
    try { terminal.setup(ctx, learning, { getPolicy }); } catch (e) { console.warn('[Antigravity Auto Submit] terminal.setup skipped:', e.message); }

    // Status bar — multiple items
    const SB_BASE = -10000;
    _sbMain = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, SB_BASE);
    _sbMain.command = 'grav.statusMenu';
    _ctx.subscriptions.push(_sbMain);
    _sbMain.show();

    _sbCdp = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, SB_BASE - 1);
    _sbCdp.command = 'grav.forceReconnect';
    _ctx.subscriptions.push(_sbCdp);

    _sbSkip = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, SB_BASE - 2);
    _sbSkip.command = 'grav.toggleSkipBrowserAgent';
    _ctx.subscriptions.push(_sbSkip);

    _sbDry = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, SB_BASE - 3);
    _sbDry.command = 'grav.toggleDryRun';
    _ctx.subscriptions.push(_sbDry);

    refreshBar();
    _sbMain.show();

    const cdpRefresh = setInterval(refreshBar, 5000);
    ctx.subscriptions.push({ dispose: () => clearInterval(cdpRefresh) });

    ctx.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('grav')) {
            _enabled = cfg('enabled', true);
            _scrollOn = cfg('autoScroll', true);
            _dryRun = cfg('dryRun', false);
            _skipBrowserAgent = cfg('skipBrowserAgent', false);
            refreshBar();
            syncPolicy(); startAcceptLoop();
            maybeTraceFilteredNative('config');
            publishTrace();
        }
    }));

    // Watch .vscode/grav.json for per-project pattern changes
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
        const watcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(folders[0], PROJ_CONFIG_FILE)
        );
        watcher.onDidChange(onProjectConfigChange);
        watcher.onDidCreate(onProjectConfigChange);
        watcher.onDidDelete(onProjectConfigChange);
        ctx.subscriptions.push(watcher);
    }

    // Commands
    ctx.subscriptions.push(
        vscode.commands.registerCommand('grav.removeRuntime', async () => {
            _acceptPaused = true;
            await vscode.workspace.getConfiguration('grav').update('enabled', false, vscode.ConfigurationTarget.Global);
            syncPolicy();
            if (cdp) await cdp.disconnect();
            if (_isAntigravity && injection.eject()) {
                await ctx.globalState.update('grav-version', '0');
                vscode.window.showInformationMessage('[Antigravity Auto Submit] Runtime removed. Restart the IDE to unload the renderer script.');
            }
        }),
        vscode.commands.registerCommand('grav.statusMenu', async () => {
            const cdpCount = cdp ? cdp.getSessionCount() : 0;
            const operationMode = normalizeOperationMode(cfg('operationMode', 'custom'));
            const items = [
                { label: '$(dashboard) Open Dashboard', description: 'View metrics & logic', command: 'grav.dashboard' },
                { label: _scrollOn ? '$(fold-up) Disable Auto-Scroll' : '$(fold-down) Enable Auto-Scroll', command: 'grav.toggleScroll' },
                { label: `$(plug) CDP Sessions (${cdpCount}) - Force Reconnect`, command: 'grav.forceReconnect' },
                { label: _acceptPaused ? '$(play) Resume Auto-Accept' : '$(debug-pause) Pause Auto-Accept', command: _acceptPaused ? 'grav.resumeAccept' : 'grav.pauseAccept' },
                { label: _skipBrowserAgent ? '$(debug-step-over) Browser Skip: ON' : '$(debug-step-over) Browser Skip: OFF', description: 'Auto-skip browser subagent steps', command: 'grav.toggleSkipBrowserAgent' },
                { label: `$(settings-gear) Operation Mode: ${operationMode}`, description: 'Apply Safe / Balanced / Fast preset', command: 'grav.applyOperationPreset' },
            ];
            const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Antigravity Auto Submit Menu' });
            if (pick) vscode.commands.executeCommand(pick.command);
        }),
        vscode.commands.registerCommand('grav.dashboard', () => dashboard.toggle(ctx, {
            learning, wiki, injection, roi, idle, getState, setState, getSessionSafe,
            getTraceSnapshot, onSave, refreshBar, recordFeedback, getOperationPresets, onPolicyChanged: syncPolicy,
        })),
        vscode.commands.registerCommand('grav.diagnostics', async () => {
            const stats = learning.getStats();
            const lastTargets = cdp && cdp.getLastTargets ? cdp.getLastTargets() : [];
            const sessions = cdp && cdp.getSessionSummaries ? cdp.getSessionSummaries() : [];
            const debugLog = cdp && cdp.getDebugLog ? cdp.getDebugLog() : [];
            const webviewCount = lastTargets.filter(t => (t.url || '').includes('vscode-webview://')).length;

            // Conflict detection: commands in both SAFE_TERMINAL_CMDS and terminalBlacklist
            const userBlacklist = cfg('terminalBlacklist', []);
            const conflicts = SAFE_TERMINAL_CMDS.filter(c => userBlacklist.some(b => b === c || c.startsWith(b)));
            const dynamicAccept = getRunnableDynamicAcceptCmds();
            const trace = getTraceSnapshot();

            const lines = [
                `Antigravity Auto Submit v${ctx.extension?.packageJSON?.version || '0'}`,
                `Platform: ${process.platform}`,
                `Capabilities: ${JSON.stringify(trace.capabilities)}`,
                `Pilot metrics: ${JSON.stringify(trace.metrics)}`,
                ``,
                `── CDP Engine ──`,
                `Connected: ${cdp ? cdp.isConnected() : 'N/A'}`,
                `Sessions: ${cdp ? cdp.getSessionCount() : 0}`,
                `WEBVIEW: ${webviewCount}`,
                `Clicks: ${cdp ? cdp.getTotalClicks() : 0}`,
                `Error: ${cdp && cdp.getLastError ? cdp.getLastError() : 'none'}`,
                ``,
                `── Active Sessions ──`,
                ...(sessions.length ? sessions.map(s => `  [${s.alive ? 'alive' : 'DEAD'}] ${s.url.slice(0, 90) || '(no url)'}  title=${s.title.slice(0, 40) || '(none)'}`) : ['  (none)']),
                ``,
                `── All Discovered Targets (${lastTargets.length}) ──`,
                ...lastTargets.slice(0, 30).map(t => `  [${t.type}] ${(t.url || '(blank)').slice(0, 90)}  title=${(t.title || '').slice(0, 40)}`),
                ``,
                `── Extension ──`,
                `Bridge: ${bridge.getPort() || 'not started'}`,
                `Enabled: ${_enabled}`,
                `Total clicks: ${_totalClicks}`,
                `Injected: ${injection.isInjected()}`,
                `Dynamic Accept: ${dynamicAccept.allowed.length}/${_dynamicAcceptCmds.length} active`,
                `skipTerminalAccept: ${cfg('skipTerminalAccept', true)}`,
                `skipBrowserAgent: ${_skipBrowserAgent}`,
                `operationMode: ${trace.operationMode}`,
                ...(dynamicAccept.filtered.length ? [`Filtered Accept Cmds: ${dynamicAccept.filtered.join(', ')}`] : []),
                ``,
                `── Learning ──`,
                `Epoch: ${stats.epoch}`,
                `Tracking: ${stats.totalTracked}`,
                `Promoted: ${learning.getPromotedCommands().length}`,
                ``,
                `── Local Telemetry ──`,
                `False positives: ${trace.feedback.falsePositive}`,
                `False negatives: ${trace.feedback.falseNegative}`,
                ...(trace.lastBlocked ? [`Last blocked: ${trace.lastBlocked.cmd || trace.lastBlocked.label} (${trace.lastBlocked.reason || 'blocked'})`] : ['Last blocked: none']),
                ``,
                `── ⚠️  Conflict Report ──`,
                conflicts.length > 0
                    ? `SAFE cmds blocked by terminalBlacklist: ${conflicts.join(', ')}`
                    : `No conflicts detected ✓`,
                ``,
                `── Observer Debug Log (last ${debugLog.length}) ──`,
                ...(debugLog.length ? debugLog.slice(0, 15).map(d => `  [${d.type}] ${JSON.stringify(d).slice(0, 120)}`) : ['  (no debug events yet — run Antigravity Auto Submit: Refresh Observer to trigger)']),
                ``,
                `── Decision Trace (last ${trace.trace.length}) ──`,
                ...(trace.trace.length ? trace.trace.slice(0, 12).map(t => `  [${t.time}] ${t.source}/${t.action} ${t.label || t.cmd || ''} ${t.reason ? `— ${t.reason}` : ''}`) : ['  (no trace events yet)']),
            ];
            const doc = await vscode.workspace.openTextDocument({ content: lines.map(redact).join('\n'), language: 'text' });
            await vscode.window.showTextDocument(doc);
        }),
        vscode.commands.registerCommand('grav.manageTerminal', async () => {
            const actions = [{ label: '$(key) Scoped Rules (exact/prefix, expiry, revoke)', action: 'rules' }, { label: '$(add) Add to Whitelist', action: 'addWhite' }, { label: '$(shield) Add to Blacklist', action: 'addBlack' }, { label: '$(search) Test Command', action: 'test' }, { label: '$(book) View Lists', action: 'viewAll' }];
            const pick = await vscode.window.showQuickPick(actions, { placeHolder: 'Manage Terminal Commands' });
            if (!pick) return;
            if (pick.action === 'rules') { await manageRules(vscode, ctx, getPolicy); syncPolicy(); }
            else if (pick.action === 'addWhite') { const cmd = await vscode.window.showInputBox({ prompt: 'Enter executable (broad legacy grant) or literal argv prefix to grant' }); if (cmd) { const wl = cfg('terminalWhitelist', []); wl.push(cmd); await vscode.workspace.getConfiguration('grav').update('terminalWhitelist', wl, vscode.ConfigurationTarget.Global); vscode.window.showInformationMessage(`[Antigravity Auto Submit] Added "${cmd}" to Whitelist.`); } }
            else if (pick.action === 'addBlack') { const cmd = await vscode.window.showInputBox({ prompt: 'Enter dangerous command' }); if (cmd) { const bl = cfg('terminalBlacklist', []); bl.push(cmd); await vscode.workspace.getConfiguration('grav').update('terminalBlacklist', bl, vscode.ConfigurationTarget.Global); vscode.window.showInformationMessage(`[Antigravity Auto Submit] Added "${cmd}" to Blacklist.`); } }
            else if (pick.action === 'test') { const cmd = await vscode.window.showInputBox({ prompt: 'Enter command to test' }); if (cmd) { const result = learning.evaluateCommand(cmd); const doc = await vscode.workspace.openTextDocument({ content: `${result.decision.toUpperCase()}\nReason: ${result.reason}\nReason code: ${result.reasonCode}\nScope: ${JSON.stringify(result.scope)}\nMatched rules: ${JSON.stringify(result.matchedRules)}\nPolicy version: ${result.policyVersion}`, language: 'text' }); await vscode.window.showTextDocument(doc); } }
            else if (pick.action === 'viewAll') { const doc = await vscode.workspace.openTextDocument({ content: `── Whitelist ──\n${cfg('terminalWhitelist', []).join('\n')}\n\n── Blacklist ──\n${cfg('terminalBlacklist', []).join('\n')}`, language: 'text' }); await vscode.window.showTextDocument(doc); }
        }),
        vscode.commands.registerCommand('grav.setScanSpeed', async () => {
            const pick = await vscode.window.showQuickPick([{label:'Slow',ms:1800},{label:'Normal',ms:1200},{label:'Fast',ms:700}], {placeHolder:'Scan speed only; permission profile and grants stay unchanged'});
            if (!pick) return;
            await vscode.workspace.getConfiguration('grav').update('approveIntervalMs', pick.ms, vscode.ConfigurationTarget.Global);
            await vscode.workspace.getConfiguration('grav').update('operationMode', 'custom', vscode.ConfigurationTarget.Global);
            syncPolicy();
        }),
        vscode.commands.registerCommand('grav.configureAutopilot', async () => {
            if (await require('./autopilot-profile').configureProfile(vscode)) syncPolicy();
        }),
        vscode.commands.registerCommand('grav.permissionProfile', async () => {
            const profile = await vscode.window.showQuickPick([{label:'Observe',id:'observe',description:'No automatic approvals'},{label:'Edits',id:'edits',description:'Command-free edit/UI actions; terminal, browser and MCP approvals require manual review'},{label:'Terminal',id:'terminal',description:'Edits plus scoped exact/prefix rules only; legacy grants are inactive'},{label:'Legacy',id:'legacy',description:'Preserve existing P0 label/grant behavior'}], {placeHolder:'Antigravity Auto Submit permission profile, independent of scan speed'});
            if (!profile) return;
            await vscode.workspace.getConfiguration('grav').update('permissionProfile', profile.id, vscode.ConfigurationTarget.Global); syncPolicy();
        }),
        vscode.commands.registerCommand('grav.learnStats', async () => {
            const stats = learning.getStats();
            if (stats.commands.length === 0) { vscode.window.showInformationMessage('[Antigravity Auto Submit] No learning data yet'); return; }
            const rows = stats.commands.map(s => `${s.cmd.padEnd(22)} suggestion-score:${String(s.candidateScore).padEnd(7)} obs:${String(s.obs).padEnd(5)} ${s.status}`);
            const doc = await vscode.workspace.openTextDocument({ content: `Candidate suggestions only — scores are not probabilities or authorization.\nEpoch: ${stats.epoch} | Tracking: ${stats.totalTracked}\n\n${rows.join('\n')}`, language: 'text' });
            await vscode.window.showTextDocument(doc);
        }),
        vscode.commands.registerCommand('grav.applyOperationPreset', async () => {
            const items = getOperationPresets().map((preset) => ({
                label: preset.label,
                description: preset.description,
                mode: preset.id,
            }));
            const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Select Antigravity Auto Submit operation mode' });
            if (!pick) return;
            const ok = await applyOperationPreset(pick.mode, 'command');
            if (ok) vscode.window.showInformationMessage(`[Antigravity Auto Submit] Applied ${pick.label} mode.`);
        }),
        vscode.commands.registerCommand('grav.recordFalsePositive', async (meta = {}) => {
            try { recordFeedback('falsePositive', { ...meta, reason: 'manual feedback' }); } catch (e) { vscode.window.showWarningMessage(e.message); return { error: e.message }; }
            vscode.window.showInformationMessage('[Antigravity Auto Submit] Logged local feedback: false positive.');
        }),
        vscode.commands.registerCommand('grav.recordMissedAction', async (meta = {}) => {
            try { recordFeedback('falseNegative', { ...meta, reason: 'manual feedback' }); } catch (e) { vscode.window.showWarningMessage(e.message); return { error: e.message }; }
            vscode.window.showInformationMessage('[Antigravity Auto Submit] Logged local feedback: missed click.');
        }),
        vscode.commands.registerCommand('grav.refreshObserver', async () => { if (!cdp || !cdp.isConnected()) { vscode.window.showWarningMessage('[Antigravity Auto Submit] CDP not connected.'); return; } cdp.hotUpdate(); vscode.window.showInformationMessage('[Antigravity Auto Submit] Observer refreshed.'); }),
        vscode.commands.registerCommand('grav.forceReconnect', async () => {
            vscode.window.showInformationMessage('[Antigravity Auto Submit] Force reconnecting CDP...');
            if (cdp && _isAntigravity && cdp.forceReconnect) {
                const ok = await cdp.forceReconnect();
                if (ok) vscode.window.showInformationMessage('[Antigravity Auto Submit] CDP reconnected successfully.');
                else vscode.window.showWarningMessage('[Antigravity Auto Submit] CDP reconnect failed. Check Output panel.');
            }
        }),
        vscode.commands.registerCommand('grav.pauseAccept', () => { _acceptPaused = true; syncPolicy(); vscode.window.showInformationMessage('[Antigravity Auto Submit] Auto-accept paused.'); refreshBar(); }),
        vscode.commands.registerCommand('grav.resumeAccept', () => { _acceptPaused = false; _resumeToken++; syncPolicy(); vscode.window.showInformationMessage('[Antigravity Auto Submit] Auto-accept resumed.'); refreshBar(); }),
        vscode.commands.registerCommand('grav.purgeLearning', async () => {
            const count = learning.purgeBadEntries();
            const msg = count > 0
                ? `[Antigravity Auto Submit] Purged ${count} invalid entries (numbers, flags, versions, filenames) from learning data.`
                : '[Antigravity Auto Submit] No bad entries found — learning data is clean.';
            vscode.window.showInformationMessage(msg);
        }),
        vscode.commands.registerCommand('grav.toggleDryRun', async () => { _dryRun = !_dryRun; await vscode.workspace.getConfiguration('grav').update('dryRun', _dryRun, vscode.ConfigurationTarget.Global); refreshBar(); vscode.window.showInformationMessage(`[Antigravity Auto Submit] Dry Run ${_dryRun ? 'ON — scanning buttons without clicking' : 'OFF — normal mode'}`); }),
        vscode.commands.registerCommand('grav.initProjectConfig', async () => {
            const folders = vscode.workspace.workspaceFolders;
            if (!folders) { vscode.window.showWarningMessage('[Antigravity Auto Submit] No workspace folder open.'); return; }
            const cfgPath = path.join(folders[0].uri.fsPath, PROJ_CONFIG_FILE);
            if (fs.existsSync(cfgPath)) { const doc = await vscode.workspace.openTextDocument(cfgPath); await vscode.window.showTextDocument(doc); return; }
            const vscodePath = path.join(folders[0].uri.fsPath, '.vscode');
            if (!fs.existsSync(vscodePath)) fs.mkdirSync(vscodePath, { recursive: true });
            const template = JSON.stringify({ patterns: [], blacklist: [], dryRun: false }, null, 2);
            fs.writeFileSync(cfgPath, template, 'utf8');
            const doc = await vscode.workspace.openTextDocument(cfgPath);
            await vscode.window.showTextDocument(doc);
            vscode.window.showInformationMessage('[Antigravity Auto Submit] Created .vscode/grav.json — add custom patterns here.');
        }),
        vscode.commands.registerCommand('grav.toggleScroll', async () => { _scrollOn = !_scrollOn; await vscode.workspace.getConfiguration('grav').update('autoScroll', _scrollOn, vscode.ConfigurationTarget.Global); onSave(); refreshBar(); }),
        vscode.commands.registerCommand('grav.stopAllTerminals', () => { 
            let count = 0; 
            for (const term of vscode.window.terminals) {
                if (!canAct()) break;
                const name = term.name.toLowerCase();
                // Protect common dev server names unless explicitly marked as agent
                const isAgent = name.includes('agent') || name.includes('task') || name.includes('cascade') || name.includes('windsurf') || name.includes('antigravity');
                const isDev = name.includes('dev') || name.includes('serve') || name.includes('watch') || name.includes('start') || name.includes('npm');
                const isSystem = name === 'extension' || name === 'output';
                
                if (isSystem || (isDev && !isAgent)) continue;

                try { term.sendText('\x03', false); count++; } catch (_) { } 
            } 
            if (count > 0) vscode.window.setStatusBarMessage(`[Antigravity Auto Submit] Auto-Killed ${count} terminal(s) to prevent deadlock`, 3000);
        }),
        vscode.commands.registerCommand('grav.acceptAll', async () => {
            const { allowed } = getRunnableDynamicAcceptCmds();
            for (const cmd of allowed) {
                if (!canAct()) break;
                if (!getRunnableDynamicAcceptCmds().allowed.includes(cmd)) continue;
                traceNativeAccept(cmd, 'manual-accept-all');
                try { await vscode.commands.executeCommand(cmd); } catch (_) { }
            }
            maybeTraceFilteredNative('manual-accept-all');
            if (cdp && cdp.isConnected()) cdp.hotUpdate();
            refreshBar();
        }),
        vscode.commands.registerCommand('grav.toggleSkipBrowserAgent', async () => {
            _skipBrowserAgent = !_skipBrowserAgent;
            await vscode.workspace.getConfiguration('grav').update('skipBrowserAgent', _skipBrowserAgent, vscode.ConfigurationTarget.Global);
            refreshBar();
            if (cdp && _isAntigravity) cdp.hotUpdate();
            vscode.window.showInformationMessage(`[Antigravity Auto Submit] Browser Skip ${_skipBrowserAgent ? 'ON' : 'OFF'}`);
        }),
        vscode.commands.registerCommand('grav.resetLearningData', async () => {
            const confirm = await vscode.window.showWarningMessage('[Antigravity Auto Submit] Bạn có chắc chắn muốn xóa TOÀN BỘ dữ liệu học máy không?', 'Có, Xóa', 'Hủy');
            if (confirm === 'Có, Xóa') {
                await ctx.globalState.update('learnData', {});
                await ctx.globalState.update('learnEpoch', 0);
                if (learning) learning.init(ctx, wiki);
                vscode.window.showInformationMessage('[Antigravity Auto Submit] Đã reset toàn bộ dữ liệu học máy về 0.');
            }
        })
    );
}

async function deactivate() {
    _active = false; _acceptPaused = true;
    if (_ctx && _isAntigravity) injection.writeRuntimeConfig(_ctx);
    if (cdp) await cdp.disconnect();
    if (_sbMain) _sbMain.dispose();
    if (_sbCdp) _sbCdp.dispose();
    if (_sbSkip) _sbSkip.dispose();
    if (_sbDry) _sbDry.dispose();
    if (_acceptTimer) clearInterval(_acceptTimer);
    bridge.stop();

    idle.stop();
    learning.flush();
    wiki.flush();
    roi.flush();
    persistObservability();
    if (_ctx) { try { _ctx.globalState.update('stats', _stats); _ctx.globalState.update('totalClicks', _totalClicks); _ctx.globalState.update('clickLog', _log); } catch (_) { } }
}

module.exports = { activate, deactivate };
