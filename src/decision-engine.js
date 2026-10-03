'use strict';

// Self-contained factory: embed this exact evaluator in either renderer adapter.
function createDecisionEngine() {
    const kinds = ['question', 'form', 'review-plan'];
    const scopeKeys = ['project', 'taskId', 'conversationId'];
    const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
    const id = value => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 200;
    const scalar = value => typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && value.length <= 4000);
    const only = (value, keys) => object(value) && Object.keys(value).every(key => keys.includes(key));
    function canonical(value, depth = 0) {
        if (depth > 8) throw new Error('too-deep');
        if (value === null || scalar(value) || (typeof value === 'string' && value.length <= 32780)) return JSON.stringify(value);
        if (Array.isArray(value) && value.length <= 256) return '[' + Array.from(value, v => canonical(v, depth + 1)).join(',') + ']';
        if (object(value) && Object.prototype.toString.call(value) === '[object Object]' && Object.keys(value).length <= 128) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key], depth + 1)).join(',') + '}';
        throw new Error('invalid-json');
    }
    function fingerprint(request) {
        try {
            // Preferences can cover identical recurring questions in their bound context.
            // Instance identity is separately included in the decision and revalidation.
            if (!object(request)) return null;
            const payload = { ...request };
            delete payload.requestId;
            const value = canonical(payload);
            return value.length <= 32768 ? 'decision-v1:' + value : null;
        } catch (_) { return null; }
    }
    function validSchema(schema) {
        if (!only(schema, ['type', 'properties', 'required', 'additionalProperties']) || schema.type !== 'object' || !object(schema.properties) || schema.additionalProperties !== false) return false;
        const fields = Object.keys(schema.properties);
        if (!fields.length || fields.length > 64 || fields.some(key => !id(key) || ['__proto__', 'constructor', 'prototype'].includes(key))) return false;
        if (!Array.isArray(schema.required) || new Set(schema.required).size !== schema.required.length || schema.required.some(key => !fields.includes(key))) return false;
        return fields.every(key => {
            const spec = schema.properties[key];
            if (!only(spec, ['type', 'enum', 'minimum', 'maximum', 'minLength', 'maxLength']) || !['string', 'number', 'integer', 'boolean'].includes(spec.type)) return false;
            if (spec.enum !== undefined && (!Array.isArray(spec.enum) || !spec.enum.length || !spec.enum.every(value => scalar(value) && (spec.type === 'integer' ? Number.isInteger(value) : typeof value === spec.type)))) return false;
            for (const bound of ['minimum', 'maximum', 'minLength', 'maxLength']) {
                if (spec[bound] !== undefined && (!Number.isFinite(spec[bound]) || (bound.endsWith('Length') ? spec.type !== 'string' || !Number.isInteger(spec[bound]) || spec[bound] < 0 : !['number', 'integer'].includes(spec.type)))) return false;
            }
            return !(spec.minimum > spec.maximum || spec.minLength > spec.maxLength);
        });
    }
    function validValues(values, schema) {
        if (!object(values) || schema.required.some(key => !Object.prototype.hasOwnProperty.call(values, key))) return false;
        return Object.keys(values).every(key => {
            if (!Object.prototype.hasOwnProperty.call(schema.properties, key)) return false;
            const value = values[key], spec = schema.properties[key];
            if (!scalar(value) || (spec.type === 'integer' ? !Number.isInteger(value) : typeof value !== spec.type)) return false;
            if (spec.enum && !spec.enum.includes(value)) return false;
            if (typeof value === 'number' && (value < spec.minimum || value > spec.maximum)) return false;
            return typeof value !== 'string' || !(value.length < spec.minLength || value.length > spec.maxLength);
        });
    }
    function validRequest(request) {
        if (!object(request) || !kinds.includes(request.kind) || !id(request.requestId) || !only(request.context, scopeKeys)) return false;
        if (Object.values(request.context).some(value => !id(value))) return false;
        if (request.questionId !== undefined && !id(request.questionId)) return false;
        if (request.sensitive !== undefined && typeof request.sensitive !== 'boolean') return false;
        if (request.kind === 'form') return validSchema(request.schema);
        if (typeof request.prompt !== 'string' || !request.prompt.trim() || request.prompt.length > 4000) return false;
        if (request.kind === 'review-plan') return id(request.revisionId);
        if (request.multiple !== undefined && typeof request.multiple !== 'boolean') return false;
        return Array.isArray(request.options) && request.options.length > 0 && request.options.length <= 64 &&
            new Set(request.options.map(option => option && option.id)).size === request.options.length &&
            request.options.every(option => only(option, ['id', 'label', 'value', 'disabled']) && id(option.id) &&
                typeof option.label === 'string' && option.label.trim().length > 0 && option.label.length <= 2000 &&
                (option.value === undefined || scalar(option.value)) && (option.disabled === undefined || typeof option.disabled === 'boolean'));
    }
    function sensitive(request) {
        // The adapter must also mark sensitive host interactions; text is a backstop.
        return request.sensitive === true || /\b(?:oauth|billing|payment|credit[ -]?card|password|credential|access[ -]?token)\b/i.test(canonical(request));
    }
    function validRule(rule) {
        return only(rule, ['id', 'kind', 'questionId', 'fingerprint', 'scope', 'answer', 'revisionId', 'expiresAt', 'revoked']) &&
            id(rule.id) && kinds.includes(rule.kind) && typeof rule.fingerprint === 'string' && rule.fingerprint.startsWith('decision-v1:') && rule.fingerprint.length <= 32780 &&
            (rule.questionId === undefined || id(rule.questionId)) && (rule.revisionId === undefined || id(rule.revisionId)) &&
            only(rule.scope, scopeKeys) && Object.keys(rule.scope).length > 0 && Object.values(rule.scope).every(id) &&
            object(rule.answer) && (rule.revoked === undefined || typeof rule.revoked === 'boolean') &&
            (rule.expiresAt === undefined || Number.isFinite(rule.expiresAt));
    }
    function decide(request, policy, now) {
        const fp = fingerprint(request);
        const unanswered = reasonCode => ({ status: 'unanswered', reasonCode, fingerprint: fp });
        if (!fp || !validRequest(request)) return unanswered('invalid-request');
        if (sensitive(request)) return unanswered('sensitive-interaction');
        if (!Number.isFinite(now) || !object(policy) || policy.enabled !== true || policy.paused === true || policy.dryRun === true || policy.revoked === true || (policy.expiresAt !== undefined && policy.expiresAt <= now)) return unanswered('policy-inactive');
        if (['paused', 'dryRun', 'revoked'].some(key => policy[key] !== undefined && typeof policy[key] !== 'boolean') || (policy.expiresAt !== undefined && !Number.isFinite(policy.expiresAt))) return unanswered('invalid-policy');
        if (!id(policy.version) || !Array.isArray(policy.rules) || policy.rules.length > 256 || policy.rules.some(rule => !validRule(rule)) || new Set(policy.rules.map(rule => rule.id)).size !== policy.rules.length) return unanswered('invalid-policy');
        const matches = policy.rules.filter(rule => !rule.revoked && (rule.expiresAt === undefined || rule.expiresAt > now) &&
            rule.kind === request.kind && rule.fingerprint === fp && (rule.questionId === undefined || rule.questionId === request.questionId) &&
            Object.keys(rule.scope).every(key => request.context[key] === rule.scope[key]));
        if (matches.length !== 1) return unanswered(matches.length ? 'ambiguous-answer' : 'no-configured-answer');
        const rule = matches[0], answer = rule.answer;
        let result;
        if (request.kind === 'question') {
            if (!only(answer, ['optionIds']) || !Array.isArray(answer.optionIds) || !answer.optionIds.length || answer.optionIds.length > 64 || new Set(answer.optionIds).size !== answer.optionIds.length || (request.multiple !== true && answer.optionIds.length !== 1)) return unanswered('invalid-answer');
            const selected = answer.optionIds.map(value => request.options.find(option => option.id === value && option.disabled !== true));
            if (selected.some(option => !option)) return unanswered('invalid-answer');
            result = { optionIds: [...answer.optionIds], values: selected.map(option => option.value === undefined ? option.id : option.value) };
        } else if (request.kind === 'form') {
            if (!only(answer, ['values']) || !validValues(answer.values, request.schema)) return unanswered('invalid-answer');
            result = { values: { ...answer.values } };
        } else {
            if (rule.revisionId !== request.revisionId || !only(answer, ['decision']) || !['approve', 'reject'].includes(answer.decision)) return unanswered('invalid-answer');
            result = { decision: answer.decision, revisionId: request.revisionId };
        }
        return { status: 'answered', reasonCode: 'configured-answer', kind: request.kind, requestId: request.requestId,
            fingerprint: fp, scope: { ...rule.scope }, ruleId: rule.id, policyVersion: policy.version, ...result };
    }
    function revalidate(decision, request, policy, now) {
        if (!decision || decision.status !== 'answered') return false;
        try {
            const current = decide(request, policy, now);
            return current.status === 'answered' && canonical(decision) === canonical(current);
        } catch (_) { return false; }
    }
    return { fingerprint, decide, revalidate };
}
module.exports = { createDecisionEngine, ...createDecisionEngine() };
