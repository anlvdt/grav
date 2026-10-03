'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// argv.json belongs to the running product, not whichever IDE profile exists first.
// Explicit argvPath supports fork-specific locations; portable mode follows VS Code.
// https://github.com/microsoft/vscode/blob/main/src/vs/platform/environment/common/environmentService.ts
function resolveArgvPath({ argvPath, appRoot, home = os.homedir(), env = process.env } = {}) {
    if (argvPath) {
        if (!path.isAbsolute(argvPath)) throw new Error('argvPath must be absolute');
        return argvPath;
    }
    if (env.VSCODE_PORTABLE) {
        if (!path.isAbsolute(env.VSCODE_PORTABLE)) throw new Error('Portable path must be absolute');
        return path.join(env.VSCODE_PORTABLE, 'argv.json');
    }
    if (!appRoot || !path.isAbsolute(appRoot)) throw new Error('Current host appRoot is required');
    const product = JSON.parse(fs.readFileSync(path.join(appRoot, 'product.json'), 'utf8'));
    const folder = product.dataFolderName;
    if (typeof folder !== 'string' || !folder || folder === '.' || folder === '..' || /[\\/\0]/.test(folder)) {
        throw new Error('Current host has no safe dataFolderName; supply argvPath');
    }
    return path.join(home, folder, 'argv.json');
}

function validatePort(port) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid CDP port');
}

// Tokenize before removing comments/commas so strings and offsets remain intact.
function parseJsonc(raw) {
    const tokens = [];
    const lex = /\s+|\uFEFF|\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|"(?:[^"\\\x00-\x1f]|\\(?:["\\/bfnrt]|u[\da-fA-F]{4}))*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}\[\],:]/gy;
    let offset = 0;
    while (offset < raw.length) {
        lex.lastIndex = offset;
        const match = lex.exec(raw);
        if (!match) throw new Error('Invalid JSONC at offset ' + offset);
        const value = match[0];
        if (!/^(?:\s|\uFEFF|\/\/|\/\*)/.test(value)) tokens.push({ value, start: offset, end: lex.lastIndex });
        offset = lex.lastIndex;
    }
    for (let i = 0; i < tokens.length; i++) {
        if (tokens[i].value === ',' && /^[}\]]$/.test(tokens[i + 1]?.value || '') &&
            /^[{\[:,]$/.test(tokens[i - 1]?.value || '')) throw new Error('Invalid trailing comma');
    }
    const clean = tokens.filter((t, i) => !(t.value === ',' && /^[}\]]$/.test(tokens[i + 1]?.value || '')))
        .map(t => t.value).join(' ');
    const value = JSON.parse(clean);
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('argv.json must contain an object');
    return { value, tokens };
}

function patchArgv(raw, port) {
    validatePort(port);
    const { value, tokens } = parseJsonc(raw);
    let depth = 0;
    const matches = [];
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (depth === 1 && t.value.startsWith('"') && tokens[i + 1]?.value === ':' &&
            JSON.parse(t.value) === 'remote-debugging-port') matches.push(tokens[i + 2]);
        if (t.value === '{' || t.value === '[') depth++;
        if (t.value === '}' || t.value === ']') depth--;
    }
    if (matches.length > 1) throw new Error('Duplicate remote-debugging-port');
    if (matches.length) {
        const t = matches[0];
        if (!/^(?:"|\d)/.test(t.value) || !/^\d+$/.test(String(value['remote-debugging-port']))) {
            throw new Error('Invalid existing remote-debugging-port');
        }
        if (Number(value['remote-debugging-port']) === port) return raw;
        const output = raw.slice(0, t.start) + String(port) + raw.slice(t.end);
        parseJsonc(output);
        return output;
    }
    const last = tokens[tokens.length - 1];
    const previous = tokens[tokens.length - 2];
    const eol = raw.includes('\r\n') ? '\r\n' : '\n';
    const output = raw.slice(0, previous.end) + (previous.value === '{' || previous.value === ',' ? '' : ',') +
        raw.slice(previous.end, last.start) + `${eol}\t"remote-debugging-port": ${port}${eol}` + raw.slice(last.start);
    parseJsonc(output);
    return output;
}

// Canonicalize the containing directory, but reject file symlinks (including dangling links).
function regularFile(fp) {
    try {
        const stat = fs.lstatSync(fp);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Not a regular file: ' + fp);
        return stat;
    } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}

function atomicWrite(fp, data, mode) {
    const temp = path.join(path.dirname(fp), '.grav-argv-' + crypto.randomBytes(12).toString('hex'));
    let fd;
    try {
        fd = fs.openSync(temp, 'wx', mode);
        fs.fchmodSync(fd, mode);
        fs.writeFileSync(fd, data, 'utf8');
        fs.fsyncSync(fd);
        fs.closeSync(fd);
        fd = undefined;
        regularFile(fp);
        fs.renameSync(temp, fp);
    } finally {
        if (fd !== undefined) fs.closeSync(fd);
        if (fs.existsSync(temp)) fs.unlinkSync(temp);
    }
}

/** Throws on invalid JSONC or IO error; unchanged inputs never create a backup.
 * Returns { changed, path, backupPath, port }. Caller reloads only when changed.
 * Missing profile directories are not created: caller must resolve/initialize the host first.
 */
function ensureCdpInArgv(options) {
    validatePort(options.port);
    const selected = resolveArgvPath(options);
    const directory = path.dirname(selected);
    if (fs.lstatSync(directory).isSymbolicLink()) throw new Error('Profile directory is a symlink: ' + directory);
    const fp = path.join(fs.realpathSync(directory), path.basename(selected));
    const stat = regularFile(fp);
    const raw = stat ? fs.readFileSync(fp, 'utf8') : '{}';
    const patched = patchArgv(raw, options.port);
    const backupPath = fp + '.grav-backup';
    if (patched === raw) return { changed: false, path: fp, backupPath: null, port: options.port };
    regularFile(backupPath);
    // Every patch backs up the immediate prior contents, atomically, before committing.
    if (stat) atomicWrite(backupPath, raw, stat.mode & 0o777);
    const current = regularFile(fp);
    if (!!current !== !!stat || (stat && (current.ino !== stat.ino || fs.readFileSync(fp, 'utf8') !== raw))) {
        throw new Error('argv.json changed during patch');
    }
    atomicWrite(fp, patched, stat ? stat.mode & 0o777 : 0o600);
    return { changed: true, path: fp, backupPath: stat ? backupPath : null, port: options.port };
}

module.exports = { resolveArgvPath, patchArgv, ensureCdpInArgv };
