'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runSuite } = require('./run-all');
let passed = 0, failed = 0;
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'grav-runner-test-'));
function check(name, sources, status, totals) {
    const dir = fs.mkdtempSync(path.join(temp, 'suite-'));
    sources.forEach((source, i) => fs.writeFileSync(path.join(dir, `${i} space ' quote.test.js`), source));
    const log = console.log, output = [];
    console.log = (...args) => output.push(args.join(' '));
    try {
        const result = runSuite(dir);
        assert.strictEqual(result, status);
        assert(output.join('\n').includes(totals));
        passed++;
    } catch (error) { failed++; console.error(`${name}: ${error.message}`); }
    finally { console.log = log; }
}
try {
    check('valid summary', ["console.log('Results: 3 passed, 0 failed')"], 0, 'Total: 3 passed, 0 failed; 0 infrastructure failures');
    check('failure counts retained', ["console.log('Results: 7 passed, 2 failed'); process.exit(1)", "console.log('Results: 3 passed, 0 failed')"], 1, 'Total: 10 passed, 2 failed; 0 infrastructure failures');
    check('zero exit with failed assertions', ["console.log('Results: 2 passed, 3 failed')"], 1, 'Total: 2 passed, 3 failed; 0 infrastructure failures');
    check('missing summary', ["console.log('looks good')"], 1, 'Total: 0 passed, 0 failed; 1 infrastructure failures');
    check('empty summary', ["console.log('Results: 0 passed, 0 failed')"], 1, '1 infrastructure failures');
    check('ambiguous summary', ["console.log('Results: 2 passed, 0 failed\\nResults: 2 passed, 0 failed')"], 1, '1 infrastructure failures');
    check('crash after summary retains counts', ["console.log('Results: 4 passed, 0 failed'); throw Error('crash')"], 1, 'Total: 4 passed, 0 failed; 1 infrastructure failures');
    check('empty suite', [], 1, '1 infrastructure failures');
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
console.log(`Results: ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
