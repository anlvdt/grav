(function () {
    'use strict';
    if (window.__gravRuntime) window.__gravRuntime.dispose();
    var disposed = false, scrollHandler = null, timers = new Set(), observers = [], requests = new Set();
    var nativeTimeout = window.setTimeout.bind(window), nativeInterval = window.setInterval.bind(window);
    function setTimeout(fn, ms) {
        var id = nativeTimeout(function() { timers.delete(id); if (!disposed) fn(); }, ms);
        timers.add(id); return id;
    }
    function setInterval(fn, ms) {
        var id = nativeInterval(function() { if (!disposed) fn(); }, ms);
        timers.add(id); return id;
    }
    var NativeXHR = window.XMLHttpRequest;
    function XMLHttpRequest() { var request = new NativeXHR(); requests.add(request); request.addEventListener('loadend', function() { requests.delete(request); }); return request; }
    var Policy = /*{{ACTION_POLICY}}*/null;
    Policy = Policy || window.__gravPolicy;
    var coordinator = Policy.createCoordinator(window, "injected-dom");
    var pendingActions = new Set();
    function cancelActions() { pendingActions.forEach(function(id) { window.clearTimeout(id); timers.delete(id); }); pendingActions.clear(); coordinator.cancelPending(); }
    var scheduler = Policy.createEventScheduler(function() { scanAndClick(); }, { setTimeout: setTimeout, clearTimeout: window.clearTimeout.bind(window), delay: 50 });
    var initialPolicy = /*{{POLICY}}*/null;
    var policy = { enabled: false, paused: true, dryRun: true, blacklist: [] };
    var policyExpiresAt = 0;
    function canAct() { return !disposed && !!Policy && coordinator.snapshot().currentOwner && !coordinator.snapshot().reasonCode && typeof policy.policyVersion === 'string' && Date.now() < policyExpiresAt && Policy.canAct(policy); }
    var runtimeController = window.__gravRuntime = { updateConfig: function(c) { applyConfig(c); }, dispose: function() {
        disposed = true; cancelActions(); scheduler.cancel();
        timers.forEach(function(id) { window.clearInterval(id); window.clearTimeout(id); }); timers.clear();
        observers.forEach(function(observer) { observer.disconnect(); });
        requests.forEach(function(request) { request.abort(); }); requests.clear();
        if (scrollHandler) window.removeEventListener('scroll', scrollHandler, true);
        if (window.__gravRuntime === runtimeController) { window.__gravTimers = []; window.__gravLoaded = false; delete window.__gravRuntime; }
    } };

    // Cleanup existing timers and handlers
    if (window.__gravTimers) { window.__gravTimers.forEach(clearInterval); window.__gravTimers = []; }
    if (window.__gravScrollHandler) { window.removeEventListener('scroll', window.__gravScrollHandler, true); window.__gravScrollHandler = null; }
    if (window.__gravApproveObserver) { try { window.__gravApproveObserver.disconnect(); } catch { } window.__gravApproveObserver = null; }

    window.__gravTimers = [];

    // Config
    var PAUSE_MS = /*{{PAUSE_MS}}*/7000;
    var APPROVE_MS = /*{{APPROVE_MS}}*/500;
    var SCROLL_MS = /*{{SCROLL_MS}}*/500;
    var PATTERNS = /*{{PATTERNS}}*/["Accept all", "Accept All", "Accept", "Retry", "Proceed", "Run", "Approve", "Expand"];
    var ENABLED = /*{{ENABLED}}*/true;

    window.__gravEnabled = ENABLED;
    window.__gravScrollEnabled = true;

    // Corrupt-banner suppression
    (function () {
        var dismiss = function () {
            if (!canAct()) return;
            var toasts = document.querySelectorAll('.notifications-toasts .notification-toast, .notification-list-item');
            toasts.forEach(function (el) {
                var text = (el.textContent || '').toLowerCase();
                if (text.indexOf('corrupt') !== -1 || text.indexOf('reinstall') !== -1) {
                    var btn = el.querySelector('.codicon-notifications-clear, .codicon-close, [class*=close]');
                    if (btn) btn.click(); else el.style.display = 'none';
                }
            });
        };
        dismiss();
        var count = 0;
        var t = setInterval(function () { dismiss(); if (++count > 30) clearInterval(t); }, 1000);
    })();

    // Bridge sync
    var BRIDGE_PORT_START = 48787, BRIDGE_PORT_END = 48850, BRIDGE_PORT = 0;
    var _pollErrors = 0, _scanning = false;

    var discoverBridge = function (cb) {
        if (_scanning) return;
        _scanning = true;
        var found = false;
        var batch = function (from) {
            if (from > BRIDGE_PORT_END || found) { if (!found) _scanning = false; return; }
            var end = Math.min(from + 7, BRIDGE_PORT_END), pending = 0;
            for (var p = from; p <= end; p++) {
                (function (port) {
                    pending++;
                    var x = new XMLHttpRequest();
                    x.open('GET', 'http://127.0.0.1:' + port + '/grav-status?surfaceUrl=' + encodeURIComponent(location.href) + '&t=' + Date.now(), true);
                    x.timeout = 800;
                    x.onload = function () {
                        if (found || disposed) return;
                        if (x.status === 200) {
                            try {
                                var c = JSON.parse(x.responseText);
                                if (!disposed && typeof c.enabled === 'boolean') { found = true; BRIDGE_PORT = port; _scanning = false; if (cb) cb(port, c); }
                            } catch { }
                        }
                        if (--pending <= 0 && !found) batch(end + 1);
                    };
                    x.onerror = x.ontimeout = function () { if (--pending <= 0 && !found) batch(end + 1); };
                    x.send();
                })(p);
            }
        };
        batch(BRIDGE_PORT_START);
    };

    var applyConfig = function (c, live) {
        if (disposed || !c || !Policy) return;
        if (live !== true && c.policyVersion !== policy.policyVersion) policyExpiresAt = 0;
        if (c.policyVersion !== policy.policyVersion || c.paused || c.dryRun || !c.enabled) { cancelActions(); scheduler.cancel(); }
        policy = Object.assign({}, c); coordinator.resume(c.resumeToken);
        if (c.intentTombstones !== undefined && !Policy.mergeTombstones(window, c.intentTombstones)) {
            policy.enabled = false; policyExpiresAt = 0; cancelActions(); scheduler.cancel(); return;
        }
        if (c.enabled && !c.paused) scheduler.resume();
        if (live === true) policyExpiresAt = typeof c.policyVersion === 'string' ? Date.now() + 4500 : 0;
        // A legacy bridge without the action-state contract cannot authorize automation.
        if (typeof c.policyVersion !== 'string' || typeof c.paused !== 'boolean' || typeof c.dryRun !== 'boolean') policy.enabled = false;
        if (Array.isArray(c.terminalBlacklist) && !Array.isArray(c.blacklist)) policy.blacklist = c.terminalBlacklist;
        window.__gravEnabled = policy.enabled === true;
        window.__gravScrollEnabled = c.scrollEnabled === true;
        PATTERNS = Policy.resolvePatterns(Object.assign({}, policy, { patterns: c.patterns || PATTERNS }));
        var pauseMs = c.pauseMs ?? c.scrollPauseMs;
        if (Number.isFinite(pauseMs) && pauseMs >= 0) PAUSE_MS = pauseMs;
        var approveMs = Policy.milliseconds(c.approveMs || c.approveIntervalMs, APPROVE_MS);
        var scrollMs = Policy.milliseconds(c.scrollMs || c.scrollIntervalMs, SCROLL_MS);
        if (approveMs !== APPROVE_MS && pollTimer) { clearInterval(pollTimer); timers.delete(pollTimer); pollTimer = setInterval(scanAndClick, approveMs * (c.eventScheduler ? 4 : 1)); }
        if (scrollMs !== SCROLL_MS && scrollTimer) { clearInterval(scrollTimer); timers.delete(scrollTimer); scrollTimer = setInterval(scrollTick, scrollMs); }
        APPROVE_MS = approveMs; SCROLL_MS = scrollMs;
    };

    discoverBridge(function (port, c) { applyConfig(c, true); _pollErrors = 0; });

    var syncTimer = setInterval(function () {
        if (BRIDGE_PORT === 0) { discoverBridge(function (p, c) { applyConfig(c, true); _pollErrors = 0; }); return; }
        if (_pollErrors > 3) { BRIDGE_PORT = 0; _pollErrors = 0; return; }
        try {
            var x = new XMLHttpRequest();
            x.open('GET', 'http://127.0.0.1:' + BRIDGE_PORT + '/grav-status?surfaceUrl=' + encodeURIComponent(location.href) + '&t=' + Date.now(), true);
            x.timeout = 1500;
            x.onload = function () {
                if (disposed) return;
                try {
                    if (x.status !== 200) throw new Error('bridge unavailable');
                    applyConfig(JSON.parse(x.responseText), true); _pollErrors = 0;
                } catch { _pollErrors++; policy.enabled = false; policyExpiresAt = 0; }
            };
            x.onerror = x.ontimeout = function () { _pollErrors++; policy.enabled = false; };
            x.send();
        } catch { _pollErrors++; policy.enabled = false; }
    }, 3000);
    window.__gravTimers.push(syncTimer);

    // Button auto-click — constants injected from shared config
    var REJECT_WORDS = /*{{REJECT_WORDS}}*/['Reject', 'Deny', 'Cancel', 'Dismiss', "Don't Allow", 'Decline', 'Reject all', 'Reject All', 'No', 'Disallow', 'Stop', 'Abort', 'Skip'];
    var EDITOR_SKIP = /*{{EDITOR_SKIP}}*/['Accept Changes', 'Accept Incoming', 'Accept Current', 'Accept Both', 'Accept Combination', 'Accept Line', 'Accept Word', 'Accept Suggestion'];
    var HIGH_CONF = /*{{HIGH_CONF}}*/{'Accept All': 1, 'Accept all': 1, 'Accept': 1, 'Approve': 1, 'Resume': 1, 'Run': 1, 'Retry': 1, 'Proceed': 1};
    var _LIM = /*{{LIMITS}}*/{BUTTON_LABEL_MIN: 2, BUTTON_LABEL_MAX: 60};
    var _globalCooldown = 0;
    var _runCooldown = 0;

    // Cooldown durations (ms) — injected from shared config
    var COOLDOWN = /*{{COOLDOWN}}*/{'Run': 5000, 'Accept': 1500, DEFAULT: 1000, GLOBAL: 500};

    var isAlreadyClicked = function(btn, text) {
        if (Date.now() < _globalCooldown) return true;
        var intent = Policy.actionIdentity(coordinator, btn, text, policy);
        return btn.getAttribute('data-grav-clicked') === 'true' || btn.getAttribute('data-grav-clicked') === intent.key;
    };

    var markClicked = function(btn, text) {
        var intent = Policy.actionIdentity(coordinator, btn, text, policy);
        try { btn.setAttribute('data-grav-clicked', intent.key); } catch {}
        _globalCooldown = Date.now() + (text === 'Expand' ? 200 : COOLDOWN.GLOBAL);
    };

    var isRunCooldown = function() { return Date.now() < _runCooldown; };

    var matchPattern = function (text, pattern) {
        if (text === pattern) return true;
        if (text.length <= pattern.length) return false;
        if (text.indexOf(pattern) !== 0) return false;
        var c = text.charAt(pattern.length);
        return /[\s\u00a0.,;:!?\-\u2013\u2014()[\]{}|/\\<>'"@#$%^&*+=~`]/.test(c);
    };

    var findMatch = function (text) {
        var best = '', len = 0;
        for (var i = 0; i < PATTERNS.length; i++) { if (PATTERNS[i].length > len && matchPattern(text, PATTERNS[i])) { best = PATTERNS[i]; len = best.length; } }
        return best;
    };

    var labelOf = function (btn) {
        // Strategy 1: aria-label (most explicit for accessibility)
        var aria = (btn.getAttribute('aria-label') || '').trim();
        if (aria.length >= 2 && aria.length <= 60) return aria;
        
        // Strategy 2: data-tooltip or data-title (common in VS Code)
        var dataTip = (btn.getAttribute('data-tooltip') || btn.getAttribute('data-title') || '').trim();
        if (dataTip.length >= 2 && dataTip.length <= 60) return dataTip;
        
        // Strategy 3: Direct text nodes (most accurate for simple buttons)
        var direct = '';
        for (var i = 0; i < btn.childNodes.length; i++) { 
            if (btn.childNodes[i].nodeType === 3) direct += btn.childNodes[i].nodeValue || ''; 
        }
        direct = direct.trim();
        if (direct.length >= 2 && direct.length <= 60) return direct;
        
        // Strategy 4: innerText first line (most common)
        var raw = (btn.innerText || btn.textContent || '').trim();
        var first = raw.split('\n')[0].trim();
        if (first.length >= 2 && first.length <= 60) return first;
        
        // Strategy 5: title attribute
        var title = (btn.getAttribute('title') || '').trim();
        if (title.length >= 2 && title.length <= 60) return title;
        
        // Strategy 6: value attribute (for input buttons)
        var value = (btn.getAttribute('value') || '').trim();
        if (value.length >= 2 && value.length <= 60) return value;
        
        // Strategy 7: Nested spans/divs/labels (React/Vue common pattern)
        var spans = btn.querySelectorAll('span, div, label, p, b, strong, em');
        var st = '';
        for (var j = 0; j < spans.length; j++) {
            var t = '';
            for (var k = 0; k < spans[j].childNodes.length; k++) { 
                if (spans[j].childNodes[k].nodeType === 3) t += spans[j].childNodes[k].nodeValue || ''; 
            }
            t = t.trim();
            if (t) st += (st ? ' ' : '') + t;
        }
        if (st.length >= 2 && st.length <= 60) return st;
        
        // Strategy 8: alt attribute (for image buttons)
        var alt = (btn.getAttribute('alt') || '').trim();
        if (alt.length >= 2 && alt.length <= 60) return alt;
        
        return '';
    };

    var inEditorContext = function (btn) {
        if (!btn.closest) return false;
        
        // Check page title first
        try {
            var pageTitle = (document.title || '').toLowerCase();
            if (pageTitle.indexOf('grav') !== -1 && pageTitle.indexOf('dashboard') !== -1) return true;
        } catch {}
        
        // List of selectors that indicate non-agent contexts
        var EDITOR_SELECTORS = [
            // Monaco Editor (code editor, diff, merge)
            '.monaco-editor', '.monaco-diff-editor', '.merge-editor-view',
            '.editor-actions', '.title-actions', '.monaco-toolbar', '.monaco-editor-overlaymessage',
            // Settings panels (all variants)
            '.settings-editor', '.settings-body', '.settings-tree-container',
            '[class*="settings-editor"]', '[class*="settings"]', '[class*="preference"]',
            '[id*="settings"]', '.settings-widget',
            // Browser panels
            '.simple-browser', '[class*="simple-browser"]', '[class*="browser-preview"]', '[class*="webview-browser"]',
            // Extensions
            '.extensions-editor', '.extension-editor', '[class*="extension-editor"]', 
            '[class*="extensions-list"]', '[class*="marketplace"]', '.extension-details',
            // Keybindings
            '[class*="keybinding"]', '.keybindings-editor',
            // Context menus and quick input
            '.context-view', '.monaco-menu', '.quick-input-widget', '.quick-input-list',
            // Auth/Accounts
            '[class*="accounts"]', '[class*="authentication"]', '.account-picker',
            // Welcome/Getting started
            '[class*="welcome"]', '[class*="walkthrough"]', '[class*="getting-started"]',
            // Output (specific — NOT [class*="output"] which blocks agent tool-output)
            '.output-view-container', '[id*="output"]',
            // Debug
            '[class*="debug-view"]', '[class*="debug-pane"]', '.debug-toolbar',
            // Notebooks
            '[class*="notebook"]', '.notebook-cell',
            // Problems panel
            '[class*="problems-panel"]', '[class*="markers-panel"]',
            // Search panel
            '[class*="search-view"]', '[class*="search-widget"]',
            // Source Control panel
            '.scm-view', '[class*="scm-view"]', '[class*="source-control"]'
        ];
        
        for (var i = 0; i < EDITOR_SELECTORS.length; i++) {
            if (btn.closest(EDITOR_SELECTORS[i])) return true;
        }
        return false;
    };

    var hasRejectNearby = function (btn) {
        var p = btn.parentElement;
        for (var lv = 0; lv < 4 && p; lv++) {
            var sibs = p.querySelectorAll('button, [role="button"], vscode-button');
            for (var i = 0; i < sibs.length; i++) {
                if (sibs[i] === btn) continue;
                var t = labelOf(sibs[i]);
                for (var j = 0; j < REJECT_WORDS.length; j++) { if (matchPattern(t, REJECT_WORDS[j])) return true; }
            }
            p = p.parentElement;
        }
        return false;
    };


    var isVisible = function(el) {
        if (!el) return false;
        if (el.disabled) return false;
        if (el.offsetWidth === 0 && el.offsetHeight === 0 && !el.closest('[class*="overlay"], [class*="popup"], [class*="dialog"], [class*="notification"]')) return false;
        try {
            var cs = getComputedStyle(el);
            if (cs.visibility === 'hidden' || cs.display === 'none' || cs.opacity === '0' || cs.pointerEvents === 'none') return false;
            // Check if element is in viewport or near it
            var rect = el.getBoundingClientRect();
            if (rect.width === 0 || rect.height === 0) return false;
            // Element should be within reasonable viewport bounds (allow some overflow)
            if (rect.right < -100 || rect.left > window.innerWidth + 100 || rect.bottom < -100 || rect.top > window.innerHeight + 100) return false;
        } catch { return false; }
        return true;
    };

    var scanOffset = 0;
    var scanAndClick = function () {
        if (disposed || Date.now() >= policyExpiresAt || !Policy || !window.__gravEnabled || policy.paused || policy.active === false) return;
        // Expanded selectors to catch more button types
        var btns = document.querySelectorAll('button, vscode-button, a.action-label, [role="button"], [role="menuitem"], input[type="button"], input[type="submit"], .monaco-button, .button, [class*="button"], [class*="btn"], [class*="action-label"], [class*="cursor-pointer"], [class*="clickable"]');
        for (var i = 0; i < Math.min(btns.length, 64); i++) {
            var b = btns[(i + scanOffset) % btns.length];
            if (!isVisible(b)) continue;
            if (inEditorContext(b)) continue;
            var text = labelOf(b);
            if (!text || text.length < 2 || text.length > 60) continue;
            if (isAlreadyClicked(b, text)) continue;
            
            // Check editor skip patterns
            var skipThis = false;
            for (var s = 0; s < EDITOR_SKIP.length; s++) { 
                if (matchPattern(text, EDITOR_SKIP[s])) { skipThis = true; break; } 
            }
            if (skipThis) continue;
            
            var matched = Policy.interactionPattern(b, policy) || findMatch(text);
            if (!matched) continue;
            
            // Run cooldown check
            if ((matched === 'Run' || matched.indexOf('Run ') === 0) && isRunCooldown()) continue;
            
            // Validation: high confidence or has reject sibling
            var isHighConf = !!HIGH_CONF[matched];
            if (!isHighConf && !hasRejectNearby(b)) {
                // Additional check: is this a standalone approval button in agent context?
                // Look for common agent panel indicators
                var inAgentPanel = false;
                try {
                    var el = b;
                    for (var up = 0; up < 5 && el; up++) {
                        var cls = (el.className || '').toLowerCase();
                        if (cls.indexOf('agent') !== -1 || cls.indexOf('chat') !== -1 || cls.indexOf('cascade') !== -1 ||
                            cls.indexOf('cortex') !== -1 || cls.indexOf('antigravity') !== -1) {
                            inAgentPanel = true; break;
                        }
                        el = el.parentElement;
                    }
                } catch {}
                if (!inAgentPanel) continue;
            }
            
            var evaluation = Policy.evaluateAction(matched, Policy.readsCommand(matched) ? Policy.extractCommand(b) : '', Policy.actionContext(b, policy));
            if (!evaluation.allowed) { console.log('[GRAV:BLOCKED] ' + JSON.stringify(evaluation)); continue; }
            if (policy.dryRun) { console.log('[GRAV:DRYRUN] ' + JSON.stringify(Object.assign({ p: matched, b: text, outcome: 'unknown' }, evaluation))); continue; }
            if (!canAct()) continue;
            var intent = Policy.actionIdentity(coordinator, b, text, policy);
            var claim = coordinator.claim(intent, policy.policyVersion);
            if (!claim.ok) continue;
            _globalCooldown = Date.now() + APPROVE_MS + (text === 'Expand' ? 200 : COOLDOWN.GLOBAL);
            // Capture identity and recheck current policy and command at the action endpoint.
            (function(button, label, pattern, entry) {
                var actionTimer = setTimeout(function() {
                    pendingActions.delete(actionTimer);
                    if (!canAct() || !isVisible(button) || button.isConnected === false || labelOf(button) !== label || !(findMatch(label) || Policy.interactionPattern(button, policy))) return;
                    var cmd = Policy.readsCommand(pattern) ? Policy.extractCommand(button) : '';
                    var ctx = Policy.actionContext(button, policy);
                    var decision = Policy.evaluateAction(pattern, cmd, ctx);
                    if (!decision.allowed || inEditorContext(button) || !coordinator.valid(entry, Policy.actionIdentity(coordinator, button, label, policy), policy.policyVersion)) return;
                    // Scope selection is UI state, not actuation. It runs pre-claim
                    // in the CDP executor; reaching it here means the decision was
                    // re-evaluated — treat as a no-op rather than claiming twice.
                    if (decision.switchScope) {
                        if (!Policy.interaction.selectScope(ctx.interaction, decision.switchScope)) { entry.outcome = 'unknown'; coordinator.postcondition(entry, button); return; }
                        entry.outcome = 'cancelled';
                        return;
                    }
                    if (decision.optionIds) {
                        coordinator.attempted(entry);
                        if (!Policy.interaction.selectOptions(ctx.interaction, decision.optionIds)) { entry.outcome = 'unknown'; coordinator.postcondition(entry, button); return; }
                        entry.outcome = 'unknown'; entry.postcondition = 'approval-ui-changed';
                        if (decision.autoSubmit !== true) setTimeout(function() { Policy.interaction.submit(ctx.interaction); }, 300);
                        return;
                    }
                    coordinator.attempted(entry); markClicked(button, label);
                    try { button.click(); } catch { coordinator.postcondition(entry, button); return; }
                    setTimeout(function() { coordinator.postcondition(entry, button); }, 1000);
                    if (pattern === 'Expand') setTimeout(scanAndClick, APPROVE_MS);
                    if (BRIDGE_PORT > 0) {
                        try {
                            var x = new XMLHttpRequest();
                            x.open('POST', 'http://127.0.0.1:' + BRIDGE_PORT + '/api/click-log', true);
                            x.setRequestHeader('Content-Type', 'application/json'); x.timeout = 1000;
                            x.send(JSON.stringify(Object.assign({ button: label, pattern: pattern, source: 'runtime', surfaceUrl: location.href, cmd: cmd, intentId: entry.key, identityEvidence: entry.evidence, adapterVersion: 'adapter-v1', latencyMs: Date.now() - entry.at, outcome: 'attempted' }, decision)));
                        } catch { }
                    }
                }, APPROVE_MS);
                pendingActions.add(actionTimer);
            })(b, text, matched, claim.entry);

        }
        scanOffset += 64;
        if (policy.eventScheduler && scanOffset < btns.length) scheduler.trigger(); else scanOffset = 0;
    };

    // MutationObserver with smart throttling
    var _flushTimer = null;
    
    try {
        var observer = new MutationObserver(function (mutations) {
            // Only process if mutations actually added nodes or changed relevant attributes
            var hasRelevantChange = false;
            for (var m = 0; m < mutations.length; m++) {
                var mut = mutations[m];
                if (mut.type === 'childList' && (mut.addedNodes.length > 0 || mut.removedNodes.length > 0)) {
                    // Check if added nodes contain buttons or containers
                    for (var n = 0; n < mut.addedNodes.length; n++) {
                        var node = mut.addedNodes[n];
                        if (node.nodeType === 1) { // Element node
                            if (node.tagName === 'BUTTON' || node.tagName === 'A' || node.tagName === 'DIV' || 
                                node.tagName === 'SPAN' || node.tagName === 'VSCODE-BUTTON' ||
                                node.querySelector && node.querySelector('button, [role="button"], vscode-button')) {
                                hasRelevantChange = true;
                                break;
                            }
                        }
                    }
                } else if (mut.type === 'attributes') {
                    // Only care about class, disabled, style, aria-hidden
                    var attr = mut.attributeName || '';
                    if (attr === 'class' || attr === 'disabled' || attr === 'style' || attr === 'aria-hidden') {
                        hasRelevantChange = true;
                    }
                }
                if (hasRelevantChange) break;
            }
            
            if (disposed || !hasRelevantChange) return;
            
            if (policy.eventScheduler) { scheduler.trigger(); return; }
            // Throttle scanAndClick calls
            if (!_flushTimer) { 
                scanAndClick(); 
                _flushTimer = setTimeout(function () { _flushTimer = null; }, APPROVE_MS);
            }
        });
        observers.push(observer);
        observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'disabled', 'aria-hidden', 'style', 'hidden'] });
        window.__gravApproveObserver = observer;
    } catch {} 

    // Initial scan with delay
    setTimeout(scanAndClick, 1000);
    // Scan cadence follows the configured approval interval.
    var pollTimer = setInterval(scanAndClick, APPROVE_MS * (policy.eventScheduler ? 4 : 1));
    window.__gravTimers.push(pollTimer);

    // Stick-to-bottom scroll
    var CHAT_SELECTORS = ['.antigravity-agent-side-panel', '.react-app-container', '[class*=agent-panel]', '[class*=chat-panel]', '.chat-widget', '.interactive-session'];
    var _chatPanel = null, _chatTick = 0;
    var _wasBottom = new WeakMap();
    var _justScrolled = new WeakSet();
    var _autoScrolling = false;

    var findChatPanel = function () {
        if (_chatPanel && _chatPanel.isConnected && ++_chatTick < 30) return _chatPanel;
        _chatTick = 0;
        for (var i = 0; i < CHAT_SELECTORS.length; i++) { var el = document.querySelector(CHAT_SELECTORS[i]); if (el) { _chatPanel = el; return el; } }
        _chatPanel = null;
        return null;
    };

    var lastUserScroll = 0;
    var scrollTick = function () {
        if (!canAct() || !window.__gravScrollEnabled || Date.now() - lastUserScroll < PAUSE_MS) return;
        var panel = findChatPanel();
        if (!panel) return;
        var best = null, bestH = 0;
        var els = panel.querySelectorAll('*');
        for (var i = 0; i < els.length; i++) {
            var el = els[i];
            if (el.scrollHeight <= el.clientHeight + 30) continue;
            if (el.tagName === 'CODE' || el.tagName === 'PRE' || el.tagName === 'TEXTAREA') continue;
            var cls = (el.className || '').toString().toLowerCase();
            if (/code|terminal|xterm|editor|monaco|diff/.test(cls)) continue;
            var s = window.getComputedStyle(el);
            if (s.overflowY !== 'auto' && s.overflowY !== 'scroll') continue;
            if (el.clientHeight > bestH) { bestH = el.clientHeight; best = el; }
        }
        if (!best) return;
        _autoScrolling = true;
        var gap = best.scrollHeight - best.scrollTop - best.clientHeight;
        var was = _wasBottom.get(best);
        if (was === undefined) { was = gap <= 150; _wasBottom.set(best, was); }
        if (was && gap > 5) { _justScrolled.add(best); best.scrollTop = best.scrollHeight; }
        setTimeout(function () { _autoScrolling = false; }, 200);
    };
    var scrollTimer = setInterval(scrollTick, SCROLL_MS);
    window.__gravTimers.push(scrollTimer);

    window.__gravScrollHandler = scrollHandler = function (e) {
        var el = e.target;
        if (!el || el.nodeType !== 1) return;
        if (_justScrolled.has(el)) { _justScrolled.delete(el); return; }
        if (_autoScrolling) return;
        lastUserScroll = Date.now();
        _wasBottom.set(el, (el.scrollHeight - el.scrollTop - el.clientHeight) <= 150);
    };
    window.addEventListener('scroll', window.__gravScrollHandler, true);

    if (initialPolicy) applyConfig(initialPolicy);
    window.__gravLoaded = true;
    console.log('[Antigravity Auto Submit] Runtime v3.0 loaded | Patterns:', PATTERNS.length);
})();