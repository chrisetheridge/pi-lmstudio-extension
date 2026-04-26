import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { log, debugLog } from "../debug.js";
import { loadConfigFromSettings } from "../config/load.js";

import { refreshProvider } from "../provider.js";
import { fetchLmStudioModelInfo, loadLmStudioModel, unloadLmStudioModel } from "../models/fetch.js";

import type { RefreshResult } from "../types.js";
import {
  createCompletionCache,
  updateCacheFromNativeModels,
  getLoadArgumentCompletions,
  getLoadedInstanceIdCompletions,
  type CompletionCache,
} from "./autocomplete.js";

let lastResult: RefreshResult | undefined;
let lastWarnings: string[] = [];
let completionCache: CompletionCache = createCompletionCache();

export function setLastResult(result: RefreshResult) {
  lastResult = result;
}

export function setLastWarnings(warnings: string[]) {
  lastWarnings = warnings;
}

export function registerCommands(
  pi: ExtensionAPI,
  refreshFn: (cwd?: string) => Promise<RefreshResult>,
  getState?: () => import("../types.js").LmStudioRefreshState,
  startPolling?: (config: import("../types.js").LmStudioConfig) => void,
): void {
  function getCompletionCache(): CompletionCache {
    return completionCache;
  }

  pi.registerCommand("lmstudio-refresh", {
    description: "Re-fetch the model list from LM Studio and re-register the provider",
    handler: async () => {
      const result = await refreshFn();
      if (result.ok) {
        log.info(`✓ ${result.count} model(s) registered`);
      } else {
        log.error(result.error);
      }
    },
  });

  pi.registerCommand("lmstudio-status", {
    description: "Show configured endpoint and last refresh status",
    handler: async () => {
      const cwd = process.cwd();
      const loaded = loadConfigFromSettings(cwd);
      const state = getState?.() ?? { lastResult: undefined, lastWarnings: [], lastRefreshAt: undefined, lastRefreshReason: undefined, lastRegisteredModels: [] };
      const lines: string[] = [
        `Endpoint: ${loaded.config.baseUrl}`,
        `Provider: ${loaded.config.providerName}`,
      ];

      if (state.lastResult) {
        if (state.lastResult.ok) {
          lines.push(`Status: ${state.lastResult.count} model(s) registered`);
        } else {
          lines.push(`Status: failed — ${state.lastResult.error}`);
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
          lines.push(`  • ${w}`);
        }
      }

      log.info(lines.join("\n"));
    },
  });

  pi.registerCommand("lmstudio-models", {
    description: "List all available models from LM Studio's native API",
    handler: async () => {
      const cwd = process.cwd();
      const loaded = loadConfigFromSettings(cwd);
      let result: { models: import("../types.js").LmStudioModelInfo[]; source: "openai" | "native" };
      try {
        result = await fetchLmStudioModelInfo(loaded.config, fetch);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        log.error(`Failed to fetch model info: ${msg}`);
        return;
      }
      if (result.source === "native") {
        log.info(`Found ${result.models.length} model(s):\n${result.models.map((m) => `  • ${m.id}: ${m.name}`).join("\n")}`);
        completionCache = updateCacheFromNativeModels(completionCache, result.models);
      } else {
        log.info(`Using OpenAI-compatible API: ${result.models.length} model(s)`);
      }
    },
  });

  pi.registerCommand("lmstudio-loaded", {
    description: "List only loaded model instances from LM Studio's native API",
    handler: async (_args, ctx) => {
      const cwd = process.cwd();
      const loaded = loadConfigFromSettings(cwd);
      let result: { models: import("../types.js").LmStudioModelInfo[]; source: "openai" | "native" };
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
          ctx.ui.notify("No models currently loaded");
          return;
        }
        for (const model of loadedModels) {
          log.info(`${model.id}: ${model.name}`);
          for (const instId of model.loadedInstanceIds) {
            log.info(`  └─ ${instId}`);
          }
        }
        completionCache = updateCacheFromNativeModels(completionCache, result.models);
        ctx.ui.notify(`${loadedModels.length} model(s) loaded`, "info");
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
        log.error("Usage: /lmstudio-load <model-id> [--context-length <n>] [--flash-attention <true|false>] [--gpu-layers <n>] [--num-gpu <n>]");
        return;
      }

      debugLog(`loading model: ${modelName}`);

      const result = await loadLmStudioModel(loaded.config, { model: modelName }, fetch);
      if (result.status === "success") {
        log.info(`✓ Model loaded (instance: ${result.instance_id}, time: ${result.load_time_seconds}s)`);
        await refreshFn(cwd);
      } else {
        log.error(`Load failed: ${result.status}`);
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
        log.error("Usage: /lmstudio-unload <instance-id>");
        return;
      }

      debugLog(`unloading instance: ${args.trim()}`);

      try {
        const result = await unloadLmStudioModel(loaded.config, args.trim(), fetch);
        log.info(`✓ Instance unloaded: ${result.instance_id}`);
        await refreshFn(cwd);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        log.error(`Unload failed: ${msg}`);
      }
    },
  });

  // Register completions for the debug flag
  pi.registerCommand("lmstudio-debug", {
    description: "Toggle LM Studio debug mode",
    handler: async (args) => {
      const enabled = args.trim() === "true" || args.trim() === "1";
      log.info(`Debug mode ${enabled ? "enabled" : "disabled"}`);
    },
  });
}
