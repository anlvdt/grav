'use strict';

const { createJobTracker } = require('./job-tracker');
const MAX_TRACE = 60;
const MAX_FEEDBACK = 20;
const text = value => typeof value === 'string' ? value.slice(0, 2000) : '';
const metadata = value => { try { const raw = JSON.stringify(value); return raw.length <= 8000 ? JSON.parse(raw) : null; } catch (_) { return null; } };

function formatClock(ts) {
    const d = new Date(ts);
    return [d.getHours(), d.getMinutes(), d.getSeconds()]
        .map((n) => n < 10 ? '0' + n : String(n))
        .join(':');
}

function clampArray(items, max) {
    return Array.isArray(items) ? items.slice(0, max) : [];
}

function createObservabilityState(saved = {}) {
    const jobs = createJobTracker(saved.jobState);
    const state = {
        nextId: typeof saved.nextId === 'number' && saved.nextId > 0 ? saved.nextId : 1,
        trace: clampArray(saved.trace, MAX_TRACE),
        feedback: {
            falsePositive: saved.feedback && typeof saved.feedback.falsePositive === 'number'
                ? saved.feedback.falsePositive
                : 0,
            falseNegative: saved.feedback && typeof saved.feedback.falseNegative === 'number'
                ? saved.feedback.falseNegative
                : 0,
            entries: clampArray(saved.feedback && saved.feedback.entries, MAX_FEEDBACK),
        },
        lastBlocked: saved.lastBlocked || null,
        lastClicked: saved.lastClicked || null,
    };

    function push(event = {}) {
        const ts = Date.now();
        const entry = {
            id: 'trace-' + state.nextId++,
            ts,
            time: formatClock(ts),
            source: text(event.source) || 'app',
            action: text(event.action) || 'info',
            label: text(event.label) || '',
            pattern: text(event.pattern) || '',
            cmd: text(event.cmd) || '',
            reason: text(event.reason) || '',
            decision: event.decision || null,
            reasonCode: event.reasonCode || null,
            matchedRules: Array.isArray(event.matchedRules) ? (metadata(event.matchedRules.slice(0, 32)) || []) : [],
            scope: metadata(event.scope || null),
            policyVersion: event.policyVersion || null,
            intentId: typeof event.intentId === 'string' ? event.intentId.slice(0, 300) : null,
            identityEvidence: event.identityEvidence || null,
            targetSessionId: event.targetSessionId || null,
            adapterVersion: event.adapterVersion || null,
            latencyMs: Number.isFinite(event.latencyMs) ? Math.max(0, event.latencyMs) : null,
            outcome: event.outcome === 'attempted' || ((event.action === 'clicked' || event.action === 'native-accept') && !event.dryRun) ? 'attempted' : 'unknown',
            relatedTraceId: event.relatedTraceId || null,
            tool: text(event.tool) || '',
            dryRun: !!event.dryRun,
        };
        state.trace.unshift(entry);
        if (state.trace.length > MAX_TRACE) state.trace.length = MAX_TRACE;
        if (entry.action === 'blocked') state.lastBlocked = entry;
        if ((entry.action === 'clicked' || entry.action === 'native-accept') && !entry.dryRun) {
            state.lastClicked = entry;
        }
        return entry;
    }

    function recordFeedback(kind, meta = {}) {
        const normalized = kind === 'falseNegative' ? 'falseNegative' : 'falsePositive';
        let selected;
        if (Object.prototype.hasOwnProperty.call(meta, 'traceId')) {
            if (typeof meta.traceId !== 'string' || !meta.traceId) throw new Error('Invalid feedback traceId');
            selected = state.trace.find(entry => entry.id === meta.traceId);
            if (!selected) throw new Error('Feedback traceId is missing or expired: ' + meta.traceId);
        }
        state.feedback[normalized]++;
        const related = selected || ( normalized === 'falsePositive'
            ? (meta.related || state.lastClicked)
            : (meta.related || state.lastBlocked || state.lastClicked));
        if (related) related.reviewerLegitimate = normalized === 'falseNegative';

        const entry = push({
            source: 'feedback',
            relatedTraceId: related && related.id,
            decision: related && related.decision, reasonCode: related && related.reasonCode,
            matchedRules: related && related.matchedRules, scope: related && related.scope, policyVersion: related && related.policyVersion,
            action: normalized,
            label: meta.label || (related && (related.label || related.pattern)) || '',
            cmd: meta.cmd || (related && related.cmd) || '',
            reason: meta.reason || '',
            tool: meta.tool || (related && related.tool) || '',
        });
        state.feedback.entries.unshift(entry);
        if (state.feedback.entries.length > MAX_FEEDBACK) state.feedback.entries.length = MAX_FEEDBACK;
        return entry;
    }

    function snapshot(extra = {}) {
        return Object.assign({
            jobMetrics: jobs.snapshot(),
            trace: state.trace.slice(0, 30),
            lastBlocked: state.lastBlocked,
            lastClicked: state.lastClicked,
            feedback: {
                falsePositive: state.feedback.falsePositive,
                falseNegative: state.feedback.falseNegative,
                recent: state.feedback.entries.slice(0, 8),
            },
        }, extra);
    }

    function exportState() {
        return {
            jobState: jobs.exportState(),
            nextId: state.nextId,
            trace: state.trace.slice(0, MAX_TRACE),
            feedback: {
                falsePositive: state.feedback.falsePositive,
                falseNegative: state.feedback.falseNegative,
                entries: state.feedback.entries.slice(0, MAX_FEEDBACK),
            },
            lastBlocked: state.lastBlocked,
            lastClicked: state.lastClicked,
        };
    }

    return {
        exportState,
        recordJobEvent: jobs.record,
        push,
        recordFeedback,
        snapshot,
    };
}

module.exports = {
    createObservabilityState,
};
