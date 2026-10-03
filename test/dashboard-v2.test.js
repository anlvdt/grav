'use strict';

const fs = require('fs');
const path = require('path');

let _passed = 0, _failed = 0;
function assert(condition, msg) {
    if (condition) { _passed++; }
    else { _failed++; console.error(`  x FAIL: ${msg}`); }
}
function section(name) { console.log(`\n── ${name} ──`); }

const html = fs.readFileSync(path.join(__dirname, '..', 'media', 'dashboard-v2.html'), 'utf8');

section('Version placeholder');
assert(html.includes('v{{VERSION}}'), 'dashboard header uses template version');

section('Safe render helpers');
assert(html.includes('function clearNode(node)'), 'clearNode helper exists');
assert(html.includes('function makeEl(tag, className, text)'), 'makeEl helper exists');

section('No raw innerHTML with untrusted values');
assert(!html.includes("row.innerHTML = '<span class=\"bar-k\""), 'stats rows no longer use raw innerHTML');
assert(!html.includes("el.innerHTML = '<div class=\"cpt-top\""), 'concept rows no longer use raw innerHTML');
assert(!html.includes("row.innerHTML = '<span class=\"feed-ts\""), 'log rows no longer use raw innerHTML');
assert(!html.includes("div.innerHTML = '<span class=\"metric-label\""), 'tool breakdown no longer uses raw innerHTML');

section('Text nodes used for dynamic content');
assert(html.includes("makeEl('span', 'feed-cmd', l.cmd || '')"), 'log command uses textContent path');
assert(html.includes("makeEl('span', 'bar-k', k)"), 'stats label uses textContent path');
assert(html.includes("makeEl('span', 'cpt-name', ck)"), 'concept name uses textContent path');

section('Consistent staged-save model');
assert(html.includes('Changes stay local until you click Save Changes.'), 'dashboard explains staged-save behavior');
assert(html.includes('id="btnSave"'), 'save button is explicit');
assert(html.includes('function currentSettingsSnapshot()'), 'dashboard tracks saved snapshot');
assert(html.includes('function markDirty(reason)'), 'dashboard marks unsaved changes');
assert(!html.includes("vscode.postMessage({ command: 'scrollToggle'"), 'scroll toggle no longer auto-commits');
assert(!html.includes("vscode.postMessage({ command: 'toggleSkipBrowser'"), 'skip-browser toggle no longer auto-commits');

section('Tool activity heading is preserved');
assert(html.includes('function renderToolBreakdown(toolBreakdown)'), 'tool breakdown render helper exists');
assert(/id="toolBreakdownCard"[\s\S]*?class="card-title"[\s\S]*?Tool[\s\S]*?id="toolBreakdown"/.test(html), 'tool heading stays outside the rerendered body');

section('Insight sections are visible');
assert(html.includes('id="conceptMap"'), 'concept map container exists');
assert(html.includes('id="brainEpoch"'), 'brain epoch metric exists');
assert(html.includes('id="brainTracking"'), 'brain tracking metric exists');
assert(html.includes('id="brainPromoted"'), 'brain promoted metric exists');
assert(html.includes('id="roiDaily"'), 'daily ROI metric exists');
assert(html.includes('id="roiLifeClicks"'), 'lifetime clicks metric exists');
assert(html.includes('id="roiLifeSessions"'), 'lifetime sessions metric exists');

section('Preset and diagnostics UI');
assert(html.includes('id="presetBar"'), 'operation preset bar exists');
assert(html.includes('id="presetDesc"'), 'preset description exists');
assert(html.includes('id="traceFeed"'), 'decision trace feed exists');
assert(html.includes('id="diagLastBlocked"'), 'last blocked diagnostics exists');
assert(html.includes('id="selLogFilter"'), 'activity log filter exists');
assert(!html.includes('id="chkSkipTerminal"'), 'native accept guard is not a fake toggle');
assert(/id="guardBadge"[^>]*>Always on</.test(html), 'native accept guard is described as a fixed capability');
assert(html.includes('function renderTrace()'), 'trace renderer exists');
assert(html.includes('function renderOperationPresets()'), 'preset renderer exists');

section('Accessible toggles');
assert(!html.includes('.tog input { display: none; }'), 'toggle inputs are not removed from keyboard flow');
assert(html.includes('.tog input:focus-visible + .tog-track'), 'toggle has visible focus state');
assert(html.includes('role="switch"'), 'toggle inputs expose switch role');

section('Runtime status and decisions');
assert(html.includes('{{RUNTIME_JSON}}'), 'runtime snapshot is injected from host state');
assert(html.includes("case 'runtimeUpdated'"), 'runtime updates are handled');
assert(html.includes('id="runtimeMeta"') && html.includes('id="runtimeReason"'), 'header shows reason, workspace and policy version');
assert(html.includes('No runtime snapshot yet'), 'missing runtime snapshot is shown as unknown');
assert(!html.includes("(enabled ? 'Active' : 'Paused')"), 'header no longer infers Active from enabled');
assert(html.includes("'Saved config: '"), 'enabled badge is labelled as saved configuration');
assert(html.includes('id="decisionCard"') && html.includes('id="decisionRules"') && html.includes('id="decisionScope"'), 'controls show the latest decision with rule and scope');
assert(html.includes('Click attempted (result not verified)'), 'attempted clicks are not reported as command success');

section('Per-row feedback');
assert(!html.includes('id="btnFalsePositive"') && !html.includes('id="btnFalseNegative"'), 'global feedback buttons are gone');
assert(html.includes("command: 'feedback', kind, traceId"), 'feedback carries a specific trace ID');
assert(html.includes("case 'feedbackResult'"), 'feedback result is handled');

section('Honest labels');
assert(html.includes('Scroll pause after interaction'), 'pause slider has an accurate name');
assert(html.includes('Candidates') && html.includes('Suggestion score'), 'learning uses candidate and suggestion score wording');
assert(html.includes('id="roiNote"') && html.includes('assumes a fixed time saved per click attempt'), 'ROI is described as an estimate');
assert(!html.includes('Productivity Gain') && !html.includes('Productivity Saved'), 'ROI is not presented as measured productivity');

section('Engine object formatting and host theme tokens');
assert(html.includes('function formatRule(rule)') && html.includes('function formatScope(scope)'), 'structured rules and scopes have explicit formatters');
assert(html.includes('argvPrefix') && html.includes("'ui-action'"), 'scope formatter understands argv prefix and ui-action');
assert(/:root \{\n  --bg: var\(--vscode-editor-background, #060a12\);/.test(html), 'base tokens come from host theme variables');
for (const token of ['--vscode-foreground', '--vscode-editorWidget-background', '--vscode-panel-border', '--vscode-input-background', '--vscode-button-background', '--vscode-focusBorder']) assert(html.includes(token), token + ' is used');
assert(!/rgba\(255, ?255, ?255, ?0\.\d+\)\s*;/.test(html.split('</style>')[0].replace(/box-shadow[^;]*;/g, '')), 'no fixed white overlay backgrounds');

section('Narrow panel');
assert(html.includes('@media (max-width: 560px)'), 'narrow panel layout exists');

console.log(`\n${'═'.repeat(40)}`);
console.log(`Results: ${_passed} passed, ${_failed} failed`);
process.exit(_failed > 0 ? 1 : 0);
