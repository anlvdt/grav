'use strict';

// ═══════════════════════════════════════════════════════════════
//  Grav — Host Job Lifecycle Producer
//
//  Produces verified host job lifecycle events by subscribing to
//  the workbench agentStateProvider (streamAgentStateUpdates).
//  Runs inside the agent webview context; emits [GRAV:JOB] via
//  the injected report() function.
//
//  Host semantics (from workbench bundle):
//    CascadeStatus (yc): UNSPECIFIED 0, IDLE 1, RUNNING 2,
//                        CANCELING 3, BUSY 4
//    active = status !== IDLE || fullyIdle === false
//    done   = status === IDLE && fullyIdle === true
//    waiting = any step with status WAITING (9) in trajectorySlice.stepsInSlice
//    failed  = terminal-idle with lastStepError or latestStep
//              status ∈ { CANCELED 6, ERROR 7, INTERRUPTED 12 }
// ═══════════════════════════════════════════════════════════════

function createJobProducer(options = {}) {
    const report = options.report || function () {};
    const setTimeoutImpl = options.setTimeout || setTimeout;
    const maxDepth = options.maxDepth || 64;
    const rescanMs = options.rescanMs || 3000;

    const STATUS = { IDLE: 1, RUNNING: 2, CANCELING: 3, BUSY: 4 };
    const STEP_FAILED = new Set([6, 7, 12]); // CANCELED, ERROR, INTERRUPTED

    let disposed = false;
    let unbindProvider = null;
    let rescanTimer = null;
    let lastProvider = null;

    // Per-conversation emission state: conversationId → {
    //   started, lastActive, hadWaiting, seq, firstProgressEmitted }
    const jobs = new Map();

    function emit(eventId, ev) {
        report('JOB', Object.assign({ eventId: eventId, evidence: 'host-job-lifecycle' }, ev));
    }

    function jobIdOf(state) {
        const id = state && (state.conversationId || state.cascadeId);
        return typeof id === 'string' && id.length > 0 && id.length <= 300 ? id : null;
    }

    function waitingStepOf(state) {
        const slice = state && state.trajectorySlice;
        const steps = slice && slice.stepsInSlice;
        if (!Array.isArray(steps)) return null;
        for (let i = 0; i < steps.length; i++) {
            const s = steps[i];
            if (s && s.status === 9) return s;
        }
        return null;
    }

    function latestStepOf(state) {
        const slice = state && state.trajectorySlice;
        if (slice && slice.latestStep) return slice.latestStep;
        const steps = slice && slice.stepsInSlice;
        return Array.isArray(steps) && steps.length ? steps[steps.length - 1] : null;
    }

    function lastErrorOf(state) {
        const slice = state && state.trajectorySlice;
        return slice && slice.lastStepError ? slice.lastStepError : null;
    }

    function waitReason(step) {
        const meta = step && (step.metadata || step);
        const name = (meta && meta.toolCall && meta.toolCall.name) || meta.toolSummary || '';
        if (/question|clarify|user_input|ask_user/i.test(name)) return 'question';
        if (/permission|approval|confirm|prompt|request/i.test(name)) return 'approval';
        if (/quota|rate.?limit|credit|billing/i.test(name)) return 'quota';
        return 'other';
    }

    function toolName(step) {
        const meta = step && (step.metadata || step);
        return (meta && meta.toolCall && meta.toolCall.name) || meta.toolSummary || undefined;
    }

    // Find a provider-shaped object in a fiber/props subtree.
    function findProvider(node, depth, seen) {
        if (!node || typeof node !== 'object' || depth > maxDepth || seen.has(node)) return null;
        seen.add(node);
        if (typeof node.getState === 'function' && typeof node.onDidChange === 'function') return node;
        // Fast path: direct state fields on a holder object.
        if (node.agentStateProvider && typeof node.agentStateProvider.getState === 'function') return node.agentStateProvider;
        if (node.state && node.state.agentStateProvider && typeof node.state.agentStateProvider.getState === 'function') return node.state.agentStateProvider;
        if (node.cascadeContext && node.cascadeContext.state && node.cascadeContext.state.agentStateProvider) return node.cascadeContext.state.agentStateProvider;
        if (node.props && node.props.cascadeContext && node.props.cascadeContext.state && node.props.cascadeContext.state.agentStateProvider) return node.props.cascadeContext.state.agentStateProvider;
        if (node.memoizedProps && node.memoizedProps.cascadeContext && node.memoizedProps.cascadeContext.state) return node.memoizedProps.cascadeContext.state.agentStateProvider || null;
        // Depth-first walk through enumerable values (bounded).
        let count = 0;
        for (const key of Object.keys(node)) {
            if (count++ > 40) break;
            if (key === '__gravPolicy' || key === '__gravObserver' || key === 'parent' || key === '_debugOwner') continue;
            const v = node[key];
            if (v && typeof v === 'object') {
                const hit = findProvider(v, depth + 1, seen);
                if (hit) return hit;
            }
        }
        return null;
    }

    // Walk React/Preact roots via DOM element expandos to locate the provider.
    // React 18+ attaches '__reactContainer$<rand>' to container nodes; Preact
    // attaches '__k' / '__P' to DOM elements.
    function locateProvider() {
        if (typeof window === 'undefined' || !window.document) return null;
        const seen = new Set();
        const doc = window.document;
        const candidates = [];
        if (doc.body) candidates.push(doc.body);
        const els = doc.body ? doc.body.querySelectorAll('*') : [];
        for (let i = 0; i < els.length && i < 400; i++) candidates.push(els[i]);
        const roots = [];
        for (let i = 0; i < candidates.length; i++) {
            const el = candidates[i];
            const keys = Object.getOwnPropertyNames(el);
            for (let k = 0; k < keys.length; k++) {
                const key = keys[k];
                if (key.indexOf('__reactContainer') === 0 || key.indexOf('__reactFiber') === 0 || key.indexOf('__k') === 0 || key.indexOf('__P') === 0) {
                    const v = el[key];
                    if (v && typeof v === 'object') roots.push(v);
                }
            }
        }
        for (let i = 0; i < roots.length; i++) {
            const hit = findProvider(roots[i], 0, seen);
            if (hit) return hit;
        }
        return null;
    }

    function reconcile(state) {
        if (!state || typeof state !== 'object') return;
        const jid = jobIdOf(state);
        if (!jid) return;
        let job = jobs.get(jid);
        const status = state.status;
        const active = status !== STATUS.IDLE || state.fullyIdle === false;
        const done = status === STATUS.IDLE && state.fullyIdle === true;
        const waitingStep = waitingStepOf(state);
        const err = lastErrorOf(state);
        const latest = latestStepOf(state);
        const latestFailed = latest && STEP_FAILED.has(latest.status);

        if (!job) {
            if (!done && status !== undefined) {
                job = { started: true, seq: 0, firstProgress: false, hadWaiting: false };
                jobs.set(jid, job);
                emit(++job.seq + ':' + jid, { jobId: jid, type: 'started', sequence: job.seq, status: status });
            } else {
                return;
            }
        }

        if (job.dead) return;

        if (waitingStep && !job.hadWaiting) {
            job.hadWaiting = true;
            emit(++job.seq + ':' + jid, {
                jobId: jid, type: 'waiting', sequence: job.seq,
                waitReason: waitReason(waitingStep), toolName: toolName(waitingStep),
            });
        } else if (!waitingStep && job.hadWaiting) {
            job.hadWaiting = false;
        }

        if (done) {
            job.dead = true;
            if (err || latestFailed) {
                emit(++job.seq + ':' + jid, { jobId: jid, type: 'failed', sequence: job.seq, error: err ? String(err).slice(0, 200) : undefined });
            } else {
                emit(++job.seq + ':' + jid, { jobId: jid, type: 'completed', sequence: job.seq });
            }
            return;
        }

        if (active && !waitingStep) {
            if (!job.firstProgress) {
                job.firstProgress = true;
                emit(++job.seq + ':' + jid, { jobId: jid, type: 'progress', sequence: job.seq, phase: 'execution' });
            }
        }
    }

    function bind(provider) {
        if (disposed || !provider || provider === lastProvider) return;
        lastProvider = provider;
        if (unbindProvider) { try { unbindProvider(); } catch { /* noop */ } unbindProvider = null; }
        try {
            const sub = provider.onDidChange(function () {
                try { reconcile(provider.getState()); } catch { /* noop */ }
            });
            unbindProvider = typeof sub === 'function' ? sub : (sub && typeof sub.dispose === 'function' ? () => sub.dispose() : null);
            // Initial snapshot — may already be mid-flight.
            try { reconcile(provider.getState()); } catch { /* noop */ }
        } catch { /* noop */ }
    }

    function schedule() {
        if (disposed) return;
        rescanTimer = setTimeoutImpl(function () {
            if (disposed) return;
            const provider = locateProvider();
            if (provider) bind(provider); else schedule();
        }, rescanMs);
    }

    function start() {
        if (disposed) return;
        const provider = locateProvider();
        if (provider) bind(provider); else schedule();
    }

    function dispose() {
        disposed = true;
        if (rescanTimer !== null) { clearTimeout(rescanTimer); rescanTimer = null; }
        if (unbindProvider) { try { unbindProvider(); } catch { /* noop */ } unbindProvider = null; }
        jobs.clear();
        lastProvider = null;
    }

    return { start: start, dispose: dispose, _locateProvider: locateProvider };
}

module.exports = { createJobProducer, browserSource: '(' + createJobProducer.toString() + ')' };
