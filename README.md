# pi-extension-lmstudio

Pi extension that discovers models from LM Studio and registers them as `local/<model-id>` models.

## Usage

Run it directly while developing:

```bash
pi -e /Users/chrise/code/private/pi-extension-lmstudio --list-models local
```

Install the local package:

```bash
pi install /Users/chrise/code/private/pi-extension-lmstudio
```

With LM Studio serving its OpenAI-compatible API, open Pi and select models with `/model` or Ctrl+L. A model returned by LM Studio as `qwen2.5-coder-7b` appears in Pi as `local/qwen2.5-coder-7b`.

## Configuration

The extension reads the `lmstudio` key from Pi settings. Project settings override global settings.

- Global: `~/.pi/agent/settings.json`
- Project: `.pi/settings.json`

```json
{
  "lmstudio": {
    "baseUrl": "http://localhost:1234/v1",
    "apiKey": "lmstudio",
    "providerName": "local",
    "contextWindow": 128000,
    "maxTokens": 16384,
    "reasoning": false
  }
}
```

Defaults are suitable for LM Studio on `localhost:1234`. `apiKey` is required by Pi's provider registry, but LM Studio ignores it.

## Commands

- `/lmstudio-refresh` refetches `GET <baseUrl>/models` and re-registers the provider without `/reload`.
- `/lmstudio-status` shows the configured endpoint and last refresh result.

If LM Studio is offline at startup, Pi still starts. The extension logs a warning and registers no local models until `/lmstudio-refresh` succeeds.

## Development

```bash
npm install
npm test
npm run check
```
