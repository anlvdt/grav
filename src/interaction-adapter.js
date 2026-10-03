'use strict';

// IDE 2.5.5 Wla/T9n contract: exact heading, editable target, checked native radio,
// and the interaction submit test id. Text hints alone never grant authority.
function createInteractionAdapter() {
    const attr = (node, name) => node && node.getAttribute ? node.getAttribute(name) : null;
    const text = node => (node && (node.innerText || node.textContent) || '').trim();
    function scopeOf(label) {
        if (label === 'Yes, allow this time') return 'once';
        if (label === 'Yes, and always allow in this conversation') return 'conversation';
        if (label === 'Yes, and always allow in this project') return 'project';
        if (label === 'Yes, and always allow in this workspace') return 'workspace';
        if (label === 'Yes, and always allow') return 'global';
        return null; // Suggested wider patterns and persistence-only requests are separate contracts.
    }
    function fiberOf(node, upLimit = 8) {
        for (let depth = 0; node && depth < upLimit; depth++, node = node.parentElement) {
            const keys = Object.keys(node).slice(0, 256).filter(k => k.startsWith('__reactFiber$'));
            if (keys.length === 1) {
                const fiber = Object.getOwnPropertyDescriptor(node, keys[0])?.value;
                if (fiber) return fiber;
            }
        }
        return null;
    }
    function fiberProps(start, match, upLimit = 64) {
        const seen = new Set();
        for (let depth = 0, component = start; component && depth < upLimit && !seen.has(component); depth++, component = component.return) {
            seen.add(component);
            const props = component.memoizedProps;
            if (props && typeof props === 'object' && match(props)) return props;
        }
        return null;
    }
    // Click a native radio through its label so React onChange fires, then verify
    // the host state settled on this input. Never touches disabled inputs.
    function clickOption(radio) {
        if (!radio || radio.disabled || radio.checked) return !!(radio && radio.checked);
        try {
            const label = radio.closest && radio.closest('label');
            (label || radio).click();
            return radio.checked === true;
        } catch { return false; }
    }

    // ── ask_permission card (Wla contract) ────────────────────────────────
    // Scope options: option.id -> scope via the same label map the host renders.
    // disabledOptionIds is a Map<optionId, reason> built from permissionSpec.triggerSource
    // (EFFECTIVE_GRANT conflict / FORCE_ASK_HOOK); a disabled scope can never be selected.
    function scopeOptions(props) {
        const question = props && props.questions && props.questions[0];
        if (!question || !Array.isArray(question.options)) return [];
        const disabled = props.disabledOptionIds instanceof Map ? props.disabledOptionIds :
            (props.disabledOptionIds && typeof props.disabledOptionIds.has === 'function' ? props.disabledOptionIds : { has: () => false });
        const options = [];
        for (const option of question.options) {
            const scope = option && typeof option.id === 'string' ? scopeOf(option.text) : null;
            if (!scope) continue;
            options.push({ id: option.id, scope, disabled: disabled.has(option.id) });
        }
        return options;
    }
    function hostIdentity(button, request, contract, selectedValue) {
        if (contract !== 'ide-2.5.5-unified-permission-dom') return null;
        let component = fiberOf(button);
        let interaction = null;
        for (let depth = 0, seen = new Set(); component && depth < 64 && !seen.has(component); depth++, component = component.return) {
            seen.add(component);
            const props = component.memoizedProps;
            if (!props || typeof props !== 'object') continue;
            if (props.toolName === 'ask_permission' && props.permissionAction === request.operation && Array.isArray(props.questions) && props.questions.length === 1) interaction = props;
            if (!props.permissionSpec) continue;
            const resource = props.permissionSpec.resource;
            if (!resource || resource.action !== request.operation || resource.target !== request.target || !interaction) return null;
            const selection = interaction.selections;
            const question = interaction.questions[0];
            if (!Array.isArray(selection) || selection.length !== 1 || !Array.isArray(selection[0]) || selection[0].length !== 1 || selection[0][0] !== selectedValue ||
                !question || question.isMultiSelect === true || question.question !== request.operation + '(' + request.target + ')' || !Array.isArray(question.options)) return null;
            const option = question.options.find(o => o.id === selectedValue);
            if (!option || scopeOf(option.text) !== request.scope) return null;
            const validId = id => typeof id === 'string' && id.length > 0 && id.length <= 80;
            if (!validId(props.cascadeId) || !validId(props.trajectoryId) || !Number.isSafeInteger(props.stepIndex) || props.stepIndex < 0) return null;
            // Read props only: no callbacks, host stores, RPCs or host state mutation.
            return 'host-permission:' + JSON.stringify([props.cascadeId, props.trajectoryId, props.stepIndex]);
        }
        return null;
    }
    function findCard(button) {
        if (!button || !button.closest) return null;
        let card = button.closest('[class*=tool], [class*=step], [class*=action], [class*=approval]');
        // The shared host interaction component has no stable class. Find its smallest
        // ancestor containing the uniquely labelled editor, without crossing an agent root.
        if (!card || !card.querySelectorAll || !card.querySelectorAll('textarea[aria-label="Edit permission target"]').length) {
            let node = button.parentElement;
            for (let i = 0; node && i < 8; i++, node = node.parentElement) {
                if (node.querySelectorAll && node.querySelectorAll('textarea[aria-label="Edit permission target"]').length) { card = node; break; }
            }
        }
        return card || null;
    }
    function read(button, contract) {
        if (!button || !button.closest) return null;
        const card = findCard(button);
        if (!card || !card.querySelectorAll) return null;
        const editors = [...card.querySelectorAll('textarea[aria-label="Edit permission target"]')].filter(e => attr(e, 'aria-label') === 'Edit permission target');
        if (!editors.length) return null;
        const unsupported = reasonCode => ({ kind: 'unsupported', reasonCode, fingerprint: JSON.stringify([text(card), editors.map(e => e.value)]) });
        if (editors.length !== 1 || attr(button, 'data-testid') !== 'interaction-continue-button') return unsupported('unverified-permission-controls');
        const headings = [...card.querySelectorAll('span')].map(text);
        const names = { 'Allow read access to this path?': 'read_file', 'Allow write access to this path?': 'write_file', 'Allow reading this URL?': 'read_url', 'Allow executing actions on this URL?': 'execute_url', 'Allow running this command?': 'command', 'Allow using this MCP tool?': 'mcp' };
        const found = headings.filter(h => names[h]);
        if (found.length !== 1 || /Save rule to always allow|outside of the sandbox|Requires manual confirmation|Conflicts with your configured Ask permission/.test(text(card))) return unsupported('unverified-permission-operation');
        // command actionDescription can override the heading. The host's terminal
        // SVG is selected from permissionAction independently of that description.
        const terminalIcons = [...card.querySelectorAll('svg mask[id="mask0_1041_504"]')].filter(n => attr(n, 'id') === 'mask0_1041_504');
        if (names[found[0]] === 'command' ? terminalIcons.length !== 1 : terminalIcons.length !== 0) return unsupported('permission-operation-icon-mismatch');
        const selected = [...card.querySelectorAll('input[type="radio"]')].filter(r => r.checked);
        const writeIns = [...card.querySelectorAll('textarea[data-testid="ask-question-writein"]')];
        if (selected.length !== 1 || selected[0].disabled || writeIns.some(e => e.value && e.value.trim())) return unsupported('unverified-permission-selection');
        const option = selected[0].closest && selected[0].closest('label');
        // Host labels include a shortcut badge before the option text.
        const parts = option && option.querySelectorAll ? [...option.querySelectorAll('span')].map(text) : [];
        const scopeLabels = parts.filter(p => scopeOf(p));
        const scope = scopeOf(text(option)) || (scopeLabels.length === 1 ? scopeOf(scopeLabels[0]) : null);
        if (!scope) return unsupported('unsupported-permission-scope');
        const target = editors[0].value;
        if (typeof target !== 'string' || !target.trim() || target.length > 2000 || /[\0\r\n*]/.test(target)) return unsupported('invalid-permission-target');
        const operation = names[found[0]];
        if (['read_file', 'write_file'].includes(operation) && (!target.startsWith('/') || target.split('/').some(p => p === '.' || p === '..'))) return unsupported('unsupported-path-target');
        const request = { kind: 'permission', operation, target, scope, card };
        // Enumerate every scope option the card offers so policy can select the
        // configured scope instead of only approving the pre-selected one. Scope
        // options come from the same Wla props that drive the radio group; a DOM
        // input without a matching option can never be selected on purpose.
        const wlaProps = fiberProps(fiberOf(button), props => props && props.permissionSpec && props.permissionSpec.resource);
        if (wlaProps) {
            const options = scopeOptions(wlaProps);
            const radios = [...card.querySelectorAll('input[type="radio"]')];
            request.scopeOptions = options.map(o => ({ ...o, present: radios.some(r => !r.disabled && (r.value === o.id || scopeOf(text(r.closest && r.closest('label'))) === o.scope)) }));
            request.scopeAvailable = scope => request.scopeOptions.some(o => o.scope === scope && !o.disabled && o.present);
        }
        const identity = hostIdentity(button, request, contract, selected[0].value);
        if (identity) request.hostRequestId = identity;
        request.fingerprint = JSON.stringify([{ kind: request.kind, operation: request.operation, target: request.target, scope: request.scope }, text(card), selected[0].value]);
        return request;
    }
    // Select the radio for a permission scope. Submit happens on a later scan so
    // React state settles first; returns true only when the input reports checked.
    function selectScope(request, scope) {
        if (!request || request.kind !== 'permission' || !request.card || request.scope === scope) return request && request.scope === scope;
        if (!request.card.isConnected || typeof request.scopeAvailable !== 'function' || !request.scopeAvailable(scope)) return false;
        const radio = [...request.card.querySelectorAll('input[type="radio"]')].find(r => !r.disabled && r !== null && scopeOf(text(r.closest && r.closest('label'))) === scope);
        return clickOption(radio);
    }

    // ── ask_question card (mTu/T9n contract) ──────────────────────────────
    // mTu props: {step:{questions}, status, metadata:{sourceTrajectoryStepInfo}}.
    // status uses the numeric `lo` enum; only WAITING (9) accepts interaction.
    // The DOM renders only the clamped question's radios as ask-question-{m},
    // so DOM groups == 1 regardless of step.questions.length.
    const WAITING = 9;
    function findQuestionCard(button) {
        if (!button || !button.closest || attr(button, 'data-testid') !== 'interaction-continue-button') return null;
        let node = button.parentElement;
        for (let i = 0; node && i < 8; i++, node = node.parentElement) {
            if (!node.querySelectorAll || !node.querySelectorAll('input[name^="ask-question-"]').length) continue;
            // Permission cards reuse the same radio group; the editor textarea is
            // the distinguishing control, so never treat them as question cards.
            if (node.querySelectorAll('textarea[aria-label="Edit permission target"]').length) return null;
            return node;
        }
        return null;
    }
    function readQuestion(button, contract) {
        if (contract !== 'ide-2.5.5-unified-permission-dom') return null;
        const cardEl = findQuestionCard(button);
        if (!cardEl) return null;
        const unsupported = reasonCode => ({ kind: 'unsupported', reasonCode, fingerprint: JSON.stringify(['question-card', text(cardEl)]) });
        // Walk to the mTu renderer props; T9n props sit on the same ancestor chain
        // but carry selections/clampedIdx, while mTu carries step + metadata.
        // toolName 'ask_question' distinguishes this from Wla, whose T9n subtree
        // renders the permission scope question with the same shape.
        const props = fiberProps(fiberOf(button), p => p && p.step && Array.isArray(p.step.questions) && p.metadata && typeof p.metadata === 'object');
        const t9n = fiberProps(fiberOf(button), p => p && p.toolName === 'ask_question' && Array.isArray(p.questions) && Array.isArray(p.selections) && Number.isSafeInteger(p.clampedIdx));
        if (!props || !t9n) return unsupported('unverified-question-card');
        const info = props.metadata.sourceTrajectoryStepInfo;
        const validId = id => typeof id === 'string' && id.length > 0 && id.length <= 80;
        if (!info || !validId(info.cascadeId) || !validId(info.trajectoryId) || !Number.isSafeInteger(info.stepIndex) || info.stepIndex < 0) return unsupported('unverified-question-identity');
        if (props.status !== WAITING) return unsupported('question-not-waiting');
        const questions = props.step.questions;
        if (!questions.length || questions.length > 8 || t9n.questions !== questions) return unsupported('unverified-question-shape');
        const index = t9n.clampedIdx;
        if (index < 0 || index >= questions.length) return unsupported('unverified-question-index');
        const question = questions[index];
        if (!question || typeof question.question !== 'string' || !question.question.trim() || question.question.length > 4000 ||
            !Array.isArray(question.options) || !question.options.length || question.options.length > 64 ||
            question.options.some(o => !o || typeof o.id !== 'string' || !o.id || o.id.length > 200 || typeof o.text !== 'string' || !o.text || o.text.length > 2000)) {
            return unsupported('unverified-question-options');
        }
        // The DOM radios for the rendered question must cover every enabled option;
        // fewer radios means another renderer owns the card and clicks would misfire.
        const radios = [...cardEl.querySelectorAll(`input[name="ask-question-${index}"]`)].filter(r => r.value !== '__write_in__');
        const disabledOptions = t9n.disabledOptionIds instanceof Map ? t9n.disabledOptionIds : { has: () => false };
        const enabled = question.options.filter(o => !disabledOptions.has(o.id));
        if (!radios.length || enabled.some(o => !radios.some(r => r.value === o.id))) return unsupported('question-dom-mismatch');
        const card = {
            kind: 'question-card', card: cardEl, question, index, count: questions.length, disabledOptionIds: t9n.disabledOptionIds instanceof Map ? t9n.disabledOptionIds : null,
            isLast: index === questions.length - 1, multiple: question.isMultiSelect === true,
            trajectory: { cascadeId: info.cascadeId, trajectoryId: info.trajectoryId, stepIndex: info.stepIndex },
            hostRequestId: 'host-question:' + JSON.stringify([info.cascadeId, info.trajectoryId, info.stepIndex]),
            fingerprint: JSON.stringify(['question-card', info.cascadeId, info.trajectoryId, info.stepIndex, index, question.question]),
        };
        return card;
    }
    // Engine request for the rendered question. Context binds to trajectory ids so
    // rules cannot leak across cascades; project is supplied by the caller (engine
    // scope keys: project/taskId/conversationId).
    function questionRequest(card) {
        if (!card || card.kind !== 'question-card') return null;
        const q = card.question;
        return {
            kind: 'question',
            requestId: card.hostRequestId + ':' + card.index,
            questionId: typeof q.id === 'string' && q.id ? q.id : undefined,
            prompt: q.question,
            multiple: card.multiple,
            options: q.options.map(o => ({ id: o.id, label: o.text, value: o.id })),
            context: { conversationId: card.trajectory.cascadeId, taskId: card.trajectory.trajectoryId },
        };
    }
    // Select the configured options on the rendered question. Single-select radios
    // auto-advance via the host onNextNoWrap timer (~200ms) and the last question's
    // single-select auto-submits; the caller must NOT click submit afterwards.
    function selectOptions(card, optionIds) {
        if (!card || card.kind !== 'question-card' || !card.card.isConnected || !Array.isArray(optionIds) || !optionIds.length) return false;
        const radios = [...card.card.querySelectorAll(`input[name="ask-question-${card.index}"]`)].filter(r => r.value !== '__write_in__');
        const wanted = new Set(optionIds);
        const options = card.question.options.filter(o => wanted.has(o.id));
        if (options.length !== wanted.size) return false;
        // A host-disabled option can never satisfy a rule; fail closed.
        if (options.some(o => card.disabledOptionIds && card.disabledOptionIds.has(o.id))) return false;
        for (const option of options) {
            const radio = radios.find(r => r.value === option.id);
            if (!radio || !clickOption(radio)) return false;
            if (!card.multiple) break; // One radio is the whole answer for single-select.
        }
        return true;
    }
    // Submit click for multi-question paging and explicit-submit cases. Single-
    // select cards auto-submit on the last option click; the caller skips this.
    function submit(card) {
        if (!card || card.kind !== 'question-card' || !card.card.isConnected) return false;
        const buttons = [...card.card.querySelectorAll('button[data-testid="interaction-continue-button"]')];
        if (buttons.length !== 1 || buttons[0].disabled) return false;
        try { buttons[0].click(); return true; } catch { return false; }
    }
    return { read, readQuestion, questionRequest, selectScope, selectOptions, submit, scopeOf, scopeOptions, hostIdentity };
}
module.exports = { createInteractionAdapter, ...createInteractionAdapter() };
