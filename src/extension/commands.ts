import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { loadConfigFromSettings } from "../config/load.js";
import { debugLog } from "../debug.js";

import { fetchLmStudioModelInfo, loadLmStudioModel, unloadLmStudioModel } from "../models/fetch.js";

import type { RefreshResult } from "../types.js";
import {
  type CompletionCache,
  createCompletionCache,
  getLoadArgumentCompletions,
  getLoadedInstanceIdCompletions,
  updateCacheFromNativeModels,
} from "./autocomplete.js";

let completionCache: CompletionCache = createCompletionCache();

function redactSecret(value: string): string {
  if (!value) return "<empty>";
  return `<set:${value.length} chars>`;
}

function formatDiagnosticConfig(
  loaded: import("../types.js").LoadedConfig,
  state: import("../types.js").LmStudioRefreshState,
  cwd: string,
): string {
  const config = loaded.config;
  const diagnostic = {
    cwd,
    config: {
      ...config,
      apiKey: redactSecret(config.apiKey),
    },
    warnings: loaded.warnings,
    runtime: {
      lastRefreshAt: state.lastRefreshAt ? new Date(state.lastRefreshAt).toISOString() : null,
      lastRefreshReason: state.lastRefreshReason ?? null,
      lastResult: state.lastResult ?? null,
      lastRegisteredModels: state.lastRegisteredModels,
    },
  };

  return `LM Studio diagnostic config:\n${JSON.stringify(diagnostic, null, 2)}`;
}

export function registerCommands(
  pi: ExtensionAPI,
  refreshFn: (cwd?: string) => Promise<RefreshResult>,
  getState?: () => import("../types.js").LmStudioRefreshState,
): void {
  function getCompletionCache(): CompletionCache {
    return completionCache;
  }

  pi.registerCommand("lmstudio-refresh", {
    description: "Re-fetch the model list from LM Studio and re-register the provider",
    handler: async (_args, ctx) => {
      const result = await refreshFn();
      if (result.ok) {
        ctx.ui.notify(`OK: ${result.count} model(s) registered`, "info");
      } else {
        ctx.ui.notify(`Refresh failed: ${result.error}`, "error");
      }
    },
  });

  pi.registerCommand("lmstudio-status", {
    description: "Show configured endpoint and last refresh status",
    handler: async (_args, ctx) => {
      try {
        const cwd = process.cwd();
        const loaded = loadConfigFromSettings(cwd);
        const state = getState?.() ?? {
          lastResult: undefined,
          lastWarnings: [],
          lastRefreshAt: undefined,
          lastRefreshReason: undefined,
          lastRegisteredModels: [],
        };
        const lines: string[] = [
          `Endpoint: ${loaded.config.baseUrl}`,
          `Provider: ${loaded.config.providerName}`,
        ];

        if (state.lastResult) {
          if (state.lastResult.ok) {
            lines.push(`Status: OK - ${state.lastResult.count} model(s) registered`);
          } else {
            lines.push(`Status: failed - ${state.lastResult.error}`);
          }
        } else {
          lines.push("Status: not yet refreshed");
        }

        if (state.lastRefreshAt) {
          const ago = Math.round((Date.now() - state.lastRefreshAt) / 1000);
          lines.push(`Last refresh: ${ago}s ago (${state.lastRefreshReason})`);
        } else {
          lines.push("Last refresh: never");
        }

        if (loaded.config.autoRefresh) {
          lines.push(`Auto-refresh: enabled (${loaded.config.refreshIntervalMs / 1000}s interval)`);
        } else {
          lines.push("Auto-refresh: disabled");
        }

        if (state.lastWarnings.length > 0) {
          lines.push("");
          lines.push("Warnings:");
          for (const w of state.lastWarnings) {
            lines.push(`- ${w}`);
          }
        }

        ctx.ui.notify(lines.join("\n"), "info");
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Failed to show status: ${msg}`, "error");
      }
    },
  });

  pi.registerCommand("lmstudio-config", {
    description: "Dump LM Studio diagnostic configuration",
    handler: async (_args, ctx) => {
      try {
        const cwd = ctx.cwd ?? process.cwd();
        const loaded = loadConfigFromSettings(cwd);
        const state = getState?.() ?? {
          lastResult: undefined,
          lastWarnings: [],
          lastRefreshAt: undefined,
          lastRefreshReason: undefined,
          lastRegisteredModels: [],
        };
        ctx.ui.notify(formatDiagnosticConfig(loaded, state, cwd), "info");
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Failed to dump config: ${msg}`, "error");
      }
    },
  });

  pi.registerCommand("lmstudio-models", {
    description: "List all available models from LM Studio's native API",
    handler: async (_args, ctx) => {
      const cwd = process.cwd();
      const loaded = loadConfigFromSettings(cwd);
      let result: {
        models: import("../types.js").LmStudioModelInfo[];
        source: "openai" | "native";
      };
      try {
        result = await fetchLmStudioModelInfo(loaded.config, fetch);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Failed to fetch model info: ${msg}`, "error");
        return;
      }
      if (result.source === "native") {
        completionCache = updateCacheFromNativeModels(completionCache, result.models);
        ctx.ui.notify(
          `Found ${result.models.length} model(s):\n${result.models.map((m) => `- ${m.id}: ${m.name}`).join("\n")}`,
          "info",
        );
      } else {
        ctx.ui.notify(`Using OpenAI-compatible API: ${result.models.length} model(s)`, "info");
      }
    },
  });

  pi.registerCommand("lmstudio-loaded", {
    description: "List only loaded model instances from LM Studio's native API",
    handler: async (_args, ctx) => {
      const cwd = process.cwd();
      const loaded = loadConfigFromSettings(cwd);
      let result: {
        models: import("../types.js").LmStudioModelInfo[];
        source: "openai" | "native";
      };
      try {
        result = await fetchLmStudioModelInfo(loaded.config, fetch);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Failed to fetch model info: ${msg}`, "error");
        return;
      }
      if (result.source === "native") {
        const loadedModels = result.models.filter((m) => m.loadedInstanceIds.length > 0);
        if (loadedModels.length === 0) {
          ctx.ui.notify("No models currently loaded", "info");
          return;
        }
        const lines = [`Loaded ${loadedModels.length} model(s):`];
        for (const model of loadedModels) {
          lines.push(`- ${model.id}: ${model.name}`);
          for (const instId of model.loadedInstanceIds) {
            lines.push(`  - ${instId}`);
          }
        }
        completionCache = updateCacheFromNativeModels(completionCache, result.models);
        ctx.ui.notify(lines.join("\n"), "info");
      } else {
        ctx.ui.notify("Not using native metadata source", "error");
      }
    },
  });

  pi.registerCommand("lmstudio-load", {
    description: "Load a model in LM Studio and refresh Pi registration",
    getArgumentCompletions: (args) => getLoadArgumentCompletions(getCompletionCache(), args),
    handler: async (args, ctx) => {
      const cwd = ctx.cwd;
      const loaded = loadConfigFromSettings(cwd);

      const parts = args.split(" ");
      const modelName = parts[0];
      if (!modelName) {
        ctx.ui.notify(
          "Usage: /lmstudio-load <model-id> [--context-length <n>] [--flash-attention <true|false>] [--gpu-layers <n>] [--num-gpu <n>]",
          "warning",
        );
        return;
      }

      debugLog(`loading model: ${modelName}`);

      const result = await loadLmStudioModel(loaded.config, { model: modelName }, fetch);
      if (result.status === "success") {
        ctx.ui.notify(
          `OK: Model loaded (instance: ${result.instance_id}, time: ${result.load_time_seconds}s)`,
          "info",
        );
        await refreshFn(cwd);
      } else {
        ctx.ui.notify(`Load failed: ${result.status}`, "error");
      }
    },
  });

  pi.registerCommand("lmstudio-unload", {
    description: "Unload a model instance from LM Studio and refresh Pi registration",
    getArgumentCompletions: (args) => getLoadedInstanceIdCompletions(getCompletionCache(), args),
    handler: async (args, ctx) => {
      const cwd = ctx.cwd;
      const loaded = loadConfigFromSettings(cwd);

      if (!args.trim()) {
        ctx.ui.notify("Usage: /lmstudio-unload <instance-id>", "warning");
        return;
      }

      debugLog(`unloading instance: ${args.trim()}`);

      try {
        const result = await unloadLmStudioModel(loaded.config, args.trim(), fetch);
        ctx.ui.notify(`OK: Instance unloaded: ${result.instance_id}`, "info");
        await refreshFn(cwd);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Unload failed: ${msg}`, "error");
      }
    },
  });

  // Register completions for the debug flag
  pi.registerCommand("lmstudio-debug", {
    description: "Toggle LM Studio debug mode",
    handler: async (args, ctx) => {
      const enabled = args.trim() === "true" || args.trim() === "1";
      ctx.ui.notify(`Debug mode ${enabled ? "enabled" : "disabled"}`, "info");
    },
  });
}
