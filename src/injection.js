// ═══════════════════════════════════════════════════════════════
//  Grav — Runtime Injection (workbench.html management)
// ═══════════════════════════════════════════════════════════════
'use strict';

const vscode = require('vscode');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');
const crypto = require('crypto');

const {
    TAG, LEGACY_TAGS, LEGACY_SCRIPTS, RUNTIME_FILE, CONFIG_FILE, DEFAULT_BLACKLIST,
    HIGH_CONF, COOLDOWN, REJECT_WORDS, EDITOR_SKIP, LIMITS,
} = require('./constants');
const { escapeRegex, elevatedWrite, workbenchPath } = require('./utils');
const { getEffectiveConfig } = require('./configuration');
const { browserSource } = require('./action-policy');
let policyProvider = null;

function setPolicyProvider(provider) {
    if (provider !== null && typeof provider !== 'function') throw new TypeError('Policy provider must be a function or null');
    policyProvider = provider;
}

function runtimeConfig(ctx) {
    const config = { ...getEffectiveConfig(ctx), ...(policyProvider ? policyProvider() : {}) };
    const safe = new Set(['Accept', 'Accept All', 'Accept all', 'ACCEPT ALL', 'Approve', 'Retry', 'Proceed', 'Expand']);
    const patterns = (config.patterns || config.approvePatterns).filter(p => safe.has(p));
    return {
        policyVersion: config.policyVersion,
        workspace: config.workspace,
        terminalWhitelist: config.terminalWhitelist,
        builtInGrants: config.builtInGrants,
        permissionProfile: config.permissionProfile || 'legacy',
        permissionRules: config.permissionRules || [],
        autopilotProfile: config.autopilotProfile || { enabled: false, grants: [] },
        decisionPolicy: config.decisionPolicy && config.decisionPolicy.enabled === true ? config.decisionPolicy : { enabled: false },
        interactionHost: config.interactionHost || null,
        resumeToken: config.resumeToken,
        eventScheduler: config.eventScheduler === true,
        pauseReasonCode: config.pauseReasonCode, pauseReason: config.pauseReason,
        enabled: config.enabled === true,
        paused: config.paused === true,
        dryRun: config.dryRun === true,
        active: config.active !== false,
        blacklist: [...new Set([...DEFAULT_BLACKLIST, ...(config.blacklist || config.terminalBlacklist)])],
        scrollEnabled: (config.scrollEnabled ?? config.autoScroll) === true,
        patterns,
        acceptInChatOnly: patterns.includes('Accept'),
        pauseMs: config.scrollPauseMs, scrollMs: config.scrollIntervalMs, approveMs: config.approveIntervalMs,
    };
}

/**
 * Build the runtime JS with injected config values.
 * @param {vscode.ExtensionContext} ctx
 * @returns {string}
 */
function buildRuntime(ctx) {
    const config = runtimeConfig(ctx);
    let src = fs.readFileSync(path.join(ctx.extensionPath, 'media', 'runtime.js'), 'utf8');
    src = src.replace(/\/\*\{\{ACTION_POLICY\}\}\*\/null/, () => browserSource);
    src = src.replace(/\/\*\{\{POLICY\}\}\*\/null/, () => JSON.stringify(config));
    // Config values
    src = src.replace(/\/\*\{\{PAUSE_MS\}\}\*\/\d+/,    String(config.pauseMs));
    src = src.replace(/\/\*\{\{SCROLL_MS\}\}\*\/\d+/,   String(config.scrollMs));
    src = src.replace(/\/\*\{\{APPROVE_MS\}\}\*\/\d+/,  String(config.approveMs));
    // Keep the legacy workbench runtime on edit-safe buttons only.
    // Tool and terminal approvals should flow through the CDP observer, which has the safety guard.
    src = src.replace(/\/\*\{\{PATTERNS\}\}\*\/\[.*?\]/, JSON.stringify(config.patterns));
    src = src.replace(/\/\*\{\{ENABLED\}\}\*\/\w+/,     String(config.enabled));
    src = src.replace('window.__gravScrollEnabled = true;', `window.__gravScrollEnabled = ${!!config.scrollEnabled};`);
    // Shared constants from constants.js
    src = src.replace(/\/\*\{\{REJECT_WORDS\}\}\*\/\[.*?\]/, JSON.stringify(REJECT_WORDS));
    src = src.replace(/\/\*\{\{EDITOR_SKIP\}\}\*\/\[.*?\]/, JSON.stringify(EDITOR_SKIP));
    src = src.replace(/\/\*\{\{HIGH_CONF\}\}\*\/\{.*?\}/, JSON.stringify(HIGH_CONF));
    src = src.replace(/\/\*\{\{COOLDOWN\}\}\*\/\{.*?\}/, JSON.stringify(COOLDOWN));
    src = src.replace(/\/\*\{\{LIMITS\}\}\*\/\{.*?\}/, JSON.stringify(LIMITS));
    return src;
}

/** Reject sibling-prefix paths and links escaping the current installation. */
function installationFile(fp) {
    const root = fs.realpathSync(vscode.env.appRoot);
    const resolved = path.resolve(fp);
    const within = candidate => {
        const rel = path.relative(root, candidate);
        return rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel);
    };
    // Resolve ancestors too: the final file may not exist yet.
    const parent = fs.realpathSync(path.dirname(resolved));
    if (!within(parent)) throw new Error('Path outside IDE installation: ' + fp);
    try {
        const stat = fs.lstatSync(resolved);
        if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Unsafe installation file: ' + fp);
        if (!within(fs.realpathSync(resolved))) throw new Error('Path outside IDE installation: ' + fp);
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
    return resolved;
}

function readOptional(fp) {
    installationFile(fp);
    try { return fs.readFileSync(fp, 'utf8'); }
    catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}

function checkedWrite(fp, content) {
    installationFile(fp);
    elevatedWrite(fp, content);
    if (fs.readFileSync(fp, 'utf8') !== content) throw new Error('Write verification failed: ' + fp);
}

function stripTags(html) {
    // Remove the exact wrapper we inserted, including its own newlines.
    html = html.replace(new RegExp('\\n' + escapeRegex(TAG.open) + '\\n<script src="' +
        escapeRegex(RUNTIME_FILE) + '\\?v=\\d+"></script>\\n' + escapeRegex(TAG.close) + '\\n', 'g'), '');
    for (const [s, e] of [[TAG.open, TAG.close], ...LEGACY_TAGS]) {
        html = html.replace(new RegExp(escapeRegex(s) + '[\\s\\S]*?' + escapeRegex(e), 'g'), '');
    }
    return html;
}

/** Snapshot before any writes; retain original backups for manual recovery. */
function transaction(changes) {
    const snapshots = changes.map(([fp]) => [installationFile(fp), readOptional(fp)]);
    const backups = snapshots.filter(([, content]) => content !== null)
        .map(([fp, content]) => [fp + '.grav-backup', content])
        .filter(([backup]) => readOptional(backup) === null);
    const touched = [];
    try {
        for (const [backup, content] of backups) {
            try { checkedWrite(backup, content); }
            catch (e) {
                installationFile(backup);
                if (readOptional(backup) !== null) fs.unlinkSync(backup);
                throw e;
            }
        }
        for (const [fp, content] of changes) {
            touched.push(fp); // Include a write that fails after partially modifying its target.
            installationFile(fp);
            if (content === null) {
                if (readOptional(fp) !== null) fs.unlinkSync(fp);
                if (readOptional(fp) !== null) throw new Error('Removal verification failed: ' + fp);
            } else checkedWrite(fp, content);
        }
    } catch (e) {
        const failures = [];
        for (const fp of touched.reverse()) {
            const original = snapshots.find(([name]) => name === fp)[1];
            try {
                installationFile(fp);
                if (original === null) {
                    if (readOptional(fp) !== null) fs.unlinkSync(fp);
                } else checkedWrite(fp, original);
            } catch (rollback) { failures.push(fp + ': ' + rollback.message); }
        }
        if (failures.length) e.message += '; rollback failed (use .grav-backup): ' + failures.join('; ');
        throw e;
    }
}

/** Inject runtime; true means all writes and cleanup were verified. */
function inject(ctx) {
    try {
        const wb = workbenchPath();
        if (!wb) throw new Error('workbench.html not found');
        const dir = path.dirname(wb);
        const html = stripTags(readOptional(wb));
        if (!/<\/html\s*>/i.test(html)) throw new Error('workbench.html has no closing html tag');
        const runtime = buildRuntime(ctx);
        const patched = html.replace(/<\/html\s*>/i,
            `\n${TAG.open}\n<script src="${RUNTIME_FILE}?v=${Date.now()}"></script>\n${TAG.close}\n</html>`);
        const changes = [
            [path.join(dir, RUNTIME_FILE), runtime], [wb, patched],
            [path.join(dir, CONFIG_FILE), JSON.stringify(runtimeConfig(ctx))],
            ...LEGACY_SCRIPTS.map(f => [path.join(dir, f), null]),
        ];
        const checksum = checksumChange(new Map(changes));
        if (checksum) changes.push(checksum);
        transaction(changes);
        return true;
    } catch (e) {
        vscode.window.showErrorMessage('[Antigravity Auto Submit] inject failed: ' + e.message);
        return false;
    }
}

/** Remove tags, scripts and config transactionally; refresh related checksums. */
function eject() {
    try {
        const wb = workbenchPath();
        if (!wb) return false;
        const dir = path.dirname(wb);
        const changes = [[wb, stripTags(readOptional(wb))],
            ...[...LEGACY_SCRIPTS, RUNTIME_FILE, CONFIG_FILE].map(f => [path.join(dir, f), null])];
        const checksum = checksumChange(new Map(changes));
        if (checksum) changes.push(checksum);
        transaction(changes);
        return true;
    } catch (e) {
        vscode.window.showErrorMessage('[Antigravity Auto Submit] eject failed: ' + e.message);
        return false;
    }
}

/** Check if runtime is currently injected. */
function isInjected() {
    try {
        const wb = workbenchPath();
        return wb ? readOptional(wb).includes(TAG.open) && readOptional(path.join(path.dirname(wb), RUNTIME_FILE)) !== null : false;
    } catch (_) { return false; }
}

/** Only update checksum entries for the workbench files Antigravity Auto Submit changes. */
function checksumChange(overrides = new Map()) {
    const pjp = path.join(vscode.env.appRoot, 'product.json');
    const raw = readOptional(pjp);
    if (raw === null) return null;
    let pj;
    try { pj = JSON.parse(raw); } catch { return null; }
    if (!pj.checksums) return null;
    const root = path.dirname(pjp);
    const wb = workbenchPath();
    const related = new Set(wb ? [wb, ...[RUNTIME_FILE, CONFIG_FILE, ...LEGACY_SCRIPTS]
        .map(f => path.join(path.dirname(wb), f))] : []);
    let dirty = false;
    for (const rp of Object.keys(pj.checksums)) {
        if (path.isAbsolute(rp) || rp.split(/[\\/]/).includes('..')) throw new Error('Unsafe checksum path: ' + rp);
        let fp = path.join(root, 'out', rp);
        if (!related.has(fp)) fp = path.join(root, rp);
        if (!related.has(fp)) continue;
        const content = overrides.has(fp) ? overrides.get(fp) : readOptional(fp);
        if (content === null) {
            delete pj.checksums[rp];
            dirty = true;
            continue;
        }
        const h = crypto.createHash('sha256').update(content).digest('base64').replace(/=+$/, '');
        if (pj.checksums[rp] !== h) { pj.checksums[rp] = h; dirty = true; }
    }
    return dirty ? [pjp, JSON.stringify(pj, null, '\t')] : null;
}

function patchChecksums() {
    try {
        const change = checksumChange();
        if (change) transaction([change]);
        return true;
    } catch (e) {
        console.error('[Antigravity Auto Submit] checksums:', e.message);
        return false;
    }
}

/** Clear IDE code cache to force reload of injected runtime. */
function clearCodeCache() {
    try {
        const paths = process.platform === 'win32'
            ? [
                path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Antigravity IDE'),
                path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Antigravity')
              ]
            : process.platform === 'darwin'
                ? [
                    path.join(os.homedir(), 'Library', 'Application Support', 'Antigravity IDE'),
                    path.join(os.homedir(), 'Library', 'Application Support', 'Antigravity')
                  ]
                : [
                    path.join(os.homedir(), '.config', 'Antigravity IDE'),
                    path.join(os.homedir(), '.config', 'Antigravity')
                  ];
        for (const base of paths) {
            const d = path.join(base, 'Code Cache', 'js');
            if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
        }
    } catch { /* non-critical */ }
}

/** Write runtime config file for hot-reload without re-injection. */
function writeRuntimeConfig(ctx) {
    try {
        const wb = workbenchPath();
        if (!wb || !isInjected()) return false;
        const changes = [[path.join(path.dirname(wb), CONFIG_FILE), JSON.stringify(runtimeConfig(ctx))]];
        const checksum = checksumChange(new Map(changes));
        if (checksum) changes.push(checksum);
        transaction(changes);
        return true;
    } catch (e) {
        console.error('[Antigravity Auto Submit] runtime config:', e.message);
        return false;
    }
}

/** Hot-update runtime file without full re-injection. */
function hotUpdateRuntime(ctx) {
    try {
        const wb = workbenchPath();
        if (!wb || !isInjected()) return false;
        const changes = [[path.join(path.dirname(wb), RUNTIME_FILE), buildRuntime(ctx)]];
        const checksum = checksumChange(new Map(changes));
        if (checksum) changes.push(checksum);
        transaction(changes);
        return true;
    } catch (e) {
        console.error('[Antigravity Auto Submit] hot-update runtime:', e.message);
        return false;
    }
}

module.exports = {
    buildRuntime, inject, eject, isInjected, setPolicyProvider,
    patchChecksums, clearCodeCache, writeRuntimeConfig, hotUpdateRuntime,
};
