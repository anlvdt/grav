// ═══════════════════════════════════════════════════════════════
//  Grav — Utilities (sanitized, testable)
// ═══════════════════════════════════════════════════════════════
'use strict';

const vscode = require('vscode');
const { matchesBlacklist } = require('./action-policy');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');
const crypto = require('crypto');
const { execSync, execFileSync } = require('child_process');

/**
 * Escape special regex characters in a string.
 * @param {string} s
 * @returns {string}
 */
function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Sanitize a file path — reject path traversal and null bytes.
 * @param {string} fp
 * @returns {boolean}
 */
function isPathSafe(fp) {
    if (!fp || typeof fp !== 'string') return false;
    if (fp.includes('\0')) return false;
    // Reject obvious traversal
    const normalized = path.normalize(fp);
    if (normalized.includes('..')) return false;
    return true;
}

// Resolve existing ancestors as well as the final path: an absent file beneath a
// symlinked directory must not escape an allowed root.
function canonicalPath(fp) {
    let current = path.resolve(fp);
    const tail = [];
    while (!fs.existsSync(current)) {
        try { fs.lstatSync(current); throw new Error('Dangling symlink'); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        const parent = path.dirname(current);
        if (parent === current) throw new Error('Unresolvable path');
        tail.unshift(path.basename(current)); current = parent;
    }
    return path.join(fs.realpathSync(current), ...tail);
}
function isWithinRoot(fp, root) {
    if (!isPathSafe(fp) || !isPathSafe(root)) return false;
    try {
        const relative = path.relative(canonicalPath(root), canonicalPath(fp));
        return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
    } catch (_) { return false; }
}

/**
 * Write file with elevated permissions if needed.
 * Sanitizes inputs before shell execution.
 * @param {string} fp - absolute file path
 * @param {string} content - file content
 */
function elevatedWrite(fp, content) {
    if (!isPathSafe(fp)) throw new Error(`Unsafe path: ${fp}`);
    // Validate fp is absolute and within known safe directories
    const resolved = path.resolve(fp);
    const allowedRoots = [
        vscode.env.appRoot,                    // IDE installation
        os.tmpdir(),                           // temp files
        path.join(os.homedir(), '.antigravity-ide'), // Antigravity IDE config
        path.join(os.homedir(), '.antigravity'), // Legacy Antigravity config
    ];
    const inAllowed = allowedRoots.some(root => isWithinRoot(resolved, root));
    if (!inAllowed) throw new Error(`Path outside allowed directories: ${fp}`);

    try {
        fs.writeFileSync(fp, content, 'utf8');
        return;
    } catch (e) {
        if (e.code !== 'EACCES' && e.code !== 'EPERM') throw e;
    }

    const tmp = path.join(os.tmpdir(), 'grav-' + crypto.randomBytes(8).toString('hex') + '.tmp');
    fs.writeFileSync(tmp, content, 'utf8');
    try {
        if (process.platform === 'darwin') {
            // Sanitize paths for AppleScript — reject quotes and newlines to prevent injection
            if (tmp.includes('"') || fp.includes('"') ||
                tmp.includes('\n') || fp.includes('\n') ||
                tmp.includes('\r') || fp.includes('\r')) throw new Error('Path contains invalid characters');
            // Use execFileSync with array args — no shell injection possible
            execFileSync('osascript', [
                '-e', `do shell script "cp " & quoted form of "${tmp}" & " " & quoted form of "${fp}" & " && chmod 644 " & quoted form of "${fp}" with administrator privileges`,
            ], { timeout: 30000 });
        } else if (process.platform === 'linux') {
            execFileSync('pkexec', ['cp', tmp, fp], { timeout: 30000 });
            execFileSync('pkexec', ['chmod', '644', fp], { timeout: 30000 });
        } else {
            throw new Error('Permission denied — restart as admin');
        }
    } finally {
        try { fs.unlinkSync(tmp); } catch (_) { /* non-critical */ }
    }
}

/**
 * Find workbench.html in the IDE installation.
 * @returns {string|null}
 */
function workbenchPath() {
    const root = vscode.env.appRoot;
    const candidates = [
        'out/vs/code/electron-sandbox/workbench/workbench.html',
        'out/vs/code/electron-browser/workbench/workbench.html',
        'out/vs/workbench/workbench.html',
        'out/vs/code/browser/workbench/workbench.html',
        'out/vs/code/electron-main/workbench/workbench.html',
    ];
    for (const c of candidates) {
        const p = path.join(root, c);
        if (fs.existsSync(p)) return p;
    }
    return deepFind(path.join(root, 'out'), 'workbench.html', 6);
}

function deepFind(dir, name, depth) {
    if (depth <= 0) return null;
    try {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const fp = path.join(dir, e.name);
            if (e.isFile() && e.name === name) return fp;
            if (e.isDirectory()) {
                const r = deepFind(fp, name, depth - 1);
                if (r) return r;
            }
        }
    } catch (_) { /* non-critical */ }
    return null;
}

/**
 * Read a VS Code configuration value.
 * @param {string} key
 * @param {*} fallback
 * @returns {*}
 */
function cfg(key, fallback) {
    return vscode.workspace.getConfiguration('grav').get(key, fallback);
}

/**
 * Extract individual command names from a compound command string.
 * Handles pipes, chains, subshells, env vars, sudo, etc.
 * @param {string} cmdLine
 * @returns {string[]}
 */
// Tokens that are definitely not shell commands
const CMD_REJECT = /^(?:\d+|[\-]{1,2}[\w\-]+|v?\d[\d.\-a-z]*|https?:\/\/\S+|\S+\.(?:js|ts|py|sh|json|yml|yaml|toml|md|txt|log|lock|env|cfg|ini|conf)|[./~]|\$[\w{]|[\[\]{}()<>"'`]|\w+=\S*)$/i;

function extractCommands(cmdLine) {
    if (!cmdLine || typeof cmdLine !== 'string') return [];
    // Reject obviously non-command strings (numbers, flags, versions, paths, urls)
    const trimmed = cmdLine.trim();
    if (!trimmed || trimmed.length < 2) return [];
    // Reject pure numbers at the top level immediately
    if (/^\d+$/.test(trimmed)) return [];

    const parts = trimmed.split(/\s*(?:\|\||&&|[|;&])\s*/);
    const cmds = [];
    for (const part of parts) {
        let p = part.trim();
        if (!p) continue;
        p = p.replace(/^(?:(?:sudo|nohup|time|nice|ionice|strace|ltrace|env)\s+)+/gi, '');
        p = p.replace(/^(?:\w+=\S+\s+)+/, '');
        p = p.replace(/^\$\(\s*/, '').replace(/^\(\s*/, '').replace(/\)\s*$/, '');
        const match = p.match(/^([^\s]+)/);
        if (match) {
            const raw = match[1];
            // Reject URLs before any stripping
            if (/^https?:\/\//i.test(raw)) continue;
            let cmd = raw.replace(/^.*[\/\\]/, '');  // strip path prefix
            cmd = cmd.toLowerCase();
            // Validate: must be a plausible command name
            if (!cmd) continue;
            if (cmd.length < 2) continue;                    // single char: skip
            if (/^\d+$/.test(cmd)) continue;                 // pure number: skip
            if (/^[\-]{1,2}[\w\-]+$/.test(cmd)) continue;   // flag: skip
            if (/^v?\d[\d.\-a-z]*$/.test(cmd)) continue;    // version: skip
            if (/\.[a-z]{2,4}$/.test(cmd)) continue;        // file/domain with extension: skip
            if (CMD_REJECT.test(cmd)) continue;
            // Reject common log prefixes/words that leak from terminal output
            if (/^(?:error|warning|info|debug|success|failed|running|building|started|finished|done|some|the|this|that|an?|is|are|was|were)$/i.test(cmd)) continue;
            // Reject insanely long "commands" (likely hashes, base64, or garbage)
            if (cmd.length > 20) continue;
            // Must contain at least one letter (not just numbers/symbols)
            if (!/[a-z]/.test(cmd)) continue;
            cmds.push(cmd);
        }
    }
    return [...new Set(cmds)];
}

module.exports = {
    escapeRegex, isPathSafe, elevatedWrite, workbenchPath,
    cfg, extractCommands, matchesBlacklist, isWithinRoot,
};
