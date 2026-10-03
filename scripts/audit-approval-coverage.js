'use strict';
// Research probe: synthetic renderer fixtures only, never interacts with the host.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Policy = require('../src/action-policy');
const { DEFAULT_PATTERNS, RISKY_PATTERNS } = require('../src/constants');
const { buildObserverScript } = require('../src/cdp-observer');
const { fixture } = require('../test/fixtures/renderer');
const cases = [
    ['terminal-run', 'Run', 'tool status', 'tool status'],
    ['terminal-accept', 'Accept', 'tool status', 'tool status'],
    ['permission-command', 'Submit', undefined, 'Allow running this command? command(tool deploy)'],
    ['permission-unsandboxed', 'Submit', undefined, 'Allow running this command outside the sandbox? unsandboxed(tool deploy)'],
    ['permission-read-file', 'Submit', undefined, 'Allow read access to this path? read_file(/outside/file)'],
    ['permission-write-file', 'Submit', undefined, 'Allow write access to this path? write_file(/outside/file)'],
    ['permission-read-url', 'Submit', undefined, 'Allow reading this URL? read_url(example.invalid)'],
    ['permission-execute-url', 'Submit', undefined, 'Allow executing actions on this URL? execute_url(example.invalid)'],
    ['permission-mcp', 'Submit', undefined, 'Allow using this MCP tool? mcp(server/tool)'],
    ['permission-custom', 'Submit', undefined, 'Allow access to this resource? custom(resource)'],
    ['permission-save-rule', 'Submit', undefined, 'Save rule to always allow running this command? command(tool deploy)'],
    ['permission-shortcut-label', 'Submit ↵', undefined, 'Allow running this command? command(tool deploy)'],
    ['permission-option-once', 'Yes, allow this time', undefined, 'command(tool deploy)'],
    ['permission-option-conversation', 'Yes, and always allow in this conversation', undefined, 'command(tool deploy)'],
    ['file-subagent-conversation', 'Allow in Conversation', undefined, 'Access /outside/file?'],
    ['file-subagent-once', 'Allow Once', undefined, 'Access /outside/file?'],
    ['browser-confirm', 'Confirm', undefined, 'Confirmation required to execute this step'],
    ['browser-js-allow', 'Allow', undefined, 'Agent needs permission to execute JavaScript on example.invalid'],
    ['browser-domain-grant', 'Allow example.invalid', undefined, 'Agent needs permission to execute JavaScript on example.invalid'],
    ['browser-allow-once', 'Allow once', undefined, 'Agent needs permission to execute JavaScript on example.invalid'],
    ['browser-setup', 'Setup', undefined, 'Open Browser Setup'],
    ['read-url-legacy', 'Accept', undefined, 'Read URL content?'],
    ['generic-tool-legacy', 'Accept', undefined, 'Approve? Generic Tool'],
    ['send-command-input', 'Accept', undefined, 'Send command input?'],
    ['mcp-tool-legacy', 'Accept', undefined, 'Approve? MCP tool server/tool'],
    ['elicitation-form', 'Submit', undefined, 'Enter a value requested by the service'],
    ['agent-question', 'Submit', undefined, 'Which implementation do you prefer?'],
    ['agent-question-continue', 'Continue', undefined, 'Which implementation do you prefer?'],
    ['elicitation-url', 'Open URL', undefined, 'Complete verification at example.invalid'],
    ['plan-review', 'Proceed', undefined, 'Implementation plan review'],
    ['edit-accept-all', 'Accept all', undefined, 'Review code changes'],
    ['subagent-approve', 'Approve', undefined, 'Blocked, needs input'],
    ['retry-error', 'Retry', undefined, 'Tool failed; retry?'],
    ['workspace-trust', 'Trust', undefined, 'Do you trust the authors?'],
    ['generic-confirm', 'OK', undefined, 'Confirm dialog'],
    ['billing-overages', 'Enable Overages', undefined, 'Billing consent'],
];
const source = fs.readFileSync(path.join(__dirname, '../media/runtime.js'), 'utf8')
    .replace('/*{{ACTION_POLICY}}*/null', () => Policy.browserSource);
const patterns = DEFAULT_PATTERNS.filter(p => !RISKY_PATTERNS.some(r => r.toLowerCase() === p.toLowerCase()));
const results = [];
for (const profile of ['observe', 'edits', 'terminal', 'legacy']) {
    for (const [id, label, command, text] of cases) {
        for (const executor of ['cdp', 'runtime']) {
            const f = fixture(), b = f.button(label, command);
            const step = b.closest('[class*=tool]');
            step.innerText = text;
            const policy = { enabled: true, paused: false, dryRun: false, policyVersion: 'approval-research-v1',
                permissionProfile: profile, patterns, blacklist: [], builtInGrants: [], terminalWhitelist: [],
                permissionRules: [{ id: 'exact-status', effect: 'allow', match: 'exact', scope: 'user', argv: ['tool', 'status'], expiresAt: null }],
                eventScheduler: true, approveMs: 100, scrollMs: 500, workspace: '/fixture' };
            const decision = Policy.evaluateAction(label, command, Policy.actionContext(b, policy));
            if (executor === 'cdp') vm.runInContext(buildObserverScript(patterns, [], false, 7000, false, false, policy), f.context);
            else {
                vm.runInContext(source, f.context);
                const req = f.requests.find(r => r.method === 'GET');
                req.status = 200; req.responseText = JSON.stringify(policy); req.onload();
            }
            f.advance(1200);
            results.push({ id, label, profile, executor, decision: decision.decision, reasonCode: decision.reasonCode, clicks: b.calls });
        }
    }
}
const output = path.resolve(__dirname, '../artifacts/approval-research-2026-10-03');
fs.mkdirSync(output, { recursive: true });
fs.writeFileSync(path.join(output, 'coverage-probe.json'), JSON.stringify({
    fixture: 'synthetic-in-context-buttons-v1', caveat: 'Not captured host DOM; no live permission decisions. A missing click does not prove recognition or an explicit manual handoff.',
    profiles: 4, executors: 2, cases: cases.length, patterns, results,
}, null, 2) + '\n');
console.log(JSON.stringify({ cases: cases.length, probes: results.length, output,
    unexpectedTerminalExamples: results.filter(r => r.profile === 'terminal' && r.clicks && ['permission-command', 'permission-save-rule', 'agent-question', 'read-url-legacy', 'elicitation-form'].includes(r.id)) }, null, 2));
