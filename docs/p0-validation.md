# Grav P0 validation — 2026-10-02

Version: 4.0.19 (unchanged). Artifact: artifacts/grav-4.0.19-p0.vsix.

## Delivery and behavior

The policy and dashboard worker changes were reviewed and integrated manually with explicit user authorization after MonoCode review failed with “This worker has no recoverable change checkpoint”. The queued integration task was cancelled to prevent duplicate work. Existing unrelated changes and the token proxy deletion were preserved; pre-integration copies of replaced files are in .cache/p0-pre-integration. No commit, branch change, installation, publication, or host permission write was performed.

- One evaluator and versioned policy snapshot serve Test command, learning, CDP observer and injected runtime. Decisions include allow/manual/deny, reasonCode, reason, matchedRules, scope and policyVersion. Only allow is eligible for an approval attempt; deny does not change host execution permissions.
- Blacklist rules take priority, including destructive defaults and user/project rules. Existing executable-only entries and built-in executable grants remain legacy broad grants. Multi-token grants match literal argv prefixes at token boundaries. Unknown or missing context and unsupported shell syntax remain manual. Ordinary quoting is supported; this is not a general shell parser.
- Runtime snapshot and status bar share off, paused, dry-run, disconnected, ready and unknown states, in that order. Ready requires a verified executor, matching policy version and a live lease. Manual pause, typing and dashboard visibility retain distinct reasons.
- Decision traces keep their IDs and add decision metadata and attempted/unknown outcomes. Click attempts are not completion receipts. Dashboard feedback selects an explicit trace ID; missing or expired IDs return an error.
- Learning suggests candidates and suggestion scores, never authorization. Manage Terminal replaces direct learning-prompt Add/Blacklist actions with explicit policy management. Fast preset retains the native edit guard.
- Dashboard renders applied runtime state separately from dirty/saving/saved/error settings, displays decision reasons/rules/scope, and uses theme tokens and accessible focus. Scroll interaction pause and the fixed native guard have explicit labels. ROI is an estimate based on assumed time per click attempt.

## Checks

Commands ran sequentially:

| Check | Result |
| --- | --- |
| npm test | 941 passed, 0 failed; 26 files, 0 infrastructure failures |
| npm run test:webview | 22 passed, 0 failed using Playwright/Chromium |
| npm run release:check | Passed; package tree reviewed |
| npm run package:vsix -- --out artifacts/grav-4.0.19-p0.vsix | Passed; verified before copy |
| npm run verify:vsix -- artifacts/grav-4.0.19-p0.vsix | Passed; ws 8.22.0, 48 entries, 24 source hashes match checkout |
| git diff --check -- . ':!AGENTS.md' | Passed |

The whole-tree whitespace check identifies an existing trailing blank line at AGENTS.md:69. That user instruction file was preserved.

Regression coverage includes full decisions and actual click eligibility across simulator/observer/runtime; blacklist conflicts, quoting and argv boundaries; unknown and unsupported syntax; project blacklist and policy refresh; pending-action revocation; pause, typing, dashboard, dry-run and disconnect/lease expiry; explicit feedback identity; learning without authorization; save ACK and live runtime updates. Chromium fixtures cover the 340px panel, keyboard/focus, theme contrast and hostile rule text rendering.

All test temporary directories and packaging scratch directories used checkout-local .cache paths. Artifacts, caches, tests and this validation report are excluded from the VSIX. The package tree contains the new action-policy/configuration code and no token proxy.

## Verification limits

This is fixture and Chromium validation, not live Antigravity validation. No extension was installed or host app changed in this run. Host command completion, permission behavior and native session identity have not been inferred from clicks. Legacy broad grants still cover arbitrary supported literal arguments and do not prove safety. The scope is the approved P0 improvements; intent ledger, scheduler, rule editor and new native adapters remain deferred.

## Artifact integrity

SHA-256: ec2e96aad74efa8f851fef7fc43b13ac109c6ff0911b95bf2bc604a0505aeabb
