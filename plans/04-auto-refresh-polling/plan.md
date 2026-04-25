# Implementation Plan: Auto-Refresh Polling

## Overview
Add optional polling so Pi's registered LM Studio models stay synchronized when LM Studio starts after Pi, when users load/unload models in LM Studio, or when model availability changes. The implementation should be conservative by default, avoid duplicate concurrent refreshes, and cleanly dispose timers if Pi exposes lifecycle hooks for extension shutdown.

## Current Repo Context
- Main implementation: `src/index.ts`
- Current refresh behavior:
  - Initial refresh during extension load
  - Manual `/lmstudio-refresh`
- `refreshProvider` is already testable and catches fetch errors
- `lastResult` and `lastWarnings` live in the extension closure
- No timer or lifecycle cleanup exists

## Goals
- Add opt-in automatic refresh
- Avoid overlapping refresh calls
- Avoid noisy user notifications during background failures
- Track enough state for `/lmstudio-status`
- Keep manual refresh behavior unchanged

## Non-Goals
- Do not add native model management in this plan
- Do not add file watching for settings changes
- Do not add exponential backoff unless simple enough to implement safely
- Do not implement a UI widget or persistent status indicator

## Proposed Config
Extend `LmStudioConfig`:

```ts
autoRefresh: boolean;
refreshIntervalMs: number;
notifyAutoRefreshChanges: boolean;
```

Defaults:
- `autoRefresh: false`
- `refreshIntervalMs: 30000`
- `notifyAutoRefreshChanges: false`

Validation:
- `refreshIntervalMs` must be positive
- Clamp to a safe minimum, for example 5000 ms, to prevent hammering LM Studio
- Keep using `fetchTimeoutMs` for each discovery request

## State Model
Inside `lmStudioExtension` track:
- `lastResult`
- `lastWarnings`
- `lastRefreshAt`
- `lastRefreshReason: "startup" | "manual" | "auto"`
- `lastRegisteredModels: string[]`
- `autoRefreshRunning: boolean`
- `autoRefreshInFlight: boolean`
- timer handle

Comparison:
- Treat model list changes as a sorted string comparison
- If per-model metadata feature has been implemented, compare model ID plus capability-relevant fields; otherwise compare IDs only

## Refresh Behavior
Add a `refresh(cwd, reason)` helper:
- `reason` controls logging and notification behavior
- Manual refresh sends notifications as today
- Startup logs success/failure
- Auto refresh logs at debug/info level but does not notify unless `notifyAutoRefreshChanges` is true and the registered model set changed

Concurrency:
- If auto refresh fires while another refresh is in flight, skip that tick
- Manual refresh should either wait for the in-flight refresh or run after it; simplest behavior is to let manual refresh run independently only after setting a shared in-flight guard
- Prefer a shared `refreshInFlight: Promise<RefreshResult> | undefined` over boolean-only state if this keeps behavior deterministic

Failure Behavior:
- If LM Studio is offline during auto refresh, keep Pi usable and record last error
- Do not unregister a previously registered provider solely because a fetch failed
- Preserve current behavior where a successful refresh with zero models unregisters provider

## Timer Lifecycle
Investigate Pi extension lifecycle hooks:
- If there is an extension shutdown/dispose hook, clear the interval there
- If not, keep one interval per extension load and document that `/reload` behavior should be tested
- Avoid starting polling until after initial refresh completes

## Task List

### Task 1: Add Config Fields
**Description:** Add auto refresh settings with validation and tests.

**Acceptance Criteria:**
- Defaults preserve current behavior with no polling
- Project settings override global settings
- `refreshIntervalMs` clamps to minimum safe value
- Invalid values fall back to defaults

**Verification:**
- Add `mergeConfig` tests
- Add `loadConfigFromSettings` tests if needed
- Run `npm test`

**Dependencies:** None

**Files Likely Touched:**
- `src/index.ts`
- `test/index.test.ts`
- `README.md`

**Estimated Scope:** Small

### Task 2: Refactor Refresh State
**Description:** Refactor extension closure state to track refresh reason, time, model list, and in-flight status without changing behavior.

**Acceptance Criteria:**
- Startup refresh still runs once
- Manual `/lmstudio-refresh` still works
- `/lmstudio-status` still reports the last refresh outcome
- No behavior change when `autoRefresh` is false

**Verification:**
- Run existing tests
- Add tests for pure helper functions if refresh state comparison is extracted
- Run `npm run check`

**Dependencies:** Task 1

**Files Likely Touched:**
- `src/index.ts`

**Estimated Scope:** Small

### Task 3: Add Model Change Detection Helper
**Description:** Add a deterministic helper to compare previous and current refresh results.

**Acceptance Criteria:**
- Same model IDs in different order are treated as unchanged
- Added and removed model IDs are identified
- Failed refreshes do not produce model-change notifications
- Zero-model successful refresh is treated as a real change if previous models existed

**Verification:**
- Add unit tests for comparison helper
- Run `npm test`

**Dependencies:** Task 2

**Files Likely Touched:**
- `src/index.ts`
- `test/index.test.ts`

**Estimated Scope:** Small

### Task 4: Implement Polling Loop
**Description:** Start a timer when `autoRefresh` is enabled and run background refreshes at the configured interval.

**Acceptance Criteria:**
- Timer starts only when `autoRefresh` is true
- Timer does not start before initial config is loaded
- Polling uses the latest project cwd known at startup or current process cwd; document this limitation
- Overlapping refreshes are skipped or coalesced
- Auto refresh errors are logged and recorded but not surfaced as repeated warning notifications by default

**Verification:**
- Use fake timers in Vitest if practical
- Test that overlapping calls do not occur
- Run `npm test`
- Run `npm run check`

**Dependencies:** Tasks 1 through 3

**Files Likely Touched:**
- `src/index.ts`
- `test/index.test.ts`

**Estimated Scope:** Medium

### Task 5: Enhance Status Command
**Description:** Report polling state in `/lmstudio-status`.

**Acceptance Criteria:**
- Status includes whether auto refresh is enabled
- Status includes interval when enabled
- Status includes last refresh reason and timestamp if available
- Status remains concise

**Verification:**
- Typecheck
- Manual command review

**Dependencies:** Tasks 2 and 4

**Files Likely Touched:**
- `src/index.ts`

**Estimated Scope:** Small

### Task 6: Add Optional Change Notifications
**Description:** If `notifyAutoRefreshChanges` is true, notify when auto refresh changes the registered model set.

**Acceptance Criteria:**
- Notification appears only when the model set changes
- Notification summarizes added and removed counts or IDs
- Failures do not spam notifications
- Default remains silent

**Verification:**
- Unit test model-change formatting helper
- Manual test with mocked or real LM Studio model list changes
- Run `npm test`

**Dependencies:** Tasks 3 and 4

**Files Likely Touched:**
- `src/index.ts`
- `test/index.test.ts`

**Estimated Scope:** Small

### Task 7: Update README
**Description:** Document settings, behavior, and caveats.

**Acceptance Criteria:**
- README includes `autoRefresh`, `refreshIntervalMs`, and `notifyAutoRefreshChanges`
- README explains that background errors are recorded but not repeatedly notified
- README explains when to use manual refresh versus auto refresh

**Verification:**
- Manual README review

**Dependencies:** Tasks 1 through 6

**Files Likely Touched:**
- `README.md`

**Estimated Scope:** Small

## Checkpoints
- After Task 3: all pure config/state helpers are covered
- After Task 4: polling is implemented and covered by tests or a clear manual test
- After Task 7: `npm test` and `npm run check` pass

## Risks and Mitigations
| Risk | Impact | Mitigation |
| --- | --- | --- |
| Polling spams LM Studio | Medium | Default off, safe minimum interval, skip overlapping refreshes |
| Repeated failure notifications annoy users | High | Do not notify auto refresh failures by default |
| Reload creates multiple timers | Medium | Investigate lifecycle cleanup and test `/reload`; keep timer creation scoped and guarded |
| Auto refresh uses stale cwd | Low | Use startup cwd for initial implementation and document behavior |

## Manual Test Scenario
1. Configure `autoRefresh: true` and `refreshIntervalMs: 5000`
2. Start Pi while LM Studio is offline
3. Start LM Studio after Pi is already running
4. Confirm `/lmstudio-status` eventually reports registered models without manual refresh
5. Load or unload a model in LM Studio
6. Confirm model list changes after the next polling interval
7. Disable `notifyAutoRefreshChanges` and confirm no repeated notifications on failure

## Acceptance Criteria for the Whole Feature
- Auto refresh is disabled by default
- When enabled, model registration updates without manual command use
- No overlapping refreshes occur
- Status reports polling state
- Unit tests cover config and change detection
- `npm test` passes
- `npm run check` passes
