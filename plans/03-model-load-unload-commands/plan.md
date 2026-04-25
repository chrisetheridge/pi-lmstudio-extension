# Implementation Plan: Model Load and Unload Commands

## Overview
Add Pi slash commands that manage LM Studio models through the native REST API. This turns the extension from passive model discovery into an operational model manager: users can list available models, load a model with optional runtime settings, unload a loaded instance, and refresh Pi registration afterward.

## Current Repo Context
- Main implementation: `src/index.ts`
- Current commands:
  - `/lmstudio-refresh`
  - `/lmstudio-status`
- Current config only targets OpenAI-compatible `baseUrl`, usually `http://localhost:1234/v1`
- There is no native API base URL helper yet
- Refresh currently discovers models through `GET <baseUrl>/models`

## External API Context
- Native list endpoint: `GET /api/v1/models`
- Native load endpoint: `POST /api/v1/models/load`
- Native unload endpoint: `POST /api/v1/models/unload`
- Load request body:
  - `model` required
  - `context_length` optional
  - `eval_batch_size` optional
  - `flash_attention` optional
  - `num_experts` optional
  - `offload_kv_cache_to_gpu` optional
  - `echo_load_config` optional
- Load response includes `type`, `instance_id`, `load_time_seconds`, `status`, and optionally `load_config`
- Unload request body:
  - `instance_id` required
- Unload response includes `instance_id`

## Goals
- Add slash commands for native LM Studio model lifecycle operations
- Keep command behavior safe and explicit
- Reuse existing timeout and config patterns
- Refresh provider registration after successful load/unload when appropriate

## Non-Goals
- Do not implement model download in this plan
- Do not implement streaming native chat
- Do not implement a custom TUI picker; use command args and notifications
- Do not implement long-running progress streaming unless LM Studio endpoint already returns quickly enough

## Proposed Commands

### `/lmstudio-models`
List available local models from `GET /api/v1/models`.

Output should include:
- model key
- display name
- type
- loaded instance IDs
- context length or max context
- vision/tool-use flags when present

Keep output concise in notifications. If output could be long, either:
- show first N models and mention count, or
- use a custom UI only if the repo already has examples and it remains low-risk

### `/lmstudio-load <model> [options]`
Load a model by native model key.

Initial options to support:
- `--context-length <number>`
- `--flash-attention true|false`
- `--eval-batch-size <number>`
- `--num-experts <number>`
- `--offload-kv-cache-to-gpu true|false`

Always send `echo_load_config: true` so the response can be reported.

After successful load:
- Notify instance ID and load time
- Call existing refresh path so Pi sees the newly loaded model if needed

### `/lmstudio-unload <instance-id>`
Unload a loaded model instance.

After successful unload:
- Notify unloaded instance ID
- Call refresh path

### `/lmstudio-loaded`
List loaded model instances only.

This can be implemented by filtering `GET /api/v1/models` for non-empty `loaded_instances`.

## Config
Extend `LmStudioConfig`:

```ts
nativeBaseUrl?: string;
modelManagementTimeoutMs: number;
```

Defaults:
- `nativeBaseUrl`: derive from `baseUrl`
- `modelManagementTimeoutMs`: 120000 because loading models can take much longer than model discovery

Do not reuse `fetchTimeoutMs` for load operations unless the maintainer explicitly wants short timeouts.

## Helper Functions
Add testable helpers:
- `deriveNativeBaseUrl(baseUrl: string): string`
- `fetchNativeModels(config, fetchImpl): Promise<NativeModel[]>`
- `loadLmStudioModel(config, request, fetchImpl): Promise<LoadModelResult>`
- `unloadLmStudioModel(config, instanceId, fetchImpl): Promise<UnloadModelResult>`
- `parseLoadArgs(args: string): LoadModelCommandArgs`
- `parseBooleanArg(value: string): boolean | undefined`

Implementation details:
- Use `AbortController` and timeout for all native requests
- Include `Authorization: Bearer <apiKey>` if the existing `apiKey` is non-empty; LM Studio may ignore it by default but native API can be token-protected
- Include `Content-Type: application/json` for POST
- Treat non-OK responses as errors with status and status text
- Parse error bodies opportunistically but do not depend on a specific error shape

## Task List

### Task 1: Add Native API URL and Timeout Config
**Description:** Add config fields and URL derivation needed by native model management endpoints.

**Acceptance Criteria:**
- `nativeBaseUrl` derives from `baseUrl`
- Explicit `nativeBaseUrl` setting is honored
- `modelManagementTimeoutMs` is validated as a positive number
- Defaults are documented in tests

**Verification:**
- Add unit tests for config merging and URL derivation
- Run `npm test`

**Dependencies:** None

**Files Likely Touched:**
- `src/index.ts`
- `test/index.test.ts`

**Estimated Scope:** Small

### Task 2: Add Native Model List Client
**Description:** Implement `GET /api/v1/models` client and parser.

**Acceptance Criteria:**
- Parses available models and loaded instances
- Handles malformed payloads with useful errors
- Applies timeout
- Sends auth header consistently

**Verification:**
- Add tests for successful model list, malformed response, non-OK response, and timeout
- Run `npm test`

**Dependencies:** Task 1

**Files Likely Touched:**
- `src/index.ts`
- `test/index.test.ts`

**Estimated Scope:** Medium

### Task 3: Add Load and Unload Clients
**Description:** Implement native POST clients for model load and unload operations.

**Acceptance Criteria:**
- Load sends required `model` and optional load settings
- Load always sends `echo_load_config: true`
- Unload sends required `instance_id`
- Non-OK responses include useful error text
- Timeout errors identify which operation timed out

**Verification:**
- Add tests for request body shape, headers, success parsing, non-OK response, and timeout
- Run `npm test`

**Dependencies:** Task 1

**Files Likely Touched:**
- `src/index.ts`
- `test/index.test.ts`

**Estimated Scope:** Medium

### Task 4: Implement Command Argument Parsing
**Description:** Add deterministic parser for command arguments without adding a heavy dependency.

**Acceptance Criteria:**
- `/lmstudio-load model-key` parses model key
- Quoted model keys are supported if existing command args preserve quotes; if not, document limitation
- Supported flags parse into the expected native request fields
- Unknown flags produce a user-facing warning instead of being ignored silently
- Numeric flags reject non-positive or non-numeric values

**Verification:**
- Add unit tests for valid args, invalid args, and boolean parsing
- Run `npm test`

**Dependencies:** None

**Files Likely Touched:**
- `src/index.ts`
- `test/index.test.ts`

**Estimated Scope:** Medium

### Task 5: Register Commands
**Description:** Add `/lmstudio-models`, `/lmstudio-loaded`, `/lmstudio-load`, and `/lmstudio-unload`.

**Acceptance Criteria:**
- Commands use `loadConfigFromSettings(ctx.cwd)`
- Commands report settings warnings before operation result
- Load and unload refresh provider registration after success
- Errors are caught and shown via `ctx.ui.notify(..., "warning")`
- No command throws uncaught errors during normal failure cases

**Verification:**
- Add command-handler tests if practical by invoking exported helper functions; otherwise keep command logic thin and covered through helpers
- Run `npm run check`
- Manual test against local LM Studio

**Dependencies:** Tasks 1 through 4

**Files Likely Touched:**
- `src/index.ts`

**Estimated Scope:** Medium

### Task 6: Add README Documentation
**Description:** Document model management commands, config, examples, and safety behavior.

**Acceptance Criteria:**
- README lists all new commands
- README shows load examples with context length and flash attention
- README explains native API base URL derivation
- README notes that load can take longer than discovery and uses `modelManagementTimeoutMs`

**Verification:**
- Manual README review
- Run `npm run check`

**Dependencies:** Task 5

**Files Likely Touched:**
- `README.md`

**Estimated Scope:** Small

## Checkpoints
- After Task 3: native clients are fully unit-tested
- After Task 5: command registration compiles and manual command paths are clear
- After Task 6: `npm test` and `npm run check` pass

## Risks and Mitigations
| Risk | Impact | Mitigation |
| --- | --- | --- |
| Loading can exceed short timeouts | High | Add separate `modelManagementTimeoutMs` defaulting to a much larger value |
| Native API requires auth token | Medium | Send bearer token when `apiKey` is set and document it |
| Long command output is hard to read | Medium | Keep notifications summarized and add filters such as loaded-only |
| Command arg parsing mishandles model names with spaces | Medium | Prefer model keys, document quoting behavior, and add autocomplete in Feature 7 |

## Manual Test Scenario
1. Start LM Studio and ensure native API is enabled
2. Run `/lmstudio-models`
3. Run `/lmstudio-load <model-key> --context-length 4096 --flash-attention true`
4. Confirm success notification includes instance ID
5. Run `/lmstudio-loaded`
6. Run `/lmstudio-unload <instance-id>`
7. Run `/lmstudio-refresh`
8. Confirm Pi model list reflects the current LM Studio state

## Acceptance Criteria for the Whole Feature
- Native list/load/unload helpers are covered by tests
- Commands do not crash Pi when LM Studio is offline or returns errors
- Successful load/unload operations refresh provider registration
- README contains usable examples
- `npm test` passes
- `npm run check` passes

## References
- LM Studio native REST API: https://lmstudio.ai/docs/developer/rest
- LM Studio model list endpoint: https://lmstudio.ai/docs/developer/rest/list
- LM Studio load endpoint: https://lmstudio.ai/docs/developer/rest/load
- LM Studio unload endpoint: https://lmstudio.ai/docs/developer/rest/unload
