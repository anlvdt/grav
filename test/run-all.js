#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const tempRoot = path.resolve(__dirname, '../.cache/test-tmp');
fs.mkdirSync(tempRoot, { recursive: true });
process.env.TMPDIR = tempRoot;
process.env.TMP = tempRoot;
process.env.TEMP = tempRoot;

function runSuite(testDir = __dirname) {
    const files = fs.readdirSync(testDir).filter(f => f.endsWith('.test.js')).sort();
    console.log(`\nGrav Test Suite — ${files.length} test files\n`);
    let totalPassed = 0, totalFailed = 0, infrastructureFailed = files.length ? 0 : 1;
    for (const file of files) {
        const result = spawnSync(process.execPath, [path.join(testDir, file)], { encoding: 'utf8', timeout: 10000 });
        const output = result.stdout || '';
        const summaries = [...output.matchAll(/^Results: (\d+) passed, (\d+) failed\s*$/gm)];
        const match = summaries[0];
        const valid = summaries.length === 1 && Number(match[1]) + Number(match[2]) > 0;
        const passed = valid ? Number(match[1]) : 0, failed = valid ? Number(match[2]) : 0;
        totalPassed += passed;
        totalFailed += failed;
        const infrastructureError = result.error || !valid || result.status === null || (result.status !== 0 && failed === 0);
        if (infrastructureError) {
            infrastructureFailed++;
            console.log(`  x ${file}: ${result.error || (!valid ? 'missing, empty or ambiguous summary' : 'CRASHED')}`);
        } else {
            console.log(`  ${failed ? 'x' : 'v'} ${file}: ${passed} passed, ${failed} failed`);
        }
        if (infrastructureError || failed) {
            console.log(output.trim());
            if (result.stderr) console.log(result.stderr.trim());
        }
    }
    console.log(`\nTotal: ${totalPassed} passed, ${totalFailed} failed; ${infrastructureFailed} infrastructure failures\n`);
    return totalFailed > 0 || infrastructureFailed > 0 ? 1 : 0;
}

if (require.main === module) process.exit(runSuite());
module.exports = { runSuite };
