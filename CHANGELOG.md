# Changelog

## 4.0.20

- Bump version to 4.0.20.
- Retry/Resume budget gate: `Retry`, `Try Again`, `Resume` and `Resume Conversation` share one per-conversation budget (`grav.retryBudget`, default off, max 1–8 clicks). Quota waits are never treated as retries and do not consume budget; terminal jobs without verified failure stay manual (`retry-quota`, `retry-unverified-failure`, `retry-unconfigured`, `retry-budget`, `retry-within-budget`).
- Job producer snapshot: `snapshot()` reports live or latest-terminal conversation state (`waitReason`, `terminal`, `failed`) so the click path can refuse quota waits and unverified failures before counting a retry attempt. `retryUsed` survives same-version hot updates and resets on policy version change or reinjection.
- Subagent job tracking with `parentJobId` attribution and trajectory-rotation retry attribution (prior commits).
- Test suite: 1422 assertions across 40 files, all passing.

## Unreleased

- Reposition the display name as **Antigravity Auto Accept — Grav (Auto Approve / Auto Run)** and describe supported edit/terminal approval, configurable rules, dry run and auto scroll.
- Replace broad IDE/competitor tags with 18 relevant discovery keywords; retain package name `grav`, publisher `ANLE`, extension ID `ANLE.grav` and version `4.0.19`.
- Put Antigravity auto accept setup first in the README, including debug-port restart, profile selection and executor checks. Remove unverified Windsurf compatibility and blanket approval/reliability claims from the opening and setup.
- Document once-configured unattended workflow as the product goal, with broader autonomy pending live end-to-end validation.
- Register the autonomy worker’s supplied `grav.autopilotProfile` schema and `Grav: Configure Autopilot Profile (One-Time Setup)` command; the typed profile is separate from permissionProfile, disabled by default and pending live workflow validation.
- Add guided one-time permission setup, exact typed grants shared by both executors, version-gated permission-card handling and payload/scope revalidation.
- Add CDP/renderer/bridge recovery, a bounded observed-attempt journal and separate host job lifecycle metrics.
- Add a pure configured question/form/plan decision evaluator; live request producers remain pending and are not exposed as supported automation.
- Add dated community wording, competitor metadata and official manifest research in [marketplace-keywords-2026-10-03.md](docs/marketplace-keywords-2026-10-03.md).

No marketplace publication or version bump is part of these changes. Existing release history remains in [README.md](README.md#changelog).
