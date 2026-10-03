# Configured autopilot implementation — 2026-10-03

Grav now has an opt-in profile and a connected permission-card adapter. The default profile is disabled, preserving existing users' behavior. Configured cards can proceed without approving each popup when their complete editable target, operation and already-selected permission scope match an explicit grant. This is bounded unattended automation, not complete coverage of Antigravity interactions.

## One-time setup and configuration

`grav.configureAutopilot` opens a guided editor with Enable/Disable, Add grant, Remove grant and Save. Adding a grant asks for operation, exact target, scope and allow/deny; it generates an ID and binds the grant to the active workspace. Cancellation discards unsaved changes. Disabling preserves grants for later re-enabling. Dashboard entry and manifest contributions are owned/integrated by the coordinator and branding worker.

Required manifest command:

```json
{"command":"grav.configureAutopilot","title":"Grav: Configure Autopilot Profile (One-Time Setup)"}
```

Required setting `grav.autopilotProfile`: object, default `{ "enabled": false, "grants": [] }`, properties `enabled` boolean and `grants` array, maxItems 256. Grant items require `id` string, `effect` allow/deny, `operation` command/read_file/write_file/read_url/execute_url/mcp, `target` string (1–2000 characters), `scope` once/conversation/project/workspace/global; optional `workspace` string. No wildcard targets or control characters. Runtime normalization validates the full profile and fails closed on malformed grants.

Example:

```json
{
  "grav.autopilotProfile": {
    "enabled": true,
    "grants": [
      { "id": "docs-read", "effect": "allow", "operation": "read_url", "target": "docs.example.test", "scope": "once", "workspace": "/path/to/project" }
    ]
  }
}
```

Existing `grav.permissionProfile` remains independent; Observe, pause, dry-run, disabled state and policy lease expiration prevent actuation. Command blacklist and explicit argv deny rules override autopilot command grants. Autopilot denies override allows for the same operation/target across scopes. Standing grants are refused if any active local deny exists in that operation namespace; standing command grants also refuse a nonempty blacklist, which includes the effective default blacklist.

Standing conversation/project/workspace/global scopes save a host permission through the host's UI. Removing a Grav grant does **not** revoke a previously saved host permission: revoke it in host permission settings. No host-internal grant RPC or configuration-store write is implemented. Host permissions retain host semantics (for example domains/subdomains and directory recursion), which differ from Grav's exact request-target matching. See [official permissions](https://antigravity.google/docs/permissions/) for host namespaces and permission precedence; that page is scoped to Antigravity 2.0/CLI and does not establish IDE DOM support.

## Actual producer and version evidence

Inspected installed `/Applications/Antigravity IDE.app/Contents/Resources/app/product.json`: IDE 2.5.5, editor 1.107.0, commit `ecfbad74d93962fc8ca485d93ab9b4f3d4cb6cf8`, macOS. Installed `out/vs/workbench/workbench.desktop.main.js` research SHA-256: `f4bd347d94be4634d2adeec8b3ef65e4d65d7dd0d72281b0e1982fe9c71fe6a7` (inventory in `artifacts/approval-research-2026-10-03/host-inventory.json`). Extension activation gates typed decisions on macOS and this exact product version/commit, sending `interactionHost: "ide-2.5.5-unified-permission-dom"`; other builds are unsupported.

Source signatures inspected directly:

- `Wla`: permission renderer receives `permissionSpec.resource.action/target`; target textarea has `aria-label="Edit permission target"` and updates `editedTarget` on submission.
- `lMu`/`aMu`: resource-specific Allow headings. Command/custom descriptions can override headings, so headings alone do not prove the operation.
- `hwu`/`mve`/`sZ`: command `permissionAction` selects an independent terminal SVG with mask ID `mask0_1041_504`. Adapter requires this icon for command, and rejects it for other namespaces, preventing a command description impersonating URL/file permission.
- `T9n`/`pTu`: native checked radio inputs, label wrappers, write-in textarea `data-testid="ask-question-writein"`, submit button `data-testid="interaction-continue-button"`.
- `Wla` `ue`: scope maps to ONCE/CONVERSATION/PROJECT/WORKSPACE/GLOBAL; edited targets and persisted grants are sent by host callback. We invoke the verified UI button, not `sendInteraction`.
- `Wla` initializes `[G,O]=We(["1"])` and resets `O(["1"])` on resource change. Regular permission adds option 1 `Yes, allow this time` with ONCE; `pTu` renders checked state from those selected IDs. The default once profile therefore works unattended on newly mounted cards.
- `pTu` schedules `onNextNoWrap` after selecting a radio. Permission `Wla` passes a no-op callback, while question `mTu` can submit/advance. They must not be conflated. Scope switching is currently outside the implemented control contract, not impossible because of the question timer.

The adapter walks to the smallest ancestor containing the uniquely labelled permission editor when generic tool-step classes are absent. It requires exactly one editor, one recognized operation heading, compatible independent command icon, one checked enabled native radio and no nonempty write-in denial. Unknown controls, wider suggested persist patterns, persistence-only cards, hook/Ask conflict text and malformed targets produce precise unsupported reasons. `Wla` props and `T9n` selections are also read through bounded, read-only React fiber traversal (at most 8 DOM ancestors and 64 fiber parents, with cycle detection). Identity is accepted only for the pinned build, matching `resource.action/target`, generated question resource, selected option ID/text, single selection and valid `cascadeId`, `trajectoryId`, `stepIndex`. No callback is invoked. Those host IDs let distinct repeated requests with identical content proceed while suppressing the same request/remount. Missing or mismatching props retain the conservative anonymous identity, which intentionally cannot distinguish identical requests.

Tests use source-derived DOM structure; they are synthetic replay fixtures, **not captured live permission requests**. No live popup was submitted and no host receipt was obtained in this task. Coordinator read-only CDP probe found no pending permission editor/shared submit controls; evidence is `artifacts/audit-implementation-2026-10-03/live-readonly-probe.json`.

## Connected behavior and coverage

| Family | Connected path | Limit |
| --- | --- | --- |
| Unified command permission | Exact target; existing command deny/blacklist checks; selected scope | One literal argv; sandbox escape/custom descriptions not recognized; effective blacklist blocks standing scopes |
| Unified file read/write permission | Separate exact absolute target grants | Lexical path only; no realpath/symlink guarantee, directory-prefix grants or implicit read-from-write grant |
| Unified URL read permission | Exact editable URL/domain resource | No inherited execution grant |
| Unified browser execution permission (`execute_url`) | Separate exact resource grant | Does not cover legacy browser action, JavaScript code approval, browser setup or native Chrome permissions |
| Unified MCP permission | Exact server/tool resource grant | Permission namespace, not an argument-sensitive tool execution adapter; no elicitation or OAuth |
| Scope handling | Exact already-selected once/conversation/project/workspace/global | No automatic scope/menu switching; suggested wider patterns and disabled/forced-Ask scopes unsupported |
| Existing legacy terminal/edit handling | Existing policy remains in use | No expansion of generic Submit/Accept into unverified typed operations |

`src/action-policy.js` embeds the same constructors/evaluator in CDP and injected runtime. Both executors resolve recognized configured cards independently of legacy button pattern allowlists, then retain their existing context, editor, visibility and ownership guards. Ledger payload includes operation, editable target, selected scope, full card text and selected value. Policy, request fingerprint and ownership are reread immediately before activation; mutations invalidate a pending intent even when the new target is also configured. Duplicate suppression and takeover use that same typed fingerprint, with verified React props providing request identity when available. Only exact unedited resource/UI matches get host identity; edited targets whose host props have not updated fall back to anonymous identity. Observer revision is `v4.0.23-autopilot`, replacing the earlier evaluator while retaining the adapter-v1 readiness contract.

Unknown outcomes remain unknown; disappearance/disabled state is only an approval UI postcondition. Reconnect, resume or profile changes never convert unknown results into an automatic replay permission. Configured profile changes affect the authoritative policy hash. Project binding currently checks the policy workspace, not verified request-level job attribution: multi-root, cross-window and background conversation attribution remain unverified and must not be described as supported project scheduling.

## Integration requirements

Coordinator/recovery owners must forward these authoritative fields in both `src/injection.js` `runtimeConfig` and `src/bridge.js` `/grav-status`: `autopilotProfile`, `interactionHost`, `permissionProfile`, `permissionRules`, `resumeToken`, `eventScheduler`. Runtime sends encoded `surfaceUrl` in bridge status queries and includes it in click logs; host journal `intentTombstones` are merged into the shared ledger before granting a live enabled lease. Malformed or saturated journal state fails closed; expired unknown tombstones never grant retry permission. CDP already spreads the complete authoritative policy. Omitting `interactionHost` intentionally prevents typed actuation, even when grants exist. The worker does not own those transport files; integration changes are supplied by their owners.

`test/run-all.js` automatically discovers both new `*.test.js` suites; no registration change is needed. No edits to package.json, README, CHANGELOG or run-all were made by this worker.

Extension also passes jobMetrics to `summarizePilot` and wires CDP/bridge `onJobObservation` to observability `recordJobEvent`. Renderer observations keep their original evidence classification: they do not create a verified host start/completion denominator. A verified host job lifecycle producer remains missing.

The separate decision-engine worker's `createDecisionEngine` API is not wired to invented DOM request identities. Questions, multi-question hidden selections, forms, plan revision identity and task context have no verified live producer here; see `docs/decision-engine-2026-10-03.md`. No dead decision setting or first-option answering path is exposed.

## Verification

- `node test/autopilot-profile.test.js`: 92 pass. Six operation grants through both executors; all five already-selected scopes; explicit deny and narrower standing deny conflicts; command blacklist and argv denies; unsupported host; question/permission separation; command-description impersonation; mutable payload/operation/scope with stable request identity; pause/dry-run/revocation during claim; shared ledger takeover; generated injection config actually drives runtime actuation; source-shaped fiber recurring equal content and same-DOM new steps; same-step remount suppression; host step swap during claim fences both executors before click; stale/cyclic/mismatching fiber fallback; expired unknown journal seeding and saturated/malformed recovery journals.
- `node test/autopilot-setup.test.js`: 6 pass. Cancel/no writes, guided save with generated ID/workspace, disable/re-enable grant retention, exact revoke and invalid target rejection.
- `node test/configuration.test.js`: 18 pass including disabled default, normalized grants reaching the snapshot, policy version invalidation and malformed profile rejection.
- Existing relevant regressions: action-policy 325, approval-research 35, extension-policy 46, activate 4, cdp-observer 28, injection-runtime 18, cdp-policy 21, remaining-roadmap 27 pass.
- Final relevant check batch: 620 pass, 0 failures across 11 suites.
- Syntax checks passed for edited renderer/policy/extension modules. Ownership-scoped `git diff --check` clean. Full release/build/package verification is coordinator-owned; no new VSIX, deployment, installation or commit was produced by this worker.

Remaining work: live capture and host receipt verification, reliable legacy file/URL/browser/MCP adapters, guarded scope selection, actual job identity/cwd/plan revision producers, symlink/path semantics, Windows/Linux and newer build mappings, native dialogs, OAuth/credentials, billing and elicitation. The implemented profile reduces repeated approval work only within the explicit verified DOM contract; it does not prove end-to-end unattended job completion.
