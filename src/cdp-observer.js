// ═══════════════════════════════════════════════════════════════
//  Grav — CDP Observer Script Builder
//  Extracted from cdp.js for maintainability
// ═══════════════════════════════════════════════════════════════
'use strict';

const { browserSource } = require('./action-policy');
const { browserSource: jobProducerSource } = require('./job-producer');

const {
    HIGH_CONF, COOLDOWN, REJECT_WORDS, EDITOR_SKIP, SUPPRESS_KEYWORDS, LIMITS,
} = require('./constants');

function buildObserverScript(patterns, blacklist, scrollEnabled, scrollPauseMs, dryRun, skipBrowserAgent, policy = {}) {
    // Version tag - increment this when observer logic changes
    const OBSERVER_VERSION = 'v4.0.23-autopilot';
    const config = { enabled: true, paused: false, patterns, blacklist, scrollEnabled, scrollPauseMs, dryRun, skipBrowserAgent, ...policy };
    return `(function() {
    'use strict';
    var initialConfig = ${JSON.stringify(config)};
    if (window.__gravObserver && window.__gravObserver.version === '${OBSERVER_VERSION}') {
        window.__gravObserver.updateConfig(initialConfig);
        return;
    }
    if (window.__gravObserver) window.__gravObserver.dispose();
    var disposed = false, timers = new Set(), observers = [], listeners = [];
    var nativeTimeout = window.setTimeout.bind(window), nativeInterval = window.setInterval.bind(window);
    function setTimeout(fn, ms) {
        var id = nativeTimeout(function() { timers.delete(id); if (!disposed) fn(); }, ms);
        timers.add(id); return id;
    }
    function setInterval(fn, ms) {
        var id = nativeInterval(function() { if (!disposed) fn(); }, ms);
        timers.add(id); return id;
    }
    function observe() {
        var observer = new window.MutationObserver(function(m) { if (!disposed) onMutation(m); });
        observers.push(observer); return observer;
    }
    var Policy = ${browserSource};
    var CreateJobProducer = ${jobProducerSource};
    window.__gravPolicy = Policy;
    var coordinator = Policy.createCoordinator(window, "cdp-dom");
    var scheduler = Policy.createEventScheduler(safeScanner, { setTimeout: setTimeout, clearTimeout: window.clearTimeout.bind(window), delay: 50 });
    var current = initialConfig, policyExpiresAt = 0;
    var PATTERNS = ${JSON.stringify(patterns)};
    var BLACKLIST = ${JSON.stringify(blacklist)};
    var SCROLL_ON = ${scrollEnabled};
    var SCROLL_PAUSE = ${scrollPauseMs};
    var DRY_RUN = ${dryRun ? 'true' : 'false'};
    var SKIP_BROWSER_AGENT = ${skipBrowserAgent ? 'true' : 'false'};
    var APPROVE_MS = Policy.milliseconds(current.approveMs, 1000);
    var SCROLL_MS = Policy.milliseconds(current.scrollMs, 800);
    var lastUserScroll = 0, scrollTick;
    function canAct() { return !disposed && coordinator.snapshot().currentOwner && !coordinator.snapshot().reasonCode && typeof current.policyVersion === 'string' && Date.now() < policyExpiresAt && Policy.canAct(current); }
    function updateConfig(next) {
        if (current.policyVersion !== next.policyVersion || next.paused || next.dryRun || !next.enabled) { coordinator.cancelPending(); scheduler.cancel(); }
        var used = current.policyVersion === next.policyVersion ? current.retryUsed : null;
        current = Object.assign({}, next);
        if (used) current.retryUsed = used;
        coordinator.resume(next.resumeToken);
        if (!next.paused && next.enabled) scheduler.resume();
        policyExpiresAt = typeof current.policyVersion === 'string' && typeof current.paused === 'boolean' && typeof current.dryRun === 'boolean' ? Date.now() + 2000 : 0;
        PATTERNS = Policy.resolvePatterns(current);
        BLACKLIST = current.blacklist;
        SCROLL_ON = current.scrollEnabled === true;
        SCROLL_PAUSE = Number.isFinite(current.scrollPauseMs) && current.scrollPauseMs >= 0 ? current.scrollPauseMs : 7000;
        DRY_RUN = current.dryRun === true;
        SKIP_BROWSER_AGENT = current.skipBrowserAgent === true;
        var nextApprove = Policy.milliseconds(current.approveMs, 1000);
        var nextScroll = Policy.milliseconds(current.scrollMs, 800);
        if (nextApprove !== APPROVE_MS && _scanTimer) { window.clearTimeout(_scanTimer); timers.delete(_scanTimer); _scanTimer = null; }
        if (nextApprove !== APPROVE_MS && pollTimer) { window.clearInterval(pollTimer); timers.delete(pollTimer); pollTimer = setInterval(safeScanner, nextApprove * (current.eventScheduler ? 4 : 1)); }
        if (nextScroll !== SCROLL_MS && scrollTimer) { window.clearInterval(scrollTimer); timers.delete(scrollTimer); scrollTimer = setInterval(scrollTick, nextScroll); }
        APPROVE_MS = nextApprove; SCROLL_MS = nextScroll;
        var health = coordinator.snapshot();
        return { adapterVersion: 'adapter-v1', scheduler: scheduler.snapshot(), ledger: health, reasonCode: health.reasonCode, verified: health.currentOwner && !health.reasonCode && !disposed && policyExpiresAt > Date.now() && !!current.policyVersion && !/grav.*dashboard/i.test(document.title || '') && /(?:vscode-webview:|vscode-file:)/.test(location.href), policyVersion: current.policyVersion, expiresAt: policyExpiresAt };
    }
    window.__gravObserver = { version: '${OBSERVER_VERSION}', updateConfig: updateConfig, dispose: function() {
        disposed = true; coordinator.cancelPending(); scheduler.cancel();
        try { jobProducer.dispose(); } catch(_) {}
        timers.forEach(function(id) { window.clearTimeout(id); window.clearInterval(id); }); timers.clear();
        observers.forEach(function(observer) { observer.disconnect(); });
        listeners.forEach(function(l) { window.removeEventListener(l[0], l[1], l[2]); });
        if (Element.prototype.attachShadow === wrappedAttachShadow) Element.prototype.attachShadow = _origAttachShadow;
        if (window.__gravObserver && window.__gravObserver.dispose === this.dispose) { delete window.__gravObserver; window.__grav3 = false; }
    } };
    window.__grav3 = '${OBSERVER_VERSION}';
    updateConfig(initialConfig);

    var _clickId = 0;

    // ── Shared Constants (from constants.js) ────────────────
    var REJECT_WORDS = ${JSON.stringify(REJECT_WORDS)};
    var EDITOR_SKIP = ${JSON.stringify(EDITOR_SKIP)};
    var SUPPRESS_KEYWORDS = ${JSON.stringify(SUPPRESS_KEYWORDS)};
    var LIM = ${JSON.stringify(LIMITS)};

    // ── Label Normalization & Shortcut Stripping ────────────
    function cleanLabel(text) {
        if (!text) return '';
        // Strip keyboard shortcuts like (Cmd+Shift+A) or [Enter] or (Ctrl+Enter) at the end
        var cleaned = text.replace(/\\s*[\\(\\[][^\\]\\)]*[\\)\\]]\\s*$/, '');
        // Strip enter symbols ↵, arrow icons, and other non-alphanumeric control marks
        cleaned = cleaned.replace(/[\\u21B5\\u23CE\\u21A9\\u2192\\u2190]/g, '');
        return cleaned.trim();
    }

    // ── Communication (CSP-safe: no XHR needed) ─────────────
    function report(type, data) {
        try {
            console.log('[GRAV:' + type + '] ' + (typeof data === 'string' ? data : JSON.stringify(data)));
        } catch(e) { console.error('[GRAV] report error:', e.message); }
    }
    function matchPattern(text, pattern) {
        var t = cleanLabel(text).toLowerCase();
        var p = cleanLabel(pattern).toLowerCase();
        if (t === p) return true;
        if (t.indexOf(p) !== 0) return false;
        if (t.length === p.length) return true;
        var c = t.charAt(p.length);
        return /[\\s\\u00a0.,;:!?\\-\\u2013\\u2014()\\[\\]{}|/\\\\<>'"@#\\$%^&*+=~\\x60]/.test(c);
    }

    function findMatch(text) {
        var best = '', bestLen = 0;
        for (var i = 0; i < PATTERNS.length; i++) {
            if (PATTERNS[i].length > bestLen && matchPattern(text, PATTERNS[i])) {
                best = PATTERNS[i]; bestLen = best.length;
            }
        }
        return best;
    }

    // ── Button Label Extraction (multi-strategy) ────────────
    function labelOf(btn) {
        // 1. aria-label (most explicit — set deliberately by component)
        var aria = (btn.getAttribute('aria-label') || '').trim();
        if (aria.length >= 2 && aria.length <= 60) return aria;

        // 2. data-tooltip / data-title (VS Code common pattern)
        var dataTip = (btn.getAttribute('data-tooltip') || btn.getAttribute('data-title') || '').trim();
        if (dataTip.length >= 2 && dataTip.length <= 60) return dataTip;

        // 3. Direct text nodes (most accurate for simple buttons)
        var direct = '';
        for (var i = 0; i < btn.childNodes.length; i++) {
            if (btn.childNodes[i].nodeType === 3) direct += btn.childNodes[i].nodeValue || '';
        }
        direct = direct.trim();
        if (direct.length >= 2 && direct.length <= 60) return direct;

        // 4. innerText first line
        var raw = (btn.innerText || btn.textContent || '').trim();
        var first = raw.split('\\n')[0].trim();
        first = cleanLabel(first);
        if (first.length >= 2 && first.length <= 60) return first;

        // 5. title attribute
        var title = cleanLabel((btn.getAttribute('title') || '').trim());
        if (title.length >= 2 && title.length <= 60) return title;

        // 6. value attribute (input[type=button])
        var value = cleanLabel((btn.getAttribute('value') || '').trim());
        if (value.length >= 2 && value.length <= 60) return value;

        // 7. Nested spans (React wraps text in layers)
        var spans = btn.querySelectorAll('span, div, label, p, b, strong');
        var st = '';
        for (var j = 0; j < spans.length; j++) {
            var t = '';
            for (var k = 0; k < spans[j].childNodes.length; k++) {
                if (spans[j].childNodes[k].nodeType === 3) t += spans[j].childNodes[k].nodeValue || '';
            }
            t = t.trim();
            if (t) st += (st ? ' ' : '') + t;
        }
        st = cleanLabel(st);
        if (st.length >= 2 && st.length <= 60) return st;

        // 8. alt attribute (image buttons)
        var alt = cleanLabel((btn.getAttribute('alt') || '').trim());
        if (alt.length >= 2 && alt.length <= 60) return alt;

        // 9. data-testid / id / class mapping for icon-only buttons
        var testId = (btn.getAttribute('data-testid') || '').toLowerCase();
        if (testId) {
            if (testId.indexOf('submit') !== -1) return 'Submit';
            if (testId.indexOf('send') !== -1) return 'Submit';
            if (testId.indexOf('accept-all') !== -1 || testId.indexOf('acceptall') !== -1) return 'Accept all';
            if (testId.indexOf('accept') !== -1) return 'Accept';
            if (testId.indexOf('approve') !== -1) return 'Approve';
            if (testId.indexOf('run') !== -1) return 'Run';
            if (testId.indexOf('allow') !== -1) return 'Allow';
        }
        var id = (btn.id || '').toLowerCase();
        if (id) {
            if (id.indexOf('submit') !== -1) return 'Submit';
            if (id.indexOf('send') !== -1) return 'Submit';
            if (id.indexOf('acceptall') !== -1 || id.indexOf('accept-all') !== -1) return 'Accept all';
        }
        var cls = (btn.className || '').toString().toLowerCase();
        if (cls) {
            if (cls.indexOf('submit') !== -1) return 'Submit';
            if (cls.indexOf('send') !== -1) return 'Submit';
            if (cls.indexOf('acceptall') !== -1 || cls.indexOf('accept-all') !== -1) return 'Accept all';
        }

        return '';
    }

    // ── Safety Guard ────────────────────────────────────────
    function extractCmd(btn) { return Policy.extractCommand(btn); }

    // ── Reject Sibling Detection ────────────────────────────
    function hasRejectNearby(btn) {
        var p = btn.parentElement;
        var SEL = 'button, [role="button"], a.action-label, vscode-button, span.cursor-pointer, [class*="cursor-pointer"], [class*="flux-button"], [class*="flux-action"], [data-testid*="accept"], [data-testid*="approve"], [data-testid*="allow"], [data-testid*="run"], div.clickable, [class*="clickable"], .monaco-button, [class*="monaco-button"]';
        for (var lv = 0; lv < 5 && p; lv++) {
            var sibs = p.querySelectorAll(SEL);
            for (var i = 0; i < sibs.length; i++) {
                if (sibs[i] === btn) continue;
                var t = labelOf(sibs[i]);
                for (var j = 0; j < REJECT_WORDS.length; j++) {
                    if (matchPattern(t, REJECT_WORDS[j])) return true;
                }
            }
            p = p.parentElement;
        }
        return false;
    }

    // ══════════════════════════════════════════════════════════
    //  Editor/Settings Context Detection — HARD BLOCK
    //  Antigravity 1.19.6+ DOM structure:
    //    - Agent chat panel: .antigravity-agent-side-panel, .react-app-container,
    //      [class*=agent], [class*=chat], [class*=cascade]
    //    - Settings: .settings-editor, [class*=settings], [class*=preference]
    //    - Editor: .monaco-editor, .monaco-diff-editor
    //    - Browser: .simple-browser, [class*=browser]
    //    - Extensions: .extensions-editor, [class*=extension-editor]
    //    - Grav Dashboard: .root (Grav's own dashboard)
    //
    //  CRITICAL: We MUST NOT click buttons in Settings, Browser,
    //  Editor, Extensions, or Grav Dashboard — only in agent chat panel.
    // ══════════════════════════════════════════════════════════
    function inEditorContext(btn) {
        if (!btn.closest) return false;
        
        // ── Grav Dashboard detection (by page title or root class) ──
        // Grav dashboard has title "Grav — Dashboard" and uses .root container
        try {
            var pageTitle = (document.title || '').toLowerCase();
            if (pageTitle.indexOf('grav') !== -1 && pageTitle.indexOf('dashboard') !== -1) return true;
        } catch(_) { /* DOM op */ }
        
        return !!(
            // ── Monaco Editor (code editor, diff, merge) ──
            btn.closest('.monaco-editor') ||
            btn.closest('.monaco-diff-editor') ||
            btn.closest('.merge-editor-view') ||
            btn.closest('.editor-actions') ||
            btn.closest('.title-actions') ||
            btn.closest('.monaco-toolbar') ||
            // ── Settings panels (all variants) ──
            btn.closest('.settings-editor') ||
            btn.closest('.settings-body') ||
            btn.closest('.settings-tree-container') ||
            btn.closest('[class*=settings-editor]') ||
            btn.closest('[class*=settings]') ||
            btn.closest('[class*=preference]') ||
            btn.closest('[id*=settings]') ||
            // ── Browser / Simple Browser panel ──
            btn.closest('.simple-browser') ||
            btn.closest('[class*=simple-browser]') ||
            btn.closest('[class*=browser-preview]') ||
            btn.closest('[class*=webview-browser]') ||
            // ── Extensions panel ──
            btn.closest('.extensions-editor') ||
            btn.closest('.extension-editor') ||
            btn.closest('[class*=extension-editor]') ||
            btn.closest('[class*=extensions-list]') ||
            btn.closest('[class*=marketplace]') ||
            // ── Keybindings editor ──
            btn.closest('[class*=keybinding]') ||
            btn.closest('.keybindings-editor') ||
            // ── Context menus, quick input ──
            // NOTE: Do NOT block .sidebar or .panel-header — agent panel
            // lives inside the sidebar on Antigravity 1.19.6+
            btn.closest('.context-view') ||
            btn.closest('.monaco-menu') ||
            btn.closest('.terminal-tab') ||
            // ── Accounts / Auth panels ──
            btn.closest('[class*=accounts]') ||
            btn.closest('[class*=authentication]') ||
            // ── Welcome / Walkthrough ──
            btn.closest('[class*=welcome]') ||
            btn.closest('[class*=walkthrough]') ||
            btn.closest('[class*=getting-started]') ||
            // ── Output panel (specific selectors — avoid [class*=output] which
            //    blocks agent tool-output / command-output containers) ──
            btn.closest('.output-view-container') ||
            btn.closest('[id*=output]') ||
            // ── Source Control panel ──
            btn.closest('.scm-view') ||
            btn.closest('[class*=scm-view]') ||
            btn.closest('[class*=source-control]') ||
            // ── Debug / Run panel ──
            btn.closest('.debug-toolbar') ||
            btn.closest('[class*=debug-view]') ||
            btn.closest('[class*=debug-pane]') ||
            // ── Problems / Markers panel ──
            btn.closest('[class*=problems-panel]') ||
            btn.closest('[class*=markers-panel]') ||
            // ── Search panel ──
            btn.closest('[class*=search-view]') ||
            btn.closest('[class*=search-widget]') ||
            // ── Notebook ──
            btn.closest('[class*=notebook]')
        );
    }

    function isEditorAccept(text) {
        for (var i = 0; i < EDITOR_SKIP.length; i++) {
            if (matchPattern(text, EDITOR_SKIP[i])) return true;
        }
        return false;
    }

    // ══════════════════════════════════════════════════════════
    //  SOLUTION 1: Identity-based click tracking
    //  Problem: WeakSet loses tracking when React re-renders
    //  (new DOM node = same button but WeakSet doesn't know)
    //  Fix: Use data-attribute stamping + text-based dedup
    // ══════════════════════════════════════════════════════════
    var _expandedOnce = new WeakSet();
    var _globalCooldown = 0;  // Global cooldown after ANY click (prevent rapid fire)
    var _runCooldown = 0;     // Extra cooldown for Run buttons (terminal needs more time)
    var _lastClickedPattern = '';  // Track last clicked pattern

    // Cooldown durations (ms) — from shared constants
    var COOLDOWN = ${JSON.stringify(COOLDOWN)};

    function getCooldown(text) {
        return COOLDOWN[text] || COOLDOWN.DEFAULT;
    }

    function isAlreadyClicked(btn, text) {
        if (Date.now() < _globalCooldown) return true;
        var intent = Policy.actionIdentity(coordinator, btn, text, current);
        return btn.getAttribute('data-grav-clicked') === 'true' || btn.getAttribute('data-grav-clicked') === intent.key;

    }

    function markClicked(btn, text) {
        var intent = Policy.actionIdentity(coordinator, btn, text, current);
        try { btn.setAttribute('data-grav-clicked', intent.key); } catch(_) {}
        _globalCooldown = Date.now() + (text === 'Expand' ? 200 : COOLDOWN.GLOBAL);

        ++_clickId;
    }

    // Check if we're in Run cooldown period
    function isRunCooldown() {
        return Date.now() < _runCooldown;
    }

    // HIGH_CONFIDENCE: patterns that ONLY appear in agent approval contexts — from shared constants
    var HIGH_CONF = ${JSON.stringify(HIGH_CONF)};


    // ══════════════════════════════════════════════════════════
    //  Agent Chat Context Detection — Antigravity 1.19.6+
    //  This function confirms a button is inside the agent chat panel.
    //  Antigravity's agent panel uses these containers:
    //    - .antigravity-agent-side-panel (main agent panel)
    //    - .react-app-container (React root for agent UI)
    //    - [class*=agent] (agent-related containers)
    //    - [class*=chat] (chat containers)
    //    - [class*=cascade] (Cascade flow containers)
    //    - [class*=cortex] (Cortex step containers)
    //    - [class*=dialog] (approval dialogs)
    //    - [class*=notification] (notification toasts)
    //
    //  Since this observer only runs inside agent webviews
    //  (filtered by isAgentTarget at host level), we can be
    //  permissive here — but still block known non-agent containers.
    // ══════════════════════════════════════════════════════════
    function inAgentContext(btn) {
        if (!btn.closest) return false;

        // ── HARD BLOCK: Never click in these containers ──
        // (double-safety: even if isAgentTarget let this target through)
        if (btn.closest('.settings-editor') ||
            btn.closest('.settings-body') ||
            btn.closest('[class*=settings-editor]') ||
            btn.closest('.simple-browser') ||
            btn.closest('[class*=simple-browser]') ||
            btn.closest('.extensions-editor') ||
            btn.closest('[class*=extension-editor]') ||
            btn.closest('.keybindings-editor') ||
            btn.closest('[class*=preference]') ||
            btn.closest('[class*=browser-preview]')) {
            return false;
        }

        // ── Positive match: Antigravity agent panel containers ──
        // NOTE: Selectors must be TIGHT. Broad selectors like [class*=toolbar],
        // [class*=action-bar], [class*=tool], [class*=command], [class*=terminal]
        // match non-agent VS Code UI (editor toolbar, command palette, terminal tabs)
        // and would cause false-positive clicks in settings/editor/terminal.
        return !!(
            // Standalone / Orchestrator layout contexts
            btn.closest('[class*=desktop]') ||
            btn.closest('[class*=orchestrator]') ||
            btn.closest('[class*=scheduler]') ||
            // Antigravity-specific
            btn.closest('.antigravity-agent-side-panel') ||
            btn.closest('[class*=agent-panel]') ||
            btn.closest('[class*=agent-side]') ||
            btn.closest('[class*=cascade]') ||
            btn.closest('[class*=cortex]') ||
            // Generic agent/chat containers
            btn.closest('[class*=agent]') ||
            btn.closest('[class*=chat]') ||
            // Interactive modal / dialog / quick-input containers
            btn.closest('.quick-input-widget') ||
            btn.closest('.quick-input-container') ||
            btn.closest('.monaco-dialog-box') ||
            btn.closest('.dialog-buttons') ||
            // Approval dialogs and notifications
            btn.closest('[class*=dialog]') ||
            btn.closest('[class*=notification]') ||
            btn.closest('[class*=popup]') ||
            btn.closest('[class*=modal]') ||
            // Agent step containers (tool steps, approval steps)
            btn.closest('[class*=step]') ||
            // React app container (Antigravity agent UI root)
            btn.closest('.react-app-container')
        );
    }

    // ══════════════════════════════════════════════════════════
    //  SOLUTION 2: Multi-layer click execution
    //  Learned from Puppeteer internals + chrome-accept-cookies:
    //  Layer 1: .click() — standard DOM click
    //  Layer 2: Full pointer event sequence (React SyntheticEvent)
    //  Layer 3: .focus() + Enter key (keyboard activation)
    //  Layer 4: Verify + retry after 200ms
    // ══════════════════════════════════════════════════════════
    function executeClick(btn, matched, text) {
        if (!canAct() || inEditorContext(btn) || btn.disabled || btn.isConnected === false || !(findMatch(labelOf(btn)) || Policy.interactionPattern(btn, current))) return;
        var cmd = Policy.readsCommand(matched) ? extractCmd(btn) : '';
        var snap = jobProducer && jobProducer.snapshot ? jobProducer.snapshot() : null;
        var conv = snap && typeof snap.conversationId === 'string' && snap.conversationId ? snap.conversationId
            : (jobProducer && jobProducer.currentConversation ? jobProducer.currentConversation() : null);
        var policy = Object.assign({}, current);
        if (typeof conv === 'string' && conv) {
            policy.conversationId = conv;
            if (snap) { policy.waitReason = snap.waitReason; policy.terminal = snap.terminal === true; policy.failed = snap.failed === true; }
            if (current.retryBudget && current.retryBudget.enabled === true && current.retryUsed) policy.retryBudget = Object.assign({}, current.retryBudget, { used: current.retryUsed });
        }
        var ctx = Policy.actionContext(btn, policy);
        var decision = Policy.evaluateAction(matched, cmd, ctx);
        if (!decision.allowed) { report('BLOCKED', Object.assign({ outcome: 'unknown' }, decision)); return; }
        // Scope selection is UI state, not actuation — no ledger claim. React
        // re-renders the checked option; the next scan re-evaluates and submits.
        if (decision.switchScope) {
            if (!Policy.interaction.selectScope(ctx.interaction, decision.switchScope)) { report('BLOCKED', Object.assign({ outcome: 'unknown' }, decision, { reasonCode: 'scope-select-failed' })); return; }
            report('CLICK', Object.assign({ p: matched, b: text, scopeSwitch: decision.switchScope, outcome: 'scope-selected' }, decision));
            return;
        }
        var intent = Policy.actionIdentity(coordinator, btn, text, current), claim = coordinator.claim(intent, current.policyVersion);
        if (!claim.ok) { report('BLOCKED', { decision: 'manual', reasonCode: claim.reasonCode, reason: 'Intent needs manual review.', outcome: 'unknown' }); return; }
        var live = Object.assign({}, current);
        if (typeof conv === 'string' && conv) {
            live.conversationId = conv;
            if (snap) { live.waitReason = snap.waitReason; live.terminal = snap.terminal === true; live.failed = snap.failed === true; }
            if (current.retryBudget && current.retryBudget.enabled === true && current.retryUsed) live.retryBudget = Object.assign({}, current.retryBudget, { used: current.retryUsed });
        }
        if (!canAct() || !Policy.evaluateAction(matched, Policy.readsCommand(matched) ? extractCmd(btn) : '', Policy.actionContext(btn, live)).allowed || !coordinator.valid(claim.entry, Policy.actionIdentity(coordinator, btn, labelOf(btn), live), current.policyVersion)) return;
        // Question answers need a claim (they actuate) but never click submit
        // directly: single-select auto-advances via the host onNextNoWrap timer
        // (~200ms); multi-select needs an explicit Continue click after state
        // settles.
        if (decision.optionIds) {
            coordinator.attempted(claim.entry);
            if (!Policy.interaction.selectOptions(ctx.interaction, decision.optionIds)) { claim.entry.outcome = 'unknown'; coordinator.postcondition(claim.entry, btn); return; }
            claim.entry.outcome = 'unknown'; claim.entry.postcondition = 'approval-ui-changed';
            report('CLICK', Object.assign({ p: matched, b: text, options: decision.optionIds, autoSubmit: decision.autoSubmit === true, intentId: intent.key, outcome: 'answer-selected' }, decision));
            if (decision.autoSubmit !== true) setTimeout(function() { Policy.interaction.submit(ctx.interaction); }, 300);
            return;
        }
        coordinator.attempted(claim.entry); markClicked(btn, text);
        try { btn.click(); } catch(_) { coordinator.postcondition(claim.entry, btn); return; }
        if (/^(?:retry|try again|resume(?:\s+conversation)?)$/i.test(matched) && typeof conv === 'string' && conv && decision.reasonCode === 'retry-within-budget') {
            if (!current.retryUsed) current.retryUsed = {};
            current.retryUsed[conv] = (Number.isInteger(current.retryUsed[conv]) ? current.retryUsed[conv] : 0) + 1;
        }
        report('CLICK', Object.assign({ p: matched, b: text, cmd: cmd, intentId: intent.key, identityEvidence: intent.evidence, adapterVersion: 'adapter-v1', latencyMs: Date.now() - claim.entry.at, outcome: 'attempted' }, decision));
        setTimeout(function() { coordinator.postcondition(claim.entry, btn); }, 1000);
        if (matched === 'Expand') setTimeout(safeScanner, APPROVE_MS);
    }

    // ══════════════════════════════════════════════════════════
    //  SOLUTION 3: Shadow DOM Piercing & MutationObserver (Layer 1)
    //  Learned from chrome-accept-cookies extension:
    //  Override Element.attachShadow to track all shadow roots,
    //  and immediately attach MutationObservers to them.
    // ══════════════════════════════════════════════════════════
    var _shadowRoots = [];
    var MAX_SHADOW_ROOTS = 200; // Cap to prevent memory leak
    var _origAttachShadow = Element.prototype.attachShadow;
    var wrappedAttachShadow;
    var _observedShadowRoots = new WeakSet();
    var _scanTimer = null;

    function triggerScan() {
        if (current.eventScheduler) { scheduler.trigger(); return; }
        if (_scanTimer) return;
        _scanTimer = setTimeout(function() {
            _scanTimer = null;
            try { safeScanner(); } catch(_) {}
        }, APPROVE_MS);
    }

    function onMutation(mutations) {
        var shouldScan = false;
        for (var i = 0; i < mutations.length; i++) {
            var m = mutations[i];
            if (m.addedNodes && m.addedNodes.length > 0) {
                shouldScan = true;
                for (var j = 0; j < m.addedNodes.length; j++) {
                    var node = m.addedNodes[j];
                    if (node.nodeType === 1) { // ELEMENT_NODE
                        collectShadowRoots(node);
                    }
                }
            } else if (m.type === 'attributes') {
                shouldScan = true;
            }
        }
        if (shouldScan) {
            triggerScan();
        }
    }

    try {
        Element.prototype.attachShadow = wrappedAttachShadow = function(init) {
            var opts = init || {};
            var shadow = _origAttachShadow.call(this, opts);
            // Cap shadow roots array to prevent memory leak
            if (_shadowRoots.length >= MAX_SHADOW_ROOTS) {
                // Remove disconnected roots first, then oldest if still over cap
                _shadowRoots = _shadowRoots.filter(function(sr) {
                    return sr.host && sr.host.isConnected;
                });
                if (_shadowRoots.length >= MAX_SHADOW_ROOTS) {
                    _shadowRoots.shift(); // Remove oldest
                }
            }
            _shadowRoots.push(shadow);
            if (!_observedShadowRoots.has(shadow)) {
                _observedShadowRoots.add(shadow);
                try {
                    var obs = observe();
                    obs.observe(shadow, { childList: true, subtree: true, attributes: true,
                        attributeFilter: ['class','style','disabled','aria-hidden','aria-label','data-state'] });
                } catch(_) { /* DOM op */ }
            }
            return shadow;
        };
    } catch(_) { /* DOM op */ }

    // Collect existing open shadow roots and attach MutationObservers to them
    function collectShadowRoots(root) {
        if (!root) return;
        try {
            var all = root.querySelectorAll('*');
            for (var i = 0; i < all.length; i++) {
                var sr = all[i].shadowRoot;
                if (sr) {
                    if (_shadowRoots.indexOf(sr) === -1) {
                        _shadowRoots.push(sr);
                    }
                    if (!_observedShadowRoots.has(sr)) {
                        _observedShadowRoots.add(sr);
                        try {
                            var obs = observe();
                            obs.observe(sr, { childList: true, subtree: true, attributes: true,
                                attributeFilter: ['class','style','disabled','aria-hidden','aria-label','data-state'] });
                        } catch(_) {}
                        // Trigger immediate scan when new shadow root is detected
                        triggerScan();
                    }
                    collectShadowRoots(sr);
                }
            }
        } catch(_) { /* DOM op */ }
    }

    // ══════════════════════════════════════════════════════════
    //  SOLUTION 4: Nested iframe scanning
    //  Some consent dialogs live in iframes within the OOPIF.
    // ══════════════════════════════════════════════════════════
    function getIframeDocuments() { return []; }

    // ══════════════════════════════════════════════════════════
    //  SOLUTION 5: Unified button collector
    //  Collects buttons from: main document + shadow DOMs + iframes
    //  NOTE: Antigravity uses <span class="cursor-pointer"> for some buttons!
    //  Also covers: flux-* components, data-testid buttons, clickable divs
    // ══════════════════════════════════════════════════════════
    function collectAllButtons() {
        var SEL = 'button, [role="button"], a.action-label, vscode-button, span.cursor-pointer, [class*="cursor-pointer"], [class*="flux-button"], [class*="flux-action"], [data-testid*="accept"], [data-testid*="approve"], [data-testid*="allow"], [data-testid*="run"], div.clickable, [class*="clickable"], .monaco-button, [class*="monaco-button"]';
        var btns = [];

        // Main document
        try {
            var main = document.querySelectorAll(SEL);
            for (var i = 0; i < main.length; i++) btns.push(main[i]);
        } catch(_) { /* DOM op */ }

        // Shadow DOMs
        for (var s = _shadowRoots.length - 1; s >= 0; s--) {
            try {
                if (!_shadowRoots[s].host || !_shadowRoots[s].host.isConnected) {
                    _shadowRoots.splice(s, 1);
                    continue;
                }
                var sb = _shadowRoots[s].querySelectorAll(SEL);
                for (var j = 0; j < sb.length; j++) btns.push(sb[j]);
            } catch(_) {
                _shadowRoots.splice(s, 1);
            }
        }

        // Nested iframes (same-origin only)
        var iframeDocs = getIframeDocuments();
        for (var d = 0; d < iframeDocs.length; d++) {
            try {
                var ib = iframeDocs[d].querySelectorAll(SEL);
                for (var k = 0; k < ib.length; k++) btns.push(ib[k]);
            } catch(_) { /* DOM op */ }
        }

        return btns;
    }

    // ── Browser Agent Detection (Removed polling) ────────────────────────────
    // Replaced by inline detection in scanAndClick to accurately reject tool calls.

    // ── Core: Scan & Click (enhanced) ───────────────────────
    var _scanCount = 0;
    function scanAndClick() {
        if (disposed || Date.now() >= policyExpiresAt || current.enabled !== true || current.paused || current.active === false) return;
        collectShadowRoots(document.body);
        var btns = collectAllButtons();
        _collectedButtonCount = btns.length;
        _scanCount++;

        // Every 20 scans (~30s), emit a SCAN debug report so Diagnostics shows live data
        if (_scanCount % 20 === 0) {
            var labels = [];
            for (var _i = 0; _i < Math.min(btns.length, 20); _i++) {
                var _t = labelOf(btns[_i]);
                if (_t) labels.push(_t);
            }
            report('DEBUG', { scan: _scanCount, btns: btns.length, labels: labels.slice(0,10), url: location.href.slice(0,80) });
        }

        for (var i = 0; i < Math.min(btns.length, 64); i++) {
            var b = btns[(i + _scanOffset) % btns.length];

            // Skip invisible/disabled
            if (b.disabled) continue;
            if (b.offsetWidth === 0 && b.offsetHeight === 0) {
                if (!b.closest || !b.closest('[class*=overlay],[class*=popup],[class*=dialog],[class*=notification]')) continue;
            }

            // Extract text first
            var text = labelOf(b);
            if (!text || text.length > 60) continue;

            var matched = Policy.interactionPattern(b, current) || findMatch(text);
            var isSkipBtn = text === 'Skip' || text === 'Skip Action' || text === 'Skip step' || text.indexOf('Skip') === 0;
            var browserContext = false;

            // ── BROWSER AGENT BYPASS LOGIC ──
            if (SKIP_BROWSER_AGENT) {
                // Use only tight, per-step containers — NOT [class*=message] or [class*=container]
                // which wrap multiple tool calls and cause false positives on terminal Run buttons
                var tc = b.closest('[class*=tool], [class*=step], [class*=preview], [class*=action], [class*=block]');
                if (!tc && isSkipBtn) {
                    // For Skip buttons, search wider (parent hierarchy) since browser agent
                    // UI may not have standard class names
                    tc = b.parentElement;
                    for (var _up = 0; _up < 6 && tc; _up++) { tc = tc.parentElement; }
                    if (!tc) tc = b.parentElement && b.parentElement.parentElement;
                }
                if (tc) {
                    var tcTxt = (tc.innerText || '').toLowerCase().slice(0, 500);
                    var tcClass = (tc.className || '').toLowerCase();
                    browserContext = tcTxt.indexOf('browser_subagent') !== -1 || tcTxt.indexOf('computer_use') !== -1 || tcTxt.indexOf('use_browser') !== -1 ||
                        // Antigravity-specific browser subagent labels
                        tcTxt.indexOf('browser agent') !== -1 || tcTxt.indexOf('open browser') !== -1 || tcTxt.indexOf('web browser') !== -1 ||
                        (tcTxt.indexOf('browser') !== -1 && tcTxt.indexOf('agent') !== -1) ||
                        // Class-based detection: container element has 'browser' in its class name
                        tcClass.indexOf('browser') !== -1 ||
                        // Existing compound checks
                        (tcTxt.indexOf('exploring') !== -1 && tcTxt.indexOf('browser') !== -1) ||
                        (tcTxt.indexOf('navigate') !== -1 && tcTxt.indexOf('browser') !== -1);
                }

                if (isSkipBtn) {
                    if (browserContext) matched = 'Skip';
                } else if (matched && browserContext) {
                    continue; // Block Accept/Run for browser tools
                }
            }

            if (!matched) continue;

            var isHighConf = !!HIGH_CONF[matched] || matched === 'Skip';

            if (matched === 'Skip' && !browserContext) continue;

            // Skip editor context — applies to ALL buttons including HIGH_CONF.
            // Previously HIGH_CONF bypassed this, but that allowed clicks on
            // Run/Accept buttons in editor toolbars, settings, SCM panels etc.
            // when combined with broad inAgentContext() selectors.
            if (inEditorContext(b)) continue;

            // Skip already clicked (multi-layer check)
            if (isAlreadyClicked(b, text)) continue;

            // Skip editor-specific accept patterns (merge conflicts, diff review, etc.)
            if (isEditorAccept(text)) continue;

            // Secondary check: if visible text differs from resolved label (e.g. aria-label="Run"
            // but innerText="Review Changes"), block on visible text too
            var visibleText = ((b.innerText || b.textContent || '').trim().split('\\n')[0] || '').trim();
            if (visibleText && visibleText !== text && visibleText.length <= 60 && isEditorAccept(visibleText)) continue;

            // Safety guard for Run/Execute commands
            if (matched === 'Run' || matched === 'Run Task' || matched === 'Execute' || Policy.requiresCommand(matched)) {
                // Global cooldown: don't click Run too fast (terminal needs time)
                if (isRunCooldown()) continue;
                
                var cmd = extractCmd(b);
                {
                    var evaluation = Policy.evaluateAction(matched, cmd, Policy.actionContext(b, current));
                    if (!evaluation.allowed) {
                        report('BLOCKED', Object.assign({ cmd: cmd.slice(0, 500), outcome: 'unknown' }, evaluation));
                        continue;
                    }
                }
            }

            // ── VALIDATION: Must prove this is an approval dialog ──
            // Skip button in browser context already validated — bypass sibling check
            // (Skip is in REJECT_WORDS so hasRejectNearby can't find a reject sibling for it,
            //  since it excludes itself and Expand isn't a reject word)
            if (matched === 'Skip' && browserContext) {
                // Already confirmed: isSkipBtn + browserContext + SKIP_BROWSER_AGENT
                // No further validation needed
            } else {
                // Strategy 1: Has a Reject/Cancel sibling nearby (strongest signal)
                var hasReject = hasRejectNearby(b);
                // Strategy 2: Inside an agent-like container
                var isAgent = inAgentContext(b);

                // Every action needs either reject-sibling confirmation or a real agent context.
                // This keeps high-confidence labels like Accept/Run from firing in unrelated UI.
                if (!hasReject && !isAgent) {
                    report('DEBUG', { skip: matched, text: text, hasReject: hasReject, isHighConf: isHighConf, isAgent: isAgent });
                    continue;
                }
            }

            // ── DRY RUN: report but don't click ──
            if (DRY_RUN) {
                report('DRYRUN', Object.assign({ p: matched, b: text, pos: (b.getBoundingClientRect().top | 0), outcome: 'unknown' }, Policy.evaluateAction(matched, Policy.readsCommand(matched) ? extractCmd(b) : '', Policy.actionContext(b, current))));
                continue;
            }

            // ── Single activation ──
            executeClick(b, matched, text);
        }
    }

    // ══════════════════════════════════════════════════════════
    //  SOLUTION 6: Periodic Scanner (Replaces MutationObserver)
    //  React transitions + OOPIF can cause MutationObservers to
    //  detach or drop events. SetInterval scanning ensures buttons
    //  are never missed.
    // ══════════════════════════════════════════════════════════
    // Removed MutationObserver in favor of flat polling.

    // ══════════════════════════════════════════════════════════
    //  SOLUTION 7: Slower polling to prevent "requires input" errors
    //  Previous: 800ms fast + 3000ms slow = too aggressive
    //  New: 1500ms standard + 5000ms safety = gives terminal time
    // ══════════════════════════════════════════════════════════
    var _lastClickTime = Date.now();
    var _origReport = report;
    report = function(type, data) {
        if (type === 'CLICK') _lastClickTime = Date.now();
        _origReport(type, data);
    };

    // Boot report — tell host what patterns + url we have
    setTimeout(function() {
        try {
            report('BOOT', { url: location.href.slice(0,120), title: document.title.slice(0,60), patterns: PATTERNS.length, dryRun: DRY_RUN });
        } catch(_) { /* DOM op */ }
    }, 1000);

    // Guard: prevent concurrent scans — if a scan is still running (e.g. slow shadow root
    // collection across many nested webviews), skip the next tick rather than overlap.
    var _scanning = false, _scanOffset = 0, _collectedButtonCount = 0;
    function safeScanner() {
        if (_scanning) return;
        _scanning = true; _collectedButtonCount = 0;
        try { scanAndClick(); } catch(_) { /* non-critical */ } finally { _scanning = false; _scanOffset += 64; if (current.eventScheduler && _scanOffset < _collectedButtonCount) scheduler.trigger(); else _scanOffset = 0; }
    }

    // Event-driven MutationObserver initialization on the main document
    try {
        var docObs = observe();
        docObs.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class', 'style', 'disabled', 'aria-hidden', 'aria-label', 'data-state']
        });
    } catch(_) {}

    // Scan cadence follows the configured approval interval.
    var pollTimer = setInterval(safeScanner, APPROVE_MS * (current.eventScheduler ? 4 : 1));

    // Initial scan with delay (let page settle)
    setTimeout(safeScanner, 1000);

    // ── Auto-Scroll (stick-to-bottom) ───────────────────────
    // Tracks per-element "was at bottom" state. If user scrolls up, we let them read.
    {
        var _agWasAtBottom = new WeakMap();
        var _agJustScrolled = new WeakSet();
        var BOTTOM_THRESHOLD = 150;
        var _isAutoScrolling = false;

        var scrollHandler = function(e) {
            var el = e.target;
            if (!el || el.nodeType !== 1) return;
            
            // Only care about in-chat scrolling
            if (!el.closest || !el.closest('.antigravity-agent-side-panel,[class*=chat],[class*=agent]')) return;

            // Ignores programmatic scroll events
            if (_agJustScrolled.has(el)) {
                _agJustScrolled.delete(el);
                return;
            }
            if (_isAutoScrolling) return;
            lastUserScroll = Date.now();

            var gap = el.scrollHeight - el.scrollTop - el.clientHeight;
            if (gap <= BOTTOM_THRESHOLD) {
                // User scrolled back to the bottom
                _agWasAtBottom.set(el, true);
            } else {
                // User scrolled up to read
                _agWasAtBottom.set(el, false);
            }
        };
        window.addEventListener('scroll', scrollHandler, true);
        listeners.push(['scroll', scrollHandler, true]);

        scrollTick = function() {
            if (!canAct() || !SCROLL_ON || Date.now() - lastUserScroll < SCROLL_PAUSE) return;
            var candidates = document.querySelectorAll(
                '.antigravity-agent-side-panel, [class*=chat], [class*=agent], [class*=cascade], [class*=cortex]'
            );
            var scrollables = [];
            for (var _s = 0; _s < candidates.length; _s++) {
                var el = candidates[_s];
                var tag = el.tagName;
                if (tag === 'TEXTAREA' || tag === 'CODE' || tag === 'PRE' || tag === 'INPUT') continue;
                var style = window.getComputedStyle(el);
                if (el.scrollHeight > el.clientHeight && (style.overflowY === 'auto' || style.overflowY === 'scroll')) {
                    scrollables.push(el);
                }
            }

            if (scrollables.length > 0) {
                _isAutoScrolling = true;
                scrollables.forEach(function (el) {
                    var gap = el.scrollHeight - el.scrollTop - el.clientHeight;
                    var wasBottom = _agWasAtBottom.get(el);

                    // First time seeing this target? Check if it's currently at the bottom.
                    if (wasBottom === undefined) {
                        wasBottom = gap <= BOTTOM_THRESHOLD;
                        _agWasAtBottom.set(el, wasBottom);
                    }

                    if (wasBottom) {
                        if (gap > 5) {
                            _agJustScrolled.add(el);
                            try {
                                if (gap < 300) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
                                else el.scrollTop = el.scrollHeight;
                            } catch(_) {
                                el.scrollTop = el.scrollHeight;
                            }
                        }
                    }
                });
                setTimeout(function () { _isAutoScrolling = false; }, 200);
            }
        }
        var scrollTimer = setInterval(scrollTick, SCROLL_MS);
    }

    // ── Self-Healing ────────────────────────────────────────
    var _healTick = 0;
    setInterval(function() {
        _healTick++;
        // Refresh open shadow roots explicitly
        if (_healTick >= 10) {
            _healTick = 0;
            collectShadowRoots(document.body);
        }
    }, 15000); // 15s interval, healing every 150s (2.5 mins)

    // ── Suppress Corrupt Banner + "Requires Input" Notifications ──
    // FIX: Use MutationObserver (event-driven) instead of setInterval (polling)
    // This eliminates the flashing caused by continuous re-scanning.
    (function() {
        // SUPPRESS_KEYWORDS is already defined at top from shared constants
        var _dismissTimer = null;

        function dismissOnce() {
            _dismissTimer = null;
            if (!canAct()) return;
            try {
                var toasts = document.querySelectorAll(
                    '.notifications-toasts .notification-toast, .notification-list-item, .notification-center .notification-toast-container'
                );
                toasts.forEach(function(el) {
                    var t = (el.textContent || '').toLowerCase();
                    var shouldDismiss = SUPPRESS_KEYWORDS.some(function(kw) { return t.indexOf(kw) !== -1; });
                    if (!shouldDismiss) return;

                    // KILL_TERMINAL guard: only fire if a real blocking <input>/<textarea>
                    // is visible in the notification DOM (genuine interactive shell prompt).
                    // Antigravity approval toasts do NOT contain input elements — safe to skip.
                    var hasBlockingInput = (function() {
                        try {
                            var inputs = el.querySelectorAll('input:not([type=hidden]), textarea');
                            for (var i = 0; i < inputs.length; i++) {
                                if (inputs[i].offsetWidth > 0 && inputs[i].offsetHeight > 0) return true;
                            }
                        } catch(_) {}
                        return false;
                    })();
                    if (hasBlockingInput) {
                        console.log('[GRAV:KILL_TERMINAL] Blocking input detected in notification');
                    }

                    // Try close button first (graceful)
                    var closeBtn = el.querySelector('.codicon-notifications-clear, .codicon-close, [class*=close], [aria-label*=close], [aria-label*=Clear]');
                    if (closeBtn && closeBtn.offsetWidth > 0) {
                        try { closeBtn.click(); } catch(_) { /* DOM op */ }
                    } else {
                        // Fallback: hide element (avoids DOM thrashing)
                        el.style.display = 'none';
                    }
                });
            } catch(_) { /* DOM op */ }
        }

        // Run once on load
        setTimeout(dismissOnce, 500);
        setTimeout(dismissOnce, 2000);

        // Use MutationObserver to react to new notifications only
        try {
            var notifArea = document.querySelector('.notifications-toasts, .notification-center, body');
            if (notifArea) {
                var notifObs = new window.MutationObserver(function(muts) {
                    if (disposed) return;
                    // Debounce: only dismiss once per 300ms burst of mutations
                    if (_dismissTimer) return;
                    _dismissTimer = setTimeout(dismissOnce, 300);
                });
                observers.push(notifObs);
                notifObs.observe(notifArea, { childList: true, subtree: true });
            }
        } catch(_) { /* DOM op */ }
    })();

    // ── Host job lifecycle producer ───────────────────────────
    // Subscribes to the workbench agentStateProvider found through
    // React/Preact fiber expandos and reports [GRAV:JOB] events.
    var jobProducer = CreateJobProducer({ report: report, setTimeout: setTimeout });
    jobProducer.start();

    report('BOOT', { v:2, patterns: PATTERNS.length, blacklist: BLACKLIST.length, scroll: SCROLL_ON, shadows: _shadowRoots.length, url: location.href.substring(0, 100) });

    // Debug: log all buttons found on first scan (including shadow DOM + iframes)
    setTimeout(function() {
        var allBtns = collectAllButtons();
        var labels = [];
        var acceptLike = [];
        var acceptRe = /(accept|approve|retry|run|proceed|expand)/i;
        for (var i = 0; i < allBtns.length && i < 200; i++) {
            var l = labelOf(allBtns[i]);
            if (l) {
                labels.push(l);
                if (acceptRe.test(l) && acceptLike.length < 50) acceptLike.push(l);
            }
        }
        report('DEBUG', {
            buttonCount: allBtns.length,
            shadowRoots: _shadowRoots.length,
            iframes: getIframeDocuments().length,
            labels: labels.slice(0, 80),
            acceptLike: acceptLike,
        });
    }, 3000);
})();`;
}

module.exports = { buildObserverScript };
