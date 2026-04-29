# pi-extension-lmstudio

This Pi extension discovers models from a running LM Studio server and registers them as Pi models automatically.

By default, the extension exposes discovered models as `local/<model-id>`, so a model named `qwen2.5-coder-7b` in LM Studio appears in Pi as `local/qwen2.5-coder-7b`.

## Note

This repo has been almost entirely written by a local model, [qwen-3.6-35b-a3b-gguf](https://huggingface.co/unsloth/Qwen3.6-35B-A3B-GGUF). Its mostly been an experiment on how far I can push my local hardware for local coding.

It started with a plan from GPT5.5. From there all code was written by my local model.

### Specs
- pi.dev harness, with [little-coder](https://github.com/itayinbarr/little-coder)
- RX 7800 XT GPU, 16gb vram
- 32gb DDR5 system ram
- Ryzen 5 7600
- Using lmstudio to serve the models

So far the experience has been far better than expected. It took a lot of experimentation to get t/s fast enough, but now it feels pretty good.

## What It Does

- Fetches `GET <baseUrl>/models` from LM Studio
- Registers the returned model IDs in Pi without editing `models.json`
- Refreshes the model list on startup and through a manual command
- Keeps Pi usable even when LM Studio is offline during startup
- Keeps the LM Studio-specific config isolated from other Pi providers

## Installation

### Development install

Run the repo directly with Pi:

```bash
pi -e /path/to/extension/pi-extension-lmstudio --list-models local
```

### Local package install

Install it into Pi as a local package:

```bash
pi install /path/to/extension/pi-extension-lmstudio
```

Pi will load the extension from your installed package automatically on startup.

## Configuration

The extension reads configuration from Pi settings files under the `lmstudio` key.

Global settings:

- `~/.pi/agent/settings.json`

Project settings:

- `.pi/settings.json`

Project settings override global settings.

Example:

```json
{
  "lmstudio": {
    "baseUrl": "http://localhost:1234/v1",
    "apiKey": "lmstudio",
    "providerName": "local",
    "contextWindow": 128000,
    "maxTokens": 16384,
    "reasoning": false,
    "input": ["text"],
    "fetchTimeoutMs": 2500
  }
}
```

### Settings reference

- `baseUrl`: LM Studio API base URL, usually `http://localhost:1234/v1`
- `apiKey`: Required by Pi, but LM Studio ignores it
- `providerName`: Pi provider name and model prefix, defaults to `local`
- `contextWindow`: Default context window assigned to each discovered model
- `maxTokens`: Default max output tokens assigned to each discovered model
- `reasoning`: Whether Pi should treat the model as reasoning-capable
- `input`: Supported input types, usually `["text"]`
- `fetchTimeoutMs`: How long to wait for LM Studio before treating discovery as failed
- `autoRefresh`: Enable automatic background refresh of the model list (default: `false`)
- `refreshIntervalMs`: Interval between auto-refresh polls in milliseconds (default: `30000`, minimum: `5000`)
- `notifyAutoRefreshChanges`: Show notifications when auto-refresh detects model changes (default: `false`)

### Changing the prefix

The visible prefix comes from `providerName`.

If you want `studio/<model-id>` instead of `local/<model-id>`, set:

```json
{
  "lmstudio": {
    "providerName": "studio"
  }
}
```

## Commands

- `/lmstudio-refresh` fetches the model list again and re-registers the provider
- `/lmstudio-status` shows the configured endpoint, last refresh status, and polling state (when auto-refresh is enabled)
- `/lmstudio-config` dumps the effective LM Studio diagnostic config with secrets redacted
- `/lmstudio-models` lists all available models from LM Studio's native API
- `/lmstudio-loaded` lists only loaded model instances from LM Studio's native API
- `/lmstudio-load <model> [options]` loads a model, then refreshes Pi registration
- `/lmstudio-unload <instance-id>` unloads a model instance, then refreshes Pi registration

### Autocomplete

The extension provides argument completions for commands:

- **Model ID completions**: `/lmstudio-load` suggests matching model IDs from cached discovery results. Native models appear first when loaded state is known.
- **Instance ID completions**: `/lmstudio-unload` suggests loaded instances from native model metadata.
- **Flag completions**: When typing `--` after a command, supported flags like `--context-length`, `--flash-attention`, etc. are suggested. Boolean flags like `--flash-attention` further suggest `true`/`false`.
- `/lmstudio-load` switches between model suggestions before the first space and flag suggestions after the model name.

Completions are based on cached data from the last refresh or model list operation. They return instantly without network requests.

If completions appear stale, run `/lmstudio-refresh` to update the cache.

## Behavior

- If LM Studio is offline, Pi still starts
- If discovery fails, the extension keeps the app usable and reports the error
- Startup discovery runs in the background so LM Studio availability does not block Pi launch
- `/lmstudio-load`, `/lmstudio-unload`, and `/lmstudio-loaded` wait for their native API calls to finish before returning
- If no models are returned, the provider is unregistered until the next successful refresh
- The extension does not write to `~/.pi/agent/models.json`

### Auto-refresh polling

When enabled, the extension automatically polls LM Studio's model list at a configurable interval and updates Pi's registered models without manual intervention. This is useful when:

- LM Studio starts after Pi
- You load or unload models in LM Studio while Pi is running
- Model availability changes unexpectedly

**Configuration:**

```json
{
  "lmstudio": {
    "autoRefresh": true,
    "refreshIntervalMs": 30000,
    "notifyAutoRefreshChanges": false
  }
}
```

**Behavior details:**

- Auto-refresh is **disabled by default** to avoid unnecessary network requests
- Polling interval defaults to 30 seconds and is clamped to a minimum of 5 seconds
- Failed refreshes are logged at debug level but do not produce repeated warning notifications
- If LM Studio goes offline, polling continues silently until it reconnects
- Overlapping refresh calls are coalesced — if a refresh is already in progress, the next tick is skipped
- When `notifyAutoRefreshChanges` is enabled, you receive one notification when the model set changes (added/removed models)
- The `/lmstudio-status` command shows whether auto-refresh is active and the last refresh timestamp
- Polling starts on session start when `autoRefresh` is true; if config isn't available yet, it begins when commands are first used

## Auto-refresh troubleshooting

### Models don't update after polling starts

1. Run `/lmstudio-status` to verify auto-refresh is enabled and see the last refresh time
2. Check that LM Studio is still running and reachable
3. Run `/lmstudio-refresh` manually to force an immediate update
4. Enable debug mode (`pi --lmstudio-debug`) to trace polling ticks

### Too many notifications

Set `notifyAutoRefreshChanges: false` (the default) to suppress change notifications. Auto-refresh will still update models in the background.

### Polling seems slow

Reduce `refreshIntervalMs` but keep it above 5000ms to avoid hammering LM Studio.

## Debug Mode

Enable verbose debug logging to trace LM Studio flows:

```bash
pi --lmstudio-debug
```

Or set the environment variable:

```bash
PI_LMSTUDIO_DEBUG=1 pi
```

With debug mode enabled, you'll see:
- Settings file paths and contents at each load
- URL normalization and native URL derivation
- Full request/response details for model discovery
- Parsed model metadata (ids, capabilities, context windows)
- Provider config construction details
- Auto-fallback flow when trying native → OpenAI

You can also control the log level independently via `PI_LMSTUDIO_LOG`:

| Value | Output |
|-------|--------|
| `DEBUG` | All debug + info + warn + error |
| `INFO` | Info + warn + error (default) |
| `WARN` | Warn + error |
| `ERROR` | Error only |

## Troubleshooting

### No models show up

1. Confirm LM Studio is running
2. Confirm the server is reachable at the configured `baseUrl`
3. Run `/lmstudio-refresh`
4. Check whether the response from `GET <baseUrl>/models` contains a `data` array with model `id` values

### Wrong URL

Set `lmstudio.baseUrl` in either global or project Pi settings. This only affects the LM Studio provider registered by this extension.

### Want a different provider name

Change `lmstudio.providerName` in Pi settings. That changes the prefix shown in Pi’s model selector.

## Development

```bash
npm install
npm test
npm run check
```
