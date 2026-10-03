'use strict';

const vscode = require('vscode');
const { LEARN, SAFE_TERMINAL_CMDS, COMMAND_CATEGORIES } = require('./constants');
const { cfg, extractCommands } = require('./utils');
const { getEffectiveConfig } = require('./configuration');
const Policy = require('./action-policy');
const { redact } = require('./redaction');
let policyProvider = null;
const setPolicyProvider = provider => { policyProvider = provider; };

let _learnData = {}, _learnEpoch = 0, _userWhitelist = [], _userBlacklist = [], _patternCache = [], _ctx = null, _wiki = null, _saveTimer = null;

const refreshPolicy = () => {
    _userWhitelist = [...cfg('terminalWhitelist', [])];
    _userBlacklist = [...getEffectiveConfig(_ctx).terminalBlacklist];
};
const getThreshold = () => {
    const value = cfg('learnThreshold', 3);
    return typeof value === 'number' && Number.isFinite(value) ? Math.max(1, Math.min(50, Math.ceil(value))) : 3;
};
const promotionEligible = d => d.conf >= LEARN.PROMOTE_THRESH && (d.approvals || 0) >= getThreshold();
const init = (ctx, wikiRef) => { _ctx = ctx; _wiki = wikiRef; refreshPolicy(); load(); };

const load = () => {
    if (!_ctx) return;
    const raw = _ctx.globalState.get('learnData', {});
    _learnEpoch = _ctx.globalState.get('learnEpoch', 0);
    _learnData = {};
    for (const [k, v] of Object.entries(raw)) {
        if (typeof v.conf === 'number') { _learnData[k] = v; }
        else if (typeof v.approves === 'number') {
            const total = (v.approves || 0) + (v.rejects || 0);
            const ratio = total > 0 ? (v.approves || 0) / total : 0.5;
            _learnData[k] = { conf: (ratio - 0.5) * 2, velocity: 0, obs: total, rewards: [], history: [], contexts: {}, lastSeen: v.lastSeen || Date.now(), promoted: false, demoted: false };
        }
    }
    applyDecay();
    generalizePatterns();
    pruneEntries();
    save();
};

const save = () => {
    if (!_ctx || _saveTimer) return;
    _saveTimer = setTimeout(() => { _saveTimer = null; try { _ctx.globalState.update('learnData', _learnData); _ctx.globalState.update('learnEpoch', _learnEpoch); } catch (_) { /* save failed */ } }, 2000);
};

const flush = () => { if (_saveTimer) { clearTimeout(_saveTimer); _saveTimer = null; } if (!_ctx) return; try { _ctx.globalState.update('learnData', _learnData); _ctx.globalState.update('learnEpoch', _learnEpoch); } catch (_) { } };

// Execution telemetry is not evidence that a person approved a command.
const recordObservation = (cmdLine, context = {}) => {
    if (!cfg('learnEnabled', true)) return;
    const cmds = extractCommands(cmdLine);
    if (!cmds.length) return;
    const now = Date.now();
    _learnEpoch++;
    for (const cmd of cmds) {
        if (!_learnData[cmd]) _learnData[cmd] = { conf: 0, velocity: 0, obs: 0, rewards: [], history: [], contexts: {}, lastSeen: now, promoted: false, demoted: false };
        const d = _learnData[cmd];
        d.observations = (d.observations || 0) + 1;
        if (Number.isInteger(context.exitCode)) d.results = (d.results || 0) + 1;
        d.lastSeen = now;
    }
    save();
};

const recordAction = (cmdLine, action, context = {}) => {
    if (!cfg('learnEnabled', true)) return;
    if (action !== 'approve' && action !== 'reject') return;
    if (context.source !== 'user-approval') return recordObservation(cmdLine, context);
    refreshPolicy();
    if (action === 'approve' && evaluateCommand(cmdLine).decision === 'deny') return;
    const cmds = extractCommands(cmdLine);
    const now = Date.now();
    _learnEpoch++;

    for (const cmd of cmds) {
        if (!_learnData[cmd]) { _learnData[cmd] = { conf: 0, velocity: 0, obs: 0, rewards: [], history: [], contexts: {}, lastSeen: now, promoted: false, demoted: false }; }
        const d = _learnData[cmd];
        d.obs++;
        if (action === 'approve') d.approvals = (d.approvals || 0) + 1;
        else d.rejections = (d.rejections || 0) + 1;
        d.examples = [...new Set([...(d.examples || []), redact(cmdLine).slice(0, 200)])].slice(-5);
        d.lastSeen = now;

        let reward = action === 'approve' ? 1.0 : -1.0;
        if (context.exitCode !== undefined) { if (context.exitCode === 0 && action === 'approve') reward += LEARN.CONTEXT_WEIGHT; else if (context.exitCode !== 0 && action === 'approve') reward -= LEARN.CONTEXT_WEIGHT; }
        if (action === 'reject') { if (!d.rejectTimes) d.rejectTimes = []; d.rejectTimes.push(now); d.rejectTimes = d.rejectTimes.filter(t => now - t < 600000); if (d.rejectTimes.length >= 2) reward *= 3.0; }
        if (action === 'approve' && context.project) { const sessionKey = 'sess:' + context.project; d.contexts[sessionKey] = (d.contexts[sessionKey] || 0) + 1; if (d.contexts[sessionKey] >= 3) reward += LEARN.CONTEXT_WEIGHT * 0.5; }

        const hour = new Date().getHours();
        const timeSlot = hour < 6 ? 'night' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
        d.contexts[timeSlot] = (d.contexts[timeSlot] || 0) + 1;
        if (context.project) { const projKey = 'proj:' + context.project; d.contexts[projKey] = (d.contexts[projKey] || 0) + 1; }

        // Mini-batch SGD with momentum - bounded arrays to prevent memory leak
        d.rewards.push(reward);
        if (d.rewards.length > LEARN.BATCH_SIZE) d.rewards = d.rewards.slice(-LEARN.BATCH_SIZE); // FIX: bounded array

        const batchReward = d.rewards.reduce((a, b) => a + b, 0) / d.rewards.length;
        const gradient = LEARN.ALPHA * batchReward;
        d.velocity = LEARN.MOMENTUM * d.velocity + gradient;
        d.conf = Math.max(-1, Math.min(1, d.conf + d.velocity * (1 - LEARN.MOMENTUM)));

        // History bounded
        d.history.push({ t: now, c: d.conf, r: reward, e: _learnEpoch });
        if (d.history.length > LEARN.MAX_HISTORY) d.history = d.history.slice(-LEARN.MAX_HISTORY); // FIX: bounded

        if (promotionEligible(d) && !d.promoted && !SAFE_TERMINAL_CMDS.includes(cmd) && !_userWhitelist.includes(cmd)) { d.promoted = true; suggestPromotion(cmd, d).catch(() => { d.promoted = false; }); }
        if (d.obs >= LEARN.OBSERVE_MIN) {
            if (d.conf <= LEARN.DEMOTE_THRESH && !d.demoted && !_userBlacklist.includes(cmd)) { d.demoted = true; suggestDemotion(cmd, d).catch(() => { d.demoted = false; }); }
        }
    }

    if (_learnEpoch % 20 === 0) generalizePatterns();
    if (_wiki) { for (const cmd of cmds) { _wiki.ingest(cmd, action, _learnData[cmd], context); } }
    save();
};

const applyDecay = () => {
    const now = Date.now();
    for (const [k, d] of Object.entries(_learnData)) {
        const daysSince = (now - d.lastSeen) / 86400000;
        if (daysSince > 1) {
            const decayFactor = Math.pow(LEARN.GAMMA, daysSince);
            d.conf *= decayFactor;
            d.velocity *= decayFactor;
            if (Math.abs(d.conf) < 0.01 && d.obs < LEARN.OBSERVE_MIN && daysSince > 60) { delete _learnData[k]; }
        }
    }
};

const pruneEntries = () => {
    const keys = Object.keys(_learnData);
    if (keys.length <= LEARN.MAX_ENTRIES) return;
    const scored = keys.map(k => ({ key: k, score: Math.abs(_learnData[k].conf) * Math.log(_learnData[k].obs + 1) }));
    scored.sort((a, b) => b.score - a.score);
    for (let i = LEARN.MAX_ENTRIES; i < scored.length; i++) { delete _learnData[scored[i].key]; }
};

const generalizePatterns = () => {
    _patternCache = [];
    const groups = {};
    for (const [cmd, d] of Object.entries(_learnData)) {
        if (d.conf < 0.2 || d.obs < 2) continue;
        const prefix = cmd.replace(/[-_].*$/, '').replace(/\d+$/, '');
        // Require meaningful prefix: ≥3 chars, must contain a letter, not a number/version
        if (prefix && prefix.length >= 3 && /[a-z]/.test(prefix) && !/^\d/.test(prefix)) {
            if (!groups[prefix]) groups[prefix] = [];
            groups[prefix].push(cmd);
        }
    }
    for (const [prefix, members] of Object.entries(groups)) {
        if (members.length >= LEARN.GENERALIZE_MIN && !SAFE_TERMINAL_CMDS.includes(prefix)) { _patternCache.push(prefix); }
    }
    if (_wiki) {
        const sequences = _wiki.getSequences();
        if (sequences) {
            const coOccur = {};
            for (const [seq, count] of Object.entries(sequences)) {
                if (count < 2) continue;
                const [a, b] = seq.split(' → ');
                if (a && b) { if (!coOccur[a]) coOccur[a] = new Set(); if (!coOccur[b]) coOccur[b] = new Set(); coOccur[a].add(b); coOccur[b].add(a); }
            }
            for (const [cmd, peers] of Object.entries(coOccur)) {
                if (_learnData[cmd] && _learnData[cmd].conf < 0.3) {
                    const trustedPeers = [...peers].filter(p => _learnData[p]?.conf > 0.5);
                    if (trustedPeers.length >= 2) { _learnData[cmd].conf = Math.min(1, _learnData[cmd].conf + 0.05); }
                }
            }
        }
    }
};

// Statistical candidates are suggestions only, never authorization.
const getPromotedCommands = () => Object.entries(_learnData).filter(([, d]) => promotionEligible(d)).map(([k]) => k);

const evaluateCommand = (cmdLine, snapshot) => {
    // The fallback's canonical blacklist includes defaults and user/project rules under its version.
    // Supplied snapshots (including an invalid/null snapshot) remain authoritative; do not fill them in.
    const policy = snapshot !== undefined ? snapshot : policyProvider ? policyProvider() : getEffectiveConfig(_ctx);
    return Policy.evaluateCommand(cmdLine, policy);
};

const suggestPromotion = async (cmd, data) => {
    // P0 intentionally routes explicit policy edits to Manage Terminal instead of Add/Blacklist prompts.
    const pick = await vscode.window.showInformationMessage(`[Grav] Candidate "${cmd}": suggestion score ${Math.round(data.conf * 100)} after ${data.obs} observations. Learning does not grant authorization.`, 'Manage Terminal', 'Dismiss');
    if (pick === 'Manage Terminal') await vscode.commands.executeCommand('grav.manageTerminal');
};

const suggestDemotion = async (cmd, data) => {
    const pick = await vscode.window.showWarningMessage(`[Grav] Candidate "${cmd}": suggestion score ${Math.round(data.conf * 100)}; frequently rejected. Review your policy manually.`, 'Manage Terminal', 'Dismiss');
    if (pick === 'Manage Terminal') await vscode.commands.executeCommand('grav.manageTerminal');
};

const getStats = () => {
    const entries = Object.entries(_learnData).sort((a, b) => b[1].obs - a[1].obs).slice(0, 30);
    return { epoch: _learnEpoch, totalTracked: Object.keys(_learnData).length, candidates: getPromotedCommands().length, promoted: getPromotedCommands().length, patterns: _patternCache.length, commands: entries.map(([cmd, d]) => ({ cmd, provenance: { observations: d.observations || 0, humanApprovals: d.approvals || 0, humanRejections: d.rejections || 0, recordedResults: d.results || 0, examples: (d.examples || []).slice(-5) }, scoreLabel: 'suggestion score', candidateScore: Math.round(d.conf * 100) / 100, conf: Math.round(d.conf * 100) / 100, velocity: Math.round(d.velocity * 1000) / 1000, obs: d.obs, status: promotionEligible(d) ? 'candidate' : d.conf <= LEARN.DEMOTE_THRESH && d.obs >= LEARN.OBSERVE_MIN ? 'review-suggestion' : d.obs < LEARN.OBSERVE_MIN ? 'observing' : d.conf > 0.3 ? 'learning' : d.conf < -0.3 ? 'suspicious' : 'neutral', lastSeen: new Date(d.lastSeen).toLocaleDateString() })) };
};

const getData = () => _learnData;
const getEpoch = () => _learnEpoch;
const getWhitelist = () => { refreshPolicy(); return [..._userWhitelist]; };
const getBlacklist = () => { refreshPolicy(); return [..._userBlacklist]; };
const getPatternCache = () => _patternCache;

/**
 * Purge badly-learned entries: numbers, flags, versions, filenames, 1-char tokens.
 * Returns count of entries removed.
 */
const purgeBadEntries = () => {
    const BAD = /^(?:\d+|[\-]{1,2}[\w\-]+|v?\d[\d.\-a-z]*|\S+\.[a-z]{2,4}|[./~$]|[\[\]{}()<>"'`]|\w+=\S*)$/i;
    let count = 0;
    for (const key of Object.keys(_learnData)) {
        const isBad =
            key.length < 2 ||              // single char
            key.length > 20 ||             // too long
            /^\d+$/.test(key) ||           // pure number
            /^[\-]{1,2}[\w\-]+$/.test(key) || // flag
            /^v?\d[\d.\-a-z]*$/.test(key) || // version
            /\.[a-z]{2,4}$/.test(key) ||  // filename/domain
            /^(?:error|warning|info|debug|success|failed|running|building|started|finished|done|some|the|this|that|an?|is|are|was|were)$/i.test(key) ||
            !/[a-z]/i.test(key) ||         // no letters at all
            BAD.test(key);
        if (isBad) {
            delete _learnData[key];
            count++;
        }
    }
    if (count > 0) {
        console.log(`[Grav] Purged ${count} bad learning entries`);
        save();
    }
    return count;
};

module.exports = { init, setPolicyProvider, refreshPolicy, flush, recordObservation, recordAction, evaluateCommand, getPromotedCommands, getStats, getData, getEpoch, getWhitelist, getBlacklist, getPatternCache, purgeBadEntries };
