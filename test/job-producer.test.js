'use strict';
const baseAssert = require('assert/strict');
let checks = 0;
const assert = new Proxy(baseAssert, {
    apply(target, receiver, args) { checks++; return Reflect.apply(target, receiver, args); },
    get(target, key) { const value = target[key]; return typeof value === 'function' ? (...args) => { checks++; return value(...args); } : value; },
});
const { createJobProducer } = require('../src/job-producer');
const { createJobTracker } = require('../src/job-tracker');

// ── Helpers ──────────────────────────────────────────────────
function fakeWindow() {
    return {
        document: { body: { querySelectorAll: () => [] } },
    };
}
function makeProvider(initial) {
    const listeners = new Set();
    let state = initial;
    return {
        getState: () => state,
        onDidChange: fn => { listeners.add(fn); return { dispose: () => listeners.delete(fn) }; },
        _fire: next => { state = next; listeners.forEach(f => f()); },
    };
}
function runningState(id, extra = {}) {
    return Object.assign({
        conversationId: id, status: 2, executableStatus: 2, executorLoopStatus: 2,
        fullyIdle: false, artifactSnapshots: [], trajectoryFileDiffs: [],
        backgroundCommands: [], pendingAgentMessages: [], costSummary: undefined,
        trajectorySlice: { stepsInSlice: [], totalStepsLength: 0, lastStepError: null, metadata: {} },
    }, extra);
}
function idleDoneState(id, extra = {}) {
    return runningState(id, Object.assign({ status: 1, fullyIdle: true }, extra));
}
function waitingState(id, toolName, extra = {}) {
    return runningState(id, Object.assign({
        status: 2, fullyIdle: false,
        trajectorySlice: {
            stepsInSlice: [{ status: 9, metadata: { toolCall: { name: toolName }, toolSummary: toolName } }],
            totalStepsLength: 1, lastStepError: null,
        },
    }, extra));
}
function failedState(id, extra = {}) {
    return runningState(id, Object.assign({
        status: 1, fullyIdle: true,
        trajectorySlice: {
            stepsInSlice: [{ status: 7, metadata: {} }],
            totalStepsLength: 1, lastStepError: 'Command failed with exit 1',
            latestStep: { status: 7 },
        },
    }, extra));
}

// ── 1. started → progress → completed emits host events ──────
{
    const emitted = [];
    const provider = makeProvider(runningState('conv-1'));
    const win = fakeWindow();
    const fiber = { memoizedProps: { cascadeContext: { state: { agentStateProvider: provider } } } };
    win.document.body.__reactContainer$abc = fiber;
    const producer = createJobProducer({ report: (t, d) => emitted.push({ t, d }), rescanMs: 1000, setTimeout: fn => { fn(); return 1; } });
    const _orig = global.window; global.window = win;
    producer.start(); global.window = _orig;

    // started on first reconcile
    assert.equal(emitted.length, 2);
    assert.equal(emitted[0].d.type, 'started');
    assert.equal(emitted[0].d.jobId, 'conv-1');
    assert.equal(emitted[0].d.evidence, 'host-job-lifecycle');
    assert.equal(emitted[0].d.sequence, 1);
    assert.equal(emitted[1].d.type, 'progress');
    assert.equal(emitted[1].d.sequence, 2);

    // feed completion
    provider._fire(idleDoneState('conv-1'));
    assert.equal(emitted.length, 3);
    assert.equal(emitted[2].d.type, 'completed');
    assert.equal(emitted[2].d.sequence, 3);
    producer.dispose();
}

// ── 2. waiting step → waiting event with reason ──────────────
{
    const emitted = [];
    const provider = makeProvider(waitingState('conv-2', 'permissionPrompt'));
    const win = fakeWindow();
    win.document.body.__reactContainer$def = { memoizedProps: { cascadeContext: { state: { agentStateProvider: provider } } } };
    const producer = createJobProducer({ report: (t, d) => emitted.push({ t, d }), rescanMs: 1000, setTimeout: fn => { fn(); return 1; } });
    const _orig = global.window; global.window = win;
    producer.start(); global.window = _orig;
    assert.equal(emitted[0].d.type, 'started');
    const waiting = emitted.find(e => e.d.type === 'waiting');
    assert.ok(waiting);
    assert.equal(waiting.d.waitReason, 'approval');
    assert.equal(waiting.d.toolName, 'permissionPrompt');
    producer.dispose();
}

// ── 3. question wait reason ──────────────────────────────────
{
    const emitted = [];
    const provider = makeProvider(waitingState('conv-3', 'askQuestion'));
    const win = fakeWindow();
    win.document.body.__reactContainer$ghi = { memoizedProps: { cascadeContext: { state: { agentStateProvider: provider } } } };
    const producer = createJobProducer({ report: (t, d) => emitted.push({ t, d }), rescanMs: 1000, setTimeout: fn => { fn(); return 1; } });
    const _orig = global.window; global.window = win;
    producer.start(); global.window = _orig;
    const waiting = emitted.find(e => e.d.type === 'waiting');
    assert.equal(waiting.d.waitReason, 'question');
    producer.dispose();
}

// ── 4. failed job: IDLE+fullyIdle with step error ────────────
{
    const emitted = [];
    const provider = makeProvider(runningState('conv-4'));
    const win = fakeWindow();
    win.document.body.__reactContainer$jkl = { memoizedProps: { cascadeContext: { state: { agentStateProvider: provider } } } };
    const producer = createJobProducer({ report: (t, d) => emitted.push({ t, d }), rescanMs: 1000, setTimeout: fn => { fn(); return 1; } });
    const _orig = global.window; global.window = win;
    producer.start(); global.window = _orig;
    provider._fire(failedState('conv-4'));
    const fail = emitted.find(e => e.d.type === 'failed');
    assert.ok(fail);
    assert.ok(fail.d.error.includes('exit 1'));
    producer.dispose();
}

// ── 5. provider found via Preact '__k' expando ──────────────
{
    const emitted = [];
    const provider = makeProvider(runningState('conv-5'));
    const win = fakeWindow();
    win.document.body.__k = { props: { cascadeContext: { state: { agentStateProvider: provider } } } };
    const producer = createJobProducer({ report: (t, d) => emitted.push({ t, d }), rescanMs: 1000, setTimeout: fn => { fn(); return 1; } });
    const _orig = global.window; global.window = win;
    producer.start(); global.window = _orig;
    assert.equal(emitted[0].d.type, 'started');
    producer.dispose();
}

// ── 6. no DOM/provider → producer retries, no crash ─────────
{
    const emitted = [];
    const win = { document: { body: null } };
    const producer = createJobProducer({ report: (t, d) => emitted.push({ t, d }), rescanMs: 5, setTimeout: fn => 1 });
    const _orig = global.window; global.window = win;
    producer.start(); global.window = _orig;
    assert.equal(emitted.length, 0);
    producer.dispose();
}

// ── 7. dedup: repeated waiting step does not re-emit ─────────
{
    const emitted = [];
    const provider = makeProvider(waitingState('conv-7', 'permissionPrompt'));
    const win = fakeWindow();
    win.document.body.__reactContainer$mno = { memoizedProps: { cascadeContext: { state: { agentStateProvider: provider } } } };
    const producer = createJobProducer({ report: (t, d) => emitted.push({ t, d }), rescanMs: 1000, setTimeout: fn => { fn(); return 1; } });
    const _orig = global.window; global.window = win;
    producer.start(); global.window = _orig;
    const waitingCount = emitted.filter(e => e.d.type === 'waiting').length;
    provider._fire(waitingState('conv-7', 'permissionPrompt'));
    assert.equal(emitted.filter(e => e.d.type === 'waiting').length, waitingCount);
    producer.dispose();
}

// ── 8. tracker accepts produced events ───────────────────────
{
    const emitted = [];
    const tracker = createJobTracker({}, { now: () => 1000 });
    const provider = makeProvider(runningState('conv-8'));
    const win = fakeWindow();
    win.document.body.__reactContainer$pqr = { memoizedProps: { cascadeContext: { state: { agentStateProvider: provider } } } };
    const producer = createJobProducer({ report: (_t, d) => { emitted.push(d); tracker.record(d); }, rescanMs: 1000, setTimeout: fn => { fn(); return 1; } });
    const _orig = global.window; global.window = win;
    producer.start(); global.window = _orig;
    provider._fire(idleDoneState('conv-8'));
    const snap = tracker.snapshot();
    assert.equal(snap.observedJobs, 1);
    assert.equal(snap.completedJobs, 1);
    assert.equal(snap.rejectedEvents, 0);
    producer.dispose();
}

// ── 9. multi-job: second conversation after first terminal ──
{
    const emitted = [];
    const provider = makeProvider(runningState('conv-A'));
    const win = fakeWindow();
    win.document.body.__reactContainer$stu = { memoizedProps: { cascadeContext: { state: { agentStateProvider: provider } } } };
    const producer = createJobProducer({ report: (_t, d) => emitted.push(d), rescanMs: 1000, setTimeout: fn => { fn(); return 1; } });
    const _orig = global.window; global.window = win;
    producer.start(); global.window = _orig;
    provider._fire(idleDoneState('conv-A'));
    provider._fire(runningState('conv-B'));
    provider._fire(idleDoneState('conv-B'));
    const byJob = id => emitted.filter(e => e.jobId === id).map(e => e.type);
    assert.deepEqual(byJob('conv-A'), ['started', 'progress', 'completed']);
    assert.deepEqual(byJob('conv-B'), ['started', 'progress', 'completed']);
    producer.dispose();
}

// ── 10. dispose unbinds provider, no more events ─────────────
{
    const emitted = [];
    const provider = makeProvider(runningState('conv-10'));
    const win = fakeWindow();
    win.document.body.__reactContainer$vwx = { memoizedProps: { cascadeContext: { state: { agentStateProvider: provider } } } };
    const producer = createJobProducer({ report: (_t, d) => emitted.push(d), rescanMs: 1000, setTimeout: fn => { fn(); return 1; } });
    const _orig = global.window; global.window = win;
    producer.start(); global.window = _orig;
    const n = emitted.length;
    producer.dispose();
    provider._fire(idleDoneState('conv-10'));
    assert.equal(emitted.length, n);
}

// ── 11. window undefined → graceful no-op ────────────────────
{
    const emitted = [];
    const producer = createJobProducer({ report: (_t, d) => emitted.push(d), rescanMs: 1000, setTimeout: fn => { fn(); return 1; } });
    const _orig = global.window; delete global.window;
    try { producer.start(); } catch { /* noop */ }
    global.window = _orig;
    assert.equal(emitted.length, 0);
    producer.dispose();
}

// ── 12. jobId >300 chars rejected ────────────────────────────
{
    const emitted = [];
    const longId = 'x'.repeat(301);
    const provider = makeProvider(runningState(longId));
    const win = fakeWindow();
    win.document.body.__reactContainer$yza = { memoizedProps: { cascadeContext: { state: { agentStateProvider: provider } } } };
    const producer = createJobProducer({ report: (_t, d) => emitted.push(d), rescanMs: 1000, setTimeout: fn => { fn(); return 1; } });
    const _orig = global.window; global.window = win;
    producer.start(); global.window = _orig;
    assert.equal(emitted.length, 0);
    producer.dispose();
}

// ── 13. subagent jobs: separate jobId + parentJobId attribution ──
{
    const emitted = [];
    const provider = makeProvider(runningState('conv-parent', {
        subagentStates: {
            'conv-sub-1': { status: 2, fullyIdle: false, killed: false, hasWaitingStep: false, latestStep: null, firstSeenMs: 1 },
        },
    }));
    const win = fakeWindow();
    win.document.body.__reactContainer$sub = { memoizedProps: { cascadeContext: { state: { agentStateProvider: provider } } } };
    const producer = createJobProducer({ report: (_t, d) => emitted.push(d), rescanMs: 1000, setTimeout: fn => { fn(); return 1; } });
    const _orig = global.window; global.window = win;
    producer.start(); global.window = _orig;
    const subStart = emitted.find(e => e.jobId === 'conv-sub-1' && e.type === 'started');
    assert.ok(subStart);
    assert.equal(subStart.parentJobId, 'conv-parent');
    assert.ok(emitted.some(e => e.jobId === 'conv-sub-1' && e.type === 'progress'));
    // subagent completes while parent still running
    provider._fire(runningState('conv-parent', {
        subagentStates: { 'conv-sub-1': { status: 1, fullyIdle: true, killed: false, hasWaitingStep: false, latestStep: { status: 3 } } },
    }));
    assert.ok(emitted.some(e => e.jobId === 'conv-sub-1' && e.type === 'completed'));
    assert.ok(!emitted.some(e => e.jobId === 'conv-parent' && e.type === 'completed'));
    producer.dispose();
}

// ── 14. subagent waiting + killed → waiting + failed ─────────
{
    const emitted = [];
    const provider = makeProvider(runningState('conv-p2', {
        subagentStates: {
            'conv-sub-2': { status: 2, fullyIdle: false, killed: false, hasWaitingStep: true, firstWaitingStep: { status: 9, metadata: { toolCall: { name: 'permissionPrompt' } } }, latestStep: null },
        },
    }));
    const win = fakeWindow();
    win.document.body.__reactContainer$sb2 = { memoizedProps: { cascadeContext: { state: { agentStateProvider: provider } } } };
    const producer = createJobProducer({ report: (_t, d) => emitted.push(d), rescanMs: 1000, setTimeout: fn => { fn(); return 1; } });
    const _orig = global.window; global.window = win;
    producer.start(); global.window = _orig;
    const w = emitted.find(e => e.jobId === 'conv-sub-2' && e.type === 'waiting');
    assert.ok(w); assert.equal(w.waitReason, 'approval');
    provider._fire(runningState('conv-p2', {
        subagentStates: { 'conv-sub-2': { status: 1, fullyIdle: true, killed: true, hasWaitingStep: false, latestStep: null } },
    }));
    assert.ok(emitted.some(e => e.jobId === 'conv-sub-2' && e.type === 'failed'));
    producer.dispose();
}

// ── 15. subagent terminal-before-attach → started + completed ─
{
    const emitted = [];
    const provider = makeProvider(runningState('conv-p3', {
        subagentStates: {
            'conv-sub-3': { status: 1, fullyIdle: true, killed: false, hasWaitingStep: false, latestStep: { status: 3 } },
        },
    }));
    const win = fakeWindow();
    win.document.body.__reactContainer$sb3 = { memoizedProps: { cascadeContext: { state: { agentStateProvider: provider } } } };
    const producer = createJobProducer({ report: (_t, d) => emitted.push(d), rescanMs: 1000, setTimeout: fn => { fn(); return 1; } });
    const _orig = global.window; global.window = win;
    producer.start(); global.window = _orig;
    const types = emitted.filter(e => e.jobId === 'conv-sub-3').map(e => e.type);
    assert.deepEqual(types, ['started', 'completed']);
    producer.dispose();
}

// ── 16. tracker records parentJobId on job + snapshot count ──
{
    const tracker = createJobTracker({}, { now: () => 1000 });
    const emitted = [];
    const provider = makeProvider(runningState('conv-p4', {
        subagentStates: { 'conv-sub-4': { status: 2, fullyIdle: false, killed: false, hasWaitingStep: false, latestStep: null } },
    }));
    const win = fakeWindow();
    win.document.body.__reactContainer$sb4 = { memoizedProps: { cascadeContext: { state: { agentStateProvider: provider } } } };
    const producer = createJobProducer({ report: (_t, d) => { emitted.push(d); tracker.record(d); }, rescanMs: 1000, setTimeout: fn => { fn(); return 1; } });
    const _orig = global.window; global.window = win;
    producer.start(); global.window = _orig;
    const snap = tracker.snapshot();
    assert.equal(snap.observedJobs, 2);
    assert.equal(snap.subagentJobs, 1);
    assert.equal(snap.rejectedEvents, 0);
    producer.dispose();
}

console.log(`Results: ${checks} passed, 0 failed`);
