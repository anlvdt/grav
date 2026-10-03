'use strict';

let _passed = 0, _failed = 0;
function assert(condition, msg) {
    if (condition) { _passed++; }
    else { _failed++; console.error(`  x FAIL: ${msg}`); }
}
function section(name) { console.log(`\n── ${name} ──`); }

const { createObservabilityState } = require('../src/observability');

section('Decision trace');
const obs = createObservabilityState();
const blocked = obs.push({ source: 'cdp', action: 'blocked', cmd: 'rm -rf /tmp', reason: 'rm -rf /' });
const clicked = obs.push({ source: 'cdp', action: 'clicked', label: 'Accept All', pattern: 'Accept All' });
const snap = obs.snapshot();
assert(snap.trace.length === 2, 'trace stores pushed events');
assert(snap.lastBlocked && snap.lastBlocked.id === blocked.id, 'lastBlocked tracks latest blocked event');
assert(snap.lastClicked && snap.lastClicked.id === clicked.id, 'lastClicked tracks latest click attempt');

section('Feedback recording');
obs.recordFeedback('falsePositive', { reason: 'manual feedback' });
obs.recordFeedback('falseNegative', { reason: 'manual feedback' });
const afterFeedback = obs.snapshot();
assert(afterFeedback.feedback.falsePositive === 1, 'false positive count increments');
assert(afterFeedback.feedback.falseNegative === 1, 'false negative count increments');
assert(afterFeedback.trace[0].source === 'feedback', 'feedback is also visible in trace');

section('Persistence shape');
const exported = obs.exportState();
assert(Array.isArray(exported.trace), 'exported trace is array');
assert(exported.feedback && typeof exported.feedback.falsePositive === 'number', 'feedback summary is exported');

section('Explicit feedback selection and decision metadata');
const decision = {decision:'allow',reasonCode:'legacy-broad-grant',reason:'Legacy broad grant',matchedRules:[{type:'legacy-broad-grant',pattern:'git'}],scope:{type:'legacy-broad-grant'},policyVersion:'p0-fixture'};
const attempted=obs.push({...decision,action:'clicked',cmd:'git status'});
assert(attempted.outcome==='attempted','click means attempted, never execution success');
assert(attempted.decision==='allow' && attempted.policyVersion==='p0-fixture','trace retains decision and version');
const chosen=obs.recordFeedback('falseNegative',{traceId:blocked.id});
assert(chosen.relatedTraceId===blocked.id && chosen.cmd===blocked.cmd,'explicit trace ID selects intended older event');
const restored=createObservabilityState(obs.exportState());
assert(restored.snapshot().trace.some(t=>t.id===attempted.id),'restore retains trace IDs');
const chosenAttempt=restored.recordFeedback('falsePositive',{traceId:attempted.id});
assert(chosenAttempt.policyVersion===attempted.policyVersion && chosenAttempt.relatedTraceId===attempted.id,'feedback copies selected decision metadata');
for(const traceId of ['trace-missing','',undefined,42]) {
    const before=JSON.stringify(restored.exportState());let threw=false;
    try { restored.recordFeedback('falsePositive',{traceId}); } catch(e) { threw=/traceId/.test(e.message); }
    assert(threw,'missing or invalid explicit trace ID rejected');assert(JSON.stringify(restored.exportState())===before,'bad ID has no side effects');
}
for(let i=0;i<65;i++)restored.push({action:'info'});
let expired=false;try{restored.recordFeedback('falseNegative',{traceId:attempted.id});}catch(e){expired=/expired/.test(e.message);}
assert(expired,'evicted supplied ID rejected even if lastClicked still references it');
assert(restored.push({action:'dry-run',dryRun:true}).outcome==='unknown','dry-run outcome unknown');

console.log(`\n${'═'.repeat(40)}`);
console.log(`Results: ${_passed} passed, ${_failed} failed`);
process.exit(_failed > 0 ? 1 : 0);
