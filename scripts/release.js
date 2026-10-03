#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { packageVsix, parseOutputPath } = require('./package');
const pkg = require('../package.json');

async function release() {
    console.log(`\n== Grav release ${pkg.version} ==\n`);
    const tests = spawnSync(process.execPath, [path.resolve(__dirname, '../test/run-all.js')], { stdio: 'inherit' });
    if (tests.error || tests.status !== 0) throw new Error('Tests failed; refusing release');
    const artifact = await packageVsix(parseOutputPath(process.argv.slice(2)));
    const digest = crypto.createHash('sha256').update(fs.readFileSync(artifact)).digest('hex');
    console.log(`\nVSIX   ${path.basename(artifact)}\nBytes  ${fs.statSync(artifact).size}\nSHA256 ${digest}`);
}

release().catch(error => { console.error(error.message); process.exitCode = 1; });
