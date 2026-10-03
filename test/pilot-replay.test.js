'use strict';
const assert=require('assert/strict');
const {report}=require('../scripts/replay-pilot');
let passed=0,failed=0;
const data=report();
for(const [name,fn] of [
    ['Same labeled opportunities and handled approvals',()=>{assert.equal(data.event.labeledOpportunities,data.fixed.labeledOpportunities);assert.equal(data.event.handledLegitimateApprovals,4);assert.equal(data.fixed.handledLegitimateApprovals,4);}],
    ['No duplicate or false approval in this fixture; outcomes remain unknown',()=>{for(const r of [data.fixed,data.event]){assert.equal(r.duplicateAttempts,0);assert.equal(r.falseAutoapprovals,0);assert.equal(r.unknownOutcomes,4);}}],
    ['Scheduler reduces scans while preserving fixture latency bound',()=>{assert(data.event.scans<data.fixed.scans);assert(data.event.wakeups<data.fixed.wakeups);assert(data.event.latencyMs.p95<=data.fixed.latencyMs.p95);}],
]){try{fn();passed++;}catch(e){failed++;console.error(name,e);}}
console.log(`Results: ${passed} passed, ${failed} failed`);process.exitCode=failed?1:0;
