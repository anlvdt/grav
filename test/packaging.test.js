'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const yazl = require('yazl');
const { verifyVsix } = require('../scripts/verify-vsix');
const pkg = require('../package.json');
const lock = require('../package-lock.json');
let passed = 0, failed = 0;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'grav-package-test-'));
async function check(name, fn) {
    try { await fn(); passed++; }
    catch (error) { failed++; console.error(`${name}: ${error.stack}`); }
}
function fixture(name, change = {}) {
    const zip = new yazl.ZipFile();
    const entries = {
        'extension/package.json': JSON.stringify({ name: pkg.name, version: pkg.version, main: pkg.main, ...change.manifest }),
        'extension/node_modules/ws/package.json': JSON.stringify({ version: change.ws || lock.packages['node_modules/ws'].version }),
        ['extension/' + pkg.main.replace(/^\.\//, '')]: change.source === undefined ? fs.readFileSync(path.resolve(__dirname, '..', pkg.main), 'utf8') : change.source,
        'extension/node_modules/ws/index.js': 'module.exports = {};',
        'extension/node_modules/ws/lib/websocket.js': 'module.exports = {};',
    };
    if (change.remove) delete entries[change.remove];
    if (change.extra) entries[change.extra] = 'forbidden';
    Object.entries(entries).forEach(([entry, data]) => zip.addBuffer(Buffer.from(data), entry));
    zip.end();
    const file = path.join(temp, name + '.vsix');
    return new Promise((resolve, reject) => {
        zip.outputStream.pipe(fs.createWriteStream(file)).on('finish', () => resolve(file)).on('error', reject);
    });
}
async function main() {
    try {
        await check('valid runtime dependency', async () => {
            const result = await verifyVsix(await fixture('valid'));
            assert.strictEqual(result.wsVersion, lock.packages['node_modules/ws'].version);
        });
        await check('stale packaged source rejected', async () => assert.rejects(verifyVsix(await fixture('stale', { source: 'outdated source' })), /source differs from current workspace/));
        await check('old ws rejected', async () => assert.rejects(verifyVsix(await fixture('old', { ws: '8.20.0' })), /unsupported ws/));
        await check('missing ws rejected', async () => assert.rejects(verifyVsix(await fixture('missing', { remove: 'extension/node_modules/ws/package.json' })), /missing/));
        await check('missing runtime file rejected', async () => assert.rejects(verifyVsix(await fixture('runtime', { remove: 'extension/node_modules/ws/lib/websocket.js' })), /missing runtime/));
        await check('wrong release rejected', async () => assert.rejects(verifyVsix(await fixture('version', { manifest: { version: '0.0.0' } })), /manifest/));
        await check('non-lockfile dependency rejected', async () => assert.rejects(verifyVsix(await fixture('mismatch', { ws: '8.21.0' })), /lockfile/));
        await check('forbidden artifact entries rejected', async () => assert.rejects(verifyVsix(await fixture('forbidden', { extra: 'extension/scripts/private.js' })), /Refusing release/));
        for (const forbidden of ['openrouter-proxy.js', 'build.log', '.env.local', '.aws/credentials', '.codex/auth.json', 'server.key']) {
            await check(`credential/tool artifact rejected: ${forbidden}`, async () => assert.rejects(verifyVsix(await fixture('credential-' + passed, { extra: 'extension/' + forbidden })), /Refusing release/));
        }
        await check('existing artifact is never overwritten', async () => {
            const { packageVsix } = require('../scripts/package');
            const file = path.join(temp, 'existing.vsix');
            fs.writeFileSync(file, 'original artifact');
            await assert.rejects(packageVsix(file), /Refusing to overwrite/);
            assert.strictEqual(fs.readFileSync(file, 'utf8'), 'original artifact');
        });
        await check('corrupt artifact rejected', async () => {
            const file = path.join(temp, 'broken.vsix');
            fs.writeFileSync(file, 'not a zip');
            await assert.rejects(verifyVsix(file));
        });
        await check('root build wrapper propagates packaging failure', async () => {
            const mock = path.join(temp, 'failed-vsce.cjs');
            fs.writeFileSync(mock, "require('child_process').spawnSync = (cmd, args) => args.includes('ls') ? ({status: 0, stdout: 'extension/src/extension.js'}) : ({status: 1, stderr: 'fixture packaging failure'});");
            const result = spawnSync(process.execPath, ['--require', mock, path.resolve(__dirname, '../build-vsce.js'), '--out', path.join(temp, 'new-output.vsix')], { encoding: 'utf8' });
            assert.strictEqual(result.status, 1);
            assert.match(result.stderr, /fixture packaging failure/);
        });
        await check('successful tool without new artifact fails gate', async () => {
            const mock = path.join(temp, 'missing-artifact.cjs');
            fs.writeFileSync(mock, "require('child_process').spawnSync = () => ({status: 0, stdout: 'extension/src/extension.js'});");
            const result = spawnSync(process.execPath, ['--require', mock, path.resolve(__dirname, '../build-vsce.js'), '--out', path.join(temp, 'new-output.vsix')], { encoding: 'utf8' });
            assert.strictEqual(result.status, 1);
            assert.match(result.stderr, /ENOENT/);
        });
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
    console.log(`Results: ${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
