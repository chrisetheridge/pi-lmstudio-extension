# Implementation Plan: Health Check and Diagnostics Command

## Overview
Add a `/lmstudio-doctor` command that performs targeted checks against the configured LM Studio server and reports actionable diagnostics. The current `/lmstudio-status` only reports configured endpoint and last refresh result; doctor should actively test connectivity, endpoint support, auth behavior, model discovery, and provider registration assumptions.

## Current Repo Context
- Main implementation: `src/index.ts`
- Current commands:
  - `/lmstudio-refresh`
  - `/lmstudio-status`
- Current fetch helper only checks `GET <baseUrl>/models`
- Current config warnings are recorded during settings parsing
- No diagnostics abstraction exists

## Goals
- Give users fast, actionable troubleshooting output
- Test both OpenAI-compatible and native LM Studio endpoints
- Keep checks read-only by default
- Make diagnostic logic unit-testable
- Avoid leaking API tokens in output

## Non-Goals
- Do not load or unload models from doctor
- Do not send a real chat/completion request by default
- Do not write settings files automatically
- Do not require native API to pass if only OpenAI-compatible discovery is needed

## Proposed Command

### `/lmstudio-doctor [--verbose] [--json]`
Checks:
1. Config load
2. `baseUrl` normalization
3. OpenAI-compatible `GET /v1/models`
4. Native `GET /api/v1/models`
5. Provider config build from discovered models
6. Optional API mode sanity:
   - If configured `api` is `openai-responses`, report that `/v1/responses` is expected for inference but do not POST by default
   - If configured `api` is `openai-completions`, report that `/v1/chat/completions` is expected
7. Current last refresh status

Output:
- Default: concise pass/warn/fail summary via `ctx.ui.notify`
- `--verbose`: include endpoint URLs, model counts, discovery source, and selected config values
- `--json`: output a JSON diagnostic object if Pi command output supports it; if not, show compact JSON in notification or skip this flag

## Diagnostic Result Shape
Add a testable result type:

```ts
export interface DiagnosticCheck {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail";
  message: string;
  details?: Record<string, unknown>;
}

export interface DoctorResult {
  ok: boolean;
  checks: DiagnosticCheck[];
}
```

Severity:
- `fail`: feature cannot work, for example OpenAI-compatible models endpoint unreachable
- `warn`: optional or degraded behavior, for example native API unavailable while OpenAI discovery works
- `pass`: check succeeded

## Endpoint Behavior
OpenAI models:
- Use existing `fetchLmStudioModels` or model-info helper
- Failure is `fail` because current extension requires this path unless metadata discovery feature changes the default

Native models:
- Use derived `nativeBaseUrl`
- Failure is `warn` unless a feature requiring native API is enabled

Timeouts:
- Use `fetchTimeoutMs` for quick diagnostics
- Each check should identify timeout separately

Auth:
- Include bearer token/header behavior consistent with discovery clients
- Never echo `apiKey`
- If 401/403 occurs, report likely auth/token issue

## Task List

### Task 1: Add Diagnostic Types and Formatting Helpers
**Description:** Define diagnostic check/result types and helpers for status summarization.

**Acceptance Criteria:**
- `summarizeDoctorResult` reports counts of pass/warn/fail
- `formatDoctorResult` produces concise default output
- Verbose formatter includes details without secrets
- JSON formatter omits or redacts secrets

**Verification:**
- Add unit tests for formatting
- Run `npm test`

**Dependencies:** None

**Files Likely Touched:**
- `src/index.ts`
- `test/index.test.ts`

**Estimated Scope:** Small

### Task 2: Implement Endpoint Probe Helpers
**Description:** Add pure-ish async helpers that probe OpenAI-compatible and native model endpoints.

**Acceptance Criteria:**
- OpenAI models check returns pass with model count on success
- OpenAI models check returns fail on network, timeout, non-OK, or malformed payload
- Native models check returns pass with available/loaded model counts on success
- Native models check returns warn on network, timeout, non-OK, or malformed payload by default
- 401/403 errors mention auth without exposing token

**Verification:**
- Mock fetch tests for success, timeout, 404, 401, malformed payload
- Run `npm test`

**Dependencies:** Task 1

**Files Likely Touched:**
- `src/index.ts`
- `test/index.test.ts`

**Estimated Scope:** Medium

### Task 3: Implement Provider Build Check
**Description:** Verify discovered model IDs can be converted into a valid Pi provider config.

**Acceptance Criteria:**
- Empty model list is warn or fail depending on existing behavior; use warn because Pi can still run but no local models are available
- Non-empty list produces pass
- Duplicate model IDs are reported as warn if duplicate handling exists
- Provider name, API mode, and base URL are included in verbose details

**Verification:**
- Unit tests for empty and non-empty discovered lists
- Run `npm test`

**Dependencies:** Task 1

**Files Likely Touched:**
- `src/index.ts`
- `test/index.test.ts`

**Estimated Scope:** Small

### Task 4: Add `runDoctor` Orchestrator
**Description:** Combine config warnings, endpoint checks, and provider checks into one result.

**Acceptance Criteria:**
- Config warnings become diagnostic warnings
- Checks are ordered from config to endpoint to provider
- One failed optional native check does not make `ok` false if OpenAI discovery works
- Any failed required check makes `ok` false
- The orchestrator accepts injected fetch for tests

**Verification:**
- Unit tests for all-pass, OpenAI fail, native warn only, config warning
- Run `npm test`

**Dependencies:** Tasks 1 through 3

**Files Likely Touched:**
- `src/index.ts`
- `test/index.test.ts`

**Estimated Scope:** Medium

### Task 5: Register `/lmstudio-doctor`
**Description:** Add the slash command and wire output to `ctx.ui.notify`.

**Acceptance Criteria:**
- `/lmstudio-doctor` runs checks using `ctx.cwd`
- `--verbose` shows more details
- `--json` is supported only if practical; otherwise document as future work and do not expose the flag
- Command catches unexpected errors and reports them as a warning
- No secrets are printed

**Verification:**
- Manual review command handler
- Run `npm run check`

**Dependencies:** Task 4

**Files Likely Touched:**
- `src/index.ts`

**Estimated Scope:** Small

### Task 6: Update README Troubleshooting
**Description:** Document the doctor command and map common failures to fixes.

**Acceptance Criteria:**
- README command list includes `/lmstudio-doctor`
- Troubleshooting section recommends doctor first
- Common failures include LM Studio offline, wrong URL, auth failure, no models, malformed response
- README does not require native API for basic discovery

**Verification:**
- Manual README review

**Dependencies:** Task 5

**Files Likely Touched:**
- `README.md`

**Estimated Scope:** Small

## Checkpoints
- After Task 2: endpoint probes are covered for success and failure cases
- After Task 4: orchestrator tests prove severity semantics
- After Task 6: `npm test` and `npm run check` pass

## Risks and Mitigations
| Risk | Impact | Mitigation |
| --- | --- | --- |
| Diagnostics become too noisy | Medium | Default output summarizes, verbose is opt-in |
| Doctor leaks auth token | High | Redact config details and add tests for redaction formatter |
| Native API unavailable creates false failure | Medium | Treat native API as warning unless a native-only feature is enabled |
| Active inference probe could load models unexpectedly | High | Keep doctor read-only by default |

## Manual Test Scenario
1. Run `/lmstudio-doctor` while LM Studio is offline
2. Confirm output identifies connection failure
3. Start LM Studio and run `/lmstudio-doctor`
4. Confirm OpenAI model endpoint passes
5. Configure a bad `baseUrl` and run `/lmstudio-doctor`
6. Confirm output points to wrong URL
7. Configure an API token requirement if available and test auth failure behavior

## Acceptance Criteria for the Whole Feature
- `/lmstudio-doctor` provides actionable diagnostics
- Endpoint checks are unit-tested
- Optional native API failure is not treated as fatal for current basic provider behavior
- Secrets are redacted
- README troubleshooting is updated
- `npm test` passes
- `npm run check` passes
