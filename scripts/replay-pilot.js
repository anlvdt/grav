'use strict';
// Deterministic renderer replay. This executes the real CDP renderer in a synthetic
// DOM/clock. It never connects to a host or treats a UI change as command success.
const fs=require('fs'),path=require('path'),vm=require('vm');
const { fixture }=require('../test/fixtures/renderer');
const { buildObserverScript }=require('../src/cdp-observer');
const { summarizePilot }=require('../src/pilot-metrics');
const fixtureData=require('../test/fixtures/pilot-v1.json');
function replay(eventScheduler) {
    const policy={enabled:true,paused:false,dryRun:false,policyVersion:'pilot-policy-v1',patterns:['Run'],blacklist:[],builtInGrants:[],terminalWhitelist:['tool status'],permissionRules:[{id:'pilot-rule',effect:'allow',match:'prefix',scope:'user',argv:['tool','status'],expiresAt:null}],permissionProfile:'terminal',eventScheduler,approveMs:100,scrollEnabled:false};
    const targets=new Map(),attempts=[],opportunities=new Map();
    for(const id of ['a','b']){
        const f=fixture();f.context.console.log=message=>{
            if(!String(message).startsWith('[GRAV:CLICK]'))return;
            const data=JSON.parse(message.slice('[GRAV:CLICK] '.length));
            attempts.push({target:id,at:vm.runInContext('Date.now()',f.context)-100000,...data});
        };
        let script=buildObserverScript(policy.patterns,[],false,7000,false,false,policy);
        script=script.replace('function safeScanner() {','function safeScanner() { window.__pilotScans = (window.__pilotScans || 0) + 1;');
        vm.runInContext(script,f.context);targets.set(id,f);
    }
    let previous=0;
    for(const event of fixtureData.events){
        for(const f of targets.values()){
            // Renew the same policy lease without waking or changing scan cadence.
            for(let elapsed=previous;elapsed<event.at;){const step=Math.min(500,event.at-elapsed);f.window.__gravObserver.updateConfig(policy);f.advance(step);elapsed+=step;}
        }
        previous=event.at;const f=targets.get(event.target),button=f.button('Run',event.command);button.setAttribute('data-request-id',event.request);
        const click=button.click;button.click=()=>{click();button.disabled=true;};
        const key=event.target+':'+event.request;if(!opportunities.has(key))opportunities.set(key,event);
        if(eventScheduler)for(const observer of f.observers.filter(o=>o.active))observer.fn([{type:'attributes',attributeName:'disabled'}]);
    }
    for(const f of targets.values())for(let elapsed=previous;elapsed<fixtureData.durationMs;){const step=Math.min(500,fixtureData.durationMs-elapsed);f.window.__gravObserver.updateConfig(policy);f.advance(step);elapsed+=step;}
    const rows=[...opportunities].flatMap(([id,event])=>{
        const hits=attempts.filter(a=>a.target===event.target&&a.intentId.startsWith('data-request-id:'+event.request+':'));
        return hits.length?hits.map(a=>({intentId:id,legitimate:event.legitimate,attempted:true,outcome:'unknown',latencyMs:a.at-event.at})):[{intentId:id,legitimate:event.legitimate,attempted:false,outcome:'unknown'}];
    });
    const scans=[...targets.values()].reduce((n,f)=>n+(f.window.__pilotScans||0),0);
    const wakeups=[...targets.values()].reduce((n,f)=>n+f.getWakeups(),0);
    for(const f of targets.values())f.window.__gravObserver.dispose();
    return {mode:eventScheduler?'events-and-watchdog':'fixed-polling',scans,wakeups,...summarizePilot(rows,{policyVersion:policy.policyVersion,adapterVersion:'adapter-v1',fixtureVersion:fixtureData.version,synthetic:true})};
}
function report(){return {fixed:replay(false),event:replay(true),limits:'Synthetic replay of CDP renderer, not a host pilot or production latency measurement. Thresholds require live observe-first calibration.'};}
if(require.main===module){const result=report();const destination=path.resolve(__dirname,'../artifacts/p1-p2-replay.json');fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));}
module.exports={replay,report};
