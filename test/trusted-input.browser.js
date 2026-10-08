'use strict';
const assert = require('assert/strict');
const { chromium } = require('playwright');
const { buildObserverScript } = require('../src/cdp-observer');
const { dispatchTrustedClick } = require('../src/trusted-click');
const policy = { enabled: true, paused: false, dryRun: false, policyVersion: 'browser-fixture', patterns: ['Run'],
    permissionProfile: 'legacy', terminalWhitelist: ['echo'], builtInGrants: [], blacklist: [], trustedInput: true, approveMs: 100 };
(async () => {
    const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
        args: ['--site-per-process', '--isolate-origins=https://child.test'] });
    try {
        const page = await browser.newPage();
        await page.setContent('<title>Agent Chat</title><div class="antigravity-agent-side-panel"><div class="tool-step" data-request-id="fixture"><code>echo hello</code><button>Run</button><button>Reject</button></div></div>');
        await page.evaluate(() => {
            window.activations = [];
            const button = document.querySelector('button');
            button.addEventListener('click', event => { activations.push(event.isTrusted); if (event.isTrusted) button.disabled = true; });
            button.click();
        });
        const input = page.waitForEvent('console', { predicate: message => message.text().startsWith('[GRAV:INPUT]'), timeout: 5000 });
        await page.evaluate(buildObserverScript(policy.patterns, [], false, 0, false, false, policy));
        const data = JSON.parse((await input).text().slice('[GRAV:INPUT] '.length));
        assert.deepEqual(await page.evaluate(() => activations), [false], 'observer queues input without synthetic DOM activation');
        const session = await page.context().newCDPSession(page);
        const journal = [];
        const click = () => dispatchTrustedClick({ ...data, isCurrent: () => true, send: (method, params) => session.send(method, params), remember: point => journal.push(point) });
        assert.equal(await click(), true);
        assert.deepEqual(await page.evaluate(() => activations), [false, true], 'CDP delivers a trusted browser click');
        assert.equal(await click(), false, 'ticket cannot cause duplicate click');
        assert.equal(journal.length, 1);
        await page.evaluate(() => window.__gravObserver.dispose());
        // Input coordinates are relative to the attached OOPIF's viewport,
        // even when the iframe is offset in the outer workbench document.
        await page.route('https://parent.test/', route => route.fulfill({ contentType: 'text/html',
            body: '<iframe src="https://child.test/" style="position:absolute;left:200px;top:150px;width:500px;height:300px"></iframe>' }));
        await page.route('https://child.test/', route => route.fulfill({ contentType: 'text/html',
            body: '<button style="width:100px;height:40px" onclick="window.trusted=event.isTrusted">Run</button>' }));
        await page.goto('https://parent.test/');
        const frame = page.frames().find(frame => frame.url().includes('child.test'));
        const childSession = await page.context().newCDPSession(frame);
        const point = await frame.evaluate(() => {
            const rect = document.querySelector('button').getBoundingClientRect();
            return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        });
        assert.equal(point.x, 58);
        await childSession.send('Input.dispatchMouseEvent', { ...point, type: 'mousePressed', button: 'left', clickCount: 1 });
        await childSession.send('Input.dispatchMouseEvent', { ...point, type: 'mouseReleased', button: 'left', clickCount: 1 });
        assert.equal(await frame.evaluate(() => window.trusted), true);
        console.log('Results: 7 passed, 0 failed');
    } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
