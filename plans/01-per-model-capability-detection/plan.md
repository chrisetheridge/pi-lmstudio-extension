# Implementation Plan: Per-Model Capability Detection

## Overview
Enhance discovery so each LM Studio model is registered with capabilities derived from LM Studio metadata instead of applying one shared capability profile to every model. The implementation should preserve the current `/v1/models` behavior as a fallback, and optionally use LM Studio native `GET /api/v1/models` when available because it exposes richer fields such as model type, loaded instances, context length, vision support, and tool-use training.

## Current Repo Context
- Main implementation: `src/index.ts`
- Tests: `test/index.test.ts`
- Current discovery path: `fetchLmStudioModels(baseUrl)` calls `GET <baseUrl>/models`
- Current parser: `parseModelsPayload(payload)` returns `string[]`
- Current provider builder: `buildProviderConfig(config, modelIds)` applies the same `reasoning`, `input`, `contextWindow`, `maxTokens`, and `compat` values to every model
- Current default config supports only provider-wide settings

## External API Context
- LM Studio OpenAI-compatible endpoint: `GET /v1/models`
- LM Studio native endpoint: `GET /api/v1/models`
- Native model fields include `type`, `key`, `display_name`, `loaded_instances`, `max_context_length`, and `capabilities`
- Native capabilities include `vision` and `trained_for_tool_use`
- Native loaded instance config includes `context_length`

## Goals
- Register model-specific Pi capabilities where metadata is available
- Keep existing users working if only `/v1/models` is available
- Keep provider registration deterministic and testable
- Avoid overfitting to a single LM Studio response shape; unknown fields should be preserved only for diagnostics, not required

## Non-Goals
- Do not implement load/unload commands in this plan
- Do not add embeddings provider registration in this plan
- Do not implement custom streaming
- Do not require LM Studio 0.4.x; native API support should be optional

## Proposed Design

### Types
Introduce an internal model descriptor type:

```ts
export interface LmStudioModelInfo {
  id: string;
  name: string;
  type: "llm" | "embedding" | "unknown";
  input: ModelInput[];
  reasoning?: boolean;
  toolUse?: boolean;
  contextWindow?: number;
  maxTokens?: number;
  loaded: boolean;
  loadedInstanceIds: string[];
  source: "openai" | "native";
}
```

Keep `ModelInput` as `"text" | "image"`.

### Config
Extend `LmStudioConfig`:

```ts
modelMetadataSource: "auto" | "openai" | "native";
nativeBaseUrl?: string;
includeEmbeddingModels: boolean;
```

Defaults:
- `modelMetadataSource: "auto"`
- `nativeBaseUrl`: derived from `baseUrl` by replacing trailing `/v1` with `/api/v1`
- `includeEmbeddingModels: false`

### Fetch Strategy
Create these functions:
- `deriveNativeBaseUrl(baseUrl: string): string`
- `parseOpenAiModelsPayload(payload: unknown): LmStudioModelInfo[]`
- `parseNativeModelsPayload(payload: unknown): LmStudioModelInfo[]`
- `fetchOpenAiModels(config, fetchImpl): Promise<LmStudioModelInfo[]>`
- `fetchNativeModels(config, fetchImpl): Promise<LmStudioModelInfo[]>`
- `fetchLmStudioModelInfo(config, fetchImpl): Promise<LmStudioModelInfo[]>`

Behavior:
- If `modelMetadataSource` is `"native"`, use native endpoint only and return its parsed models
- If `"openai"`, use current `/v1/models` endpoint only
- If `"auto"`, try native endpoint first; if it fails due to network, 404, 401, or malformed payload, log a warning and fall back to OpenAI-compatible `/v1/models`
- Preserve the existing `fetchLmStudioModels(baseUrl, fetchImpl, timeoutMs): Promise<string[]>` export as a compatibility wrapper that returns IDs from `fetchOpenAiModels`

### Native Mapping Rules
- Use `key` as model ID when `type === "llm"`
- Use `display_name` as display name when present, otherwise use `key`
- Ignore `type === "embedding"` unless `includeEmbeddingModels` is true
- Set `input` to `["text", "image"]` when `capabilities.vision === true`; otherwise `["text"]`
- Set `toolUse` from `capabilities.trained_for_tool_use === true`
- Set `contextWindow` from the first loaded instance config `context_length` if available, otherwise `max_context_length`, otherwise provider default
- Set `loaded` to whether `loaded_instances.length > 0`
- Set `loadedInstanceIds` from `loaded_instances[].id`
- Do not infer `reasoning` from `trained_for_tool_use`; reasoning remains provider/default/override-driven until there is a reliable metadata source

### OpenAI Mapping Rules
- Use `id` for both `id` and `name`
- If an entry contains `capabilities`, handle both array and object shapes defensively
- For array shape, map known values:
  - `"vision"` or `"image_input"` means `input: ["text", "image"]`
  - `"tool_use"` means `toolUse: true`
- Defaults remain provider-level values

### Provider Registration
Change `buildProviderConfig` to accept model info:

```ts
export function buildProviderConfig(config: LmStudioConfig, models: LmStudioModelInfo[]): ProviderConfig
```

Add a compatibility helper or overload for existing string arrays if useful for test churn:

```ts
function modelIdToInfo(id: string): LmStudioModelInfo
```

Model fields:
- `id`: model info ID
- `name`: model info name
- `input`: model-specific input if present, otherwise config input
- `reasoning`: model-specific reasoning if set, otherwise config reasoning
- `contextWindow`: model-specific context window if valid, otherwise config contextWindow
- `maxTokens`: model-specific max tokens if valid, otherwise config maxTokens
- `compat`: current local OpenAI compat object
- `cost`: zero cost

### Status/Diagnostics
Do not add a full doctor command here, but enhance `/lmstudio-status` minimally:
- Include metadata source used by the last successful refresh
- Include whether native discovery fell back to OpenAI discovery
- Keep notification short

## Task List

### Task 1: Add Model Metadata Types and Config
**Description:** Add `LmStudioModelInfo`, metadata source config, and native base URL derivation while preserving existing defaults.

**Acceptance Criteria:**
- `mergeConfig()` returns defaults with `modelMetadataSource: "auto"` and `includeEmbeddingModels: false`
- `nativeBaseUrl` is derived correctly from `http://localhost:1234/v1` to `http://localhost:1234/api/v1`
- Explicit `nativeBaseUrl` in settings is honored and trailing slashes are normalized
- Invalid metadata source values are ignored during config coercion

**Verification:**
- Add unit tests in `test/index.test.ts`
- Run `npm test`
- Run `npm run check`

**Dependencies:** None

**Files Likely Touched:**
- `src/index.ts`
- `test/index.test.ts`
- `README.md`

**Estimated Scope:** Medium

### Task 2: Implement OpenAI-Compatible Model Info Parser
**Description:** Replace the string-only parsing path with a model-info parser that can still return plain IDs through the existing exported wrapper.

**Acceptance Criteria:**
- Existing `parseModelsPayload` tests continue to pass or are replaced by equivalent tests for compatibility behavior
- Empty/malformed entries are ignored
- A valid OpenAI-compatible response produces `LmStudioModelInfo[]`
- Capabilities, when present, are parsed defensively without throwing on unknown shapes

**Verification:**
- Add parser tests for plain model IDs and capability-bearing entries
- Run `npm test`

**Dependencies:** Task 1

**Files Likely Touched:**
- `src/index.ts`
- `test/index.test.ts`

**Estimated Scope:** Small

### Task 3: Implement Native Model Parser
**Description:** Parse LM Studio native `GET /api/v1/models` responses into model descriptors.

**Acceptance Criteria:**
- LLM models are included by default
- Embedding models are excluded by default
- Embedding models are included when `includeEmbeddingModels` is true, but they are not registered as chat models unless explicitly intended by follow-up work
- Vision models map to `input: ["text", "image"]`
- Loaded instance IDs and context length are captured
- Missing optional fields do not throw

**Verification:**
- Add tests using sample native payloads with LLM, embedding, loaded instance, vision, and tool-use metadata
- Run `npm test`

**Dependencies:** Task 1

**Files Likely Touched:**
- `src/index.ts`
- `test/index.test.ts`

**Estimated Scope:** Medium

### Task 4: Implement Fetch Strategy and Fallback
**Description:** Add native/OpenAI/auto discovery behavior with timeout handling and fallback logging.

**Acceptance Criteria:**
- `modelMetadataSource: "native"` calls only native endpoint
- `modelMetadataSource: "openai"` calls only OpenAI-compatible endpoint
- `modelMetadataSource: "auto"` tries native first, then falls back to OpenAI-compatible discovery on failure
- Timeout behavior applies to both endpoints
- The refresh result includes enough metadata to report which source was used

**Verification:**
- Mock fetch tests for native success, native failure fallback, forced OpenAI mode, forced native failure
- Run `npm test`

**Dependencies:** Tasks 2 and 3

**Files Likely Touched:**
- `src/index.ts`
- `test/index.test.ts`

**Estimated Scope:** Medium

### Task 5: Update Provider Registration
**Description:** Feed model descriptors into provider registration so Pi receives model-specific capabilities.

**Acceptance Criteria:**
- `buildProviderConfig` uses per-model `input`, `contextWindow`, and display name when available
- Provider defaults still apply when metadata is missing
- Existing behavior for simple `/v1/models` payloads remains unchanged from the user's perspective
- No duplicate model IDs are registered

**Verification:**
- Add tests for native vision model registration
- Add tests for fallback default values
- Run `npm test`
- Run `npm run check`

**Dependencies:** Tasks 2 through 4

**Files Likely Touched:**
- `src/index.ts`
- `test/index.test.ts`

**Estimated Scope:** Medium

### Task 6: Update README and Status Output
**Description:** Document metadata discovery behavior and lightly enhance `/lmstudio-status`.

**Acceptance Criteria:**
- README documents `modelMetadataSource`, `nativeBaseUrl`, and `includeEmbeddingModels`
- README explains native API fallback behavior
- `/lmstudio-status` reports the last discovery source without becoming verbose

**Verification:**
- Manual review of README examples
- Run `npm run check`

**Dependencies:** Tasks 1 through 5

**Files Likely Touched:**
- `README.md`
- `src/index.ts`

**Estimated Scope:** Small

## Checkpoints
- After Tasks 1-3: parser and config tests pass
- After Tasks 4-5: `npm test` and `npm run check` pass
- After Task 6: README matches implemented config names and defaults

## Risks and Mitigations
| Risk | Impact | Mitigation |
| --- | --- | --- |
| Native API response shape changes | Medium | Parse defensively, treat optional fields as optional, keep OpenAI fallback |
| Registering embedding models as chat models | Medium | Keep `includeEmbeddingModels` default false and document that full embeddings support is out of scope |
| Incorrect reasoning inference | Medium | Do not infer reasoning from model names or tool-use metadata in this plan |
| Breaking exported API used by tests or users | Low | Preserve `fetchLmStudioModels` and `parseModelsPayload` compatibility wrappers if possible |

## Acceptance Criteria for the Whole Feature
- Existing simple discovery behavior still works
- Native discovery enriches model registration when available
- Unit tests cover both native and OpenAI-compatible payloads
- `npm test` passes
- `npm run check` passes
- README documents new settings and fallback behavior

## References
- LM Studio native REST API: https://lmstudio.ai/docs/developer/rest
- LM Studio model list endpoint: https://lmstudio.ai/docs/developer/rest/list
- LM Studio OpenAI-compatible endpoints: https://lmstudio.ai/docs/developer/openai-compat
