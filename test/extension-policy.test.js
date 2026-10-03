'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
let passed = 0, failed = 0;
function check(ok, label) { if (ok) passed++; else { failed++; console.error(label); } }
async function exercise(appName) {
    const commands = {}, settings = Object.fromEntries(Object.entries(require('../package.json').contributes.configuration.properties).map(([key,value]) => [key.slice(5), value.default]));
    const intervals = [], storage = {}, effects = [];
    let dashboardOptions, cdpOptions, executor = {connected:false}, terminalOptions, bridgeOptions, idle = true, panel, revokeOnExecute = false, addDiscovered = false;
    const noop = () => {}, disposable = { dispose: noop };
    const vscode = {
        env: { appName, appRoot: '/fixture' }, ConfigurationTarget: { Global: 1 }, StatusBarAlignment: { Right: 1 }, ThemeColor: class {}, RelativePattern: class {},
        workspace: { workspaceFolders: [], getConfiguration: () => ({get: (k,d) => settings[k] ?? d, update: async(k,v) => {settings[k]=v;} }), onDidChangeConfiguration: () => disposable },
        window: { createStatusBarItem: () => ({show:noop,hide:noop,dispose:noop}), showInformationMessage: async message=>addDiscovered && message.includes('Discovered:') ? 'Add to auto-click' : null, showWarningMessage:async()=>null },
        commands: {getCommands:async()=>['workbench.action.chat.applyAll'],executeCommand:async c=>{effects.push(c);if(revokeOnExecute)settings.approvePatterns=[];},registerCommand:(name,fn)=>{commands[name]=fn;return disposable;} }
    };
    const utils = {cfg:(k,d)=>settings[k]??d};
    const constants = require('../src/constants');
    const configModule = { getEffectiveConfig: () => ({enabled:settings.enabled,dryRun:settings.dryRun,approvePatterns:settings.approvePatterns,terminalBlacklist:settings.terminalBlacklist,autoScroll:settings.autoScroll}),setProjectProvider:noop, withPolicyVersion: config => ({...config,policyVersion:JSON.stringify(config)}) };
    const cdp = {init:opts=>{cdpOptions=opts;},isConnected:()=>false,getSessionCount:()=>0,getRuntimeState:()=>executor,hotUpdate:noop,disconnect:async()=>{},resetStats:noop};
    const learner = {init:noop,purgeBadEntries:()=>0,flush:noop};
    const modules = {
        vscode, './utils':utils,'./constants':constants,'./configuration':configModule,'./cdp':cdp,
        './injection':{isInjected:()=>true,hotUpdateRuntime:noop,writeRuntimeConfig:noop,patchChecksums:noop},
        './learning':learner,'./wiki':{init:noop,flush:noop},'./bridge':{start:(ctx,opts)=>{bridgeOptions=opts;},stop:noop},
        './terminal':{setup:(ctx,l,opts)=>{terminalOptions=opts;}},
        './dashboard':{postMessage:noop,getPanel:()=>panel,toggle:(ctx,opts)=>{dashboardOptions=opts;}},
        './roi':{init:noop,flush:noop,recordClick:p=>effects.push('roi:'+p)},
        './idle':{init:noop,isIdle:()=>idle,stop:noop},'./argv':{ensureCdpInArgv:()=>false},
    };
    const sandbox = { module:{exports:{}},require:id=>id in modules?modules[id]:require(id.startsWith('./')?path.resolve(__dirname,'../src',id):id),console:{log:noop,warn:noop,error:noop},setTimeout:noop,setInterval:fn=>{intervals.push(fn);return fn;},clearInterval:noop };
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../src/extension.js'),'utf8'),sandbox);
    const ctx={extensionPath:path.resolve(__dirname,'..'),extension:{packageJSON:{version:'fixture'}},subscriptions:[],globalState:{get:(k,d)=>storage[k]??d,update:async(k,v)=>{storage[k]=v;}}};
    await sandbox.module.exports.activate(ctx);
    check(!!commands['grav.dashboard'],appName+' registers dashboard');
    check(bridgeOptions.getState().runtime.status==='disconnected','socket unavailable is disconnected');
    settings.dryRun=true;check(bridgeOptions.getState().runtime.status==='dry-run','dry-run outranks disconnected');
    await commands['grav.acceptAll']();check(effects.length===0,'dry-run prevents native execution');
    settings.dryRun=false;await commands['grav.pauseAccept']();check(bridgeOptions.getState().runtime.reasonCode==='manual-pause','manual pause reason');await commands['grav.acceptAll']();check(effects.length===0,'pause prevents native execution');
    if(cdpOptions) check(cdpOptions.getPolicy().paused,'CDP receives paused state');
    await commands['grav.resumeAccept']();idle=false;check(bridgeOptions.getState().runtime.reasonCode==='typing','typing reason');await commands['grav.acceptAll']();check(effects.length===0,'typing prevents native execution');
    idle=true;settings.enabled=false;check(bridgeOptions.getState().runtime.status==='off','off outranks pauses');await commands['grav.acceptAll']();check(effects.length===0,'off prevents native execution');
    settings.enabled=true;panel={visible:true};check(bridgeOptions.getState().runtime.reasonCode==='dashboard','dashboard reason');await commands['grav.acceptAll']();check(effects.length===0,'dashboard prevents native execution');panel=null;
    settings.approvePatterns=[]; await commands['grav.acceptAll'](); check(effects.length===0,'disabled approval patterns prevent native execution');
    settings.approvePatterns=['Accept All']; await commands['grav.acceptAll'](); check(effects.length===1 && effects[0]==='workbench.action.chat.applyAll','enabled policy executes known edit approval once'); effects.length=0;
    settings.approvePatterns=['Accept','Accept All']; revokeOnExecute=true; await commands['grav.acceptAll'](); check(effects.length===1,'label revocation after await cancels remaining native commands'); effects.length=0; revokeOnExecute=false;
    settings.approvePatterns=['Accept All']; addDiscovered=true; bridgeOptions.onPatternsDiscovered(['Dummy']); await new Promise(resolve=>setImmediate(resolve));
    check(settings.presetMode==='custom' && settings.operationMode==='custom' && settings.approvePatterns.includes('Dummy') && settings.approvePatterns.includes('Accept All'),'discovery Add preserves effective policy and switches to custom'); addDiscovered=false;
    if(cdpOptions) {
        executor={connected:true};check(bridgeOptions.getState().runtime.status==='unknown','open socket is not ready');
        executor={connected:true,verified:true,policyVersion:cdpOptions.getPolicy().policyVersion,expiresAt:Date.now()+1000};
        check(bridgeOptions.getState().runtime.status==='ready','verified current leased executor is ready');
        executor.expiresAt=0;check(bridgeOptions.getState().runtime.status==='unknown','expired executor cannot be ready');
        cdpOptions.onClicked({dryRun:true,p:'Accept'});check(effects.length===0,'dry-run does not record ROI');
        cdpOptions.onClicked({p:'Accept',b:'Accept'});check(storage.stats.Accept===1 && storage.totalClicks===1,'CDP persists real clicks');
    }
    await commands['grav.dashboard']();
    const newest=dashboardOptions.getTraceSnapshot().trace[0];
    const feedback=dashboardOptions.recordFeedback('falseNegative',{traceId:newest.id});
    check(feedback.relatedTraceId===newest.id,'dashboard callback returns explicit feedback selection');
    let rejected=false;try{dashboardOptions.recordFeedback('falsePositive',{traceId:'trace-missing'});}catch(e){rejected=true;}check(rejected,'dashboard callback rejects supplied missing ID');
    check(newest.outcome==='attempted' || newest.outcome==='unknown','trace exposes honest outcome');
    await sandbox.module.exports.deactivate();check(!terminalOptions.getPolicy().enabled,'deactivate disables policy for pending actions');
}
(async()=>{try{await exercise('Antigravity');await exercise('Visual Studio Code');}catch(e){failed++;console.error(e);}console.log(`Results: ${passed} passed, ${failed} failed`);process.exitCode=failed?1:0;})();
