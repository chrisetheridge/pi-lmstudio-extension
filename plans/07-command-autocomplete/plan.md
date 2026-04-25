# Implementation Plan: Command Autocomplete

## Overview
Add argument autocomplete for LM Studio extension commands so users can quickly select model IDs and instance IDs. Pi supports command argument completions through `getArgumentCompletions`, and this extension can use cached discovery/native model data to provide completions without blocking the UI on every keystroke.

## Current Repo Context
- Main implementation: `src/index.ts`
- Current commands:
  - `/lmstudio-refresh`
  - `/lmstudio-status`
- Future or related commands from other plans:
  - `/lmstudio-load <model>`
  - `/lmstudio-unload <instance-id>`
  - `/lmstudio-loaded`
  - `/lmstudio-models`
  - `/lmstudio-doctor`
- Current code does not import `AutocompleteItem`
- Current model cache is only `lastResult`

## Goals
- Add completions for model IDs and loaded instance IDs
- Use cached data for fast synchronous completions where Pi requires sync completions
- Optionally refresh cache opportunistically through existing refresh/model-list flows
- Keep autocomplete feature useful even if model management commands are not implemented yet

## Non-Goals
- Do not perform network requests on every autocomplete call
- Do not build a custom picker UI
- Do not require native API support for completions of current `/lmstudio-refresh` or `/lmstudio-status`
- Do not implement command aliases unless separately requested

## Pi API Context
Pi command registration supports:

```ts
getArgumentCompletions: (prefix: string) => AutocompleteItem[] | null
```

Autocomplete items have at least:

```ts
{
  value: string;
  label: string;
}
```

Confirm exact import path before coding. Existing docs show `AutocompleteItem` imported from `@mariozechner/pi-tui`.

## Proposed Cache
Inside extension closure track:

```ts
interface CompletionCache {
  discoveredModelIds: string[];
  nativeModels: Array<{
    key: string;
    displayName: string;
    type: "llm" | "embedding" | "unknown";
    loadedInstanceIds: string[];
  }>;
  updatedAt?: number;
}
```

Population:
- On successful refresh, update `discoveredModelIds`
- If native model list helpers exist, update `nativeModels` when `/lmstudio-models`, `/lmstudio-loaded`, `/lmstudio-load`, or `/lmstudio-unload` runs
- If native model list helpers do not exist yet, autocomplete only discovered model IDs for commands that need model IDs

Staleness:
- Do not block autocomplete to refresh stale cache
- Add `/lmstudio-refresh` or `/lmstudio-models` guidance in README if completions appear stale

## Completion Rules

### Model ID Completions
Use for:
- `/lmstudio-load`
- Future commands accepting model IDs

Source preference:
1. Native model keys from cache, because they include unloaded available models
2. Discovered model IDs from last refresh

Filter:
- Case-insensitive substring match against value and label
- Sort loaded models first if native loaded state is known
- Limit to a reasonable number, for example 20

### Loaded Instance ID Completions
Use for:
- `/lmstudio-unload`

Source:
- Native loaded instance IDs from cache

Fallback:
- If no native cache exists, return `null` rather than stale guessed completions

### Flag Completions
Use for:
- `/lmstudio-load`

Suggested flags:
- `--context-length`
- `--flash-attention`
- `--eval-batch-size`
- `--num-experts`
- `--offload-kv-cache-to-gpu`

Behavior:
- If prefix starts with `--`, suggest flags
- If the previous token is a boolean flag, suggest `true` and `false`
- Otherwise suggest model IDs

## Task List

### Task 1: Confirm Autocomplete Types
**Description:** Inspect Pi examples and type exports to confirm `AutocompleteItem` import path and command option shape.

**Acceptance Criteria:**
- Correct type import is used
- `npm run check` passes after adding typed completions
- If the type is not exported, use structural typing locally without adding a dependency

**Verification:**
- Run `npm run check`

**Dependencies:** None

**Files Likely Touched:**
- `src/index.ts`

**Estimated Scope:** Small

### Task 2: Add Completion Cache Helpers
**Description:** Add pure helpers to store and query discovered model IDs and native model metadata.

**Acceptance Criteria:**
- Cache can be updated from `RefreshResult`
- Cache can be updated from native model list results if those helpers exist
- Duplicate model IDs are removed
- Results are sorted deterministically

**Verification:**
- Add unit tests for cache update and deduplication
- Run `npm test`

**Dependencies:** None

**Files Likely Touched:**
- `src/index.ts`
- `test/index.test.ts`

**Estimated Scope:** Small

### Task 3: Implement Completion Filtering
**Description:** Implement model, instance, and flag completion functions.

**Acceptance Criteria:**
- Prefix filtering is case-insensitive
- Empty prefix returns the top sorted suggestions
- Results are limited to a safe max count
- Labels include display names when available
- Loaded model suggestions can be labeled or sorted first when known
- Boolean flags suggest `true` and `false`

**Verification:**
- Add unit tests for filtering, sorting, labels, max result count, and flag behavior
- Run `npm test`

**Dependencies:** Task 2

**Files Likely Touched:**
- `src/index.ts`
- `test/index.test.ts`

**Estimated Scope:** Medium

### Task 4: Wire Completions to Existing Commands
**Description:** Add completions where immediately useful, even before model management commands exist.

**Acceptance Criteria:**
- `/lmstudio-refresh` and `/lmstudio-status` do not expose irrelevant completions
- If a command accepts no args, it should omit `getArgumentCompletions`
- Existing commands continue to work unchanged

**Verification:**
- Run `npm run check`

**Dependencies:** Task 1

**Files Likely Touched:**
- `src/index.ts`

**Estimated Scope:** Small

### Task 5: Wire Completions to Model Management Commands
**Description:** If Feature 3 has been implemented, attach completions to load/unload/model commands.

**Acceptance Criteria:**
- `/lmstudio-load` suggests model IDs or native model keys
- `/lmstudio-load --` suggests supported flags
- `/lmstudio-load --flash-attention ` suggests `true` and `false`
- `/lmstudio-unload` suggests loaded instance IDs
- Completions return `null` when cache is empty instead of throwing

**Verification:**
- Typecheck command registrations
- Unit-test completion functions rather than command internals
- Manual test in Pi command prompt

**Dependencies:** Tasks 1 through 3, and Feature 3 if commands exist

**Files Likely Touched:**
- `src/index.ts`

**Estimated Scope:** Medium

### Task 6: Keep Cache Fresh
**Description:** Update completion cache after refresh, native model list, load, and unload operations.

**Acceptance Criteria:**
- Successful `/lmstudio-refresh` updates discovered model completions
- Successful native model list updates model and loaded instance completions
- Successful load/unload updates cache by re-fetching native model list if Feature 3 exists
- Failed operations do not clear the last good cache unless explicitly desired

**Verification:**
- Unit tests for cache behavior on success and failure
- Manual test with LM Studio if model management commands exist
- Run `npm test`

**Dependencies:** Tasks 2 and 5

**Files Likely Touched:**
- `src/index.ts`
- `test/index.test.ts`

**Estimated Scope:** Small

### Task 7: Update README
**Description:** Document autocomplete behavior and staleness.

**Acceptance Criteria:**
- README mentions model and instance completions
- README explains completions are based on cached refresh/list data
- README tells users to run `/lmstudio-refresh` or `/lmstudio-models` if completions are stale

**Verification:**
- Manual README review

**Dependencies:** Tasks 5 and 6

**Files Likely Touched:**
- `README.md`

**Estimated Scope:** Small

## Checkpoints
- After Task 3: autocomplete helper tests pass
- After Task 5: command registrations typecheck
- After Task 7: `npm test` and `npm run check` pass

## Risks and Mitigations
| Risk | Impact | Mitigation |
| --- | --- | --- |
| Autocomplete API is synchronous | Medium | Use cached data only; do not fetch in completion callback |
| Cache becomes stale | Low | Keep last good cache and document refresh behavior |
| Model management commands are not implemented yet | Low | Implement helpers now, wire load/unload completions conditionally when commands exist |
| Large model lists clutter completions | Low | Limit result count and filter by substring |

## Manual Test Scenario
1. Start Pi with the extension
2. Run `/lmstudio-refresh`
3. Type `/lmstudio-load ` and confirm model suggestions appear if load command exists
4. Type `/lmstudio-load --` and confirm flag suggestions appear
5. Type `/lmstudio-unload ` and confirm loaded instance suggestions appear if native cache exists
6. Load or unload a model, then confirm completions update after the command completes

## Acceptance Criteria for the Whole Feature
- Completion helpers are tested
- Command registrations typecheck
- Completions are fast and cache-backed
- Empty cache returns `null`, not errors
- README documents staleness behavior
- `npm test` passes
- `npm run check` passes
