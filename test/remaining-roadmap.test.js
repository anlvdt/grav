'use strict';
const assert = require('assert/strict'), fs = require('fs'), vm = require('vm');
const Policy = require('../src/action-policy');
const { createCoordinator } = require('../src/intent-ledger');
const { createEventScheduler } = require('../src/event-scheduler');
const { validateRule, activeRules, preview } = require('../src/permission-rules');
const { capabilityManifest } = require('../src/capabilities');
const { summarizePilot } = require('../src/pilot-metrics');
const { redact } = require('../src/redaction');
const { createObservabilityState } = require('../src/observability');
const { fixture } = require('./fixtures/renderer');
const { buildObserverScript } = require('../src/cdp-observer');
let passed = 0, failed = 0;
function check(name, fn) { try { fn(); passed++; } catch(e) { failed++; console.error(name, e); } }
const policy = { enabled: true, paused: false, dryRun: false, policyVersion: 'p1-fixture', patterns: ['Run','Accept'], terminalWhitelist: ['tool status'], builtInGrants: [], blacklist: [], permissionRules:[{id:'pilot-rule',effect:'allow',match:'prefix',scope:'user',argv:['tool','status'],expiresAt:null}], permissionProfile: 'terminal', workspace: '/fixture', eventScheduler: true, approveMs: 100, scrollMs: 500 };
const intent = { key: 'target-a:prompt-1', payload: 'tool status', evidence: 'host-attribute' };
check('Takeover fences old owner before any side effect', () => {
    const root = {}, old = createCoordinator(root,'old'), first = old.claim(intent,'v1');
    const next = createCoordinator(root,'new');
    assert(!old.valid(first.entry,intent,'v1'));
    const claim = next.claim(intent,'v1'); assert(claim.ok); assert(next.valid(claim.entry,intent,'v1'));
    next.attempted(claim.entry); assert(!createCoordinator(root,'third').claim(intent,'v1').ok);
});
check('Revoke/payload changes cannot execute a pending intent', () => {
    const ledger = createCoordinator({},'a'), entry = ledger.claim(intent,'v1').entry;
    assert(!ledger.valid(entry,intent,'v2')); assert(!ledger.valid(entry,{...intent,payload:'tool deploy'},'v1'));
    ledger.cancelPending(); assert(!ledger.valid(entry,intent,'v1'));
});
check('Unknown outcomes survive expiry, takeover and Resume', () => {
    let now=1; const root={}, ledger=createCoordinator(root,'a',{now:()=>now,ttl:10});
    const entry=ledger.claim(intent,'v1').entry;ledger.attempted(entry);now=20;
    assert.equal(ledger.snapshot().unresolved,1);assert.equal(entry.payload,undefined);
    ledger.resume(1);assert(!ledger.claim(intent,'v1').ok);
});
check('Target budgets are bounded and isolated', () => {
    const a=createCoordinator({},'a',{max:1}), b=createCoordinator({},'b');
    a.claim(intent,'v1');assert.equal(a.claim({...intent,key:'next'},'v1').reasonCode,'intent-budget');assert(b.claim(intent,'v1').ok);
});
check('No-progress breaker and explicit Resume retain unknown tombstones', () => {
    const a=createCoordinator({},'a');
    for(let i=0;i<3;i++){const e=a.claim({...intent,key:String(i)},'v1').entry;a.attempted(e);a.postcondition(e,{isConnected:true,disabled:false});}
    assert.equal(a.snapshot().reasonCode,'no-progress');a.resume('operator-1');assert.equal(a.snapshot().reasonCode,null);assert(!a.claim({...intent,key:'0'},'v1').ok);
});
check('Approval UI change is not completion evidence', () => {
    const a=createCoordinator({},'a'),e=a.claim(intent,'v1').entry;a.attempted(e);a.postcondition(e,{isConnected:false});
    assert.equal(e.postcondition,'approval-ui-changed');assert.equal(e.outcome,'unknown');
});
check('Event storms coalesce without starvation; pause cancels pending work', () => {
    let scheduled, runs=0, clears=0;
    const q=createEventScheduler(()=>runs++,{delay:50,setTimeout:fn=>{scheduled=fn;return 1;},clearTimeout:()=>{scheduled=null;clears++;}});
    for(let i=0;i<100;i++)q.trigger();assert.equal(q.snapshot().coalesced,99);scheduled();assert.equal(runs,1);
    q.trigger();q.cancel();assert.equal(clears,1);assert.equal(scheduled,null);q.resume();q.trigger();scheduled();assert.equal(runs,2);
});
const runtimeSource = fs.readFileSync(require.resolve('../media/runtime.js'),'utf8').replace('/*{{ACTION_POLICY}}*/null',()=>Policy.browserSource);
function renderer(kind,f) {
    if(kind==='cdp')vm.runInContext(buildObserverScript(policy.patterns,[],false,7000,false,false,policy),f.context);
    else {vm.runInContext(runtimeSource,f.context);const x=f.requests.find(x=>x.method==='GET');x.status=200;x.responseText=JSON.stringify(policy);x.onload();}
}
for(const kind of ['cdp','runtime']) {
    check(kind+' remount same request once, new request same text separately',()=>{
        const f=fixture(), first=f.button('Run','tool status');first.setAttribute('data-request-id','r-1');renderer(kind,f);f.advance(1200);
        assert.equal(first.calls,1);
        const remount=f.button('Run','tool status');remount.setAttribute('data-request-id','r-1');f.advance(200);assert.equal(remount.calls,0);
        const next=f.button('Run','tool status');next.setAttribute('data-request-id','r-2');f.advance(600);assert.equal(next.calls,1);
    });
    check(kind+' anonymous identical remount requires manual review',()=>{
        const f=fixture(),first=f.button('Run','tool status');renderer(kind,f);f.advance(1200);assert.equal(first.calls,1);
        const remount=f.button('Run','tool status');f.advance(600);assert.equal(remount.calls,0);
    });
    check(kind+' preserves P0 attempted markers during migration',()=>{
        const f=fixture(),b=f.button('Run','tool status');b.setAttribute('data-grav-clicked','true');renderer(kind,f);f.advance(1200);assert.equal(b.calls,0);
    });
    check(kind+' bounded batches drain candidates beyond the first 64',()=>{
        const f=fixture();for(let i=0;i<64;i++)f.button('Toolbar action '+i);const last=f.button('Run','tool status');renderer(kind,f);
        for(const observer of f.observers.filter(o=>o.active))observer.fn([{type:'attributes',attributeName:'disabled'}]);f.advance(500);assert.equal(last.calls,1);
    });
    check(kind+' independent target with same command is not suppressed',()=>{
        const a=fixture(),b=fixture(),one=a.button('Run','tool status'),two=b.button('Run','tool status');renderer(kind,a);renderer(kind,b);a.advance(1200);b.advance(1200);assert.equal(one.calls,1);assert.equal(two.calls,1);
    });
}
check('Shared document prevents runtime/CDP duplicate after takeover',()=>{
    const f=fixture(),b=f.button('Run','tool status');renderer('cdp',f);f.advance(1100);assert.equal(b.calls,1);
    renderer('runtime',f);const remount=f.button('Run','tool status');f.advance(600);assert.equal(remount.calls,0);
});
check('Runtime detach before delayed callback has no side effect',()=>{
    const f=fixture(),b=f.button('Run','tool status');renderer('runtime',f);f.advance(150);b.isConnected=false;f.advance(1000);assert.equal(b.calls,0);
});
const exact=validateRule({effect:'allow',match:'exact',scope:'project',command:'custom "status"',workspace:'/fixture',expiresAt:Date.now()+100000});
check('Exact/project/expiry rule and effective blacklist parity in both evaluators',()=>{
    const p={...policy,permissionRules:[exact]};
    for(const cmd of ['custom status','custom status --extra','custom statusx']){
        const expected=Policy.evaluateCommand(cmd,p),browser=vm.runInNewContext(Policy.browserSource);
        assert.deepEqual(JSON.parse(JSON.stringify(browser.evaluateCommand(cmd,p))),expected);
    }
    assert(Policy.evaluateCommand('custom status',p).allowed);assert(!Policy.evaluateCommand('custom status --extra',p).allowed);
    assert(!Policy.evaluateCommand('custom status',{...p,workspace:'/other'}).allowed);
    assert(!Policy.evaluateCommand('custom status',{...p,permissionRules:[{...exact,expiresAt:1}]}).allowed);
    assert.equal(Policy.evaluateCommand('custom status',{...p,blacklist:['custom status']}).decision,'deny');
});
check('Prefix preview shows additional argv only and explicit deny beats grants',()=>{
    const rule={...exact,match:'prefix'};const rows=preview(rule,['custom status -s','custom status-other'],policy);
    assert(rows[0].allowed);assert(!rows[1].allowed);
    assert.equal(Policy.evaluateCommand('tool status',{...policy,permissionRules:[{...exact,scope:'user',argv:['tool'],match:'prefix',effect:'deny'}]}).decision,'deny');
});
check('Session rules cannot be smuggled in persisted settings; invalid config fails closed',()=>{
    assert.equal(activeRules([{...exact,scope:'session'}],'/fixture').length,0);
    assert.equal(Policy.evaluateCommand('tool status',{...policy,permissionRules:activeRules([{}],'/fixture')}).decision,'manual');
});
check('Profiles remain independent of scan speed and unsupported browser/MCP scopes',()=>{
    for(const speed of [100,700,1800]){
        assert.equal(Policy.evaluateCommand('tool status',{...policy,permissionProfile:'edits',approveMs:speed}).decision,'manual');
        assert(Policy.evaluateCommand('tool status',{...policy,approveMs:speed}).allowed);
    }
    assert(!Policy.canAct({...policy,permissionProfile:'observe'}));
    assert(!Policy.evaluateCommand('git status',{...policy,builtInGrants:['git'],terminalWhitelist:['git']}).allowed);
    assert(Policy.evaluateCommand('git status',{...policy,permissionProfile:'legacy',builtInGrants:['git'],terminalWhitelist:['git']}).allowed);
    for(const actionKind of ['browser','mcp'])assert(!Policy.evaluateAction('Accept','',{...policy,actionKind}).allowed);
});
check('Pinned capability fixture never claims unsupported completion/write/identity',()=>{
    const fixture=JSON.parse(fs.readFileSync(require.resolve('./fixtures/adapter-v1.json'),'utf8'));
    const manifest=capabilityManifest({name:'fixture',cdpVerified:true});assert.equal(manifest.version,fixture.version);
    for(const adapter of manifest.adapters){assert.equal(adapter.completion,false);assert.equal(adapter.policyWrite,false);}
    assert.equal(manifest.adapters[2].identity,false);assert.equal(manifest.adapters[2].automatic,false);
});
check('Labeled denominator, duplicates, unknown outcomes and percentiles are honest',()=>{
    const report=summarizePilot([{intentId:'a',legitimate:true,attempted:true,latencyMs:10},{intentId:'a',legitimate:false,attempted:true,latencyMs:20},{intentId:'b',legitimate:true,attempted:false,intervention:true},{intentId:'c',attempted:false}],{fixture:'v1'});
    assert.equal(report.labeledOpportunities,3);assert.equal(report.legitimateOpportunities,2);assert.equal(report.handledLegitimateApprovals,1);assert.equal(report.falseAutoapprovals,1);assert.equal(report.duplicateAttempts,1);assert.equal(report.unknownOutcomes,2);assert.equal(report.latencyMs.p95,20);assert.equal(report.userInterventions,1);
});
check('Feedback labels the selected opportunity; bounded trace metadata survives',()=>{
    const obs=createObservabilityState(),a=obs.push({intentId:'r1',targetSessionId:'s1',adapterVersion:'adapter-v1',action:'clicked',cmd:'x'.repeat(9000)});
    const b=obs.push({action:'blocked'});obs.recordFeedback('falsePositive',{traceId:a.id});
    const trace=obs.snapshot().trace;assert.equal(trace.find(t=>t.id===a.id).reviewerLegitimate,false);assert.equal(trace.find(t=>t.id===b.id).reviewerLegitimate,undefined);assert.equal(a.cmd.length,2000);assert.equal(a.intentId,'r1');
});
check('Diagnostics and learning examples redact obvious credential payloads',()=>{
    const text=redact('curl https://name:pw@example.test --token=topsecret --password "hidden words" Authorization: Bearer abcdef');
    assert(!text.includes('topsecret'));assert(!text.includes('hidden words'));assert(!text.includes('name:pw'));assert(!text.includes('abcdef'));
});
console.log(`Results: ${passed} passed, ${failed} failed`);process.exitCode=failed?1:0;
