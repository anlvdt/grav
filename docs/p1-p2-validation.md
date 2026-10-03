# Grav P1/P2 engineering validation — 2026-10-02

Extension version remains 4.0.19. This delivery implements R4–R9 infrastructure from /Users/anle/Documents/Grav-Research/2026-10-02/ROADMAP.md. Live host pilot and unsupported native API integrations remain explicitly unverified.

## Delivery by roadmap item

| Item | Implemented | Evidence / limit |
| --- | --- | --- |
| R4 intent ledger | Shared document ledger across CDP/injected runtime; request/tool-call/prompt attributes when available; conservative anonymous fingerprints; claim, owner generation fencing, payload/policy revalidation; UI postcondition tracking | Real renderer fixture tests for remount, new request with same text, separate targets, takeover, detach, delayed revoke and P0 marker migration. No exactly-once or command-completion guarantee |
| R5 scheduler/breaker | Coalesced leading events, watchdog, bounded 64-candidate batches with continuation; four concurrent CDP target tasks; pending policy/delayed action cancellation; jittered reconnect; target-local no-progress breaker | Large candidate list and stalled/failed target tests; deterministic replay reduces scans/wakeups. Thresholds are conservative pilot defaults awaiting real-host calibration |
| R6 permission/speed | Independent profile and speed controls; rule manager with exact/prefix argv, allow/deny, session/project/user scope, expiry, rule-only/effective previews, revoke and bounded history | Default Legacy preserves old data. Terminal uses scoped rules only and ignores legacy/built-in grants. Old combined operation presets remain explicitly labelled legacy behavior |
| R7 learning provenance | Observation/result counters separate from human approvals/rejections; automation never creates human labels; bounded credential-redacted command examples; suggestion scores only | Human labels require explicit user-approval provenance. Existing host telemetry does not fabricate those labels or grant authorization |
| R8 capabilities | Versioned feature manifest; readable host build metadata; adapter ACK version gate; target-level ledger/scheduler diagnostics; unsupported capabilities stated | Installed Antigravity IDE metadata read only: editor build 1.107.0, stable, commit ecfbad74d93962fc8ca485d93ab9b4f3d4cb6cf8. Metadata is not proof of native approval APIs. No unsupported native adapter was invented |
| R9 metrics/pilot | Labeled-opportunity denominator, handled legitimate attempts, false approvals, duplicate attempts, unknown outcomes, p50/p95 latency, interventions; reconnect recovery instrumentation; deterministic replay artifact | Clicks remain attempts. Live metrics cover bounded recent traces, not lifetime totals. Reconnect has no synthetic sample in this replay. Live observe-first pilot remains to be performed |

No proxy, host permission write, dependency, release/version increment, commit, branch change, extension installation or publication was introduced. Existing dirty files and AGENTS.md were preserved. Canonical dashboard remains the existing HTML/webview stack.

## Behavior and limits

- A stable host attribute is evidence available in the DOM, not a verified native transaction ID. Anonymous identical prompts remain manual after the first attempt; the system cannot prove that a remount is a new prompt. Different documents have separate ledgers; two target sessions with the same command are not suppressed globally.
- Once attempted, an intent remains unknown and is never blindly retried after exception, policy loss, reinjection, Resume or payload TTL. Disabled/disappeared buttons record approval-ui-changed, not command completion. Full document replacement loses this local ledger; no cross-navigation exactly-once claim is made.
- Ledger holds up to 256 entries. Payload retention is 30 minutes; bounded unknown tombstones remain until the document ends. A full ledger requires manual approval or a new document. Resume clears the no-progress breaker, not unknown tombstones or adapter incompatibility.
- Three unconfirmed UI postconditions stop that document. UI postcondition sampling is one second after an attempt. Event scans coalesce at 50 ms; watchdog uses four times the configured cadence. These are initial conservative fixture-tested limits and must be calibrated by live observation, not advertised as measured production optima.
- Profiles: Observe never auto-approves; Edits permits command-free edit/UI actions; Terminal also permits scoped terminal rules; Legacy preserves P0 label/executable grants. Browser/MCP approvals require manual review outside Legacy; Skip remains a cancellation action. Broad grants are inactive in Terminal.
- Session rules are memory-only for the extension host session. Project rules bind to the recorded first workspace path; user rules remain in Grav configuration. Expiry is checked by the evaluator at the action endpoint, including delayed callbacks. Malformed rules fail closed. Default blacklist denies still win over explicit allows.
- Scan-speed changes do not edit grants/profile. Historical Safe/Balanced/Fast presets remain combined presets, with a clear description, and can still change labels/browser skipping. Use Set Scan Speed for a speed-only change.
- Native automatic acceptance now stays manual because verified request identity/receipt is unavailable. Explicit Grav: Accept All continues to use the known edit-command allowlist and action guards. Capability manifest does not claim native terminal, browser, MCP, host permission writes or completion support.
- Diagnostic exports and learning examples redact common credential forms and bound payload size. Redaction is heuristic; review before sharing. Raw command semantics are not rewritten for policy evaluation.

## Validation

| Command / check | Result |
| --- | --- |
| npm test | 978 passed, 0 failed; 29 test files; 0 infrastructure failures |
| npm run test:webview | 23 passed, 0 failed; Chromium fixtures |
| npm run pilot:replay | Passed; artifacts/p1-p2-replay.json |
| npm run release:check | Passed; runtime files present, caches/tests/reports/proxy excluded |
| npm run package:vsix -- --out artifacts/grav-4.0.19-p1-p2.vsix | See artifact verification below |
| git diff --check -- . ':!AGENTS.md' | Passed; pre-existing AGENTS.md trailing blank line preserved |

Browser checks include 340px layout, theme/focus/keyboard, save ACK, explicit feedback ID, runtime states, independent profile/speed messages and safe text rendering of capability/provenance data. Renderer replays run the actual compiled CDP/injected sources, not just a mock evaluator. The target scheduler test holds one target indefinitely while the healthy lane proceeds and a failed target does not stop later work.

## Synthetic replay

Fixture pilot-v1; policy pilot-policy-v1; adapter adapter-v1; two target documents; six unique labeled opportunities, including one remount and two commands needing manual review.

| Metric | Fixed polling | Events + watchdog |
| --- | ---: | ---: |
| Scans | 242 | 69 |
| Timer wakeups | 284 | 111 |
| Legitimate approvals attempted | 4 / 4 | 4 / 4 |
| False approvals observed | 0 | 0 |
| Duplicate attempts observed | 0 | 0 |
| Unknown command outcomes | 4 | 4 |
| p50 / p95 opportunity-to-attempt latency | 99 / 99 ms | 50 / 50 ms |

These results describe one deterministic synthetic fixture. They do not establish production performance, zero risk or command success. Live recent-trace latency is local claim-to-attempt latency, not the replay's opportunity-to-attempt measure; the two are not interchangeable. Live reconnect recovery measures disconnect to the first verified current-policy ACK and remains null until observed.

## Next verification stage

A real host pilot is still needed: install this reviewed artifact, begin in Observe, manually label opportunities, then try a narrow exact session rule with expiry under Terminal. Monitor unknown outcomes, false/duplicate attempts, interventions and recovery before expanding scope. No live auto-approval or real-host pilot was performed in this implementation run, and unsupported native APIs remain manual rather than falling back blindly.

References used for event lifecycle guidance: [MDN MutationObserver](https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver), [MDN disconnect](https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver/disconnect). The implementation uses existing MutationObserver/timers without introducing a new browser API or framework.

## Artifact verification

Verified artifacts/grav-4.0.19-p1-p2.vsix: ws 8.22.0; 54 entries; 30 src/media/icon hashes match the final checkout. No proxy, caches, tests, replay fixtures or validation reports are packaged.

SHA-256: 9ba63d21d5cb565df3cbbdc309ad57975c6058cd87eda50716b64226c8c35bb1
