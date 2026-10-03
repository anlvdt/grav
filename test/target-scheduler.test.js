'use strict';
const assert = require('assert/strict');
const { runTargets } = require('../src/event-scheduler');
let passed=0,failed=0;
(async()=>{
    let release,active=0,max=0;const visited=[];
    const blocked=new Promise(resolve=>{release=resolve;});
    const work=runTargets([0,1,2,3,4,5],async target=>{active++;max=Math.max(max,active);if(target===0)await blocked;else{visited.push(target);await Promise.resolve();}active--;if(target===1)throw new Error('bad target');},2);
    await new Promise(resolve=>setImmediate(resolve));
    try{assert.deepEqual(visited,[1,2,3,4,5]);passed++;}catch(e){failed++;console.error('Healthy targets are not blocked by stalled/failed targets',e);}
    release();await work;
    try{assert.equal(max,2);assert.equal(active,0);passed++;}catch(e){failed++;console.error('Target concurrency bounded',e);}
    console.log(`Results: ${passed} passed, ${failed} failed`);process.exitCode=failed?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});
