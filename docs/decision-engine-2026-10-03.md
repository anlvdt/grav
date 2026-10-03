# Configured interaction decisions — 2026-10-03

Implemented in `src/decision-engine.js`; verified with `node test/decision-engine.test.js` (22 passed, zero failed). Changes are limited to this document, that module, and its test. This work implements deterministic decisions and revalidation, not a host RPC or an end-to-end unattended workflow. Runtime integration belongs to the autonomy worker; the API and source findings were sent through the coordinator mailbox.

## API and explicit configuration

CommonJS exports `createDecisionEngine`, `fingerprint`, `decide`, and `revalidate`. The factory is self-contained and can be embedded via `createDecisionEngine.toString()` in either renderer; it does not reference DOM, Node imports, clocks, mutable state, or host services. Pass a finite millisecond timestamp explicitly to each evaluation.

```js
const engine = createDecisionEngine();
const request = {
    kind: 'question', requestId: 'shared-request-identity',
    questionId: 'output-language', // optional: use only a real known question ID
    context: { project: '/work', taskId: 'task1' },
    prompt: 'Choose output language', multiple: false,
    options: [
        { id: 'en', label: 'English', value: 'english' },
        { id: 'vi', label: 'Vietnamese', value: 'vietnamese' }
    ]
};
const rules = [{
    id: 'language-for-task1', kind: 'question', questionId: 'output-language',
    fingerprint: engine.fingerprint(request), scope: { taskId: 'task1' },
    answer: { optionIds: ['vi'] }, expiresAt: 1791000000000
}];
const policy = { enabled: true, version: 'current-policy-version', rules };
const result = engine.decide(request, policy, now);
// Re-read the request and policy before actuation; do not reuse stale objects.
const valid = engine.revalidate(result, currentRequest, currentPolicy, currentNow);
```

The rule array can be supplied from explicitly configured preferences or an explicit task-context answer. The evaluator does not extract preferences from prose, rank options, choose defaults, learn grants, or invent text. It returns `status: 'unanswered'` for absent, incomplete, malformed, mismatched, ambiguous, sensitive, or expired configuration.

Policy fields are `enabled`, `version`, `rules`, and optional boolean `paused`, `dryRun`, `revoked`, plus optional numeric `expiresAt`. Rules are a bounded array (256 maximum), with unique IDs, exact `kind` and `fingerprint`, a nonempty `scope`, and an `answer`. Optional rule fields are `questionId`, `revisionId`, numeric `expiresAt`, and boolean `revoked`. Scope keys are `project`, `taskId`, and `conversationId`; every configured scope key must equal the actual request context. No global wildcard scope exists. Expiry is exclusive: a rule expiring at the evaluation timestamp is inactive. Multiple active matching rules leave the interaction unanswered even if their answers agree.

For storage, the proposal sent to the runtime owner is a separate `grav.decisionRules` rule array, wrapped into this evaluator's policy with the existing effective policy version and enabled state. This worker adds no setting or dead runtime configuration. Expose the setting only with a verified request producer and consumer, or clearly expose the capability as unavailable.

## Typed requests and answers

All requests require `kind`, a nonempty `requestId` supplied by the shared adapter identity, and `context` containing only verified project/task/conversation IDs. Optional `sensitive: true` blocks automatic answering. OAuth, billing, payment, password, credential, credit-card, and access-token wording in the request is also excluded as a conservative backstop; adapters must mark sensitive requests using the host's actual type, since wording alone cannot exhaustively classify them.

| Kind | Required content | Configured answer | Answered result |
| --- | --- | --- | --- |
| `question` | Nonempty `prompt`, unique options `{id,label,value?,disabled?}`, optional boolean `multiple`, optional real `questionId` | `{optionIds: ['exact-id']}`; multiple IDs only when `multiple: true` | `optionIds` and corresponding scalar `values`; absent option values fall back to their IDs |
| `form` | `schema` described below | `{values: {field: explicitScalar}}` | Copy of the exact configured `values` |
| `review-plan` | Nonempty `prompt` containing actual plan content, nonempty `revisionId` | `{decision: 'approve'}` or `{decision: 'reject'}`, plus matching rule `revisionId` | `decision` and `revisionId` |

Forms support only `{type:'object', properties:{...}, required:[...], additionalProperties:false}`. Each field supports scalar `type` (`string`, `number`, `integer`, `boolean`), optional `enum`, numeric `minimum`/`maximum`, and string `minLength`/`maxLength`. Unknown keywords, arrays, nested objects, formats, regex constraints, missing required fields, unknown supplied fields, type coercion, and out-of-bounds values stay unanswered. Strings come only from configuration, never generated responses or schema defaults. Optional fields may remain absent.

Answered results also carry `reasonCode: 'configured-answer'`, `kind`, `requestId`, `fingerprint`, `scope`, `ruleId`, and `policyVersion`. Unanswered results carry only status, reason, and available fingerprint; no actuation payload is supplied.

Fingerprints are collision-free canonical JSON snapshots prefixed `decision-v1:` rather than short hashes. They bind prompt, known question ID, option order/labels/values/disabled state, schema, revision, context, and other supplied content. They exclude `requestId` so identical recurring requests can reuse a preference in their configured context; the decision's separate request ID prevents revalidating it against another instance. Fingerprints can contain task/form content and must not be sent to routine diagnostic logs. Requests are bounded to 32 KiB canonical snapshots, 64 question options/form properties, bounded scalar strings, and eight nested levels. Cyclic and non-JSON values are rejected.

`revalidate` recomputes the decision from fresh request, policy, and timestamp and compares the entire result. It rejects changed identity, scope, answer, policy version, content, expiry, revocation, and tampered result payloads. The runtime must still enforce lease ownership, dry-run/pause, and ledger checks independently; this module claims no side-effect ownership.

## Installed-source evidence and runtime wiring

Read-only inspection of `/Applications/Antigravity IDE.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js` found the following version-specific producer relationships (runtime owner identified IDE 2.5.5):

- `pTu` renders option inputs with IDs `ask-opt-${generatedId}-${option.id}`, names `ask-question-${generatedId}`, option values equal to the actual question option IDs, label text from `option.text`, and a special `__write_in__` input plus `textarea[data-testid="ask-question-writein"]`.
- `T9n` receives `questions`, `count`, `clampedIdx`, and `toolName`. It renders previous/next question buttons only when count exceeds one, and uses `interaction-continue-button` and `interaction-skip-button`. This component is shared with permission interactions, so a generic Submit button or matching radio name does not establish a question request.
- `mTu` receives actual `step.questions`, `status`, and `metadata.sourceTrajectoryStepInfo` with `cascadeId`, `trajectoryId`, and `stepIndex`. Its submission uses those host identities and maps all question responses to `selectedOptionIds`, `writeInResponse`, and `skipped`. No host request/task attributes are emitted on the inspected question controls.
- For single-select, `pTu` schedules `onNextNoWrap` 200 ms after option change; `mTu` calls its submission callback when already on the final question. A radio click therefore can submit without any subsequent Submit click. Multi-select does not take that automatic path.

A plausible minimal producer is a bounded read-only React-fiber walk from verified controls to source-mapped `T9n` and `mTu` props. It must verify `toolName === 'ask_question'`, a pending status, a single complete question, matching parent/child question data, actual identity triple, matching current DOM options, no write-in selection/text, and no hidden questions. Use the actual cascade ID as conversation context and a shared identity derived from the host triple, never call internal submit callbacks or invent host attributes. The generated radio name alone is local mount evidence, not host identity; remounts can change it. This worker did not access a live React tree or prove that this producer works on a running request, so it remains a proposed source-backed route requiring adapter verification, not an active supported capability.

Runtime owner must:

1. Extract a normalized typed request from a version-verified host producer. Map actual question text/options into prompt and option IDs/values. Obtain task/project context from trusted current runtime state; do not infer scope from arbitrary card text. For forms preserve the complete schema; for plans preserve actual content and revision identity. Missing evidence must retain an explicit unanswered/unsupported result.
2. Pass fresh effective policy and configured rules to `decide`. Require `answered`; claim the existing shared intent ledger and lease using the same request identity in both adapters. Store the decision fingerprint in the pending intent payload.
3. Re-extract controls and context, call `revalidate`, and verify policy/lease/ledger ownership immediately before each side effect. Reject user-entered write-ins and conflicting existing responses. Mark attempted before controls that can submit automatically. Single-select radio clicks must be treated as submission attempts, with no duplicate explicit Submit; delayed host auto-submit introduces a host-owned timing window that a pure evaluator cannot cancel after the click.
4. For multi-select or forms, use supported native input events, re-read React-controlled state and exact selected IDs/values, then revalidate again before Submit. Cancel if any control/schema/revision changes. Do not blindly retry an unknown result.
5. Observe UI acknowledgment and subsequent task progress separately. A disappearing/disabled Submit button is not host completion. Retain unknown results in the existing ledger to prevent duplicates.

There is currently no verified DOM producer for the complete form schema or plan revision identity established by this worker. The pure module supports their typed contracts, but answering live forms/plans must remain unavailable until the runtime supplies those verified producers. Tests establish evaluator semantics and browser embedding parity, not host receipt or task completion.
