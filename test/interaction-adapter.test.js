'use strict';
// Synthetic replay of the IDE 2.5.5 Wla permission card and mTu/T9n question card
// contracts verified in host-research. These fixtures stub only the DOM shape and
// React fiber chain the adapter reads; no renderer internals are invoked.
const assert = require('assert');
const Adapter = require('../src/interaction-adapter');
const CONTRACT = 'ide-2.5.5-unified-permission-dom';
let checks = 0;
const check = fn => { fn(); checks++; };

// Minimal queryable element for adapter traversal (querySelectorAll/closest/attr).
function el(tag, attrs = {}, children = [], extra = {}) {
    const node = { tagName: tag.toUpperCase(), attrs, children: [...children], parentElement: null,
        innerText: extra.innerText || '', textContent: extra.text || '',
        value: extra.value, checked: extra.checked, disabled: extra.disabled, type: attrs.type,
        isConnected: extra.isConnected !== false, clicks: 0, name: attrs.name,
        getAttribute: name => attrs[name] ?? null, hasAttribute: name => name in attrs,
        setAttribute: (name, v) => { attrs[name] = v; },
        closest: sel => { for (let n = node; n; n = n.parentElement) if (match(n, sel)) return n; return null; },
        click: () => { node.clicks++; if (extra.onClick) extra.onClick(node); else if (node.tagName === 'LABEL') { const r = collect(node, 'input')[0]; if (r && !r.disabled && !r.checked) r.checked = true; } else if (node.tagName === 'INPUT' && !node.disabled) node.checked = true; },
        querySelectorAll: sel => collect(node, sel),
        querySelector: sel => collect(node, sel)[0] || null };
    for (const c of node.children) c.parentElement = node;
    return node;
}
function match(node, sel) {
    const parts = sel.split(',').map(s => s.trim());
    return parts.some(part => {
        if (part === 'label') return node.tagName === 'LABEL';
        if (part.includes('[class*=')) return /tool|step|action|approval/.test((node.attrs.class || '')) === /tool|step|action|approval/.test(part.replace('[class*=', '').replace(']', '')) || new RegExp(part.slice(8, -1)).test(node.attrs.class || '');
        if (part.startsWith('input')) {
            if (node.tagName !== 'INPUT') return false;
            const nm = part.match(/name\^="([^"]+)"/);
            if (nm) return (node.attrs.name || '').startsWith(nm[1]);
            const exact = part.match(/name="([^"]+)"/);
            if (exact) return node.attrs.name === exact[1];
            return node.attrs.type === 'radio';
        }
        if (part.startsWith('textarea')) {
            if (node.tagName !== 'TEXTAREA') return false;
            const m = part.match(/aria-label="([^"]+)"|data-testid="([^"]+)"/);
            if (!m) return true;
            return m[1] ? node.attrs['aria-label'] === m[1] : node.attrs['data-testid'] === m[2];
        }
        if (part.startsWith('button')) {
            if (node.tagName !== 'BUTTON') return false;
            const m = part.match(/data-testid="([^"]+)"/);
            return !m || node.attrs['data-testid'] === m[1];
        }
        if (part.startsWith('svg')) return node.tagName === 'SVG' || node.tagName === 'MASK';
        if (part === 'span') return node.tagName === 'SPAN';
        return false;
    });
}
function collect(node, sel, out = []) {
    for (const c of node.children) { if (match(c, sel)) out.push(c); collect(c, sel, out); }
    return out;
}
// Wrap a node in a fiber chain: fiber props sit on nodes reachable from `start`
// via parentElement; the fiber itself is attached as __reactFiber$X.
function attachFiber(node, chain) {
    // chain[0] is deepest (closest component); later entries are .return parents.
    const fiber = { memoizedProps: chain[0] };
    let f = fiber;
    for (let i = 1; i < chain.length; i++) { f.return = { memoizedProps: chain[i] }; f = f.return; }
    node['__reactFiber$stub'] = fiber;
    return fiber;
}

// ── Permission card (Wla) ──────────────────────────────────────────────────
const SCOPE_LABELS = { once: 'Yes, allow this time', conversation: 'Yes, and always allow in this conversation',
    project: 'Yes, and always allow in this project', workspace: 'Yes, and always allow in this workspace', global: 'Yes, and always allow' };
function permissionCard({ selected = 'once', scopes = ['once', 'project'], disabledScopes = [], operation = 'Allow running this command?', target = 'git status',
    stepIndex = 1, cascadeId = 'c1', trajectoryId = 't1', disabledOptionIds = null } = {}) {
    const radios = scopes.map(scope => {
        const opt = { id: 'opt-' + scope, text: SCOPE_LABELS[scope] };
        const radio = el('input', { type: 'radio', name: 'ask-question-0' }, [], { value: opt.id, checked: scope === selected, disabled: disabledScopes.includes(scope) });
        const label = el('label', {}, [el('span', {}, [], { text: opt.text }), radio], { text: opt.text });
        return { radio, label, opt };
    });
    const editor = el('textarea', { 'aria-label': 'Edit permission target' }, [], { value: target });
    const heading = el('span', {}, [], { text: operation });
    const icon = operation === 'Allow running this command?' ? [el('mask', { id: 'mask0_1041_504' })] : [];
    const submit = el('button', { 'data-testid': 'interaction-continue-button', class: 'agent-button' });
    const card = el('div', { class: 'tool-step' }, [heading, editor, ...icon, ...radios.map(r => r.label), submit]);
    const question = { question: 'command(' + target + ')', isMultiSelect: false, options: radios.map(r => r.opt) };
    const interactionProps = { toolName: 'ask_permission', permissionAction: 'command', questions: [question], selections: [[radios.find(r => r.radio.checked).opt.id]] };
    if (disabledOptionIds) interactionProps.disabledOptionIds = disabledOptionIds;
    const wlaProps = { permissionSpec: { resource: { action: 'command', target } }, cascadeId, trajectoryId, stepIndex, questions: [question], disabledOptionIds: disabledOptionIds || new Map() };
    const t9nProps = { ...interactionProps, clampedIdx: 0, questions: [question], disabledOptionIds: disabledOptionIds || new Map() };
    attachFiber(submit, [interactionProps, wlaProps, t9nProps]);
    return { card, submit, radios, editor };
}
{
    const { submit } = permissionCard();
    const request = Adapter.read(submit, CONTRACT);
    check(() => assert(request, 'reads permission card'));
    check(() => assert.strictEqual(request.kind, 'permission'));
    check(() => assert.strictEqual(request.operation, 'command'));
    check(() => assert.strictEqual(request.target, 'git status'));
    check(() => assert.strictEqual(request.scope, 'once'));
    check(() => assert.strictEqual(request.hostRequestId, 'host-permission:["c1","t1",1]'));
    check(() => assert.strictEqual(request.scopeOptions.length, 2));
    check(() => assert.strictEqual(request.scopeOptions.find(o => o.scope === 'project').present, true));
    check(() => assert.strictEqual(request.scopeAvailable('project'), true));
    check(() => assert.strictEqual(request.scopeAvailable('workspace'), false));
}
{
    const { submit, radios } = permissionCard({ selected: 'once', scopes: ['once', 'project'] });
    const request = Adapter.read(submit, CONTRACT);
    const projectRadio = radios.find(r => r.opt.id === 'opt-project').radio;
    projectRadio.click = () => { projectRadio.clicks++; projectRadio.checked = true; };
    check(() => assert.strictEqual(Adapter.selectScope(request, 'project'), true, 'selectScope switches checked radio'));
    check(() => assert.strictEqual(projectRadio.checked, true));
    check(() => assert.strictEqual(Adapter.selectScope(request, 'workspace'), false, 'unavailable scope refused'));
    check(() => assert.strictEqual(Adapter.selectScope(null, 'once'), null, 'null request short-circuits'));
}
{
    const { submit } = permissionCard({ disabledScopes: ['project'], disabledOptionIds: new Map([['opt-project', 'EFFECTIVE_GRANT']]) });
    const request = Adapter.read(submit, CONTRACT);
    check(() => assert.strictEqual(request.scopeAvailable('project'), false, 'host-disabled scope not selectable'));
    check(() => assert.strictEqual(Adapter.selectScope(request, 'project'), false));
}
{
    const { submit } = permissionCard();
    // read() is contract-agnostic for the DOM shape; hostRequestId is the gated part.
    const unknown = Adapter.read(submit, 'other-contract');
    check(() => assert(unknown && unknown.kind === 'permission'));
    check(() => assert.strictEqual(unknown.hostRequestId, undefined, 'unknown contract drops host identity'));
    check(() => assert.strictEqual(Adapter.read(null, CONTRACT), null));
}
{
    // Non-command headings need no terminal icon; wrong heading shape is unsupported.
    const { submit } = permissionCard({ operation: 'Allow read access to this path?', target: '/tmp/x' });
    const request = Adapter.read(submit, CONTRACT);
    check(() => assert.strictEqual(request && request.operation, 'read_file'));
}
{
    const { submit } = permissionCard({ operation: 'Allow read access to this path?', target: 'relative/path' });
    const request = Adapter.read(submit, CONTRACT);
    check(() => assert.strictEqual(request.kind, 'unsupported', 'relative path target rejected'));
    check(() => assert.strictEqual(request.reasonCode, 'unsupported-path-target'));
}
{
    const { submit } = permissionCard({ target: 'git status *' });
    const request = Adapter.read(submit, CONTRACT);
    check(() => assert.strictEqual(request.kind, 'unsupported', 'wildcard target rejected'));
}

// ── Question card (mTu/T9n) ────────────────────────────────────────────────
function questionCard({ questions, clampedIdx = 0, status = 9, cascadeId = 'c1', trajectoryId = 't1', stepIndex = 3, disabledOptionIds = null } = {}) {
    const q = questions[clampedIdx];
    const radios = q.options.map(o => {
        const radio = el('input', { type: 'radio', name: `ask-question-${clampedIdx}`, id: `ask-opt-${clampedIdx}-${o.id}` }, [], { value: o.id });
        return { radio, label: el('label', {}, [el('span', {}, [], { text: o.text }), radio], { text: o.text }), opt: o };
    });
    const submit = el('button', { 'data-testid': 'interaction-continue-button', class: 'agent-button' });
    const card = el('div', { class: 'tool-step' }, [el('span', {}, [], { text: q.question }), ...radios.map(r => r.label), submit]);
    const step = { questions };
    const mTu = { step, status, metadata: { sourceTrajectoryStepInfo: { cascadeId, trajectoryId, stepIndex } } };
    const t9n = { toolName: 'ask_question', questions, selections: questions.map(() => []), clampedIdx, disabledOptionIds: disabledOptionIds || new Map() };
    attachFiber(submit, [t9n, mTu]);
    return { card, submit, radios };
}
const q1 = { id: 'q1', question: 'Which database?', isMultiSelect: false, options: [{ id: 'pg', text: 'Postgres' }, { id: 'my', text: 'MySQL' }] };
{
    const { submit } = questionCard({ questions: [q1] });
    const card = Adapter.readQuestion(submit, CONTRACT);
    check(() => assert(card, 'reads question card'));
    check(() => assert.strictEqual(card.kind, 'question-card'));
    check(() => assert.strictEqual(card.index, 0));
    check(() => assert.strictEqual(card.count, 1));
    check(() => assert.strictEqual(card.isLast, true));
    check(() => assert.strictEqual(card.multiple, false));
    check(() => assert.strictEqual(card.hostRequestId, 'host-question:["c1","t1",3]'));
    const request = Adapter.questionRequest(card);
    check(() => assert.strictEqual(request.kind, 'question'));
    check(() => assert.strictEqual(request.requestId, 'host-question:["c1","t1",3]:0'));
    check(() => assert.strictEqual(request.prompt, 'Which database?'));
    check(() => assert.deepStrictEqual(request.options.map(o => o.id), ['pg', 'my']));
    check(() => assert.strictEqual(request.context.conversationId, 'c1'));
    check(() => assert.strictEqual(request.context.taskId, 't1'));
}
{
    // Single-select: one click answers; adapter never submits afterwards.
    const { submit, radios } = questionCard({ questions: [q1] });
    const card = Adapter.readQuestion(submit, CONTRACT);
    const pg = radios.find(r => r.opt.id === 'pg').radio;
    pg.click = () => { pg.clicks++; pg.checked = true; };
    check(() => assert.strictEqual(Adapter.selectOptions(card, ['pg']), true));
    check(() => assert.strictEqual(pg.checked, true));
    check(() => assert.strictEqual(Adapter.selectOptions(card, ['nope']), false, 'unknown option refused'));
}
{
    // Multi-select: every wanted option clicked; submit is a separate explicit act.
    const qm = { id: 'qm', question: 'Pick features', isMultiSelect: true, options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }, { id: 'c', text: 'C' }] };
    const { submit, radios } = questionCard({ questions: [qm] });
    const card = Adapter.readQuestion(submit, CONTRACT);
    check(() => assert.strictEqual(card.multiple, true));
    for (const r of radios) r.radio.click = () => { r.radio.checked = true; };
    check(() => assert.strictEqual(Adapter.selectOptions(card, ['a', 'c']), true));
    check(() => assert.strictEqual(Adapter.selectOptions(card, ['a', 'nope']), false, 'partial unknown refused'));
    check(() => assert.strictEqual(Adapter.submit(card), true));
    check(() => assert.strictEqual(submit.clicks, 1));
}
{
    // Disabled host option can never satisfy a configured rule.
    const { submit } = questionCard({ questions: [q1], disabledOptionIds: new Map([['pg', 'FORCE_ASK_HOOK']]) });
    const card = Adapter.readQuestion(submit, CONTRACT);
    check(() => assert.strictEqual(Adapter.selectOptions(card, ['pg']), false, 'disabled option refused'));
    check(() => assert.strictEqual(Adapter.selectOptions(card, ['my']), true));
}
{
    const { submit } = questionCard({ questions: [q1], status: 1 });
    const card = Adapter.readQuestion(submit, CONTRACT);
    check(() => assert.strictEqual(card.kind, 'unsupported'));
    check(() => assert.strictEqual(card.reasonCode, 'question-not-waiting'));
}
{
    // DOM must cover every enabled option; a missing radio means another renderer owns the card.
    const { submit, radios } = questionCard({ questions: [q1] });
    radios.find(r => r.opt.id === 'my').label.children = [];
    const card = Adapter.readQuestion(submit, CONTRACT);
    check(() => assert.strictEqual(card.kind, 'unsupported'));
    check(() => assert.strictEqual(card.reasonCode, 'question-dom-mismatch'));
}
{
    const { submit } = questionCard({ questions: [q1] });
    check(() => assert.strictEqual(Adapter.readQuestion(submit, 'other-contract'), null, 'unknown contract refuses question card'));
}
console.log(`Results: ${checks} passed, 0 failed`);
