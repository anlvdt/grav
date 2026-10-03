# Antigravity Auto Accept — Grav (Auto Approve / Auto Run)

**Configure once to keep supported agent workflows moving in Antigravity IDE.** Grav provides auto accept for supported edit actions and auto approve / auto run for supported terminal prompts under your configured rules. It also keeps chat scrolled to the latest response and offers dry run and diagnostics.

The goal is to configure permissions and preferences once, then let jobs continue unattended. Current coverage depends on the host UI, verified executor and selected policy; broader permission, question and recovery automation is still under development and has not been validated end to end on the live IDE.

[![Version](https://img.shields.io/badge/version-4.0.19-blue)](https://marketplace.visualstudio.com/items?itemName=ANLE.grav) [![License: MIT](https://img.shields.io/badge/License-MIT-green)](LICENSE) [![VS Marketplace](https://img.shields.io/visual-studio-marketplace/v/ANLE.grav?label=Marketplace)](https://marketplace.visualstudio.com/items?itemName=ANLE.grav)

---

## Why Grav?

Antigravity runs its agent panel inside an Out-of-Process IFrame (OOPIF). Grav uses **Chrome DevTools Protocol (CDP)** and an injected observer to find supported approval controls across webview and Shadow DOM boundaries. Terminal rules decide whether Grav may attempt an approval; matching a button label alone does not grant permission.

> **Primary target:** Antigravity IDE. VS Code Native Chat (Copilot Edits) has explicit guarded edit-accept commands; automatic native acceptance stays manual without verified request identity. Compatibility with other IDEs is not established by this documentation.

---

## Features

### 🤖 Auto-Click Agent Buttons
Recognizes configured labels such as `Accept`, `Accept All`, `Run`, `Run Task`, `Execute`, `Approve`, `Retry`, `Proceed` and `Allow`. Auto-click attempts require a supported action, an active executor and an allowing policy. Permission scope menus and generic Submit forms are not covered merely because their labels match; see runtime limits below.

### 🛡️ Safety Guard (Terminal Protection)
Evaluates extracted commands from supported terminal prompts **before** attempting `Run` or `Execute`. Missing command context stays manual. Declines auto-approval for destructive patterns (host execution permissions are unchanged), including:
- `rm -rf /`, `rm -rf *`, `rm -rf ~`
- `dd if=/dev/zero`, `kill -9 -1`, fork bombs (`:(){:|:&};:`)
- `DROP DATABASE`, `TRUNCATE TABLE`
- `git push --force`, `git push -f`, `git clean -fdx`, `git reset --hard`
- `curl <url> | bash`, `wget <url> | sh`, `curl <url> | zsh` — pipe-to-shell detection
- `docker system prune -a --volumes`
- Windows: `reg delete hk`, `vssadmin delete shadows`, PowerShell execution bypass
- `su -`, `su root` (interactive shell deadlock)

Custom patterns via `grav.terminalBlacklist` support plain substrings and `/regex/` syntax.

### Terminal decisions and runtime state
Test command, learning, the CDP observer and injected runtime use the same versioned evaluator. It returns allow, manual or deny with a reason, matched rules, scope and policy version. Only allow permits an auto-approval attempt. Deny means Grav declines auto-approval; it does not prohibit execution in the host.

Antigravity IDE 2.5.5 reuses Submit for permission cards, agent questions and MCP forms. The typed autopilot adapter distinguishes supported command, file-read, file-write, URL-read, URL-action and MCP permission cards by their operation, exact target and selected permission scope. Configure matching grants once using Set up Autopilot. Generic questions, MCP forms, unrecognized cards and terminal-input prompts remain outside current executor coverage. Accept with an extracted command is evaluated as a command, including blacklist checks. Label matching and a Ready executor do not establish coverage of every host approval popup; see the approval research report in the repository.

Existing whitelist data is preserved. A single executable such as `git` is a legacy broad grant for all supported literal arguments. Built-in executable grants have the same broad scope and do not prove a command safe. A multi-token entry such as `git status` matches a literal argv prefix with token boundaries; it does not match `git status-other`. Blacklists take priority over every grant.

Ordinary quoting is supported for a single literal command. Missing context, unknown commands, wrappers and shell expansion, substitution, redirection or compound syntax require manual review unless a blacklist already denies the command. This release does not include a general shell parser.

The dashboard and status bar use the same runtime snapshot: off, paused, dry-run, disconnected, ready or unknown, in that priority order. Ready requires a verified executor and the current policy lease. Opening the dashboard pauses auto-approval. Unsaved settings are distinct from applied runtime policy. Trace outcomes are attempted or unknown; clicking an approval is not proof of command completion. Feedback references the selected trace ID and reports an error if that ID is unavailable. ROI figures are estimates based on assumed time per click attempt.

### Intent reliability, permissions and pilot metrics

CDP and injected runtimes share a bounded document ledger. Host-provided request/tool-call/prompt attributes identify intents when available. On the verified permission build, a bounded read-only lookup of matching React props can identify the actual cascade, trajectory and step; equal content in a new verified step is a distinct request. Otherwise a local fingerprint conservatively prevents an identical anonymous prompt from being auto-approved again. A new request ID permits a new prompt with the same text. Owner generations fence stale controllers, pending callbacks revalidate payload and policy, and expiry never grants retry permission. A disabled/disappeared approval button is UI evidence only, not proof that a command finished. Unknown attempts survive reinjection in the same document; full document replacement cannot guarantee exactly-once behavior.

Mutation events coalesce into a leading scheduled scan with a polling watchdog. Each scan handles up to 64 candidates. CDP target tasks have bounded concurrency and independent failure handling, and reconnect delays include jitter. Three unconfirmed approval UI postconditions stop that document with `no-progress`; Resume clears that breaker without deleting attempted intents. The ledger holds at most 256 entries, with payload retention up to 30 minutes. Unknown tombstones remain until the document ends. At the retention budget, manual approval or a new document is required. These conservative limits are pilot defaults, not calibrated production recommendations.

Use the Rules tab or command palette:
- Grav: Select Permission Profile chooses Observe, Edits, Terminal or Legacy. Observe never auto-approves. Edits allows command-free edit/UI actions. Terminal uses only scoped exact/prefix rules, with legacy grants inactive; browser/MCP approval requires manual review. Legacy preserves existing label/grant behavior.
- Grav: Set Scan Speed changes scan cadence independently of grants and profile. Existing Safe/Balanced/Fast operation presets remain legacy combined presets; they can change button labels and browser skipping and should not be confused with the speed-only control.
- Manage Terminal → Scoped Rules supports exact argv or prefix, allow/deny, session/project/user scope and expiry. The preview shows both rule-only and effective decisions, including nearby examples and any broad grants active in Legacy. Session rules are memory-only until extension restart; project rules bind to the recorded workspace. Revoke and bounded history are available. Grav does not directly write host permission rules. Approving a configured standing scope through the host UI can save a host permission; revoke saved standing permissions in the host’s settings.

Diagnostics exposes a capability manifest, learning examples/provenance and metrics with labeled opportunity denominators. Host/build identity is reported only when readable; a matching adapter ACK is required, and adapter version mismatch disables readiness. Native automatic edit commands are now manual because no verified request identity/receipt is available. Explicit Grav: Accept All remains restricted to the known edit allowlist.

Learning distinguishes execution observations/results from explicit human approval/rejection labels. Automation does not create either human label. Examples redact common credential patterns, and suggestion scores never grant authorization. Diagnostics redaction is heuristic: review exports before sharing.

Pilot sequence: start with Observe, label opportunities, then use a narrow exact session rule with expiry under Terminal. Review false approvals, duplicate attempts, unknown outcomes and user interventions before widening scope. Clicks are attempts, and unlabelled opportunities cannot establish an error rate. `npm run pilot:replay` writes a deterministic synthetic comparison to `artifacts/p1-p2-replay.json`; its policy/adapter/fixture versions accompany the metrics. A zero-error fixture result is not zero risk or a live host validation.

### Configured autopilot permission cards (development)

**Set up Autopilot** in the Rules tab, or **Grav: Configure Autopilot Profile (One-Time Setup)** in the command palette, offers Enable/Disable, Add grant, Remove grant and Save. Cancel discards unsaved changes; JSON authoring is unnecessary. This configures `grav.autopilotProfile`, separate from the existing permission profile. It starts disabled with no grants. Each grant names an exact operation target, allow/deny effect and permission scope (once, conversation, project, workspace or global); an optional workspace restriction binds it to that workspace. Wildcard targets are not supported. Observe remains non-actuating. Use once for the host’s default selected option; Grav currently verifies the selected scope and does not switch radio options. Nondefault scopes apply only when already selected. Standing grants cannot be installed where they could suppress a future local deny.

The adapter is gated to the installed macOS Antigravity IDE 2.5.5 build (`ecfbad74d93962fc8ca485d93ab9b4f3d4cb6cf8`) and permission-card controls: an exact Allow heading, editable permission target, native scope radio and Continue control. This source mapping is narrower evidence than a live unattended workflow test. End-to-end behavior remains unverified; it does not establish coverage of generic questions, MCP forms, every popup or background conversation. Question, form, plan and background-conversation adapters are remaining automation work; they are not covered by a generic Submit match.

### Automatic recovery and job evidence

Grav automatically reconnects CDP, repairs a missing renderer observer and restarts a failed bridge listener, with bounded rapid repairs followed by a cooldown. Stale connections and callbacks cannot replace the current controller. Known approval attempts are retained in a bounded extension-host journal to prevent replay after a renderer remount when the same surface identity is available. An unobserved attempt or extension-host restart still has an unknown outcome; automatic repair does not justify repeating it.

Diagnostics separates executor recovery from job progress. The job tracker includes failed and unfinished jobs in its denominator and distinguishes setup from later intervention. It requires explicit host lifecycle evidence for starts and completion; the current adapters do not yet supply that evidence, so an unattended completion rate is unavailable rather than inferred from clicks.

### 🌐 Skip Browser SubAgent
When the AI agent attempts to use a browser automation tool (`browser_subagent`, `computer_use`, `use_browser`), Grav detects it and clicks **Skip** instead of **Run** — preventing unintended browser sessions. Toggle via status bar or `Grav: Toggle Skip Browser SubAgent`.

### 📜 Auto-Scroll
Keeps the chat panel pinned to the bottom while AI responds. Automatically pauses when you scroll up and resumes when you scroll back down.

### 🧠 Adaptive Learning
Observes explicit command approvals and rejections to suggest candidates with a suggestion score. This score is not a probability of safety. Learning never creates authorization. Use Manage Terminal to review and explicitly edit grants; the former Add/Blacklist learning prompt actions now route to policy management.

### 🛠️ Auto-Fixer
If a terminal command fails with a numeric exit code, Grav suggests a correction in the extension log. The extension does not automatically execute suggestions.
- `gti status` → suggests `git status`
- `npm instal` → suggests `npm install`
- `python script.py` (missing alias on macOS) → suggests `python3 script.py`
- Parses Git suggestions: `"The most similar command is..."`

### 💬 VS Code Native Chat & Copilot Edits
Supports explicit native **Copilot Edits** edit-accept commands through Grav: Accept All; the automatic native fallback stays manual because verified request identity is unavailable. Supported terminal approvals use the Antigravity CDP policy evaluator; native tool approvals remain manual. Discovers native edit commands including `workbench.action.chat.applyAll`, `github.copilot.acceptWorkspaceEdit`, and inline chat accept buttons.

### 🗂️ Per-Project Patterns
Define custom button patterns and blacklists per workspace via `.vscode/grav.json`. Changes reload live without restarting the extension. In multi-root workspaces only the first folder supplies `.vscode/grav.json`; project patterns augment the selected preset, blacklists augment global rules, and project `dryRun: true` forces observation only.

```json
{
  "patterns": ["Deploy", "Apply", "Confirm Deploy"],
  "blacklist": ["Drop DB"],
  "dryRun": false
}
```

### ⚡ Adaptive Accept Loop
Detects when the AI agent fires a `run_command` tool call and **instantly drops its scan interval to 800ms for 10 seconds** — then returns to normal. This reduces the delay before checking a newly appearing approval; short-lived or unsupported dialogs can still be missed.

### 🧩 Smart Terminal Kill Guard
When a notification containing blocking keywords appears, Grav **inspects the actual DOM** before sending any kill signal. Only fires if the element contains a visible `<input>` or `<textarea>`. Approval toasts without a visible input do not qualify for that input-based kill path.

### 🔍 Dry Run Mode
Scan and match buttons without clicking. See exactly what Grav would click before enabling auto-approval on a new project.

### 📊 Real-Time Dashboard (`Cmd+Shift+D`)
- Toggle Auto-Click, Auto-Scroll, Dry Run, Skip Browser SubAgent
- Enable/disable individual button patterns
- Live activity log, learning engine stats, CDP connection status
- ROI tracker, idle detection

---

## Installation

### From the Antigravity Extensions View

1. Open **Antigravity IDE** and the Extensions view (`Cmd+Shift+X` on macOS or `Ctrl+Shift+X` on Windows/Linux).
2. Search **Antigravity Auto Accept** or **Grav** and check publisher **ANLE**, extension ID **ANLE.grav**. The new display name appears after a future release; this checkout has not been published. Use the VSIX route if your IDE's registry does not list it.
3. Install. With Grav and CDP enabled, Grav attempts to configure the current IDE's `argv.json` with the debug port (default `9333`); a host it cannot identify safely is left unchanged.
4. Fully quit the IDE (`Cmd+Q` on macOS), then reopen so the debug port takes effect.
5. Run **Grav: Select Permission Profile** and choose the scope you want. Use Observe or Dry Run to inspect detection, or Terminal with explicit scoped rules for supported auto run prompts. Review any existing Legacy grants before using them.
6. Check **Grav: Diagnostics** for executor and policy state. Close the dashboard to resume auto accept; opening it pauses approval. Ready indicates executor readiness, not completion of your agent's job.

### From VSIX (Manual)

1. `Cmd+Shift+P` (macOS) or `Ctrl+Shift+P` → **Extensions: Install from VSIX** → select `grav-4.0.19.vsix`.
2. Fully quit and reopen the IDE, then select a permission profile and verify state as above.

> **Status bar shows disconnected?** Fully quit and reopen to apply the debug port. If it remains disconnected, use the troubleshooting steps below.

---

## Configuration

| Setting | Default | Description |
|---|---|---|
| `grav.enabled` | `true` | Master on/off switch |
| `grav.autoScroll` | `true` | Keep chat pinned to bottom |
| `grav.dryRun` | `false` | Scan without clicking |
| `grav.skipBrowserAgent` | `false` | Click Skip instead of Run on browser_subagent steps |
| `grav.approvePatterns` | `[Accept, Run, ...]` | Button labels to auto-click |
| `grav.presetMode` | `1.24+` | Button preset: `1.19.6`, `1.23.2`, `1.24+`, `custom` |
| `grav.approveIntervalMs` | `1000` | Approval scan interval (ms, minimum 100) |
| `grav.scrollPauseMs` | `15000` | Pause after manual scroll-up (ms) |
| `grav.learnEnabled` | `true` | Adaptive learning engine |
| `grav.learnThreshold` | `3` | Minimum explicit approvals for a candidate; sufficient suggestion score is also required. Learning never authorizes commands. |
| `grav.language` | `en` | Deprecated: the dashboard supports English only; this setting has no effect. |
| `grav.permissionProfile` | `legacy` | Observe, Edits, Terminal or Legacy; independent of scan speed |
| `grav.permissionRules` | `[]` | Explicit scoped exact/prefix rules with expiry |
| `grav.autopilotProfile` | `{ "enabled": false, "grants": [] }` | Development: exact typed permission targets/scopes; separate from permissionProfile and pending live validation |
| `grav.terminalWhitelist` | `[]` | Explicit grants: legacy executable or literal argv-prefix; blacklist wins |
| `grav.terminalBlacklist` | `[]` | Decline Grav auto-approval (supports `/regex/`); host permissions unchanged |
| `grav.cdpEnabled` | `true` | CDP engine (required for OOPIF access) |
| `grav.cdpPort` | `9333` | CDP debug port |

---

## Commands

| Command | Shortcut | Description |
|---|---|---|
| `Grav: Select Permission Profile` | — | Select permission scopes independently of speed |
| `Grav: Configure Autopilot Profile (One-Time Setup)` | — | Configure exact typed grants for supported permission cards (development) |
| `Grav: Set Scan Speed` | — | Change cadence only |
| `Grav: Dashboard` | `Cmd+Shift+D` | Open monitoring dashboard |
| `Grav: Diagnostics` | — | CDP sessions, button detection state, conflict report |
| `Grav: Pause Auto-Accept` | — | Temporarily pause clicking |
| `Grav: Resume Auto-Accept` | — | Resume clicking |
| `Grav: Accept All` | — | Force-click all accept commands once |
| `Grav: Toggle Dry Run` | — | Toggle dry run mode |
| `Grav: Toggle Auto-Scroll` | — | Toggle auto-scroll |
| `Grav: Toggle Skip Browser SubAgent` | — | Toggle browser agent bypass |
| `Grav: Refresh Observer` | — | Force re-inject observer into all sessions |
| `Grav: Force Reconnect CDP` | — | Manually reconnect CDP |
| `Grav: Init Project Config` | — | Create `.vscode/grav.json` template |
| `Grav: Remove Injected Runtime` | — | Remove the injected runtime from the current IDE installation |
| `Grav: Purge Bad Learning Data` | — | Clean up incorrectly learned entries |
| `Grav: Learning Stats` | — | View candidate suggestion scores |
| `Grav: Manage Terminal Commands` | — | Interactively manage whitelist/blacklist |
| `Grav: Stop All Terminals` | `Cmd+Shift+Q` | Send Ctrl+C to agent terminals |

---

## Status Bar

| Display | Meaning |
|---|---|
| `🚀 Grav` | Ready: verified executor with a current policy lease |
| `⏸ Grav` | Paused: manual pause, typing, or visible dashboard |
| `🚫 Grav` | Off |
| `$(eye) Grav` | Dry-run: scan only |
| `$(debug-disconnect) Grav` | Executor disconnected |
| `$(question) Grav` | Unknown: target or policy lease unverified |
| `$(plug) N $(fold-down)` | CDP connected, N sessions, auto-scroll ON |
| `$(debug-disconnect)` | CDP disconnected |
| `$(exclude) SKIP` | Skip Browser SubAgent ON |
| `$(eye) DRY` | Dry Run mode ON |

---

## Troubleshooting

**CDP off / disconnected:** Fully quit the IDE (`Cmd+Q`), not just close the window. Reopen. If still failing: `Grav: Force Reconnect CDP`.

**Buttons not being clicked:** Check Dry Run in Dashboard. Open Activity log. Run `Grav: Diagnostics`. Verify label case matches exactly.

**Learning store has garbage:** Run `Grav: Purge Bad Learning Data` (also runs automatically on startup).

**Terminal being killed unexpectedly:** The Smart Terminal Kill Guard checks for DOM input presence before firing. If still happening, check `grav.terminalBlacklist` for conflicting entries via `Grav: Diagnostics`.

---

## Requirements

- Antigravity IDE with CDP debug port support; a compatible host UI and verified executor are required for automatic approval.
- Configure a permission profile and terminal rules for your workflow. The `ws` WebSocket module is bundled in the VSIX; no separate dependency installation is needed.

---

## Changelog

### Unreleased
- Discovery metadata now leads with Antigravity Auto Accept, with Auto Approve / Auto Run as related intent. Extension ID `ANLE.grav` and version `4.0.19` are unchanged.
- Setup now explains permission profiles and current automation limits. Once-configured unattended completion remains the goal, pending live end-to-end validation.
- See [CHANGELOG.md](CHANGELOG.md) for the pending positioning changes.

### v4.0.19
- **Premium UI/UX Overhaul:** Introduced a completely redesigned modern dashboard with dynamic glassmorphism cards, interactive radial gradients, animated tab transitions, a larger integrated progress ring, and micro-interactions.
- **Enhanced IDE Integration:** Fixed packaging and fully validated paths for Antigravity IDE compatibility.

### v4.0.18
- **Fix Skip Browser SubAgent not clicking:** When `skipBrowserAgent` was ON, the Skip button failed to click because it lacked a reject-sibling (Skip itself is in `REJECT_WORDS`). Rewrote validation flow — Skip in browser context bypasses sibling check entirely.
- **Execute button safety guard:** `Execute` now goes through the same Run/Run Task safety guard path, ensuring terminal commands are checked before auto-clicking.
- **Skip only fires in browser context:** Added guard `if (matched === 'Skip' && !browserContext) continue` — prevents false Skip clicks on non-browser tool steps.
- **Dashboard overflow fix:** Dashboard panel no longer overflows on narrow viewports.
- **Softer status bar icon:** Reduced visual weight of status bar indicators.
- **Operation presets & observability:** Added operation mode system (`safe`/`balanced`/`fast`/`custom`) with `getState()` and `getSessionSafe()` exposing current mode. New observability state module for metrics tracking.

### v4.0.16 – v4.0.17
- CDP observer version bump and internal refactoring.
- Restored JS click fallback alongside CDP native click for iframe compatibility.

### v4.0.15
- Hardened target selection for CDP injection to avoid broad webview matching.
- Native `Accept All` / accept-loop commands now respect `skipTerminalAccept` and `skipBrowserAgent`, so blind command-level accepts no longer bypass the safer CDP path by default.
- Dashboard dynamic rows now render via DOM/text nodes instead of raw `innerHTML`.
- VSIX packaging excludes local scratch/index artifacts, and activation smoke test now runs against the local repo.

### v4.0.14
- **Fix CDP disconnection under load:** Heartbeat ticks (`setInterval` + async) were running concurrently — each spawning CDP commands that cascaded into timeouts, marking sessions dead, and triggering more discovery loops. Fixed with `_heartbeatRunning` guard that skips a tick if the previous is still in flight.
- **Fix concurrent `discoverTargets()`:** Added `_discoverRunning` guard to prevent the heartbeat, `Target.targetCreated` events, and `hotUpdate()` from running overlapping discovery loops.
- **Fast heartbeat ping:** Observer alive-check (`window.__grav3`) now uses 2s timeout (was 5s) so a dead session fails fast without blocking the full heartbeat tick for 5s.
- **Longer session pruning window:** `DEAD_AFTER_MS` raised from 15s → 30s, giving sessions more time to recover when Antigravity is busy processing a long AI turn.
- **Reconnecting status indicator:** Status bar now shows `$(sync~spin)` (spinning icon) while CDP is reconnecting, with attempt count. Previously showed `$(debug-disconnect)` immediately, causing confusion between "genuinely disconnected" and "momentarily reconnecting."
- **Cleanup guard:** `cleanup()` resets `_heartbeatRunning` and `_discoverRunning` so no stale "lock" blocks the next connection attempt after a WS close.

### v4.0.13
- **Security fix — pipe-to-shell detection:** `curl url | bash`, `wget url | sh`, `curl url | zsh` were silently passing the blacklist due to a regex anchor bug. All 8 pipe-to-shell patterns (`| bash`, `| sh`, `| zsh`, `| pwsh`, `wget|sh`, `curl|sh`, `curl|bash`, `wget|bash`) now correctly block in both the CDP observer and the learning safety guard.
- **False positive fix:** `git push --force` no longer incorrectly blocks `git push --force-with-lease` (trailing word-boundary lookahead added).
- **`Execute` button support:** Added to `DEFAULT_PATTERNS` and `PRESET_PATTERNS['1.24+']` — Antigravity variants that use `Execute` instead of `Run` are now auto-clicked.
- **`Allow This Workspace` added to 1.24+ preset** — covers Antigravity versions that use this label variant.
- **`HIGH_CONF` cleanup:** Removed dead entries `'Go'` (too generic, no matching pattern) and `'Approved'`. Added `'Allow This Workspace'` to match new preset entry.

### v4.0.12
- **Fix SKIP_BROWSER_AGENT false blocking:** When Skip Browser SubAgent was ON and an AI response contained multiple tool calls (e.g., `browser_subagent` followed by `run_terminal`), the terminal `Run` button was incorrectly blocked. Root cause: `b.closest('[class*=message], [class*=container]')` found a broad parent wrapping all steps; its `innerText` contained `browser_subagent` from the earlier step. Fix: narrowed selector to `[class*=tool], [class*=step]` only — per-step scope, no cross-step bleed.
- **Observer version bumped to v4.0.12** for force-reload on update.

### v4.0.11
- Restore JS click fallback alongside CDP native click for maximum compatibility.
- Fix iframe discovery for nested OOPIF targets in Antigravity 1.24+.

### v4.0.10 — v4.0.7
- CDP click: trigger native `Input.dispatchMouseEvent` directly to bypass Antigravity's permission guard.
- Human-like click sequence to avoid anti-automation detection on Antigravity update.
- Split status bar into 4 independent items (main, CDP, Skip, Dry Run).
- Skip Browser SubAgent feature: detect `browser_subagent`/`computer_use` tool calls and click Skip instead of Run.
- Fix activation crash introduced by Antigravity internal update.

### v4.0.0
- **Auto-Fixer Engine:** Suggests corrections for failed terminal commands; corrections must pass the command blacklist.
- **VS Code Native Chat Support:** Native edit-accept commands for Copilot Edits (`workbench.action.chat.applyAll`, `github.copilot.acceptWorkspaceEdit`) and Inline Chat.

### v3.7.0
- Adaptive Accept Loop: scan interval drops to 800ms for 10s on `run_command` tool-call event.
- Smart Terminal Kill Guard: DOM-verified kill — only fires when `<input>`/`<textarea>` is visible.
- Diagnostics Conflict Report: surfaces conflicts between `SAFE_TERMINAL_CMDS` and user `terminalBlacklist`.

### v3.6.3
- Dev Server Protection: `grav.stopAllTerminals` filters out user dev servers.
- Enhanced Blacklist: Added `su -` and `git reset --hard`.
- Optimized word-boundary matching in `matchesBlacklist`.

### v3.6.0
- Per-project patterns via `.vscode/grav.json` with live file watcher.
- Dry Run mode with Dashboard toggle and status bar indicator.
- Notification suppression: debounced `MutationObserver` replaces polling.

### v3.5.0
- CDP engine rewrite: exponential backoff reconnect, session pruning, heartbeat re-inject.
- Safety Guard: reads `<code>` blocks adjacent to Run buttons.
- Adaptive Learning Engine: mini-batch SGD, confidence scoring, promote/demote.

---

**Author:** An Le · [GitHub](https://github.com/anlvdt/grav) · [Issues](https://github.com/anlvdt/grav/issues) · anlvdt@gmail.com

☕️ **Support the Developer**
If Grav saves you time, consider supporting:
- 💳 **MB Bank**: `0360126996868` (LE VAN AN)
<p align="left">
  <img src="https://img.vietqr.io/image/970422-0360126996868-compact2.png" width="250" alt="MB Bank QR">
</p>
