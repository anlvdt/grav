#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { checkTree, verifyVsix, additionalIgnores } = require('./verify-vsix');
const root = path.resolve(__dirname, '..');
const pkg = require('../package.json');
const tempRoot = path.join(root, '.cache', 'packaging');
fs.mkdirSync(tempRoot, { recursive: true });

function runVsce(args, capture = false) {
    const installed = require('@vscode/vsce/package.json').version;
    if (installed !== pkg.devDependencies['@vscode/vsce']) throw new Error('Installed vsce does not match the exact manifest pin; run npm ci');
    const temp = fs.mkdtempSync(path.join(tempRoot, 'grav-vsce-ignore-'));
    try {
        const ignoreFile = path.join(temp, '.vscodeignore');
        fs.writeFileSync(ignoreFile, fs.readFileSync(path.join(root, '.vscodeignore'), 'utf8') + '\n' + additionalIgnores.join('\n') + '\n');
        const result = spawnSync(process.execPath, [require.resolve('@vscode/vsce/vsce'), ...args, '--ignoreFile', ignoreFile], {
            cwd: root, encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
        });
        if (result.error || result.status !== 0) throw new Error(`vsce ${args.join(' ')} failed: ${result.error || result.stderr || result.status}`);
        return result.stdout || '';
    } finally {
        fs.rmSync(temp, { recursive: true, force: true });
    }
}

function checkPackage() {
    const tree = runVsce(['ls', '--tree'], true);
    checkTree(tree);
    console.log(tree.trim());
}

async function packageVsix(outputPath) {
    const fileName = `${pkg.name}-${pkg.version}.vsix`;
    const destination = outputPath ? path.resolve(outputPath) : path.join(root, fileName);
    if (fs.existsSync(destination)) throw new Error(`Refusing to overwrite existing VSIX: ${destination}; use --out with a new path`);
    checkPackage();
    const temp = fs.mkdtempSync(path.join(tempRoot, 'grav-vsix-'));
    const temporaryArtifact = path.join(temp, fileName);
    try {
        runVsce(['package', '--out', temporaryArtifact]);
        const result = await verifyVsix(temporaryArtifact);
        fs.copyFileSync(temporaryArtifact, destination, fs.constants.COPYFILE_EXCL);
        console.log(`Verified ${destination}: ws ${result.wsVersion}, ${result.entries} entries; ${Object.keys(result.sourceHashes).length} source hashes match current workspace`);
        return destination;
    } finally {
        fs.rmSync(temp, { recursive: true, force: true });
    }
}

if (require.main === module) {
    Promise.resolve().then(() => {
        if (process.argv[2] === '--check' && process.argv.length === 3) return checkPackage();
        return packageVsix(parseOutputPath(process.argv.slice(2)));
    }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
function parseOutputPath(args) {
    if (!args.length) return undefined;
    if (args.length === 2 && args[0] === '--out' && args[1] && !args[1].startsWith('--')) return args[1];
    throw new Error('Usage: node scripts/package.js [--out <new-vsix-path> | --check]');
}
module.exports = { packageVsix, checkPackage, parseOutputPath };
