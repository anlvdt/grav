// ═══════════════════════════════════════════════════════════════
//  Grav — Unit Tests for learning.js
//  Run: node test/learning.test.js
// ═══════════════════════════════════════════════════════════════
'use strict';

let _passed = 0, _failed = 0;
function assert(condition, msg) {
    if (condition) { _passed++; }
    else { _failed++; console.error(`  x FAIL: ${msg}`); }
}
function section(name) { console.log(`\n── ${name} ──`); }

const config = {};
let promptResult = null, prompts = 0;
let pendingPick = null;
const promptOptions = [], policyWrites = [], commandCalls = [];

// Mock vscode
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
    if (request === 'vscode') return 'vscode';
    return origResolve.call(this, request, parent, isMain, options);
};
require.cache['vscode'] = {
    id: 'vscode', filename: 'vscode', loaded: true, exports: {
        env: { appRoot: '/mock' },
        workspace: {
            getConfiguration: () => ({
                get: (k, f) => config[k] === undefined ? f : config[k],
                update: async (k, v) => { policyWrites.push({k,v}); config[k] = v; },
            }),
            workspaceFolders: [{ name: 'test-project' }],
        },
        window: {
            showInformationMessage: async (message, ...options) => { prompts++; promptOptions.push(options); return pendingPick || promptResult; },
            showWarningMessage: async (message, ...options) => { promptOptions.push(options); return promptResult; },
        },
        commands: { executeCommand: async command => { commandCalls.push(command); } },
        ConfigurationTarget: { Global: 1 },
    }, children: [], paths: [],
};

const _store = {};
const mockCtx = {
    globalState: {
        get: (k, d) => _store[k] !== undefined ? _store[k] : d,
        update: (k, v) => { _store[k] = v; return Promise.resolve(); },
    },
};

// Mock wiki
const mockWiki = {
    ingest: () => { },
    query: () => null,
    getSequences: () => ({}),
};

const learning = require('../src/learning');

async function main() {
section('Init');
learning.init(mockCtx, mockWiki);
assert(learning.getEpoch() === 0, 'epoch starts at 0');
assert(Object.keys(learning.getData()).length === 0, 'empty learn data');

section('Standalone fallback snapshot without a policy provider');
const configuration = require('../src/configuration');
learning.setPolicyProvider(null);
for (const command of ['git reset --hard', 'git push --force', 'git clean -fdx', 'docker system prune -a --volumes', 'rm -rf /', 'env git reset --hard', '"git" "reset" "--hard"']) {
    const result = learning.evaluateCommand(command);
    assert(result.decision === 'deny' && !result.allowed, 'standalone default deny: ' + command);
    assert(result.policyVersion === configuration.getEffectiveConfig(mockCtx).policyVersion, 'standalone default deny uses authoritative version: ' + command);
}
const fallbackVersion = learning.evaluateCommand('git status').policyVersion;
configuration.setProjectProvider(() => ({blacklist:['git status']}));
learning.init(mockCtx, mockWiki);
const projectDeny = learning.evaluateCommand('git status');
assert(projectDeny.decision === 'deny', 'standalone init applies project blacklist');
assert(learning.evaluateCommand('git reset --hard').decision === 'deny', 'project blacklist cannot remove destructive defaults');
assert(projectDeny.policyVersion !== fallbackVersion && projectDeny.policyVersion === configuration.getEffectiveConfig(mockCtx).policyVersion, 'project rule refresh changes complete snapshot version');
configuration.setProjectProvider(() => ({}));
assert(learning.evaluateCommand('git status').allowed, 'project rule removal refreshes standalone evaluator');
const supplied = {policyVersion:'explicit-snapshot',blacklist:[],builtInGrants:['git'],terminalWhitelist:[]};
const suppliedBefore = JSON.stringify(supplied);
assert(learning.evaluateCommand('git reset --hard', supplied).allowed, 'explicit snapshot semantics are preserved without injecting fallback defaults');
assert(learning.evaluateCommand('git reset --hard', supplied).policyVersion === supplied.policyVersion, 'supplied version is preserved');
assert(JSON.stringify(supplied) === suppliedBefore, 'supplied snapshot is not mutated');
assert(learning.evaluateCommand('git status', null).decision === 'manual', 'explicit invalid snapshot does not fall back to grants');
learning.setPolicyProvider(() => supplied);
assert(learning.evaluateCommand('git reset --hard').policyVersion === supplied.policyVersion && learning.evaluateCommand('git reset --hard').allowed, 'provider semantics are preserved');
learning.setPolicyProvider(null);
assert(learning.evaluateCommand('git reset --hard').decision === 'deny', 'clearing provider restores complete fallback');

section('Record action');
learning.recordAction('npm install', 'approve', { source: 'user-approval', project: 'test' });
assert(learning.getEpoch() === 1, 'epoch incremented');
const data = learning.getData();
assert(data['npm'] !== undefined, 'npm tracked');
assert(data['npm'].obs === 1, 'obs = 1');
assert(data['npm'].conf > 0, 'confidence positive after approve');

section('Multiple approves increase confidence');
const confBefore = data['npm'].conf;
learning.recordAction('npm test', 'approve', { source: 'user-approval', project: 'test' });
learning.recordAction('npm run build', 'approve', { source: 'user-approval', project: 'test' });
assert(data['npm'].conf > confBefore, 'confidence increased');
assert(data['npm'].obs === 3, 'obs = 3');
assert(data['npm'].approvals === 3, 'approval threshold evidence counted separately');

section('Reject affects confidence');
// Record a fresh command with only rejects
learning.recordAction('dangerous-cmd', 'reject', { source: 'user-approval', project: 'test' });
learning.recordAction('dangerous-cmd', 'reject', { source: 'user-approval', project: 'test' });
learning.recordAction('dangerous-cmd', 'reject', { source: 'user-approval', project: 'test' });
const dangerData = data['dangerous-cmd'];
assert(dangerData !== undefined, 'dangerous-cmd tracked');
assert(dangerData.conf <= 0, 'confidence negative after only rejects');

section('Exit code affects reward');
learning.recordAction('git status', 'approve', { source: 'user-approval', exitCode: 0, project: 'test' });
const gitData = data['git'];
assert(gitData !== undefined, 'git tracked');
assert(gitData.conf > 0, 'git confidence positive with exit 0');

section('Evaluate command');
// npm should be whitelisted (in SAFE_TERMINAL_CMDS)
const result1 = learning.evaluateCommand('npm install');
assert(result1.allowed === true, 'npm allowed (whitelisted)');

const result2 = learning.evaluateCommand('rm -rf /');
assert(result2.allowed === false, 'rm -rf / blocked');

const result3 = learning.evaluateCommand('unknowncmd123');
assert(result3.allowed === false, 'unknown command blocked by default');
assert(result3.decision === 'manual' && !('confidence' in result3), 'unknown command is manual without probability');

section('Compound command evaluation');
const result4 = learning.evaluateCommand('npm install && git push');
assert(result4.decision === 'manual', 'compound syntax requires manual review');

const result5 = learning.evaluateCommand('npm install && rm -rf /');
assert(result5.allowed === false, 'npm && rm -rf / blocked');

section('Stats');
const stats = learning.getStats();
assert(stats.epoch > 0, 'stats has epoch');
assert(stats.totalTracked > 0, 'stats has tracked commands');
assert(Array.isArray(stats.commands), 'stats has commands array');

section('Promoted commands');
// With only a few observations, nothing should be promoted yet
const promoted = learning.getPromotedCommands();
assert(Array.isArray(promoted), 'promoted is array');

section('Execution provenance');
learning.recordObservation('telemetrytool', { exitCode: 0 });
learning.recordAction('telemetrytool', 'approve', { source: 'terminal-observation', exitCode: 0 });
learning.recordAction('telemetrytool', 'approve', { exitCode: 0 });
learning.recordAction('telemetrytool', 'reject', { source: 'terminal-observation', exitCode: 1 });
const observed = learning.getData().telemetrytool;
assert(observed.observations === 4, 'execution telemetry retained as neutral observations');
assert(observed.obs === 0 && !observed.approvals, 'execution events are not approval or rejection decisions');
assert(observed.conf === 0 && observed.velocity === 0, 'execution success does not increase confidence');
assert(!learning.getPromotedCommands().includes('telemetrytool'), 'execution events cannot meet promotion threshold');

section('Learning is advisory only');
const entry = (conf = 1, approvals = 50) => ({ conf, approvals, velocity: 0, obs: 50, rewards: [], history: [], contexts: {}, lastSeen: Date.now(), promoted: false, demoted: false });
data['customtool'] = entry();
assert(learning.getPromotedCommands().includes('customtool'), 'high confidence is a suggestion candidate');
assert(!learning.evaluateCommand('customtool deploy').allowed, 'statistical candidate cannot authorize');
data['positiveonly'] = entry(0.1);
assert(!learning.evaluateCommand('positiveonly').allowed, 'positive confidence cannot authorize');
mockWiki.query = () => ({ riskLevel: 'safe', totalEvents: 100, confidence: 1 });
assert(!learning.evaluateCommand('wikionly').allowed, 'safe wiki cannot authorize');
mockWiki.query = () => ({ riskLevel: 'caution', totalEvents: 100, confidence: 1 });
assert(!learning.evaluateCommand('wikionly').allowed, 'caution wiki cannot authorize');
mockWiki.query = () => null;
for (const cmd of ['family-one', 'family-two', 'family-three']) data[cmd] = entry();
learning.flush();
learning.init(mockCtx, mockWiki);
assert(learning.getPatternCache().includes('family'), 'generalized pattern fixture exists');
assert(!learning.evaluateCommand('family').allowed, 'generalized pattern cannot authorize');

section('Live policy and project blacklist');
config.terminalWhitelist = ['customtool'];
assert(learning.evaluateCommand('customtool').allowed, 'new explicit whitelist applies without init');
config.terminalWhitelist = [];
assert(!learning.evaluateCommand('customtool').allowed, 'whitelist removal applies without init');
config.terminalBlacklist = ['npm'];
assert(!learning.evaluateCommand('npm test').allowed, 'new blacklist overrides built-in whitelist');
const npmObs = learning.getData().npm.obs;
learning.recordAction('npm test', 'approve', { source: 'user-approval' });
assert(learning.getData().npm.obs === npmObs, 'blacklisted execution cannot create approval evidence');
config.terminalBlacklist = [];
let project = { blacklist: ['git'], dryRun: true };
configuration.setProjectProvider(() => project);
assert(!learning.evaluateCommand('git status').allowed, 'effective project blacklist applies');
const gitObs = learning.getData().git.obs;
learning.recordAction('git status', 'approve', { source: 'user-approval' });
assert(learning.getData().git.obs === gitObs, 'project blacklist applies to learner');
project = {};
assert(learning.evaluateCommand('git status').allowed, 'project blacklist removal applies immediately');

section('Threshold and explicit promotion decisions');
config.learnThreshold = 50;
learning.getData().thresholdtool = entry(1, 2);
const beforePrompts = prompts;
learning.recordAction('thresholdtool', 'approve', { source: 'user-approval' });
await new Promise(resolve => setImmediate(resolve));
assert(prompts === beforePrompts, 'high threshold prevents early suggestion');
config.learnThreshold = 3;
promptResult = 'Ignore';
learning.recordAction('thresholdtool', 'approve', { source: 'user-approval' });
await new Promise(resolve => setImmediate(resolve));
assert(prompts === beforePrompts + 1, 'threshold change applies without init');
assert(!learning.evaluateCommand('thresholdtool').allowed, 'Ignore keeps command outside whitelist');
promptResult = 'Add';
learning.recordAction('thresholdtool', 'approve', { source: 'user-approval' });
await new Promise(resolve => setImmediate(resolve));
assert(!learning.evaluateCommand('thresholdtool').allowed, 'learning suggestion never generates grant even if old Add response returned');
config.learnThreshold = 3;
learning.getData().boundarytool = entry(1, 2);
assert(!learning.getPromotedCommands().includes('boundarytool'), 'one below threshold is ineligible');
learning.getData().boundarytool.approvals = 3;
assert(learning.getPromotedCommands().includes('boundarytool'), 'exact approval threshold is eligible');
config.learnThreshold = 50;
learning.getData().rejectheavy = entry(1, 0);
assert(!learning.getPromotedCommands().includes('rejectheavy'), 'observations without approvals do not meet threshold');
config.learnThreshold = NaN;
learning.getData().fallbacktool = entry(1, 3);
assert(learning.getPromotedCommands().includes('fallbacktool'), 'invalid threshold uses manifest default');

section('Pending decision keeps policy current');
config.learnThreshold = 1;
learning.getData().pendingtool = entry();
let resolvePick;
pendingPick = new Promise(resolve => { resolvePick = resolve; });
learning.recordAction('pendingtool', 'approve', { source: 'user-approval' });
assert(!learning.evaluateCommand('pendingtool').allowed, 'pending suggestion cannot authorize');
config.terminalWhitelist = ['anotherexplicittool'];
resolvePick('Add');
await new Promise(resolve => setImmediate(resolve));
assert(config.terminalWhitelist.includes('anotherexplicittool'), 'Add preserves concurrent whitelist changes');
assert(!learning.evaluateCommand('pendingtool').allowed, 'resolved suggestion cannot generate authorization');
pendingPick = null;

section('Candidates remain actionable through Manage Terminal');
promptResult = 'Manage Terminal';
learning.getData().actionabletool = entry();
learning.recordAction('actionabletool', 'approve', {source:'user-approval'});
await new Promise(resolve => setImmediate(resolve));
assert(commandCalls.length === 1 && commandCalls[0] === 'grav.manageTerminal', 'candidate action opens existing Manage Terminal command');
learning.getData().reviewtool = entry(-1, 0);
learning.recordAction('reviewtool', 'reject', {source:'user-approval'});
await new Promise(resolve => setImmediate(resolve));
assert(commandCalls.length === 2 && commandCalls[1] === 'grav.manageTerminal', 'rejection suggestion also opens Manage Terminal');
assert(promptOptions.every(options => options.includes('Manage Terminal') && !options.includes('Add') && !options.includes('Blacklist')), 'P0 prompts intentionally route policy edits to Manage Terminal');
assert(policyWrites.length === 0, 'candidate prompts and navigation never write policy');
assert(!learning.evaluateCommand('actionabletool').allowed, 'opening policy management does not authorize candidate');
promptResult = null;

section('Shared evaluator parity');
const Policy=require('../src/action-policy');
config.terminalWhitelist=['customtool status'];
for(const command of ['customtool status -s','customtool statusx','npm test','git reset --hard','env git reset --hard','echo $HOME']) {
    const policy=configuration.getEffectiveConfig(mockCtx);
    assert(JSON.stringify(learning.evaluateCommand(command))===JSON.stringify(Policy.evaluateCommand(command,policy)), 'learner evaluator parity: '+command);
}
assert(learning.getStats().commands.every(c=>c.scoreLabel==='suggestion score'), 'learning exports suggestion score labels');
section('Provenance and automation labels');
learning.recordAction('automatedreject', 'reject', {source:'runtime'});
assert(learning.getData().automatedreject.observations === 1 && !learning.getData().automatedreject.rejections, 'automation rejection is an observation, never a human label');
learning.recordAction('humanexample status --token=topsecret', 'approve', {source:'user-approval'});
const evidence=learning.getStats().commands.find(c=>c.cmd==='humanexample').provenance;
assert(evidence.humanApprovals===1 && evidence.examples.some(e=>e.includes('status')), 'human evidence retains exact command examples and counts');
assert(!evidence.examples.join(' ').includes('topsecret'), 'learning example credentials redacted');
section('Flush');
learning.flush();
assert(_store['learnData'] !== undefined, 'learnData persisted');
assert(_store['learnEpoch'] !== undefined, 'learnEpoch persisted');

console.log(`\n${'═'.repeat(40)}`);
console.log(`Results: ${_passed} passed, ${_failed} failed`);
process.exit(_failed > 0 ? 1 : 0);

}
main().catch(error => { console.error(error); learning.flush(); process.exit(1); });
