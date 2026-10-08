'use strict';

// Self-contained so the exact evaluator can be embedded in CSP-safe renderer scripts.
function createPolicy(builtInGrants = [], createCoordinator, createEventScheduler, createInteractionAdapter, createAutopilotProfile, createDecisionEngine) {
    function matchesBlacklist(cmdLine, blacklist) {
        if (typeof cmdLine !== 'string' || !cmdLine.trim() || cmdLine.length > 2000) return 'unknown command';
        if (!Array.isArray(blacklist)) return 'invalid blacklist';
        const lower = cmdLine.toLowerCase().trim().replace(/\s+/g, ' ');
        for (const pattern of blacklist) {
            if (typeof pattern !== 'string') return 'invalid blacklist';
            const p = pattern.toLowerCase().trim();
            if (!p) continue;

            // Regex patterns: /pattern/
            if (p.startsWith('/') && p.endsWith('/')) {
                try {
                    const rawPattern = p.slice(1, -1);
                    // ReDoS protection: reject overly complex or long patterns
                    if (rawPattern.length > 200) return 'unsafe blacklist regex';
                    if (cmdLine.length > 2000) return 'unknown command';
                    // Reject catastrophic backtracking patterns: nested quantifiers like (a+)+, (a*)+, (.+)*
                    if (/\([^)]*[+*][^)]*\)[+*?]/.test(rawPattern)) return 'unsafe blacklist regex';
                    // Reject alternation inside quantified group: (a|ab)+
                    if (/\([^)]*\|[^)]*\)[+*?]/.test(rawPattern)) return 'unsafe blacklist regex';
                    const userRe = new RegExp(rawPattern, 'i');
                    if (userRe.test(cmdLine)) return pattern;
                } catch (_) { return 'invalid blacklist regex'; }
                continue;
            }

            // Multi-word / pipe patterns
            if (p.includes(' ') || p.includes('|')) {
                // Pipe-to-shell: pattern starts with '|' (e.g., '| bash', '| sh')
                // Use substring match — these appear mid-command: curl url | bash
                if (p.startsWith('|')) {
                    if (new RegExp('\\|\\s*' + p.slice(1).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=\\s|$|[;|&])', 'i').test(lower)) return pattern;
                    continue;
                }

                // Pipe-chain: no spaces, has '|' (e.g., 'wget|sh', 'curl|bash')
                // Detects: wget <url> | sh  OR  curl <url>|bash
                if (!p.includes(' ') && p.includes('|')) {
                    const [pcmd, pshell] = p.split('|');
                    // Word-boundary check: 'curl' must not match 'curling' or 'mycurl'
                    const pcmdRe = new RegExp(`^${pcmd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$|[|;&])`, 'i');
                    if (pcmdRe.test(lower)) {
                        const shellRe = new RegExp(`[|]\\s*${pshell.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$|;)`, 'i');
                        if (shellRe.test(lower)) return pattern;
                    }
                    continue;
                }

                // Standard multi-word: match at start or after separator + trailing boundary
                // The lookahead (?=\s|$|[;|&]) prevents 'git push --force' matching '--force-with-lease'
                const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const re = new RegExp(`(?:^|[;|&]\\s*|\\b(?:sudo|nohup|time|env)\\s+)${escaped}(?=\\s|$|[;|&])`, 'i');
                if (re.test(lower)) return pattern;
                continue;
            }

            // Single-word patterns → word-boundary match
            // "shutdown" should match "shutdown" or "shutdown -h now"
            // but NOT "shutdown-handler" or "myshutdown"
            const escaped = p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const re = new RegExp(`(?:^|[\\s;|&/\\\\])${escaped}(?:$|[\\s;|&])`, 'i');
            if (re.test(lower) || lower === p) return pattern;
        }
        return null;
    }

    function resolvePatterns(config, presets = {}, defaults = []) {
        const source = Array.isArray(config.patterns) ? config.patterns :
            (config.presetMode === 'custom' ? config.approvePatterns : presets[config.presetMode]) || config.approvePatterns || defaults;
        const disabled = new Set((config.disabledPatterns || []).map(p => String(p).trim().toLowerCase()));
        return [...new Set(source.filter(p => typeof p === 'string' && p.trim() && !disabled.has(p.trim().toLowerCase())))];
    }
    function canAct(policy) {
        return !!policy && policy.enabled === true && policy.paused !== true && policy.dryRun !== true && policy.active !== false && policy.permissionProfile !== 'observe';
    }
    function requiresCommand(label) {
        // Only navigation, text submission and reversible edit acceptance are command-free.
        return !/^(?:accept(?: all)?|expand|submit|skip)$/i.test(label || '');
    }
    function readsCommand(label) {
        return requiresCommand(label) || /^accept(?: all)?$/i.test(label || '');
    }
    // Deliberately limited to one literal argv: no shell evaluation or general parser.
    function parseArgv(command) {
        if (typeof command !== 'string' || !command.trim() || command.length > 2000) return null;
        const argv = [];
        let token = '', quote = '', started = false;
        for (let i = 0; i < command.length; i++) {
            const c = command[i];
            if (/[\r\n\0]/.test(c)) return null;
            if (quote === "'") {
                if (c === "'") quote = ''; else token += c;
                continue;
            }
            if (c === '$' || c === '`') return null;
            if (c === '\\') {
                const next = command[++i];
                if (next === undefined || /[\r\n]/.test(next)) return null;
                if (quote === '"' && !/["\\$`]/.test(next)) token += '\\';
                token += next; started = true; continue;
            }
            if (quote === '"') {
                if (c === '"') quote = ''; else token += c;
                continue;
            }
            if (c === "'" || c === '"') { quote = c; started = true; continue; }
            if (/[;&|<>()*?\[\]{}~#!]/.test(c)) return null;
            if (/\s/.test(c)) {
                if (started) { argv.push(token); token = ''; started = false; }
            } else { token += c; started = true; }
        }
        if (quote) return null;
        if (started) argv.push(token);
        if (!argv.length || !argv[0] || /^[A-Za-z_][A-Za-z0-9_]*=/.test(argv[0])) return null;
        return argv;
    }
    function argvPrefix(argv, prefix) {
        return prefix.length <= argv.length && prefix.every((token, i) => token === argv[i]);
    }
    function validRule(rule) {
        return !!rule && typeof rule.id === 'string' && rule.id.length > 0 && rule.id.length <= 200 &&
            ['allow','deny'].includes(rule.effect) && ['exact','prefix'].includes(rule.match) && ['session','project','user'].includes(rule.scope) &&
            Array.isArray(rule.argv) && rule.argv.length > 0 && rule.argv.length <= 100 && rule.argv.every(t => typeof t === 'string') &&
            rule.argv.join(' ').length <= 2000 && (rule.expiresAt === null || Number.isFinite(rule.expiresAt)) &&
            (rule.scope !== 'project' || typeof rule.workspace === 'string' && rule.workspace.length > 0);
    }
    function evaluateCommand(command, policy = {}) {
        // Array callers are retained for blacklist compatibility; all live paths pass a snapshot.
        if (Array.isArray(policy)) policy = { blacklist: policy };
        if (!policy || typeof policy !== 'object') policy = {};
        const blacklist = policy.blacklist || policy.terminalBlacklist || [];
        const argv = parseArgv(command);
        const commands = argv ? [argv[0]] : [];
        const result = (decision, reasonCode, reason, matchedRules = [], scope = null) => ({
            decision, allowed: decision === 'allow', reasonCode, reason, matchedRules,
            scope, policyVersion: policy.policyVersion || null, commands,
        });
        if (typeof command !== 'string' || !command.trim()) return result('manual', 'missing-command', 'Command context is missing; review manually.');
        if (!Array.isArray(blacklist) || blacklist.some(p => typeof p !== 'string')) return result('manual', 'invalid-policy', 'Blacklist is invalid; review manually.');
        const denied = [];
        for (const pattern of blacklist) {
            if (!pattern.trim()) continue;
            const prefix = parseArgv(pattern);
            // Literal rules use argv boundaries. Unsupported commands retain blacklist detection.
            const legacyMatch = matchesBlacklist(command, [pattern]);
            const wrapped = argv && ['env', 'time', 'nohup', 'sudo'].includes(argv[0]);
            const match = legacyMatch || (argv && prefix && (argvPrefix(argv, prefix) || (wrapped && argv.slice(1).some((_, i) => argvPrefix(argv.slice(i + 1), prefix)))));
            if (typeof match === 'string' && ['invalid blacklist', 'invalid blacklist regex', 'unsafe blacklist regex', 'unknown command'].includes(match)) return result('manual', 'invalid-policy', match);
            if (match) denied.push({ type: 'blacklist', pattern });
        }
        if (denied.length) return result('deny', 'blacklist-match', 'Antigravity Auto Submit will not auto-approve this command; host execution permissions are unchanged.', denied, { type: 'command' });
        if (!argv) return result('manual', 'unsupported-syntax', 'Only a single literal argv command is supported; review shell syntax manually.');
        if (policy.permissionProfile === 'observe' || policy.permissionProfile === 'edits') return result('manual', 'permission-profile', 'This profile does not grant terminal approvals.');
        if (['env', 'time', 'nohup', 'sudo', 'command', 'exec'].includes(argv[0])) return result('manual', 'wrapper-command', 'Wrapper semantics require manual review.');
        if (policy.contextAvailable === false) return result('manual', 'missing-context', 'Action context is missing; review manually.');
        if (typeof policy.policyVersion !== 'string' || !policy.policyVersion) return result('manual', 'missing-policy', 'A versioned policy snapshot is required; review manually.');
        const rules = policy.permissionRules || [];
        if (!Array.isArray(rules) || rules.length > 256 || rules.some(r => !validRule(r))) return result('manual', 'invalid-policy', 'Permission rules are invalid or exceed the rule budget.');
        const matching = rules.filter(rule => rule && ['allow', 'deny'].includes(rule.effect) && ['exact', 'prefix'].includes(rule.match) &&
            Array.isArray(rule.argv) && rule.argv.length && rule.argv.every(t => typeof t === 'string') &&
            (rule.expiresAt === null || (Number.isFinite(rule.expiresAt) && rule.expiresAt > Date.now())) &&
            ['session', 'user', 'project'].includes(rule.scope) && (rule.scope !== 'project' || rule.workspace === policy.workspace) &&
            argvPrefix(argv, rule.argv) && (rule.match === 'prefix' || argv.length === rule.argv.length));
        const rule = matching.find(r => r.effect === 'deny') || matching.find(r => r.effect === 'allow');
        if (rule) return result(rule.effect, 'explicit-rule', 'Explicit ' + rule.match + ' argv rule matches; host permissions are unchanged.',
            [{ type: rule.match + '-argv', source: rule.scope, pattern: rule.argv.join(' '), id: rule.id }], { type: rule.match + '-argv', source: rule.scope, argvPrefix: rule.argv, broad: rule.match === 'prefix' });
        // The new scoped profile never silently inherits legacy executable grants.
        const whitelist = policy.permissionProfile === 'terminal' ? [] : policy.whitelist || policy.terminalWhitelist || [];
        const builtins = policy.permissionProfile === 'terminal' ? [] : policy.builtInGrants || builtInGrants;
        if (!Array.isArray(whitelist) || !Array.isArray(builtins)) return result('manual', 'invalid-policy', 'Grants are invalid; review manually.');
        const grants = [];
        for (const [source, entries] of [['user', whitelist], ['builtin', builtins]]) {
            for (const entry of entries) {
                const prefix = parseArgv(entry);
                if (!prefix || !argvPrefix(argv, prefix)) continue;
                grants.push({ type: prefix.length === 1 ? 'legacy-broad-grant' : 'literal-argv-prefix', source, pattern: entry, argv: prefix });
            }
        }
        if (!grants.length) return result('manual', 'unknown-command', 'No explicit grant matches this command; review manually.');
        const grant = grants.find(g => g.type === 'literal-argv-prefix') || grants[0];
        const broad = grant.type === 'legacy-broad-grant';
        return result('allow', broad ? 'legacy-broad-grant' : 'argv-prefix-grant',
            broad ? 'Legacy executable grant covers all literal arguments; this does not prove the command is safe.' : 'Literal argv-prefix grant matches.',
            grants, { type: grant.type, source: grant.source, argvPrefix: grant.argv, broad });
    }
    const Interaction = createInteractionAdapter();
    const Autopilot = createAutopilotProfile();
    const Decision = typeof createDecisionEngine === 'function' ? createDecisionEngine() : null;
    function evaluateInteraction(request, policy = {}) {
        const result = (decision, reasonCode, matchedRules = [], extra = {}) => ({ decision, allowed: decision === 'allow', reasonCode,
            reason: reasonCode.replace(/-/g, ' '), matchedRules, scope: request ? { type: request.operation || request.kind, permissionScope: request.scope } : null, policyVersion: policy.policyVersion || null, ...extra });
        if (!request || !['permission', 'question-card'].includes(request.kind)) return result('manual', request && request.reasonCode || 'unsupported-interaction');
        if (!policy.policyVersion || policy.contextAvailable === false) return result('manual', 'missing-policy');
        if (policy.interactionHost !== 'ide-2.5.5-unified-permission-dom') return result('manual', 'unsupported-host-build');
        if (policy.permissionProfile === 'observe') return result('manual', 'permission-profile');
        if (request.kind === 'question-card') return evaluateQuestion(request, policy, result);
        const profile = Autopilot.normalize(policy.autopilotProfile);
        if (!profile.enabled) return result('manual', profile.error || 'autopilot-not-configured');
        const matches = profile.grants.filter(g => g.operation === request.operation && g.target === request.target &&
            (g.workspace === undefined || g.workspace === policy.workspace));
        // Deny applies across scopes: a narrower allow cannot defeat an explicit deny.
        const deny = matches.find(g => g.effect === 'deny');
        if (deny) return result('deny', 'autopilot-explicit-deny', [deny]);
        if (request.operation === 'command') {
            const commandDecision = evaluateCommand(request.target, { ...policy, permissionProfile: 'terminal' });
            if (commandDecision.decision === 'deny' || ['invalid-policy', 'unsupported-syntax', 'wrapper-command'].includes(commandDecision.reasonCode)) return commandDecision;
        }
        const grant = matches.find(g => g.effect === 'allow');
        if (!grant) return result('manual', 'autopilot-no-grant');
        // A standing host grant can suppress future prompts. Never install it while
        // local deny rules in that namespace would no longer get a decision
        // opportunity. The check binds to the CANDIDATE scope, not the selected one:
        // the old code compared request.scope so a card pre-set to 'once' skipped
        // this guard even when the grant wanted a persistent scope.
        if (grant.scope !== 'once' && (profile.grants.some(g => g.effect === 'deny' && g.operation === request.operation && (g.workspace === undefined || g.workspace === policy.workspace)) ||
            request.operation === 'command' && ((policy.blacklist || []).some(p => p.trim()) || (policy.permissionRules || []).some(r => r.effect === 'deny')))) return result('manual', 'persistent-grant-deny-conflict', [grant]);
        if (request.scope === grant.scope) return result('allow', 'autopilot-exact-grant', [grant]);
        // The card sits on a different scope than the grant asks for. Switching is
        // only possible when the adapter enumerated that option and the host did
        // not disable it (EFFECTIVE_GRANT conflict / FORCE_ASK_HOOK disable every
        // non-'once' option); anything else stays manual.
        if (typeof request.scopeAvailable !== 'function' || !request.scopeAvailable(grant.scope)) return result('manual', 'scope-unavailable', [grant]);
        return result('allow', 'autopilot-scope-switch', [grant], { switchScope: grant.scope });
    }
    function evaluateQuestion(card, policy, result) {
        if (!Decision) return result('manual', 'decision-engine-unavailable');
        const decisionPolicy = policy.decisionPolicy;
        if (!decisionPolicy || decisionPolicy.enabled !== true) return result('manual', 'questions-not-configured');
        const request = Interaction.questionRequest(card);
        if (!request) return result('manual', 'unverified-question-card');
        request.context.project = policy.workspace;
        if (!request.context.project) return result('manual', 'missing-policy');
        const decided = Decision.decide(request, decisionPolicy, Date.now());
        if (decided.status !== 'answered') {
            const r = { decision: 'manual', allowed: false, reasonCode: decided.reasonCode, reason: decided.reasonCode.replace(/-/g, ' '), matchedRules: [], scope: { type: 'question' }, policyVersion: policy.policyVersion || null, fingerprint: decided.fingerprint, questionRequest: request };
            return r;
        }
        // Single-select option clicks auto-advance/auto-submit via the host's
        // onNextNoWrap timer — the executor must NOT click submit. Multi-select
        // cards need an explicit Continue/Submit click after selection.
        const r = result('allow', 'configured-answer', [{ id: decided.ruleId }], { optionIds: decided.optionIds, autoSubmit: !card.multiple, questionIndex: card.index });
        return r;
    }
    function interactionPayload(button, label, policy, request = Interaction.read(button, policy.interactionHost)) {
        return request ? request.fingerprint : readsCommand(label) ? extractCommand(button) : '';
    }
    function readInteraction(button, policy) {
        const permission = Interaction.read(button, policy.interactionHost);
        if (permission) return permission;
        // Question cards share the continue/submit control; only read them when a
        // decision policy is configured so unconfigured installs keep manual flow.
        if (policy.decisionPolicy && policy.decisionPolicy.enabled === true) return Interaction.readQuestion(button, policy.interactionHost);
        return null;
    }
    function actionIdentity(coordinator, button, label, policy) {
        const request = readInteraction(button, policy);
        const identity = coordinator.identity(button, label, interactionPayload(button, label, policy, request));
        if (request && request.hostRequestId && request.kind === 'question-card') return { ...identity, key: request.hostRequestId + ':' + request.index + ':approval', request: request.hostRequestId, evidence: 'host-react-props' };
        if (request && request.hostRequestId) return { ...identity, key: request.hostRequestId + ':approval', request: request.hostRequestId, evidence: 'host-react-props' };
        return identity;
    }
    function interactionPattern(button, policy) {
        return readInteraction(button, policy) ? 'Submit' : null;
    }
    function evaluateAction(label, command, policy = {}) {
        if (policy.permissionProfile === 'observe') return { decision: 'manual', allowed: false, reasonCode: 'permission-profile', reason: 'Observe profile does not auto-approve.', matchedRules: [], scope: null, policyVersion: policy.policyVersion || null };
        if (policy.interaction) return evaluateInteraction(policy.interaction, policy);
        // The host reuses Submit for permission scopes, questions and MCP forms.
        // A label cannot prove which operation or grant would be submitted.
        if (/^submit$/i.test(label || '')) return { decision: 'manual', allowed: false, reasonCode: 'ambiguous-submission', reason: 'Submission requires a verified interaction type, payload and permission scope; review this card manually.', matchedRules: [], scope: null, policyVersion: policy.policyVersion || null };
        if (['permission', 'url-read', 'terminal-input', 'generic-tool', 'mcp'].includes(policy.actionKind)) return { decision: 'manual', allowed: false, reasonCode: 'unsupported-interaction', reason: 'This interaction needs a typed payload and scope adapter; review it manually.', matchedRules: [], scope: { type: policy.actionKind }, policyVersion: policy.policyVersion || null };
        if (['edits', 'terminal'].includes(policy.permissionProfile) && ['browser', 'mcp'].includes(policy.actionKind) && !/^skip$/i.test(label)) return { decision: 'manual', allowed: false, reasonCode: 'unsupported-action-scope', reason: 'Browser/MCP auto-approval requires a verified adapter capability.', matchedRules: [], scope: { type: policy.actionKind }, policyVersion: policy.policyVersion || null };
        // Accept is also used by terminal/tool steps, not just edit reviews.
        if (/^accept(?: all)?$/i.test(label || '') && typeof command === 'string' && command.trim()) return evaluateCommand(command, policy);
        // Retry/Resume re-runs host work. They are only automatic inside an
        // explicit per-conversation budget; unset means manual, same as before.
        // Checked before requiresCommand: these are not command-free labels.
        if (/^(?:retry|try again|resume(?:\s+conversation)?)$/i.test(label || '')) return evaluateRetry(policy);
        if (requiresCommand(label) || !policy.policyVersion || policy.contextAvailable === false) return evaluateCommand(command, policy);
        return { decision: 'allow', allowed: true, reasonCode: 'command-free-action', reason: 'Command-free UI action; target guards still apply.',
            matchedRules: [], scope: { type: 'ui-action', label }, policyVersion: policy.policyVersion || null };
    }
    function evaluateRetry(policy) {
        const budget = policy.retryBudget;
        const base = { matchedRules: [], scope: { type: 'retry' }, policyVersion: policy.policyVersion || null };
        if (!budget || budget.enabled !== true) return { ...base, decision: 'manual', allowed: false, reasonCode: 'retry-unconfigured', reason: 'Retry stays manual until a retry budget is configured.' };
        const max = Number.isInteger(budget.maxPerConversation) && budget.maxPerConversation > 0 && budget.maxPerConversation <= 8 ? budget.maxPerConversation : 0;
        if (!max) return { ...base, decision: 'manual', allowed: false, reasonCode: 'retry-budget', reason: 'Retry budget is not a positive integer within 1-8.' };
        const key = typeof policy.conversationId === 'string' && policy.conversationId ? policy.conversationId : null;
        if (!key) return { ...base, decision: 'manual', allowed: false, reasonCode: 'retry-unattributed', reason: 'Retry needs a verified conversation id before it counts against the budget.' };
        // Refuse quota waits and unverified failures before counting the
        // attempt: neither is a click-budget retry.
        if (policy.waitReason === 'quota') return { ...base, decision: 'manual', allowed: false, reasonCode: 'retry-quota', reason: 'A quota wait is not a retry; wait for the host to recover or act manually.' };
        if (policy.terminal === true && policy.failed !== true) return { ...base, decision: 'manual', allowed: false, reasonCode: 'retry-unverified-failure', reason: 'Only a verified failed job may be retried automatically.' };
        const used = budget.used && typeof budget.used === 'object' && Number.isInteger(budget.used[key]) ? budget.used[key] : 0;
        if (used >= max) return { ...base, decision: 'manual', allowed: false, reasonCode: 'retry-budget', reason: 'Retry budget for this conversation is exhausted.' };
        return { ...base, decision: 'allow', allowed: true, reasonCode: 'retry-within-budget', reason: 'Retry is inside the configured per-conversation budget.', scope: { type: 'retry', conversationId: key, attempt: used + 1, max } };
    }
    function runtimeState(policy = {}, executor = {}) {
        let status, reasonCode, reason;
        if (policy.enabled !== true || policy.active === false) { status = 'off'; reasonCode = 'disabled'; reason = 'Antigravity Auto Submit is off.'; }
        else if (policy.paused) { status = 'paused'; reasonCode = policy.pauseReasonCode || 'manual-pause'; reason = policy.pauseReason || 'Manual pause.'; }
        else if (policy.dryRun || policy.permissionProfile === 'observe') { status = 'dry-run'; reasonCode = 'dry-run'; reason = 'Scan only; no auto-approval attempts.'; }
        else if (executor.connected === false) { status = 'disconnected'; reasonCode = 'executor-disconnected'; reason = 'Executor is disconnected.'; }
        else if (executor.verified === true && executor.policyVersion === policy.policyVersion && typeof policy.policyVersion === 'string' && executor.expiresAt > Date.now()) {
            status = 'ready'; reasonCode = 'executor-ready'; reason = 'Verified executor has the current live policy.';
        } else {
            status = 'unknown'; reasonCode = executor.reasonCode || 'executor-unverified';
            const reasons = { 'no-progress': 'No approval UI progress. Use Resume to clear the breaker; unknown intents are not retried.', 'intent-budget': 'Intent retention budget exhausted. Manual approval or a new document is required; Resume preserves unknown intents.', 'adapter-version-mismatch': 'Adapter version mismatch. Re-inject a compatible adapter before auto-approval.' };
            reason = reasons[reasonCode] || 'Executor target or current policy lease is not verified.';
        }
        return { status, reasonCode, reason, workspace: policy.workspace || null, policyVersion: policy.policyVersion || null };
    }
    function extractCommand(button) {
        if (!button || !button.closest) return '';
        const step = button.closest('[class*=tool], [class*=step], [class*=action], [class*=approval]');
        if (!step || !step.querySelectorAll) return '';
        const values = [...step.querySelectorAll('code, pre, [data-command], [class*=command]')]
            .map(el => (el.getAttribute && el.getAttribute('data-command')) || el.textContent || '')
            .map(text => text.trim()).filter(Boolean);
        const commands = [...new Set(values)];
        return commands.length === 1 && commands[0].length <= 2000 ? commands[0] : '';
    }
    function actionContext(button, policy) {
        const step = button.closest && button.closest('[class*=tool], [class*=step], [class*=action], [class*=approval]');
        const stepText = ((step && (step.innerText || step.textContent)) || '').slice(0, 1000).toLowerCase();
        // These hints can only restrict approval. They never prove authorization.
        const actionKind = /\b(?:read_file|write_file|read_url|execute_url|unsandboxed|command|custom)\s*\(|save rule to always allow/.test(stepText) ? 'permission' :
            /read url content\?/.test(stepText) ? 'url-read' : /send command input\?/.test(stepText) ? 'terminal-input' :
            /approve\?/.test(stepText) ? 'generic-tool' : /browser_subagent|computer_use|use_browser|browser agent/.test(stepText) ? 'browser' : /\bmcp\b|mcp[_:-]/.test(stepText) ? 'mcp' : 'terminal';
        return { ...policy, actionKind, interaction: readInteraction(button, policy) };
    }
    function mergeTombstones(root, saved) {
        const state = root.__gravIntentLedger;
        if (!state || !saved || typeof saved.saturated !== 'boolean' || !Array.isArray(saved.entries) || saved.entries.length > 256 ||
            saved.entries.some(e => !e || typeof e.key !== 'string' || !e.key || e.key.length > 300 || e.outcome !== 'unknown' || !Number.isFinite(e.at) || !Number.isFinite(e.expiresAt))) return false;
        for (const entry of saved.entries) {
            const prior = state.entries.get(entry.key);
            if (!prior && state.entries.size >= 256) { state.stopped = 'intent-budget'; return false; }
            if (!prior || prior.outcome === 'pending' || prior.outcome === 'cancelled') state.entries.set(entry.key, { ...entry });
        }
        if (saved.saturated) state.stopped = 'intent-budget';
        return !saved.saturated;
    }
    function milliseconds(value, fallback) {
        return Number.isFinite(value) && value > 0 ? Math.max(50, value) : fallback;
    }
    return { matchesBlacklist, resolvePatterns, canAct, requiresCommand, readsCommand, parseArgv, evaluateCommand, evaluateAction, runtimeState, extractCommand, actionContext, validRule, milliseconds, createCoordinator, createEventScheduler, evaluateInteraction, interactionPayload, interactionPattern, actionIdentity, mergeTombstones, interaction: Interaction, decision: Decision };
}

const { SAFE_TERMINAL_CMDS } = require('./constants');
const { createCoordinator } = require('./intent-ledger');
const { createEventScheduler } = require('./event-scheduler');
const { createInteractionAdapter } = require('./interaction-adapter');
const { createAutopilotProfile } = require('./autopilot-profile');
const { createDecisionEngine } = require('./decision-engine');
module.exports = { createPolicy, ...createPolicy(SAFE_TERMINAL_CMDS, createCoordinator, createEventScheduler, createInteractionAdapter, createAutopilotProfile, createDecisionEngine), browserSource: '(' + createPolicy.toString() + ')(' + JSON.stringify(SAFE_TERMINAL_CMDS) + ',' + createCoordinator.toString() + ',' + createEventScheduler.toString() + ',' + createInteractionAdapter.toString() + ',' + createAutopilotProfile.toString() + ',' + createDecisionEngine.toString() + ')' };
