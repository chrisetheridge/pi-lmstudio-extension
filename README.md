# pi-extension-lmstudio

This Pi extension discovers models from a running LM Studio server and registers them as Pi models automatically.

By default, the extension exposes discovered models as `local/<model-id>`, so a model named `qwen2.5-coder-7b` in LM Studio appears in Pi as `local/qwen2.5-coder-7b`.

## What It Does

- Fetches `GET <baseUrl>/models` from LM Studio
- Registers the returned model IDs in Pi without editing `models.json`
- Refreshes the model list on startup and through a manual command
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
- `/lmstudio-status` shows the configured endpoint and the result of the last refresh

## Behavior

- If LM Studio is offline, Pi still starts
- If discovery fails, the extension keeps the app usable and reports the error
- If no models are returned, the provider is unregistered until the next successful refresh
- The extension does not write to `~/.pi/agent/models.json`

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
