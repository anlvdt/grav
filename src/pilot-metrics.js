'use strict';

function summarizePilot(opportunities, provenance = {}, jobMetrics = null) {
    const rows = opportunities.slice(-2000);
    const labeled = rows.filter(r => typeof r.legitimate === 'boolean');
    const attempts = rows.filter(r => r.attempted);
    const latencies = attempts.map(r => r.latencyMs).filter(n => Number.isFinite(n) && n >= 0).sort((a,b) => a-b);
    const percentile = p => latencies.length ? latencies[Math.max(0, Math.ceil(latencies.length * p) - 1)] : null;
    return { provenance, jobMetrics, opportunities: rows.length, labeledOpportunities: labeled.length, legitimateOpportunities: labeled.filter(r => r.legitimate).length,
        handledLegitimateApprovals: labeled.filter(r => r.legitimate && r.attempted).length,
        falseAutoapprovals: labeled.filter(r => !r.legitimate && r.attempted).length,
        duplicateAttempts: attempts.length - new Set(attempts.map(r => r.intentId)).size,
        unknownOutcomes: attempts.filter(r => r.outcome !== 'completed').length,
        userInterventions: rows.filter(r => r.intervention).length,
        latencyMs: { p50: percentile(.5), p95: percentile(.95) },
        reconnectRecoveryMs: rows.map(r => r.recoveryMs).filter(Number.isFinite),
        caveat: 'Labeled opportunities are required for error rates. Zero observed errors does not imply zero risk. Clicks are approval attempts, not command success.' };
}
module.exports = { summarizePilot };
