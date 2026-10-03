'use strict';
// Run with Playwright available in NODE_PATH; no extension or terminal actions are executed.
// Keep browser output inside the checkout by pointing TMPDIR at a checkout directory when running.
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const tempRoot = path.resolve(__dirname, '../.cache/test-tmp');
fs.mkdirSync(tempRoot, { recursive: true });
process.env.TMPDIR = tempRoot;
process.env.TMP = tempRoot;
process.env.TEMP = tempRoot;
const vm = require('vm');
const { createRequire } = require('module');
const { chromium } = require('playwright');
const filename = path.join(__dirname, '../src/dashboard.js');
const localRequire = createRequire(filename);
const mod = { exports: {} };
vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module: mod, __dirname: path.dirname(filename),
    require: name => name === 'vscode' ? {} : name === './utils' ? {} : localRequire(name) }, { filename });
const presets = localRequire('./operation-presets');
const html = mod.exports.buildHtml({ enabled: true, scrollOn: true, skipBrowser: false, skipTerminalAccept: true,
    approveMs: 1200, scrollMs: 500, pauseMs: 15000, patterns: ['Accept'], allPatterns: ['Accept', 'Run'],
    totalClicks: 21, stats: { Accept: 6, Run: 5, Retry: 4, Proceed: 3, Expand: 2, Confirm: 1 },
    operationMode: 'custom', operationPresets: presets.getOperationPresets(),
    operationPresetConfigs: ['safe', 'balanced', 'fast'].map(presets.buildOperationPreset),
    roi: { session: { clicks: 9, savedSec: 90, gainPct: 15, dailySavedMin: 72 }, lifetime: { totalClicks: 25, savedSec: 300, sessions: 3 } },
    session: { learningHealth: 'healthy', cdpConnected: true, cdpSessions: 2 },
});
// Fixtures for the engine contract: getState().runtime and decision trace entries (newest first).
const runtimeReady = { status: 'ready', reasonCode: 'policy-ready', reason: 'Policy loaded and CDP connected', workspace: 'grav-fixture', policyVersion: 'p-7' };
const decisionTrace = { trace: [
    { id: 'trace-12', time: '10:00:03', source: 'cdp', action: 'clicked', label: 'Accept', decision: 'allow', reasonCode: 'pattern-match',
        reason: 'Matches an enabled pattern', matchedRules: [{ type: 'pattern', source: 'user-config', pattern: 'Accept', argv: [] }],
        scope: { type: 'ui-action', label: 'Accept' }, policyVersion: 'p-7', outcome: 'attempted' },
    { id: 'trace-11', time: '10:00:02', source: 'terminal', action: 'blocked', label: 'rm -rf build', decision: 'deny', reasonCode: 'blacklist-hit',
        reason: 'Blacklisted command', matchedRules: [{ type: 'blacklist', source: 'default', pattern: 'rm -rf', argv: ['rm', '-rf'] }],
        scope: { type: 'terminal', source: 'argv', argvPrefix: ['rm', '-rf'], broad: true }, policyVersion: 'p-7', outcome: 'unknown' },
    { time: '10:00:01', source: 'app', action: 'info', label: 'Event without ID', decision: 'manual', reasonCode: 'needs-review',
        reason: 'Needs a person', matchedRules: ['needs-review-rule'], scope: 'workspace', policyVersion: 'p-7', outcome: 'unknown' },
    { id: 'trace-9', time: '10:00:00', source: 'app', action: 'info', label: 'Odd decision', decision: 'maybe', outcome: 'done',
        matchedRules: [{ type: { nested: 1 }, source: 'user', pattern: '<img src=x onerror=window.xss=1>' }, { unexpected: true }],
        scope: { type: 'terminal', argvPrefix: ['<b>x</b>'], broad: false } },
], feedback: { falsePositive: 0, falseNegative: 0 } };
let passed = 0, failed = 0;
async function check(name, fn) {
    try { await fn(); passed++; } catch (e) { failed++; console.error(name, e); }
}
(async () => {
    const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
    try {
        const page = await browser.newPage();
        page.setDefaultTimeout(5000);
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.addInitScript(() => {
            window.sent = [];
            window.cspViolations = [];
            window.acquireVsCodeApi = () => ({ postMessage: msg => window.sent.push(msg) });
            document.addEventListener('securitypolicyviolation', event => window.cspViolations.push(event.violatedDirective));
        });
        await page.route('https://grav.test/', route => route.fulfill({ contentType: 'text/html', body: html }));
        await page.goto('https://grav.test/');
        const ack = (success, error) => page.evaluate(data => window.dispatchEvent(new MessageEvent('message', { data })), { command: 'saveResult', success, error });
        const text = id => page.locator('#' + id).textContent();
        const post = data => page.evaluate(data => window.dispatchEvent(new MessageEvent('message', { data })), data);
        const feedbackMessages = () => page.evaluate(() => sent.filter(m => m.command === 'feedback'));
        await check('Runtime is unknown without a snapshot and the guard is a fixed capability', async () => {
            assert.equal(await text('masterBadge'), 'Runtime: Unknown');
            assert.equal(await text('runtimeReason'), 'No runtime snapshot yet');
            assert.equal(await text('runtimeMeta'), 'Workspace: unknown · Policy version: unknown');
            assert.equal(await text('decisionBadge'), 'None');
            assert.equal(await page.locator('#chkSkipTerminal').count(), 0);
            assert.equal(await text('guardBadge'), 'Always on');
            assert.equal(await page.getByLabel('Scroll pause after interaction').count(), 1);
            assert.match(await text('roiNote'), /assumes a fixed time saved per click attempt/);
        });
        await check('Initial ROI uses session and lifetime schema', async () => {
            assert.equal(await text('roiSaved'), '1m 30s');
            assert.equal(await text('roiClicks'), '9');
            assert.equal(await text('roiGain'), '15%');
            assert.equal(await text('roiDaily'), '1h 12m');
            assert.equal(await text('roiLifeSaved'), '5m 0s');
            assert.equal(await text('roiLifeClicks'), '25');
            assert.equal(await text('roiLifeSessions'), '3');
            assert.equal(await text('healthBadge'), 'Healthy');
        });
        await check('All stats count toward active patterns; ring describes top-five share', async () => {
            assert.equal(await text('statActive'), '6 active');
            assert.equal(await text('successRate'), '95%');
            assert.equal(await page.locator('.ring-sub').textContent(), 'top 5 share');
        });
        await check('CSP-safe toggle marks dirty; no badge commit before ACK', async () => {
            await page.locator('#chkEnabled').uncheck();
            assert.equal(await page.locator('#btnSave').isEnabled(), true);
            await page.locator('#btnSave').click();
            assert.match(await text('saveState'), /Saving/);
            assert.equal(await text('ctrlBadge'), 'Saved config: On');
            assert.match(await text('pendingNote'), /Saving/);
            assert.equal(await text('masterBadge'), 'Runtime: Unknown');
            assert.equal(await page.locator('#btnSave').isDisabled(), true);
            assert.equal(await page.evaluate(() => sent.filter(m => m.command === 'save').length), 1);
            await ack(false, 'disk rejected');
            assert.equal(await text('saveState'), 'Unsaved changes');
            assert.match(await text('pendingNote'), /not applied yet/);
            assert.equal(await page.locator('#btnSave').isEnabled(), true);
        });
        await check('Successful ACK commits submitted snapshot while later edits stay dirty', async () => {
            await page.locator('#btnSave').click();
            await page.locator('#chkScroll').uncheck();
            assert.equal(await page.locator('#btnSave').isDisabled(), true);
            await ack(true);
            assert.equal(await text('ctrlBadge'), 'Saved config: Off');
            assert.equal(await text('masterBadge'), 'Runtime: Unknown');
            assert.equal(await text('saveState'), 'Unsaved changes');
            assert.equal(await page.locator('#btnSave').isEnabled(), true);
            await page.locator('#btnSave').click();
            await ack(true);
            assert.equal(await text('saveState'), 'All changes saved');
        });
        await check('Preset payload switches to custom pattern resolver', async () => {
            await page.getByRole('button', { name: 'Safe', exact: true }).click();
            await page.locator('#btnSave').click();
            const data = await page.evaluate(() => sent.filter(m => m.command === 'save').at(-1).data);
            assert.equal(data.presetMode, 'custom');
            assert.equal(data.operationMode, 'safe');
            assert.equal(data.skipBrowser, true);
            assert.equal(data.skipTerminalAccept, true);
            assert.equal(data.approveMs, 1800);
            await ack(true);
            await page.locator('#chkSkipBrowser').uncheck();
            await page.locator('#btnSave').click();
            assert.equal(await page.evaluate(() => sent.filter(m => m.command === 'save').at(-1).data.operationMode), 'custom');
            await ack(true);
        });
        await check('Slider input updates label and dirty state under CSP', async () => {
            await page.locator('#rngPause').evaluate(node => { node.value = '17000'; node.dispatchEvent(new Event('input')); });
            assert.equal(await text('valPause'), '17000ms');
            assert.equal(await page.locator('#btnSave').isEnabled(), true);
        });
        await check('Confirmation dispatches once and restores focus', async () => {
            await page.locator('#btnResetStats').click();
            assert.equal(await page.locator('#confirmOverlay').evaluate(node => node.open), true);
            assert.equal(await page.locator('#confirmNo').evaluate(node => node === document.activeElement), true);
            await page.keyboard.press('Escape');
            assert.equal(await page.locator('#btnResetStats').evaluate(node => node === document.activeElement), true);
            assert.equal(await page.evaluate(() => sent.filter(m => m.command === 'resetStats').length), 0);
            await page.locator('#btnResetStats').click();
            await page.locator('#confirmYes').click();
            assert.equal(await page.evaluate(() => sent.filter(m => m.command === 'resetStats').length), 1);
            await page.waitForFunction(() => document.activeElement.id === 'btnResetStats');
            // The dialog's close event restores focus asynchronously; let it settle before the next check moves focus.
            await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 50))));
            assert.doesNotMatch(await text('toastMsg'), /Stats reset/);
            await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: { command: 'actionResult', action: 'resetStats', success: true } })));
            assert.equal(await text('toastMsg'), 'Stats reset');
        });
        await check('Tabs expose relationships and support arrows/Home/End', async () => {
            await page.getByRole('tab', { name: /Controls/ }).focus();
            await page.keyboard.press('ArrowRight');
            assert.equal(await page.getByRole('tab', { name: /Rules/ }).getAttribute('aria-selected'), 'true');
            await page.keyboard.press('End');
            assert.equal(await page.getByRole('tab', { name: /Diagnostics/ }).getAttribute('aria-selected'), 'true');
            assert.equal(await page.locator('#tab-dashboard').isVisible(), false);
            await page.locator('#btnClearLog').click();
            await page.locator('#confirmYes').click();
            assert.equal(await page.evaluate(() => sent.filter(m => m.command === 'clearLog').length), 1);
            await page.keyboard.press('Home'); // focus is restored to Clear, so move to tabs explicitly
            await page.getByRole('tab', { name: /Diagnostics/ }).focus();
            await page.keyboard.press('Home');
            assert.equal(await page.getByRole('tab', { name: /Controls/ }).getAttribute('aria-selected'), 'true');
        });
        await check('Rules, diagnostics, feedback, reload, and filters have CSP-safe bindings', async () => {
            await page.getByRole('tab', { name: /Rules/ }).click();
            await page.locator('#btnManageTerminal').click();
            await page.getByRole('tab', { name: /Diagnostics/ }).click();
            for (const id of ['btnDiagnostics', 'btnRefreshTrace', 'btnRefreshObserver', 'btnRefreshLog']) await page.locator('#' + id).click();
            await page.locator('#searchTrace').fill('dummy');
            await page.locator('#selTraceFilter').selectOption('blocked');
            await page.locator('#searchLog').fill('dummy');
            await page.locator('#selLogFilter').selectOption('block');
            await page.locator('#btnReloadWindow').click();
            const messages = await page.evaluate(() => sent);
            for (const command of ['manageTerminal', 'openDiagnostics', 'getTrace', 'refreshObserver', 'getLog', 'reload']) assert.ok(messages.some(m => m.command === command), command);
            await page.getByRole('tab', { name: /Controls/ }).click();
        });
        await check('Runtime snapshot drives the header; config edits never change it', async () => {
            await post({ command: 'runtimeUpdated', runtime: runtimeReady });
            assert.equal(await text('masterBadge'), 'Runtime: Ready');
            assert.equal(await text('runtimeReason'), 'Policy loaded and CDP connected (policy-ready)');
            assert.equal(await text('runtimeMeta'), 'Workspace: grav-fixture · Policy version: p-7');
            assert.match(await text('diagRuntime'), /Ready\nPolicy loaded/);
            await page.locator('#chkEnabled').check();
            assert.equal(await text('masterBadge'), 'Runtime: Ready');
            for (const [status, label] of [['off', 'Off'], ['paused', 'Paused'], ['dry-run', 'Dry run'], ['disconnected', 'Disconnected'], ['unknown', 'Unknown'], ['active', 'Unknown']]) {
                await post({ command: 'runtimeUpdated', runtime: { ...runtimeReady, status } });
                assert.equal(await text('masterBadge'), 'Runtime: ' + label);
            }
            await post({ command: 'runtimeUpdated', runtime: null });
            assert.equal(await text('masterBadge'), 'Runtime: Unknown');
            assert.equal(await text('runtimeReason'), 'No runtime snapshot yet');
        });
        await check('Controls show the latest decision with reason, rule, scope and attempt wording', async () => {
            await post({ command: 'traceUpdated', trace: decisionTrace });
            assert.equal(await text('decisionBadge'), 'Decision: Allow');
            assert.equal(await text('decisionLabel'), 'Accept');
            assert.equal(await text('decisionReason'), 'Matches an enabled pattern (pattern-match)');
            assert.equal(await text('decisionRules'), 'Accept — type: pattern · source: user-config');
            assert.equal(await text('decisionScope'), 'ui-action: Accept');
            assert.equal(await text('decisionOutcome'), 'Click attempted (result not verified)');
        });
        await check('Decision details open the exact trace row in Diagnostics', async () => {
            await page.locator('#btnDecisionDetails').click();
            assert.equal(await page.getByRole('tab', { name: /Diagnostics/ }).getAttribute('aria-selected'), 'true');
            const toggle = page.getByRole('button', { name: 'Hide details for trace-12' });
            assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
            assert.equal(await toggle.evaluate(node => node === document.activeElement), true);
            const detail = await page.locator('.trace-detail').textContent();
            for (const expected of ['trace-12', 'pattern-match', 'Accept — type: pattern · source: user-config', 'ui-action: Accept', 'p-7', 'Click attempted (result not verified)']) assert.ok(detail.includes(expected), expected);
            assert.equal(await page.locator('.trace-detail').count(), 1);
        });
        await check('Unrecognised decision or outcome values render as unknown', async () => {
            await page.locator('#searchTrace').fill('odd decision');
            await page.getByRole('button', { name: 'Details for trace-9' }).click();
            const detail = await page.locator('.trace-detail').textContent();
            assert.match(detail, /DecisionUnknown/);
            assert.match(detail, /Outcome unknown/);
            // Hostile or malformed rule/scope values stay inert text and never print [object Object].
            assert.ok(detail.includes('<img src=x onerror=window.xss=1> — source: user'));
            assert.ok(detail.includes('terminal · prefix: <b>x</b> · broad: no'));
            assert.ok(!detail.includes('[object Object]'));
            assert.equal(await page.locator('.trace-detail img, .trace-detail b').count(), 0);
            assert.equal(await page.evaluate(() => window.xss), undefined);
            await page.getByRole('button', { name: 'Hide details for trace-9' }).click();
            await page.locator('#searchTrace').fill('blacklist-hit');
            assert.equal(await page.locator('.trace-item').count(), 1);
            await page.getByRole('button', { name: 'Details for trace-11' }).click();
            const real = await page.locator('.trace-detail').textContent();
            assert.ok(real.includes('rm -rf — type: blacklist · source: default · argv: rm -rf'));
            assert.ok(real.includes('terminal · source: argv · prefix: rm -rf · broad: yes'));
            await page.getByRole('button', { name: 'Hide details for trace-11' }).click();
            await page.locator('#searchTrace').fill('needs-review-rule');
            assert.equal(await page.locator('.trace-item').count(), 1); // string rules remain searchable
            await page.locator('#searchTrace').fill('');
        });
        await check('Row feedback sends that row trace ID and never guesses another row', async () => {
            await page.getByRole('button', { name: 'Details for trace-11' }).click();
            assert.equal(await page.locator('.trace-detail').count(), 1);
            assert.equal(await (await feedbackMessages()).length, 0);
            await page.getByRole('button', { name: 'Report false positive for trace-11' }).click();
            let messages = await feedbackMessages();
            assert.equal(messages.length, 1);
            assert.equal(messages[0].traceId, 'trace-11');
            assert.equal(messages[0].kind, 'falsePositive');
            assert.match(await page.locator('.trace-detail').textContent(), /Sending feedback/);
            await page.getByRole('button', { name: 'Report missed click for trace-11' }).click({ force: true });
            assert.equal((await feedbackMessages()).length, 1);
            await post({ command: 'feedbackResult', kind: 'falsePositive', traceId: 'trace-11', success: true });
            assert.match(await page.locator('.trace-detail').textContent(), /Feedback recorded: false positive/);
            assert.equal(await text('toastMsg'), 'Feedback recorded for trace-11');
            await page.getByRole('button', { name: 'Report missed click for trace-11' }).click();
            await post({ command: 'feedbackResult', kind: 'falseNegative', traceId: 'trace-11', success: false, error: 'Trace ID expired' });
            assert.match(await page.locator('.trace-detail').textContent(), /Feedback failed: Trace ID expired/);
            messages = await feedbackMessages();
            assert.deepEqual(messages.map(m => m.traceId), ['trace-11', 'trace-11']);
        });
        await check('Rows without a trace ID cannot send feedback', async () => {
            await page.getByRole('button', { name: 'Details for Event without ID' }).click();
            assert.match(await page.locator('.trace-detail').textContent(), /Trace IDNot provided/);
            const before = (await feedbackMessages()).length;
            const button = page.getByRole('button', { name: 'Report false positive for this event' });
            assert.equal(await button.getAttribute('aria-disabled'), 'true');
            await button.click({ force: true });
            assert.equal((await feedbackMessages()).length, before);
            assert.match(await page.locator('.trace-detail').textContent(), /needs a trace ID/);
        });
        await check('Keyboard focus survives trace refreshes', async () => {
            const toggle = page.getByRole('button', { name: 'Hide details for Event without ID' });
            await toggle.focus();
            await post({ command: 'traceUpdated', trace: decisionTrace });
            assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Hide details for Event without ID');
            await page.keyboard.press('Enter');
            assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Details for Event without ID');
            assert.equal(await page.locator('.trace-detail').count(), 0);
            await page.getByRole('region', { name: 'Decision trace events' }).focus();
        });
        await check('Learning and ROI labels avoid measured-productivity claims', async () => {
            await page.getByRole('tab', { name: /Analytics/ }).click();
            const body = await page.locator('#tab-analytics').textContent();
            for (const expected of ['Candidates', 'Estimated Time Saved', 'Est. Session Saved', 'Session Click Attempts', 'suggestion score']) assert.ok(body.includes(expected), expected);
            await post({ command: 'brainUpdated', concepts: { git: { commands: ['git status'], avgConfidence: 0.8, riskLevel: 'safe' } } });
            assert.match(await text('conceptMap'), /Suggestion score 80%/);
            await page.getByRole('tab', { name: /Controls/ }).click();
        });
        await check('Narrow panel has no horizontal overflow on any tab', async () => {
            await page.setViewportSize({ width: 340, height: 800 });
            for (const name of [/Controls/, /Rules/, /Analytics/, /Diagnostics/]) {
                await page.getByRole('tab', { name }).click();
                const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
                assert.ok(overflow <= 0, String(name) + ' overflows by ' + overflow);
            }
            await page.getByRole('tab', { name: /Controls/ }).click();
            assert.equal(await page.getByText('Scroll pause after interaction', { exact: true }).isVisible(), true);
            await page.setViewportSize({ width: 1280, height: 800 });
        });
        await check('Theme tokens, reduced motion, and visible toggle focus', async () => {
            await page.emulateMedia({ reducedMotion: 'reduce' });
            await page.locator('#chkEnabled').focus();
            await page.keyboard.press('Tab');
            await page.keyboard.press('Shift+Tab');
            const style = await page.evaluate(() => {
                document.documentElement.style.setProperty('--vscode-editor-background', 'rgb(250, 250, 250)');
                const track = getComputedStyle(document.querySelector('#chkEnabled + .tog-track'));
                return { outline: track.outlineStyle, bg: getComputedStyle(document.body).backgroundColor,
                    animation: getComputedStyle(document.querySelector('.tab-content.active')).animationName };
            });
            assert.equal(style.outline, 'solid');
            assert.equal(style.bg, 'rgb(250, 250, 250)');
            assert.equal(style.animation, 'none');
            for (const id of ['rngPause', 'rngApprove', 'rngScroll']) {
                await page.locator('#' + id).focus();
                assert.equal(await page.locator('#' + id).evaluate(node => getComputedStyle(node).outlineStyle), 'solid');
            }
        });
        await check('Light and high-contrast host themes drive colors; narrow keyboard traversal keeps focus visible', async () => {
            const light = { '--vscode-editor-background': 'rgb(255, 255, 255)', '--vscode-foreground': 'rgb(51, 51, 51)', '--vscode-descriptionForeground': 'rgb(97, 97, 97)',
                '--vscode-editorWidget-background': 'rgb(243, 243, 243)', '--vscode-sideBar-background': 'rgb(240, 240, 240)', '--vscode-panel-border': 'rgb(200, 200, 200)',
                '--vscode-input-background': 'rgb(250, 250, 200)', '--vscode-input-foreground': 'rgb(0, 0, 0)', '--vscode-button-background': 'rgb(0, 95, 184)',
                '--vscode-button-foreground': 'rgb(255, 255, 255)', '--vscode-focusBorder': 'rgb(255, 0, 255)' };
            await page.evaluate(vars => { for (const [k, v] of Object.entries(vars)) document.documentElement.style.setProperty(k, v); }, light);
            await page.setViewportSize({ width: 340, height: 800 });
            await page.getByRole('tab', { name: /Controls/ }).click();
            const colors = await page.evaluate(() => {
                const css = (sel, prop) => getComputedStyle(document.querySelector(sel))[prop];
                const channels = c => c.match(/[\d.]+/g).slice(0, 3).map(Number);
                const lum = c => { const [r, g, b] = channels(c).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
                const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
                const card = css('.card', 'backgroundColor');
                return { body: css('body', 'backgroundColor'), card, input: css('#searchTrace', 'backgroundColor'), inputFg: css('#searchTrace', 'color'),
                    save: css('#btnSave', 'backgroundColor'), saveFg: css('#btnSave', 'color'), border: css('.card', 'borderTopColor'),
                    primary: ratio(css('.trow-name', 'color'), card), muted: ratio(css('.trow-desc', 'color'), card), thumb: css('#chkEnabled + .tog-track', 'backgroundColor') };
            });
            assert.equal(colors.body, 'rgb(255, 255, 255)');
            assert.equal(colors.card, 'rgb(243, 243, 243)');
            assert.equal(colors.input, 'rgb(250, 250, 200)');
            assert.equal(colors.inputFg, 'rgb(0, 0, 0)');
            assert.equal(colors.save, 'rgb(0, 95, 184)');
            assert.equal(colors.saveFg, 'rgb(255, 255, 255)');
            assert.equal(colors.border, 'rgb(200, 200, 200)');
            assert.ok(colors.primary >= 4.5 && colors.muted >= 4.5, 'text contrast ' + colors.primary + ' / ' + colors.muted);
            // Keyboard traversal at narrow width: every stop is fully in view horizontally with the themed focus ring.
            await page.getByRole('tab', { name: /Controls/ }).focus();
            const stops = new Set();
            for (let i = 0; i < 45; i++) {
                await page.keyboard.press('Tab');
                const stop = await page.evaluate(() => {
                    const el = document.activeElement, r = el.getBoundingClientRect(), style = getComputedStyle(el);
                    return { name: el.id || el.getAttribute('aria-label') || el.textContent.trim(), left: r.left, right: r.right, width: window.innerWidth, outline: style.outlineStyle, ring: style.outlineColor };
                });
                stops.add(stop.name);
                assert.ok(stop.left >= -1 && stop.right <= stop.width + 1, stop.name + ' leaves the narrow viewport');
                assert.equal(stop.outline, 'solid', stop.name + ' has no visible focus');
                assert.equal(stop.ring, 'rgb(255, 0, 255)', stop.name + ' ignores the host focus color');
                if (stop.name === 'btnResetStats') break;
            }
            for (const name of ['rngPause', 'btnSave', 'btnResetStats']) assert.ok(stops.has(name), 'Tab order reaches ' + name);
            await page.evaluate(() => {
                document.body.classList.add('vscode-high-contrast');
                document.documentElement.style.setProperty('--vscode-contrastBorder', 'rgb(255, 128, 0)');
            });
            assert.equal(await page.locator('.card').first().evaluate(node => getComputedStyle(node).borderTopColor), 'rgb(255, 128, 0)');
            assert.equal(await page.locator('#btnSave').evaluate(node => getComputedStyle(node).borderTopColor), 'rgb(255, 128, 0)');
            await page.evaluate(vars => {
                document.body.classList.remove('vscode-high-contrast');
                for (const k of [...Object.keys(vars), '--vscode-contrastBorder']) document.documentElement.style.removeProperty(k);
            }, light);
            await page.setViewportSize({ width: 1280, height: 800 });
        });
        await check('Permission and speed controls are separate; provenance/capabilities render safely at narrow width', async () => {
            await page.setViewportSize({width:340,height:800});
            await post({command:'traceUpdated',trace:{...decisionTrace,permissionProfile:'edits',capabilities:{version:'adapter-v1',completion:false},metrics:{labeledOpportunities:0},jobMetrics:{observedJobs:0,unattendedCompletionRate:null},learningEvidence:[{cmd:'<img onerror=window.xss=1>',provenance:{humanApprovals:2,examples:['tool status']}}]}});
            await page.getByRole('tab',{name:/Rules/}).click();
            await page.locator('#btnConfigureAutopilot').click();
            assert.equal(await page.evaluate(()=>sent.filter(m=>m.command==='configureAutopilot').length),1);
            await page.locator('#btnPermissionProfile').click();await page.locator('#btnScanSpeed').click();
            assert.deepEqual(await page.evaluate(()=>sent.filter(m=>['permissionProfile','scanSpeed'].includes(m.command)).map(m=>m.command)),['permissionProfile','scanSpeed']);
            for(const id of ['btnConfigureAutopilot','btnManageTerminal','btnPermissionProfile','btnScanSpeed']) {const r=await page.locator('#'+id).boundingBox();assert(r.x>=0&&r.x+r.width<=341,id+' leaves narrow viewport');}
            await page.getByRole('tab',{name:/Diagnostics/}).click();
            await page.getByText('Pilot metrics (clicks are attempts)',{exact:true}).click();
            assert.match(await text('pilotSummary'),/"unattendedCompletionRate": null/);
            await page.getByText('Adapter capabilities',{exact:true}).click();
            assert.match(await text('capabilitySummary'),/adapter-v1/);assert.match(await text('capabilitySummary'),/"completion": false/);
            await page.getByText('Learning evidence and examples',{exact:true}).click();
            assert.match(await text('learningEvidence'),/humanApprovals/);assert.equal(await page.locator('#learningEvidence img').count(),0);
            await page.setViewportSize({width:1280,height:800});
        });
        await check('No CSP violations or script errors', async () => {
            assert.deepEqual(errors, []);
            assert.deepEqual(await page.evaluate(() => cspViolations), []);
        });
    } finally { await browser.close(); }
    console.log(`Results: ${passed} passed, ${failed} failed`);
    process.exitCode = failed ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; });
