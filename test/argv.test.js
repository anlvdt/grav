'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveArgvPath, patchArgv, ensureCdpInArgv } = require('../src/argv');
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  v ' + name); }
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'grav-argv-test-')));
try {
    test('empty object and trailing commas produce valid JSON', () => {
        for (const raw of ['{}', '{"a":1}', '{"a":1,}', '{"a":[1,2,],}']) {
            const updated = patchArgv(raw, 9444);
            assert(updated.includes('"remote-debugging-port": 9444'));
            assert.strictEqual(patchArgv(updated, 9444), updated);
        }
    });
    test('preserves comments, URL strings, nested port and CRLF', () => {
        const raw = '{\r\n// "remote-debugging-port": 9333\r\n"url":"https://x//y", "nested":{"remote-debugging-port":2}, /*comment*/\r\n}';
        const out = patchArgv(raw, 9444);
        for (const value of ['// "remote-debugging-port": 9333', '"https://x//y"', '"remote-debugging-port":2', '/*comment*/']) assert(out.includes(value));
        assert(!out.replace(/\r\n/g, '').includes('\n'));
    });
    test('updates actual root port and handles escaped key', () => {
        assert.strictEqual(patchArgv('{"remote-debugging-port":"9333"}', 9444), '{"remote-debugging-port":9444}');
        assert.strictEqual(patchArgv('{"remote-debugging-port":9444}', 9444), '{"remote-debugging-port":9444}');
        assert(patchArgv('{"remote-debugging-\\u0070ort":9333}', 9444).endsWith(':9444}'));
    });
    test('invalid input and duplicate ports fail closed', () => {
        for (const raw of ['{,}', '{"a":,}', '[]', '{"a":1', '{/*oops}', '{"remote-debugging-port":{}}', '{"remote-debugging-port":1,"remote-debugging-port":2}']) assert.throws(() => patchArgv(raw, 9444));
        for (const port of [0, 65536, 1.5, NaN, '9444']) assert.throws(() => patchArgv('{}', port));
    });
    const home = path.join(root, 'home');
    const appRoot = path.join(root, 'app');
    fs.mkdirSync(home); fs.mkdirSync(appRoot);
    fs.writeFileSync(path.join(appRoot, 'product.json'), '{"dataFolderName":".windsurf"}');
    for (const folder of ['.windsurf', '.antigravity', '.antigravity-ide']) {
        fs.mkdirSync(path.join(home, folder)); fs.writeFileSync(path.join(home, folder, 'argv.json'), '{}');
    }
    const options = { appName: 'Windsurf', appRoot, home, env: {}, port: 9444 };
    const fp = path.join(home, '.windsurf', 'argv.json');
    test('selects current product among multiple profiles on all platforms', () => {
        for (const platform of ['darwin', 'linux', 'win32']) assert.strictEqual(resolveArgvPath({ ...options, platform }), fp);
        assert.strictEqual(resolveArgvPath({ ...options, env: { VSCODE_PORTABLE: root } }), path.join(root, 'argv.json'));
        assert.strictEqual(resolveArgvPath({ argvPath: fp }), fp);
        assert.throws(() => resolveArgvPath({ argvPath: '../argv.json' }));
    });
    test('backs up original, preserves mode, returns no-op explicitly', () => {
        fs.chmodSync(fp, 0o640);
        const result = ensureCdpInArgv(options);
        assert(result.changed); assert.strictEqual(result.path, fp);
        assert.strictEqual(fs.readFileSync(result.backupPath, 'utf8'), '{}');
        assert.strictEqual(fs.statSync(fp).mode & 0o777, 0o640);
        assert.strictEqual(ensureCdpInArgv(options).changed, false);
        assert.strictEqual(fs.readFileSync(path.join(home, '.antigravity', 'argv.json'), 'utf8'), '{}');
    });
    test('invalid JSONC leaves original and backup unchanged', () => {
        fs.writeFileSync(fp, '{bad');
        assert.throws(() => ensureCdpInArgv(options));
        assert.strictEqual(fs.readFileSync(fp, 'utf8'), '{bad');
        assert.strictEqual(fs.readFileSync(fp + '.grav-backup', 'utf8'), '{}');
    });
    test('atomic commit failure preserves original and leaves no temp files', () => {
        fs.writeFileSync(fp, '{}');
        const rename = fs.renameSync;
        fs.renameSync = (from, to) => { if (to === fp) throw new Error('fault'); return rename(from, to); };
        try { assert.throws(() => ensureCdpInArgv(options), /fault/); }
        finally { fs.renameSync = rename; }
        assert.strictEqual(fs.readFileSync(fp, 'utf8'), '{}');
        assert(!fs.readdirSync(path.dirname(fp)).some(f => f.startsWith('.grav-argv-')));
    });
    test('target and backup symlinks including dangling links are rejected', () => {
        fs.unlinkSync(fp); fs.symlinkSync(path.join(root, 'missing'), fp);
        assert.throws(() => ensureCdpInArgv(options), /regular file/);
        fs.unlinkSync(fp); fs.writeFileSync(fp, '{}');
        fs.unlinkSync(fp + '.grav-backup'); fs.symlinkSync(path.join(root, 'missing'), fp + '.grav-backup');
        assert.throws(() => ensureCdpInArgv(options), /regular file/);
        assert.strictEqual(fs.readFileSync(fp, 'utf8'), '{}');
    });
} finally { fs.rmSync(root, { recursive: true, force: true }); }
console.log(`Results: ${passed} passed, 0 failed`);
