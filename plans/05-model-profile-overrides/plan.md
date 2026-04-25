# Implementation Plan: Model Profile Overrides

## Overview
Add per-model override rules so users can fix or tune capabilities for specific local models without changing provider-wide defaults. This is important for local models because capability metadata can be incomplete or inconsistent, and model names often encode useful traits such as vision, Qwen thinking, GPT-OSS reasoning, or special context sizes.

## Current Repo Context
- Main implementation: `src/index.ts`
- Current config applies provider-wide values:
  - `reasoning`
  - `input`
  - `contextWindow`
  - `maxTokens`
  - `fetchTimeoutMs`
- Current provider builder accepts model IDs and assigns the same profile to every model
- No per-model configuration exists

## Goals
- Allow exact and regex-like model overrides
- Keep override behavior deterministic and documented
- Avoid unsafe arbitrary regex execution patterns where possible
- Support capability fields Pi already understands
- Work with both current string-based discovery and future metadata-rich discovery

## Non-Goals
- Do not auto-detect all capabilities from model names in this plan
- Do not create a UI editor for overrides
- Do not implement embeddings provider support
- Do not implement custom streaming or custom request mutation

## Proposed Config
Extend `LmStudioConfig`:

```ts
modelOverrides: ModelOverrideRule[];
```

Define:

```ts
export interface ModelOverrideRule {
  match: string;
  matchType: "exact" | "prefix" | "suffix" | "contains" | "regex";
  name?: string;
  reasoning?: boolean;
  input?: ModelInput[];
  contextWindow?: number;
  maxTokens?: number;
  api?: "openai-completions" | "openai-responses";
  compat?: Partial<LocalOpenAICompat>;
}
```

Settings shape should favor JSON readability:

```json
{
  "lmstudio": {
    "modelOverrides": [
      {
        "match": "qwen3",
        "matchType": "contains",
        "reasoning": true,
        "compat": {
          "thinkingFormat": "qwen-chat-template"
        }
      },
      {
        "match": "vision",
        "matchType": "contains",
        "input": ["text", "image"]
      },
      {
        "match": "openai/gpt-oss-20b",
        "matchType": "exact",
        "reasoning": true,
        "contextWindow": 131072
      }
    ]
  }
}
```

Do not use object keys as regexes for the initial implementation. Arrays preserve order and avoid confusing JSON escaping.

## Override Precedence
Apply values in this order:
1. Extension defaults
2. Global config
3. Project config
4. Discovered model metadata
5. Matching model override rules, in array order, later matching rules win

Rationale:
- Metadata should improve provider defaults
- User overrides should be the final authority
- Ordered rules allow broad rules followed by exact corrections

## Matching Semantics
- `exact`: `model.id === match`
- `prefix`: `model.id.startsWith(match)`
- `suffix`: `model.id.endsWith(match)`
- `contains`: `model.id.includes(match)`
- `regex`: compile `match` with `new RegExp(match)` and test `model.id`

Safety:
- Compile regex rules once during config normalization
- Invalid regex should produce a config warning and be skipped
- Do not allow regex flags in the initial config unless explicitly needed

## Compat Scope
Current compat fields include:
- `supportsDeveloperRole`
- `supportsReasoningEffort`
- `supportsStrictMode`
- `maxTokensField`
- Additional Pi fields exist, including `thinkingFormat`, `requiresThinkingAsText`, and `cacheControlFormat`

Implementation should:
- Type compat as a permissive subset of Pi's provider model compat type if exported
- Merge override compat over the default local compat object
- Only apply compat to API modes where Pi accepts it

## Task List

### Task 1: Define Override Types and Coercion
**Description:** Add config types and settings parsing for model override rules.

**Acceptance Criteria:**
- Valid override rules are parsed from global and project settings
- Invalid rules are skipped
- Invalid regex rules produce warnings
- `input` arrays are validated using the existing `ModelInput` rules
- Numeric fields require positive finite values

**Verification:**
- Add config parsing tests for valid exact/prefix/contains/regex rules
- Add tests for invalid regex and invalid field types
- Run `npm test`

**Dependencies:** None

**Files Likely Touched:**
- `src/index.ts`
- `test/index.test.ts`

**Estimated Scope:** Medium

### Task 2: Implement Override Matching Helper
**Description:** Add pure functions that determine which overrides apply to a given model ID.

**Acceptance Criteria:**
- All match types behave as documented
- Matching is case-sensitive by default
- Rules apply in order
- Later rules override earlier rule fields
- Invalid/skipped rules cannot throw at registration time

**Verification:**
- Add unit tests for each match type and precedence behavior
- Run `npm test`

**Dependencies:** Task 1

**Files Likely Touched:**
- `src/index.ts`
- `test/index.test.ts`

**Estimated Scope:** Small

### Task 3: Apply Overrides in Provider Builder
**Description:** Update `buildProviderConfig` so model-specific overrides are applied while building Pi model definitions.

**Acceptance Criteria:**
- Override `name` changes display name only, not raw model ID
- Override `reasoning` controls model reasoning flag
- Override `input` controls supported input types
- Override `contextWindow` and `maxTokens` control token limits
- Override `compat` merges over default compat
- Provider-level defaults still work when no override matches

**Verification:**
- Add tests for each overridable field
- Add test for broad rule plus exact rule precedence
- Run `npm test`
- Run `npm run check`

**Dependencies:** Tasks 1 and 2

**Files Likely Touched:**
- `src/index.ts`
- `test/index.test.ts`

**Estimated Scope:** Medium

### Task 4: Add Config Warnings to Commands
**Description:** Ensure skipped invalid override rules are visible through existing warning paths.

**Acceptance Criteria:**
- Invalid override warnings are returned from `loadConfigFromSettings`
- Startup logs warnings
- `/lmstudio-refresh` notifies warnings
- `/lmstudio-status` notifies warnings
- Warning messages identify enough context to fix the rule

**Verification:**
- Add tests for warnings produced by settings loading
- Manual review command handlers still iterate `lastWarnings`
- Run `npm test`

**Dependencies:** Task 1

**Files Likely Touched:**
- `src/index.ts`
- `test/index.test.ts`

**Estimated Scope:** Small

### Task 5: Document Override Rules
**Description:** Update README with examples and precedence rules.

**Acceptance Criteria:**
- README includes `modelOverrides` schema
- README includes examples for reasoning, vision, context window, and Qwen thinking format
- README states rule order and later-rule-wins behavior
- README warns that regex rules should be used sparingly

**Verification:**
- Manual README review

**Dependencies:** Tasks 1 through 4

**Files Likely Touched:**
- `README.md`

**Estimated Scope:** Small

## Checkpoints
- After Task 2: matching semantics are fully tested
- After Task 3: provider output tests prove overrides apply correctly
- After Task 5: `npm test` and `npm run check` pass

## Risks and Mitigations
| Risk | Impact | Mitigation |
| --- | --- | --- |
| Regex rules become confusing or unsafe | Medium | Support simpler match types first, skip invalid regex, document order |
| Overrides conflict with discovered metadata | Medium | Define explicit precedence: user overrides win |
| Compat typing is hard to import | Low | Use a local typed subset and rely on TypeScript provider config checking |
| Users accidentally register wrong capabilities | Low | Make behavior transparent in README and status/doctor features |

## Manual Test Scenario
1. Add a project `.pi/settings.json` with a `contains` override for `"vision"` setting `input: ["text", "image"]`
2. Run `/lmstudio-refresh`
3. Confirm matching model is registered with image input support
4. Add a later exact override for the same model setting `input: ["text"]`
5. Run `/lmstudio-refresh`
6. Confirm later rule wins
7. Add an invalid regex rule
8. Confirm `/lmstudio-status` reports a warning

## Acceptance Criteria for the Whole Feature
- Per-model overrides are parsed, validated, and applied
- Override precedence is deterministic and tested
- Invalid override rules do not crash extension loading
- README contains copy-pasteable examples
- `npm test` passes
- `npm run check` passes
