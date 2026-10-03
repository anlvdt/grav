'use strict';
const assert = require('assert/strict');
const vm = require('vm');
const engine = require('../src/decision-engine');
let passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; } catch (error) { failed++; console.error(name, error); } }
const clone = value => JSON.parse(JSON.stringify(value));
const question = { kind: 'question', requestId: 'host:r1', questionId: 'output-language', context: { project: '/work', taskId: 'task1' }, prompt: 'Choose output language', multiple: false,
    options: [{ id: 'en', label: 'English', value: 'english' }, { id: 'vi', label: 'Vietnamese', value: 'vietnamese' }] };
const form = { kind: 'form', requestId: 'host:f1', context: { project: '/work' }, schema: { type: 'object', additionalProperties: false,
    properties: { locale: { type: 'string', enum: ['vi', 'en'] }, count: { type: 'integer', minimum: 1, maximum: 5 }, notify: { type: 'boolean' }, note: { type: 'string', minLength: 2, maxLength: 5 } }, required: ['locale', 'count', 'notify'] } };
const plan = { kind: 'review-plan', requestId: 'host:p1', context: { taskId: 'task1' }, revisionId: 'rev1', prompt: 'Implement local changes and run tests' };
function policyFor(request, answer, extra = {}) {
    return { enabled: true, version: 'v1', rules: [{ id: 'configured1', kind: request.kind, fingerprint: engine.fingerprint(request), scope: { ...request.context }, answer, ...extra }] };
}
const policy = policyFor(question, { optionIds: ['vi'] }, { questionId: question.questionId });
test('Explicit preference picks the configured second option and host value', () => {
    const decision = engine.decide(question, policy, 100);
    assert.equal(decision.status, 'answered'); assert.deepEqual(decision.optionIds, ['vi']); assert.deepEqual(decision.values, ['vietnamese']);
    assert.deepEqual(decision.scope, question.context); assert.equal(decision.requestId, 'host:r1'); assert(engine.revalidate(decision, question, policy, 100));
});
test('Unconfigured questions do not choose the first option or invent text', () => {
    const result = engine.decide(question, { ...policy, rules: [] }, 100);
    assert.equal(result.status, 'unanswered'); assert.equal(result.optionIds, undefined); assert.equal(result.values, undefined);
});
test('A known question ID cannot bypass changed option labels or values', () => {
    for (const field of ['label', 'value', 'id']) {
        const changed = clone(question); changed.options[1][field] = 'changed';
        assert.equal(engine.decide(changed, policy, 100).status, 'unanswered');
    }
});
test('Option order, prompt, multiplicity and context changes invalidate snapshot', () => {
    for (const changed of [{ ...question, options: [...question.options].reverse() }, { ...question, prompt: 'Different task?' }, { ...question, multiple: true }, { ...question, context: { project: '/other', taskId: 'task1' } }]) {
        assert.equal(engine.decide(changed, policy, 100).status, 'unanswered');
    }
});
test('Recurring exact questions reuse preference but decision stays instance bound', () => {
    const next = { ...question, requestId: 'host:r2' }, decision = engine.decide(question, policy, 100);
    assert.equal(engine.decide(next, policy, 100).status, 'answered'); assert(!engine.revalidate(decision, next, policy, 100));
});
test('Fingerprint ignores object key ordering but includes option sequence', () => {
    assert.equal(engine.fingerprint(question), engine.fingerprint({ options: question.options, prompt: question.prompt, multiple: false, context: { taskId: 'task1', project: '/work' }, questionId: question.questionId, requestId: question.requestId, kind: question.kind }));
});
test('Multi-select returns exactly the configured IDs and values', () => {
    const request = { ...question, multiple: true }, p = policyFor(request, { optionIds: ['vi', 'en'] });
    const result = engine.decide(request, p, 100); assert.deepEqual(result.optionIds, ['vi', 'en']); assert.deepEqual(result.values, ['vietnamese', 'english']);
});
test('Duplicate, empty, missing and single-select multiple answers stay unanswered', () => {
    for (const optionIds of [[], ['en', 'en'], ['missing'], ['en', 'vi']]) assert.equal(engine.decide(question, policyFor(question, { optionIds }), 100).status, 'unanswered');
});
test('Disabled and malformed options cannot be selected', () => {
    const request = clone(question); request.options[1].disabled = true;
    assert.equal(engine.decide(request, policyFor(request, { optionIds: ['vi'] }), 100).status, 'unanswered');
    request.options[1].id = 'en'; assert.equal(engine.decide(request, policyFor(request, { optionIds: ['en'] }), 100).reasonCode, 'invalid-request');
});
test('Configured scalar forms retain types and never supply missing values', () => {
    const values = { locale: 'vi', count: 2, notify: false, note: 'hello' }, p = policyFor(form, { values });
    assert.deepEqual(engine.decide(form, p, 100).values, values);
    for (const invalid of [{ locale: 'vi' }, { ...values, count: '2' }, { ...values, count: 1.5 }, { ...values, count: 6 }, { ...values, locale: 'fr' }, { ...values, unknown: 'x' }, { ...values, note: 'toolong' }, { ...values, notify: {} }]) {
        assert.equal(engine.decide(form, policyFor(form, { values: invalid }), 100).status, 'unanswered');
    }
});
test('Changed form schema invalidates a previously configured answer', () => {
    const p = policyFor(form, { values: { locale: 'vi', count: 2, notify: true } }), changed = clone(form);
    changed.schema.properties.count.maximum = 10;
    assert.equal(engine.decide(changed, p, 100).status, 'unanswered');
});
test('Unsupported schema constraints and incomplete schemas fail closed', () => {
    for (const mutate of [r => { r.schema.properties.locale.pattern = '.*'; }, r => { r.schema.additionalProperties = true; }, r => { delete r.schema.required; }, r => { r.schema.properties.count.type = 'array'; }, r => { r.schema.properties.locale.maxLength = -1; }]) {
        const request = clone(form); mutate(request);
        assert.equal(engine.decide(request, policyFor(request, { values: {} }), 100).reasonCode, 'invalid-request');
    }
});
test('Explicit plan review needs a matching revision and exact content', () => {
    const p = policyFor(plan, { decision: 'approve' }, { revisionId: 'rev1' });
    assert.equal(engine.decide(plan, p, 100).decision, 'approve');
    assert.equal(engine.decide(plan, policyFor(plan, { decision: 'reject' }, { revisionId: 'rev1' }), 100).decision, 'reject');
    for (const changed of [{ ...plan, revisionId: 'rev2' }, { ...plan, prompt: 'Deploy externally' }]) assert.equal(engine.decide(changed, p, 100).status, 'unanswered');
    assert.equal(engine.decide(plan, policyFor(plan, { decision: 'approve' }), 100).status, 'unanswered');
    assert.equal(engine.decide(plan, policyFor(plan, { decision: 'revise', text: 'Invented revision' }, { revisionId: 'rev1' }), 100).status, 'unanswered');
});
test('OAuth, billing and explicitly sensitive interactions remain unanswered', () => {
    for (const request of [{ ...question, prompt: 'Approve OAuth connection?' }, { ...question, prompt: 'Confirm billing?' }, { ...question, sensitive: true }, { ...form, schema: { type: 'object', properties: { password: { type: 'string' } }, required: ['password'], additionalProperties: false } }]) {
        const p = policyFor(request, request.kind === 'form' ? { values: { password: 'secret' } } : { optionIds: ['en'] });
        assert.equal(engine.decide(request, p, 100).reasonCode, 'sensitive-interaction');
    }
});
test('Revocation, expiry and policy state invalidate pending decisions', () => {
    const p = policyFor(question, { optionIds: ['vi'] }, { expiresAt: 101 }), result = engine.decide(question, p, 100);
    assert.equal(result.status, 'answered'); assert(!engine.revalidate(result, question, p, 101));
    for (const patch of [{ enabled: false }, { paused: true }, { dryRun: true }, { revoked: true }, { expiresAt: 100 }, { version: 'v2' }, { rules: [] }, { rules: [{ ...p.rules[0], revoked: true }] }]) assert(!engine.revalidate(result, question, { ...p, ...patch }, 100));
});
test('Scope cannot match an absent or different task', () => {
    const request = { ...question, context: { project: '/work' } }, p = policyFor(request, { optionIds: ['en'] }, { scope: { taskId: 'task1' } });
    assert.equal(engine.decide(request, p, 100).status, 'unanswered');
});
test('Conflicting matches and malformed rules never silently pick a rule', () => {
    assert.equal(engine.decide(question, { ...policy, rules: [policy.rules[0], { ...policy.rules[0], id: 'second', answer: { optionIds: ['en'] } }] }, 100).reasonCode, 'ambiguous-answer');
    for (const extra of [{ scope: {} }, { expiresAt: 'tomorrow' }, { revoked: 'false' }, { fingerprint: null }, { surprise: true }]) assert.equal(engine.decide(question, { ...policy, rules: [{ ...policy.rules[0], ...extra }] }, 100).reasonCode, 'invalid-policy');
});
test('Tampered decision outputs and in-place answer changes fail revalidation', () => {
    const p = clone(policy), result = engine.decide(question, p, 100);
    assert(!engine.revalidate({ ...result, optionIds: ['en'] }, question, p, 100));
    p.rules[0].answer.optionIds = ['en']; assert(!engine.revalidate(result, question, p, 100));
});
test('Evaluation is deterministic and does not mutate requests or configuration', () => {
    const before = JSON.stringify([question, policy]), result = engine.decide(question, policy, 100);
    result.optionIds.push('en'); result.scope.project = '/changed'; result.values[0] = 'changed';
    assert.equal(JSON.stringify([question, policy]), before);
    assert.equal(engine.decide(question, policy, NaN).status, 'unanswered');
});
test('Malformed, incomplete, unknown, oversized and cyclic inputs stay unanswered', () => {
    const cyclic = { ...question }; cyclic.loop = cyclic;
    for (const request of [null, {}, { ...question, kind: 'permission' }, { ...question, requestId: '' }, { ...question, context: null }, { ...question, options: [] }, { ...question, options: new Array(2) }, { ...question, extra: new Date(0) }, { ...question, prompt: '' }, { ...question, prompt: 'x'.repeat(4001) }, cyclic]) assert.equal(engine.decide(request, policy, 100).status, 'unanswered');
    assert.equal(engine.decide(question, { ...policy, rules: Array(257).fill(policy.rules[0]) }, 100).reasonCode, 'invalid-policy');
});
test('Factory embeds without CommonJS or host APIs with matching decisions', () => {
    const browser = vm.runInNewContext('(' + engine.createDecisionEngine.toString() + ')()');
    assert.deepEqual(clone(browser.decide(question, policy, 100)), engine.decide(question, policy, 100));
    assert(browser.revalidate(browser.decide(question, policy, 100), question, policy, 100));
});
test('Long bounded option snapshots revalidate without truncated fingerprints', () => {
    const request = { ...question, options: Array.from({ length: 4 }, (_, i) => ({ id: String(i), label: 'x'.repeat(1800) })) };
    const p = policyFor(request, { optionIds: ['3'] }), result = engine.decide(request, p, 100);
    assert.equal(result.status, 'answered'); assert(result.fingerprint.length > 4000); assert(engine.revalidate(result, request, p, 100));
    const oversized = { ...request, options: Array.from({ length: 64 }, (_, i) => ({ id: String(i), label: 'x'.repeat(1800) })) };
    assert.equal(engine.fingerprint(oversized), null);
});
console.log(`Results: ${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
