# Project Context

## Domain Terms

- **Pi extension**: A package loaded by Pi through the `pi.extensions` manifest entry in `package.json`.
- **LM Studio server**: Local server that exposes OpenAI-compatible endpoints under `/v1` and native management endpoints under `/api/v1`.
- **Provider**: Runtime Pi provider registration that makes discovered LM Studio models selectable in Pi.
- **Model discovery**: Fetching LM Studio model metadata and converting it into Pi provider model entries.
- **OpenAI-compatible API**: LM Studio `/v1/models` and related endpoints. This is the broad fallback path.
- **Native API**: LM Studio `/api/v1/models` and load/unload endpoints. This provides richer metadata and model management but may not always be available.
- **Loaded instance**: A running LM Studio model instance that can be unloaded by instance id.
- **Auto-refresh**: Optional polling that keeps Pi's runtime provider registration aligned with LM Studio model availability.

## Responsibilities

This extension is responsible for:

- Loading LM Studio configuration from Pi settings under the `lmstudio` key.
- Merging global and project configuration with project settings taking precedence.
- Discovering available models without blocking Pi indefinitely.
- Registering or unregistering the runtime Pi provider based on successful discovery results.
- Exposing `/lmstudio-*` commands for refresh, status, config diagnostics, model listing, and model load/unload operations.
- Providing fast command completions from cached model metadata.
- Documenting user-visible configuration and command behavior in `README.md`.

## Architectural Rules

- Startup discovery should not make Pi unusable when LM Studio is offline.
- Failed refreshes are errors to report or record, not a reason to discard a previously registered provider.
- A successful refresh with zero models is a real empty state and may unregister the provider.
- OpenAI-compatible discovery is the compatibility fallback; native metadata is an enhancement unless a command specifically requires it.
- Configuration parsing should ignore invalid optional values or fall back to safe defaults.
- Diagnostics must redact secrets and avoid leaking API keys.
- Autocomplete must be cache-based and quick; it should not make a network request for every keystroke.
- Network-facing helpers should remain deterministic and unit-testable by accepting an injected `fetch` where practical.
- User-facing changes require README updates.

## Verification Commands

Use full verification before final handoff:

```bash
npm run verify
```

Individual checks:

```bash
npm run check
npm test
npm run lint
```

## Boundaries

- Do not edit Pi's persistent `models.json`; this extension registers providers at runtime.
- Do not automatically create or rewrite user settings files.
- Do not vendor global agent skills or unrelated tooling into this repo.
- Do not treat `plans/**` as current requirements; they are historical unless explicitly referenced by the user.
- Do not add noisy background notifications unless controlled by user configuration.

## Context Routing

This is a single-package repository with one global domain context. Agents should read:

1. `AGENTS.md`
2. `CONTEXT.md`
3. Relevant source files and tests
4. `README.md` for user-facing behavior

A `CONTEXT-MAP.md` or `docs/agents/domain.md` is unnecessary unless the repo grows into multiple packages or domains.
