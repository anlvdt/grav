'use strict';

const { packageVsix, parseOutputPath } = require('./scripts/package');
Promise.resolve().then(() => packageVsix(parseOutputPath(process.argv.slice(2)))).catch(error => {
    console.error(`Build failed: ${error.message}`);
    process.exitCode = 1;
});
