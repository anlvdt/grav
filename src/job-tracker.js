'use strict';

const TYPES = new Set(['started', 'progress', 'waiting', 'completed', 'failed', 'intervention', 'recovery-start']);
const WAITS = new Set(['approval', 'question', 'quota', 'recovery', 'other']);
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 300;
const percentile = (values, p) => values.length ? [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1] : null;

function createJobTracker(saved = {}, options = {}) {
    const now = options.now || Date.now, maxJobs = options.maxJobs || 2000;
    const jobs = new Map((Array.isArray(saved.jobs) ? saved.jobs : []).slice(0, maxJobs)
        .filter(j => j && id(j.jobId) && Number.isFinite(j.startedAt) && Array.isArray(j.eventIds))
        .map(j => [j.jobId, { ...j, eventIds: j.eventIds.slice(0, 1000) }]));
    let rejected = 0;
    function closeWait(job, ts) {
        if (job.wait) {
            job.waits.push({ reason: job.wait.reason, durationMs: Math.max(0, ts - job.wait.at) });
            job.wait = null;
        }
    }
    function record(event = {}) {
        const host = event.evidence === 'host-job-lifecycle';
        if (!id(event.jobId) || !id(event.eventId) || !TYPES.has(event.type)) { rejected++; return false; }
        if (host && event.sequence !== undefined && (!Number.isSafeInteger(event.sequence) || event.sequence < 0)) { rejected++; return false; }
        let job = jobs.get(event.jobId);
        if (!job) {
            if (!host || event.type !== 'started' || jobs.size >= maxJobs) { rejected++; return false; }
            job = { jobId: event.jobId, startedAt: now(), status: 'running', eventIds: [], interventions: 0,
                setupInterventions: 0, waits: [], wait: null, recoveryAt: null, recoveryMs: [], recoveries: 0, recoveryAttempts: 0, unattendedRecoveries: 0, progressEvents: 0 };
            if (id(event.parentJobId)) job.parentJobId = event.parentJobId;
            jobs.set(event.jobId, job);
        }
        if (job.eventIds.includes(event.eventId) || job.status === 'completed' || job.status === 'failed') return false;
        if (job.eventIds.length >= 1000) { rejected++; return false; }
        // Transport/UI observations can show activity, never job success or failure.
        if (!host && event.type !== 'progress') { rejected++; return false; }
        if (host && event.sequence !== undefined && event.sequence <= (job.sequence ?? -1)) return false;
        const ts = now();
        job.eventIds.push(event.eventId);
        if (host && event.sequence !== undefined) job.sequence = event.sequence;
        if (event.type === 'progress' || event.type === 'completed') {
            job.progressEvents++;
            job.lastProgressAt = ts;
            if (host) {
                closeWait(job, ts);
                if (job.recoveryAt !== null) {
                    job.recoveryMs.push(Math.max(0, ts - job.recoveryAt)); job.recoveries++;
                    if (job.interventions === job.recoveryInterventions) job.unattendedRecoveries = (job.unattendedRecoveries || 0) + 1;
                    job.recoveryAt = null;
                }
            }
        }
        if (event.type === 'waiting' || event.type === 'recovery-start') {
            const reason = event.type === 'recovery-start' ? 'recovery' : WAITS.has(event.waitReason) ? event.waitReason : 'other';
            if (!job.wait || job.wait.reason !== reason) { closeWait(job, ts); job.wait = { reason, at: ts }; }
            if (reason === 'recovery' && job.recoveryAt === null) {
                job.recoveryAt = ts; job.recoveryAttempts = (job.recoveryAttempts || 0) + 1; job.recoveryInterventions = job.interventions;
            }
        }
        if (event.type === 'intervention') {
            if (event.phase === 'setup') job.setupInterventions++; else job.interventions++;
        }
        if (event.type === 'completed' || event.type === 'failed') {
            closeWait(job, ts); job.status = event.type; job.endedAt = ts;
        }
        return true;
    }
    function snapshot() {
        const rows = [...jobs.values()], completed = rows.filter(j => j.status === 'completed');
        const unattended = completed.filter(j => j.interventions === 0);
        const recoveryMs = rows.flatMap(j => j.recoveryMs);
        const recoveryAttempts = rows.reduce((n, j) => n + (j.recoveryAttempts || 0), 0);
        const unattendedRecoveries = rows.reduce((n, j) => n + (j.unattendedRecoveries || 0), 0);
        const waits = Object.fromEntries([...WAITS].map(reason => {
            const values = rows.flatMap(j => j.waits.filter(w => w.reason === reason).map(w => w.durationMs));
            return [reason, { count: values.length, totalMs: values.reduce((a, b) => a + b, 0), p50: percentile(values, .5), p95: percentile(values, .95) }];
        }));
        return { observedJobs: rows.length, completedJobs: completed.length, failedJobs: rows.filter(j => j.status === 'failed').length,
            unknownCompletionJobs: rows.filter(j => j.status === 'running').length, unattendedCompletedJobs: unattended.length,
            unattendedCompletionRate: rows.length ? unattended.length / rows.length : null,
            userInterventions: rows.reduce((n, j) => n + j.interventions, 0), setupInterventions: rows.reduce((n, j) => n + j.setupInterventions, 0),
            recoveryAttempts, unattendedRecoveries, automaticRecoveryRate: recoveryAttempts ? unattendedRecoveries / recoveryAttempts : null,
            failedRecoveries: rows.filter(j => j.status === 'failed' && j.recoveryAt !== null).length,
            recoveriesToHostProgress: recoveryMs.length, pendingRecoveries: rows.filter(j => j.status === 'running' && j.recoveryAt !== null).length,
            recoveryToProgressMs: { p50: percentile(recoveryMs, .5), p95: percentile(recoveryMs, .95) }, waits,
            activeJobs: rows.filter(j => j.status === 'running').map(j => ({ jobId: j.jobId, waitingFor: j.wait?.reason || null,
                waitingMs: j.wait ? Math.max(0, now() - j.wait.at) : 0, lastProgressAt: j.lastProgressAt ?? null })),
            subagentJobs: rows.filter(j => j.parentJobId).length,
            rejectedEvents: rejected, evidence: 'host-job-lifecycle', caveat: 'Only explicit host job starts enter the denominator; unknown outcomes and failed jobs remain in it. Renderer activity and approvals do not prove completion.' };
    }
    return { record, snapshot, exportState: () => ({ jobs: [...jobs.values()].map(j => ({ ...j, eventIds: j.eventIds.slice(), waits: j.waits.slice(), recoveryMs: j.recoveryMs.slice() })) }) };
}
module.exports = { createJobTracker };
