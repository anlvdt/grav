'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const Module = require('module');
const { TAG, RUNTIME_FILE, CONFIG_FILE, LEGACY_SCRIPTS } = require('../src/constants');
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  v ' + name); }
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'grav-injection-test-')));
const wbDir = path.join(root, 'out', 'vs', 'workbench');
const wb = path.join(wbDir, 'workbench.html');
const productPath = path.join(root, 'product.json');
const hash = s => crypto.createHash('sha256').update(s).digest('base64').replace(/=+$/, '');
const originalHtml = '<html><body>original</body></html>';
const originalLoad = Module._load;
let failPath = null, writes = 0, failAt = 0, provider = null, messages = [];
const vscode = {
    env: { appRoot: root }, window: { showErrorMessage: msg => messages.push(msg) },
    workspace: { getConfiguration: () => ({ get: (key, fallback) => key === 'presetMode' ? 'custom' : fallback }) },
};
Module._load = function(request, parent, isMain) {
    if (request === 'vscode') return vscode;
    if (request === './utils' && parent?.filename.endsWith('/src/injection.js')) {
        const actual = originalLoad.call(this, request, parent, isMain);
        return { ...actual, elevatedWrite: (fp, content) => {
            writes++;
            if (fp === failPath || (failAt && writes === failAt)) {
                failPath = null; failAt = 0;
                fs.writeFileSync(fp, 'partial');
                throw new Error('Injected write failure');
            }
            fs.writeFileSync(fp, content, 'utf8');
        } };
    }
    return originalLoad.call(this, request, parent, isMain);
};
const injection = require('../src/injection');
const ctx = { extensionPath: path.resolve(__dirname, '..'), globalState: { get: (key, fallback) => fallback } };
function reset() {
    fs.rmSync(path.join(root, 'out'), { recursive: true, force: true });
    for (const file of fs.readdirSync(root)) fs.rmSync(path.join(root, file), { recursive: true, force: true });
    fs.mkdirSync(wbDir, { recursive: true });
    fs.writeFileSync(wb, originalHtml);
    fs.writeFileSync(path.join(wbDir, RUNTIME_FILE), 'old runtime');
    fs.writeFileSync(path.join(wbDir, CONFIG_FILE), 'old config');
    for (const f of LEGACY_SCRIPTS) fs.writeFileSync(path.join(wbDir, f), 'legacy ' + f);
    fs.writeFileSync(productPath, JSON.stringify({ checksums: { 'vs/workbench/workbench.html': hash(originalHtml), 'unrelated.js': 'leave-me' } }));
    writes = 0; failAt = 0; failPath = null; messages = [];
    injection.setPolicyProvider(null);
}
function contents() {
    return [wb, path.join(wbDir, RUNTIME_FILE), path.join(wbDir, CONFIG_FILE), productPath,
        ...LEGACY_SCRIPTS.map(f => path.join(wbDir, f))].map(fp => [fp, fs.existsSync(fp) ? fs.readFileSync(fp, 'utf8') : null]);
}
try {
    test('transaction verifies injection and related checksum, keeps original backup', () => {
        reset(); assert.strictEqual(injection.inject(ctx), true);
        assert(injection.isInjected());
        assert.strictEqual(fs.readFileSync(wb + '.grav-backup', 'utf8'), originalHtml);
        assert(!fs.existsSync(path.join(wbDir, LEGACY_SCRIPTS[0])));
        const pj = JSON.parse(fs.readFileSync(productPath));
        assert.strictEqual(pj.checksums['vs/workbench/workbench.html'], hash(fs.readFileSync(wb, 'utf8')));
        assert.strictEqual(pj.checksums['unrelated.js'], 'leave-me');
        assert(injection.inject(ctx));
        assert.strictEqual(fs.readFileSync(wb + '.grav-backup', 'utf8'), originalHtml);
        assert.strictEqual(fs.readFileSync(wb, 'utf8').split(TAG.open).length, 2);
    });
    test('failure at each backup and commit write restores original files', () => {
        reset(); assert(injection.inject(ctx)); const count = writes;
        for (let i = 1; i <= count; i++) {
            reset(); const before = contents(); failAt = i;
            assert.strictEqual(injection.inject(ctx), false, 'fault ' + i);
            assert.deepStrictEqual(contents(), before, 'rollback fault ' + i);
            assert(!injection.isInjected());
        }
    });
    test('failure removes newly created runtime and config', () => {
        reset(); fs.unlinkSync(path.join(wbDir, RUNTIME_FILE)); fs.unlinkSync(path.join(wbDir, CONFIG_FILE));
        const before = contents(); failPath = wb;
        assert.strictEqual(injection.inject(ctx), false); assert.deepStrictEqual(contents(), before);
    });
    test('missing html closing tag makes no writes', () => {
        reset(); fs.writeFileSync(wb, '<html>oops'); const before = contents();
        assert.strictEqual(injection.inject(ctx), false); assert.strictEqual(writes, 0); assert.deepStrictEqual(contents(), before);
    });
    test('eject removes all tags/scripts/config and updates only related checksum', () => {
        reset(); assert(injection.inject(ctx)); assert(injection.eject()); assert(!injection.isInjected());
        for (const f of [RUNTIME_FILE, CONFIG_FILE, ...LEGACY_SCRIPTS]) assert(!fs.existsSync(path.join(wbDir, f)));
        const html = fs.readFileSync(wb, 'utf8'); assert(!html.includes(TAG.open));
        assert.strictEqual(html, originalHtml);
        const pj = JSON.parse(fs.readFileSync(productPath));
        assert.strictEqual(pj.checksums['vs/workbench/workbench.html'], hash(html));
        assert.strictEqual(pj.checksums['unrelated.js'], 'leave-me'); assert(injection.eject());
        assert.strictEqual(injection.hotUpdateRuntime(ctx), false);
        assert.strictEqual(injection.writeRuntimeConfig(ctx), false);
    });
    test('eject deletion failure restores tags, scripts, config and checksum', () => {
        reset(); assert(injection.inject(ctx)); const before = contents();
        const unlink = fs.unlinkSync;
        fs.unlinkSync = fp => { if (fp === path.join(wbDir, CONFIG_FILE)) throw new Error('delete fault'); return unlink(fp); };
        try { assert.strictEqual(injection.eject(), false); }
        finally { fs.unlinkSync = unlink; }
        assert.deepStrictEqual(contents(), before);
    });
    test('live provider gates pause, disabled, dry-run and effective project patterns', () => {
        reset(); provider = { enabled: true, paused: false, dryRun: false, patterns: ['Accept All', 'Run Task', 'Retry'], scrollEnabled: false };
        injection.setPolicyProvider(() => provider);
        assert(injection.inject(ctx));
        let config = JSON.parse(fs.readFileSync(path.join(wbDir, CONFIG_FILE)));
        assert.deepStrictEqual(config.patterns, ['Accept All', 'Retry']); assert(config.enabled); assert(!config.scrollEnabled);
        for (const patch of [{ paused: true }, { dryRun: true }, { enabled: false }]) {
            provider = { enabled: true, paused: false, dryRun: false, ...patch };
            assert(injection.writeRuntimeConfig(ctx));
            config = JSON.parse(fs.readFileSync(path.join(wbDir, CONFIG_FILE)));
            assert.strictEqual(config.enabled, patch.enabled !== false);
            assert.strictEqual(config.paused, patch.paused === true);
            assert.strictEqual(config.dryRun, patch.dryRun === true);
            assert.strictEqual(config.enabled && !config.paused && !config.dryRun, false);
            assert(!injection.buildRuntime(ctx).includes('/*{{POLICY}}*/'));
        }
        provider = { enabled: true, patterns: ['Expand'], scrollEnabled: true };
        assert(injection.writeRuntimeConfig(ctx));
        config = JSON.parse(fs.readFileSync(path.join(wbDir, CONFIG_FILE)));
        assert.deepStrictEqual(config.patterns, ['Expand']); assert(config.enabled);
    });
    test('target and backup symlinks fail before modifying the installation', () => {
        for (const target of [wb, path.join(wbDir, RUNTIME_FILE), wb + '.grav-backup']) {
            reset(); if (fs.existsSync(target)) fs.unlinkSync(target);
            fs.symlinkSync(path.join(root, 'outside'), target);
            assert.strictEqual(injection.inject(ctx), false); assert.strictEqual(writes, 0);
        }
    });
    test('parent symlink escape and unsafe checksum traversal fail closed', () => {
        reset(); const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'grav-outside-'));
        try {
            fs.writeFileSync(path.join(outside, 'workbench.html'), originalHtml);
            fs.rmSync(wbDir, { recursive: true }); fs.symlinkSync(outside, wbDir);
            assert.strictEqual(injection.inject(ctx), false); assert.strictEqual(writes, 0);
        } finally { fs.rmSync(outside, { recursive: true, force: true }); }
        reset(); fs.writeFileSync(productPath, '{"checksums":{"../../outside":"bad"}}');
        assert.strictEqual(injection.inject(ctx), false); assert.strictEqual(writes, 0);
    });
} finally {
    Module._load = originalLoad;
    injection.setPolicyProvider(null);
    fs.rmSync(root, { recursive: true, force: true });
}
console.log(`Results: ${passed} passed, 0 failed`);
