# Implementation Plan: OpenAI Responses Provider Mode

## Overview
Add an explicit provider API mode so users can register LM Studio models through Pi's `openai-responses` integration instead of always using `openai-completions`. LM Studio documents `POST /v1/responses` as supported and specifically calls it out for Codex-style clients, so this extension should expose it as a configurable provider mode while preserving the current default unless the maintainer chooses a breaking default change.

## Current Repo Context
- Main implementation: `src/index.ts`
- Current provider API: `api: "openai-completions"` at provider and model levels
- Current compatibility object: `LOCAL_OPENAI_COMPAT` is tailored for OpenAI chat/completions behavior
- Current config has no API mode setting
- Pi docs in `node_modules/@mariozechner/pi-coding-agent/docs/extensions.md` list `openai-responses` as a supported provider API type

## External API Context
- LM Studio OpenAI-compatible endpoints include:
  - `GET /v1/models`
  - `POST /v1/responses`
  - `POST /v1/chat/completions`
  - `POST /v1/embeddings`
  - `POST /v1/completions`
- LM Studio docs state Codex is supported because LM Studio implements `POST /v1/responses`
- LM Studio changelog notes `/v1/responses` supports stateful interactions, custom tool calling, remote MCP opt-in, reasoning effort for some models, and SSE streaming

## Goals
- Let users opt into Pi `openai-responses` mode for LM Studio
- Keep `openai-completions` mode working
- Keep config naming clear and forward-compatible
- Avoid adding custom streaming in this plan

## Non-Goals
- Do not migrate all users to responses by default unless explicitly decided
- Do not implement native `/api/v1/chat`
- Do not implement Anthropic-compatible `/v1/messages`
- Do not add MCP configuration for LM Studio responses mode

## Proposed Design

### Config
Extend `LmStudioConfig`:

```ts
api: "openai-completions" | "openai-responses";
responsesReasoningEffort: boolean;
```

Defaults:
- Conservative default: `api: "openai-completions"` to avoid changing existing behavior
- `responsesReasoningEffort: false`

Alternative maintainer decision:
- If this extension is still pre-release and there is no compatibility concern, default to `openai-responses` because LM Studio docs call it out for Codex support

### Provider Config Mapping
In `buildProviderConfig`, use `config.api` for:
- Provider-level `api`
- Model-level `api`

Compatibility:
- Keep `compat` only for `openai-completions` unless Pi types allow and require the same object for responses
- For `openai-responses`, omit completions-specific compat fields by default
- If `responsesReasoningEffort` is true and model reasoning is enabled, set `compat.supportsReasoningEffort` only if Pi applies that compat field to responses mode; verify against Pi types before implementation

### Validation
`coercePartialConfig` should accept only exact supported values. Invalid API values should be ignored and a warning should ideally be emitted. If warning plumbing is too invasive, ignore invalid values silently for consistency with current config coercion.

### Documentation
README should explain:
- `api: "openai-completions"` is the existing chat-completions compatible mode
- `api: "openai-responses"` uses LM Studio's `/v1/responses` endpoint through Pi
- When to prefer responses mode
- How to configure it globally or per project

Example:

```json
{
  "lmstudio": {
    "api": "openai-responses",
    "reasoning": true
  }
}
```

## Task List

### Task 1: Confirm Pi API Type Support
**Description:** Inspect `@mariozechner/pi-coding-agent` exported types or docs to confirm the exact string literal and whether `ProviderModelConfig.compat` applies to `openai-responses`.

**Acceptance Criteria:**
- Implementation uses the exact supported API literal
- TypeScript compile confirms the provider config is valid
- Any responses-specific compat assumptions are documented in comments or avoided

**Verification:**
- Run `npm run check`

**Dependencies:** None

**Files Likely Touched:**
- `src/index.ts`

**Estimated Scope:** Small

### Task 2: Add Config Field and Coercion
**Description:** Add `api` to `LmStudioConfig`, defaults, merge logic, and settings parsing.

**Acceptance Criteria:**
- `DEFAULT_CONFIG.api` is defined
- Global and project settings can override `api`
- Project settings override global settings
- Invalid string values do not break config loading
- Existing config tests are updated

**Verification:**
- Add `mergeConfig` and `loadConfigFromSettings` tests
- Run `npm test`

**Dependencies:** Task 1

**Files Likely Touched:**
- `src/index.ts`
- `test/index.test.ts`

**Estimated Scope:** Small

### Task 3: Update Provider Config Builder
**Description:** Use the configured API mode when registering provider and model definitions.

**Acceptance Criteria:**
- `buildProviderConfig(mergeConfig({ api: "openai-responses" }), ["model"])` returns provider and model entries with `api: "openai-responses"`
- `openai-completions` mode retains the current compatibility settings
- `openai-responses` mode does not include chat-completions-only compat settings unless explicitly verified as valid
- Existing model registration behavior remains unchanged for default config

**Verification:**
- Add tests for both API modes
- Run `npm test`
- Run `npm run check`

**Dependencies:** Task 2

**Files Likely Touched:**
- `src/index.ts`
- `test/index.test.ts`

**Estimated Scope:** Small

### Task 4: Update Commands and Status Output
**Description:** Include the active API mode in `/lmstudio-status` so users can tell which LM Studio endpoint Pi will use for inference.

**Acceptance Criteria:**
- `/lmstudio-status` notification includes provider name, base URL, API mode, and last refresh state
- Output remains one notification line unless warnings exist
- Refresh behavior is unchanged

**Verification:**
- Add unit coverage only if command handlers are already easy to test; otherwise manually review handler output
- Run `npm run check`

**Dependencies:** Task 3

**Files Likely Touched:**
- `src/index.ts`

**Estimated Scope:** Small

### Task 5: Update README
**Description:** Document provider API mode and explain the tradeoff between completions and responses.

**Acceptance Criteria:**
- Settings reference includes `api`
- Example config shows how to enable `openai-responses`
- Troubleshooting mentions switching modes if tool calling or Codex-like flows behave poorly
- README does not claim responses mode is universally better

**Verification:**
- Manual README review

**Dependencies:** Tasks 2 through 4

**Files Likely Touched:**
- `README.md`

**Estimated Scope:** Small

## Checkpoints
- After Task 2: config tests pass
- After Task 3: provider config tests cover both API modes
- After Task 5: `npm test` and `npm run check` pass

## Risks and Mitigations
| Risk | Impact | Mitigation |
| --- | --- | --- |
| Pi's `openai-responses` behavior differs from expectations | Medium | Keep opt-in default and validate with TypeScript plus manual local LM Studio test |
| Compat fields are invalid for responses mode | Low | Omit completions-specific compat for responses mode unless verified |
| Changing default breaks users | Medium | Keep default as `openai-completions` unless maintainer approves default change |

## Manual Test Scenario
1. Start LM Studio server on `http://localhost:1234`
2. Configure project `.pi/settings.json` with `api: "openai-responses"`
3. Run `pi -e /path/to/extension/pi-extension-lmstudio --list-models local`
4. Select a local model in Pi and send a simple prompt
5. Confirm LM Studio receives a `/v1/responses` request if server logs expose request paths

## Acceptance Criteria for the Whole Feature
- Users can opt into `openai-responses`
- Default behavior remains compatible
- Unit tests cover config and provider output
- README explains mode selection
- `npm test` passes
- `npm run check` passes

## References
- LM Studio OpenAI-compatible endpoints: https://lmstudio.ai/docs/developer/openai-compat
- LM Studio API changelog for `/v1/responses`: https://lmstudio.ai/docs/developer/api-changelog
- Pi custom provider docs: `node_modules/@mariozechner/pi-coding-agent/docs/custom-provider.md`
