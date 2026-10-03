'use strict';

const vscode = require('vscode');
const { cfg } = require('./utils');
const { DEFAULT_PATTERNS, PRESET_PATTERNS, SAFE_TERMINAL_CMDS, DEFAULT_BLACKLIST } = require('./constants');
const crypto = require('crypto');
const { activeRules } = require('./permission-rules');
const { normalize } = require('./autopilot-profile');
function withPolicyVersion(config) {
    const effective = { ...config };
    delete effective.policyVersion;
    const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
    return { ...effective, policyVersion: 'p0-' + crypto.createHash('sha256').update(JSON.stringify(stable(effective))).digest('hex') };
}
let projectProvider = () => ({});

function setProjectProvider(provider) { projectProvider = provider; }
function normalizeRetryBudget(input) {
    if (!input || input.enabled !== true) return { enabled: false };
    const max = input.maxPerConversation;
    if (!Number.isInteger(max) || max < 1 || max > 8) return { enabled: false };
    return { enabled: true, maxPerConversation: max };
}
function getEffectiveConfig(ctx, project = projectProvider()) {
    const disabledPatterns = ctx ? ctx.globalState.get('disabledPatterns', []) : [];
    const disabled = new Set(disabledPatterns.map(p => p.trim().toLowerCase()));
    const mode = cfg('presetMode', '1.24+');
    const base = mode === 'custom' ? cfg('approvePatterns', DEFAULT_PATTERNS) : (PRESET_PATTERNS[mode] || DEFAULT_PATTERNS);
    const config = {
        enabled: cfg('enabled', true),
        dryRun: cfg('dryRun', false) || project.dryRun === true,
        approvePatterns: [...new Set([...base, ...(project.patterns || [])])].filter(p => !disabled.has(p.trim().toLowerCase())),
        terminalWhitelist: [...cfg('terminalWhitelist', [])],
        builtInGrants: [...SAFE_TERMINAL_CMDS],
        workspace: vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath || null,
        permissionProfile: ['legacy', 'observe', 'edits', 'terminal'].includes(cfg('permissionProfile', 'legacy')) ? cfg('permissionProfile', 'legacy') : 'observe',
        permissionRules: activeRules(cfg('permissionRules', []), vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath || null),
        autopilotProfile: normalize(cfg('autopilotProfile', { enabled: false, grants: [] })),
        decisionPolicy: cfg('decisionRules', { enabled: false }),
        retryBudget: normalizeRetryBudget(cfg('retryBudget', { enabled: false })),
        retryUsed: {},
        eventScheduler: true,
        skipBrowserAgent: cfg('skipBrowserAgent', false),
        skipTerminalAccept: cfg('skipTerminalAccept', true),
        autoFixEnabled: cfg('autoFixEnabled', false),
        terminalBlacklist: [...new Set([...cfg('terminalBlacklist', []), ...(project.blacklist || [])])],
        disabledPatterns,
        autoScroll: cfg('autoScroll', true),
        approveIntervalMs: Math.max(100, cfg('approveIntervalMs', 1000)),
        scrollIntervalMs: Math.max(100, cfg('scrollIntervalMs', 500)),
        scrollPauseMs: Math.max(0, cfg('scrollPauseMs', 15000)),
    };
    // blacklist is the authoritative evaluator field; terminalBlacklist retains user/project entries.
    return withPolicyVersion({ ...config, patterns: config.approvePatterns, blacklist: [...new Set([...DEFAULT_BLACKLIST, ...config.terminalBlacklist])] });
}
module.exports = { getEffectiveConfig, setProjectProvider, withPolicyVersion };
