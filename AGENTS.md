# Agent Instructions

## Repository purpose

This repository is a TypeScript Pi extension that discovers models from a running LM Studio server and registers them as Pi models. It also exposes LM Studio slash commands for refresh, status, diagnostics, model listing, and model load/unload flows.

## Before editing

1. Read this file.
2. Read `CONTEXT.md` for domain terms, boundaries, and architecture rules.
3. Treat `plans/**` as historical implementation notes only. Do not use them as current requirements unless the user explicitly references one.
4. Prefer nearby source and tests over historical plans when determining current behavior.

## Source map

- `src/extension/index.ts`: Pi extension lifecycle, startup refresh, debug flag, auto-refresh polling.
- `src/extension/commands.ts`: registered `/lmstudio-*` commands and user-facing command output.
- `src/extension/autocomplete.ts`: command argument completion cache and completion rules.
- `src/config/**`: settings loading, coercion, defaults, and merge behavior.
- `src/models/**`: LM Studio OpenAI-compatible/native fetch, parse, load, and unload helpers.
- `src/provider.ts`: Pi provider config construction and provider registration/unregistration.
- `src/polling.ts`: refresh state and model-change detection for auto-refresh.
- `test/index.test.ts`: current Vitest coverage.
- `README.md`: user-facing installation, configuration, commands, and troubleshooting docs.

## Architecture rules

- Keep Pi usable when LM Studio is offline or a refresh fails.
- Do not unregister a previously working provider because of a failed fetch. A successful refresh with zero models may unregister the provider.
- Project settings in `.pi/settings.json` override global Pi settings.
- Do not write to `~/.pi/agent/models.json`; provider registration is runtime-only.
- Do not mutate user settings automatically.
- Redact secrets such as `apiKey` in diagnostics and logs.
- Keep network calls timeout-bound and testable with injected `fetch` where practical.
- Do not perform network requests in autocomplete hot paths; use cached data.
- Update `README.md` when commands, configuration keys, or user-visible behavior changes.

## Verification

Run full verification before claiming implementation is complete:

```bash
npm run verify
```

`npm run verify` runs TypeScript checking, Vitest, and Biome checks. If a narrower command is used during development, still run full verification before final handoff unless the user says not to.

## GitHub Issues

- GitHub Issues is the authoritative issue tracker for this repo.
- Reference issue numbers in branches, commits, and PRs when available, e.g. `#123`.
- Do not create, edit, close, or label issues unless the user explicitly asks.
- If implementation reveals follow-up work, mention it in the final response rather than creating an issue automatically.

## Generated and ignored files

- Do not commit `node_modules/`, `dist/`, `coverage/`, or `.pi-lens/`.
- Keep package lockfile changes only when dependency changes require them.
