'use strict';

const yauzl = require('yauzl');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const pkg = require('../package.json');
const lock = require('../package-lock.json');

const forbiddenEntries = [
    '.kluster/', '.github/', '.git/', '.vscode/', '.aws/', '.ssh/', '.codex/', '.agents/', '.agent/',
    '.env', '.npmrc', '.netrc', 'credentials/', 'credentials.json', 'secrets.json', '.pem', '.key', '.p12', '.pfx',
    'scratch/', 'scratch_', 'media/dashboard-mock.html', 'build-vsce.js', 'build.log', 'openrouter-proxy.js',
    'AGENTS.md', 'scripts/', 'test/', '.cache/', 'artifacts/', 'docs/p0-validation.md', 'docs/p1-p2-validation.md',
];
const additionalIgnores = [
    '.github/**', '.aws/**', '.ssh/**', '.codex/**', '.agents/**', '.agent/**', '**/.env*', '**/.npmrc', '**/.netrc',
    '**/credentials/**', '**/credentials.json', '**/secrets.json', '**/*.pem', '**/*.key', '**/*.p12', '**/*.pfx',
    'openrouter-proxy.js', 'build.log',
];
function checkTree(tree) {
    for (const forbidden of forbiddenEntries) {
        if (tree.includes(forbidden)) throw new Error(`Refusing release: VSIX contains "${forbidden}"`);
    }
}

function verifyContents(entries, manifest, ws) {
    checkTree(entries.join('\n'));
    if (manifest.name !== pkg.name || manifest.version !== pkg.version) throw new Error('VSIX manifest does not match this release');
    const main = 'extension/' + manifest.main.replace(/^\.\//, '');
    for (const required of [main, 'extension/node_modules/ws/index.js', 'extension/node_modules/ws/lib/websocket.js']) {
        if (!entries.includes(required)) throw new Error(`VSIX missing runtime file: ${required}`);
    }
    const version = /^8\.(\d+)\.(\d+)$/.exec(ws.version);
    if (!version || Number(version[1]) < 21) throw new Error(`VSIX contains unsupported ws ${ws.version}; require >=8.21.0 in 8.x`);
    if (ws.version !== lock.packages['node_modules/ws'].version) throw new Error('VSIX ws version does not match lockfile');
    return { wsVersion: ws.version, entries: entries.length };
}

function verifyVsix(filePath) {
    return new Promise((resolve, reject) => {
        yauzl.open(filePath, { lazyEntries: true }, (error, zip) => {
            if (error) return reject(error);
            const entries = [], metadata = {}, sourceHashes = {};
            const targets = new Set(['extension/package.json', 'extension/node_modules/ws/package.json']);
            const fail = err => { zip.close(); reject(err); };
            zip.on('error', fail);
            zip.on('entry', entry => {
                if (entries.includes(entry.fileName)) return fail(new Error(`Duplicate VSIX entry: ${entry.fileName}`));
                entries.push(entry.fileName);
                const source = /^extension\/(?:src|media|icons)\//.test(entry.fileName) && !entry.fileName.endsWith('/');
                if (!targets.has(entry.fileName) && !source) return zip.readEntry();
                if (entry.uncompressedSize > 1024 * 1024) return fail(new Error('Oversized VSIX metadata or source'));
                zip.openReadStream(entry, (err, stream) => {
                    if (err) return fail(err);
                    const chunks = [];
                    stream.on('error', fail);
                    stream.on('data', chunk => chunks.push(chunk));
                    stream.on('end', () => {
                        try {
                            const contents = Buffer.concat(chunks);
                            if (source) sourceHashes[entry.fileName] = crypto.createHash('sha256').update(contents).digest('hex');
                            else metadata[entry.fileName] = JSON.parse(contents.toString('utf8'));
                        }
                        catch (parseError) { return fail(parseError); }
                        zip.readEntry();
                    });
                });
            });
            zip.on('end', () => {
                try {
                    const manifest = metadata['extension/package.json'], ws = metadata['extension/node_modules/ws/package.json'];
                    if (!manifest || !ws) throw new Error('VSIX missing extension or ws manifest');
                    const result = verifyContents(entries, manifest, ws);
                    for (const [entry, hash] of Object.entries(sourceHashes)) {
                        const file = path.resolve(__dirname, '..', entry.slice('extension/'.length));
                        const current = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
                        if (hash !== current) throw new Error(`VSIX source differs from current workspace: ${entry}`);
                    }
                    resolve({ ...result, sourceHashes });
                } catch (err) { reject(err); }
            });
            zip.readEntry();
        });
    });
}

if (require.main === module) {
    verifyVsix(process.argv[2]).then(result => {
        console.log(`Verified VSIX: ws ${result.wsVersion}, ${result.entries} entries; ${Object.keys(result.sourceHashes).length} source hashes match current workspace`);
        if (process.argv.includes('--hashes')) console.log(JSON.stringify(result.sourceHashes, null, 2));
    }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { checkTree, verifyContents, verifyVsix, additionalIgnores };
