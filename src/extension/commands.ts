import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { debugLog, log } from "../debug.js";
import { loadConfigFromSettings } from "../config/load.js";
import {
  fetchNativeModels,
  loadLmStudioModel,
  unloadLmStudioModel,
} from "../models/fetch.js";
import { parseLoadArgs, parseBooleanArg } from "../models/load-args.js";
import type { RefreshResult, LoadModelCommandArgs, LoadModelResult, UnloadModelResult } from "../types.js";
import {
  createCompletionCache,
  updateCacheFromDiscoveredModels,
  updateCacheFromNativeModels,
  getModelIdCompletions,
  getLoadedInstanceIdCompletions,
  getFlagCompletions,
  getLoadArgumentCompletions,
  parseArgumentPrefix,
  type CompletionCache,
} from "./autocomplete.js";

let lastResult: RefreshResult | undefined;
let lastWarnings: string[] = [];
let lastDiscoverySource: "openai" | "native" | undefined;
let completionCache: CompletionCache = createCompletionCache();

export function setLastResult(result: RefreshResult): void {
  lastResult = result;
  if (result.ok) {
    lastDiscoverySource = result.source;
    // Update completion cache based on refresh result
    if (result.source === "openai") {
      completionCache = updateCacheFromDiscoveredModels(completionCache, result.models);
    } else {
      // Native source - we need model info, not just IDs
      // The cache will be updated separately when native models are fetched
    }
  }
}

export function setLastWarnings(warnings: string[]): void {
  lastWarnings = warnings;
}

export function getLastDiscoverySource(): typeof lastDiscoverySource {
  return lastDiscoverySource;
}

/** Update completion cache from native model info */
export function updateCompletionCacheFromNativeModels(models: Array<{ id: string; name: string; type: "llm" | "embedding" | "unknown"; loadedInstanceIds: string[] }>): void {
  completionCache = updateCacheFromNativeModels(completionCache, models as never);
}

/** Get the current completion cache (for testing) */
export function getCompletionCache(): CompletionCache {
  return completionCache;
}

/** Format a concise model list for notifications. */
function formatModelList(models: Array<{ id: string; name: string; type: string; loadedInstanceIds: string[] }>, maxItems?: number): string {
  const items = models.slice(0, maxItems ?? 20);
  const lines = items.map((m) => {
    const loaded = m.loadedInstanceIds.length > 0 ? ` [loaded:${m.loadedInstanceIds.length}]` : "";
    return `  ${m.id}${loaded}`;
  });
  if (models.length > (maxItems ?? 20)) {
    lines.push(`  ... and ${models.length - (maxItems ?? 20)} more`);
  }
  return lines.join("\n");
}

/** Refresh provider registration after load/unload. */
async function refreshAfterOperation(
  pi: ExtensionAPI,
  ctx: { cwd: string },
  refresh: (cwd?: string) => Promise<RefreshResult>,
): Promise<void> {
  try {
    const result = await refresh(ctx.cwd);
    if (result.ok) {
      debugLog(`provider refreshed after operation (${result.count} models)`);
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    debugLog(`refresh after operation failed: ${msg}`);
  }
}

export function registerCommands(pi: ExtensionAPI, refresh: (cwd?: string) => Promise<RefreshResult>): void {
  pi.registerCommand("lmstudio-refresh", {
    description: "Refresh LM Studio local models",
    handler: async (_args, ctx) => {
      debugLog("refresh command invoked");
      const result = await refresh(ctx.cwd);
      for (const warning of lastWarnings) {
        ctx.ui.notify(`[lmstudio] ${warning}`, "warning");
      }
      if (result.ok) {
        const sourceHint = result.source !== "openai" ? ` (using ${result.source} metadata)` : "";
        ctx.ui.notify(`[lmstudio] registered ${result.count} local model${result.count === 1 ? "" : "s"}${sourceHint}`, "info");
        // Update completion cache after successful refresh
        if (result.source === "openai") {
          completionCache = updateCacheFromDiscoveredModels(completionCache, result.models);
        }
      } else {
        ctx.ui.notify(`[lmstudio] refresh failed: ${result.error}`, "warning");
      }
    },
  });

  pi.registerCommand("lmstudio-status", {
    description: "Show LM Studio provider status",
    handler: async (_args, ctx) => {
      debugLog("status command invoked");
      const { config, warnings } = loadConfigFromSettings(ctx.cwd);
      for (const warning of warnings) {
        ctx.ui.notify(`[lmstudio] ${warning}`, "warning");
      }
      const status =
        lastResult === undefined
          ? "not refreshed yet"
          : lastResult.ok
            ? `${lastResult.count} local model${lastResult.count === 1 ? "" : "s"} registered${lastDiscoverySource ? ` (metadata: ${lastDiscoverySource})` : ""}`
            : `last refresh failed: ${lastResult.error}`;
      ctx.ui.notify(`[lmstudio] ${config.baseUrl} (${config.providerName}/): ${status}`, lastResult?.ok === false ? "warning" : "info");
    },
  });

  // /lmstudio-models — list all available models from native API
  pi.registerCommand("lmstudio-models", {
    description: "List all available local models via the LM Studio native API",
    handler: async (_args, ctx) => {
      debugLog("models command invoked");
      const { config, warnings } = loadConfigFromSettings(ctx.cwd);
      for (const warning of warnings) {
        ctx.ui.notify(`[lmstudio] ${warning}`, "warning");
      }

      try {
        const models = await fetchNativeModels(config);
        updateCompletionCacheFromNativeModels(models);
        if (models.length === 0) {
          ctx.ui.notify("[lmstudio] no models found via native API", "warning");
          return;
        }
        const output = formatModelList(models, 20);
        ctx.ui.notify(`[lmstudio] ${models.length} model(s) available:\n${output}`, "info");
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`[lmstudio] failed to list models: ${msg}`, "warning");
      }
    },
  });

  // /lmstudio-loaded — list only loaded model instances
  pi.registerCommand("lmstudio-loaded", {
    description: "List currently loaded model instances",
    handler: async (_args, ctx) => {
      debugLog("loaded command invoked");
      const { config, warnings } = loadConfigFromSettings(ctx.cwd);
      for (const warning of warnings) {
        ctx.ui.notify(`[lmstudio] ${warning}`, "warning");
      }

      try {
        const models = await fetchNativeModels(config);
        updateCompletionCacheFromNativeModels(models);
        const loadedModels = models.filter((m) => m.loadedInstanceIds.length > 0);
        if (loadedModels.length === 0) {
          ctx.ui.notify("[lmstudio] no models currently loaded", "info");
          return;
        }
        const output = formatModelList(loadedModels, 20);
        ctx.ui.notify(`[lmstudio] ${loadedModels.length} model(s) loaded:\n${output}`, "info");
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`[lmstudio] failed to list loaded models: ${msg}`, "warning");
      }
    },
  });

  // /lmstudio-load <model> [options]
  pi.registerCommand("lmstudio-load", {
    description: "Load a model via the LM Studio native API",
    getArgumentCompletions: (argumentPrefix) => getLoadArgumentCompletions(completionCache, argumentPrefix),
    handler: async (args, ctx) => {
      debugLog("load command invoked", args);
      const { config, warnings } = loadConfigFromSettings(ctx.cwd);
      for (const warning of warnings) {
        ctx.ui.notify(`[lmstudio] ${warning}`, "warning");
      }

      let parsedArgs: LoadModelCommandArgs;
      try {
        parsedArgs = parseLoadArgs(args);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`[lmstudio] invalid arguments: ${msg}`, "warning");
        return;
      }

      try {
        const result = await loadLmStudioModel(config, parsedArgs);
        const timeStr = result.load_time_seconds !== undefined ? `${result.load_time_seconds.toFixed(2)}s` : "unknown";
        ctx.ui.notify(
          `[lmstudio] model loaded: ${parsedArgs.model}\n  instance_id: ${result.instance_id}\n  load_time: ${timeStr}`,
          "info",
        );
        // Refresh provider so Pi sees the newly loaded model
        await refreshAfterOperation(pi, ctx, refresh);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`[lmstudio] load failed: ${msg}`, "warning");
      }
    },
  });

  // /lmstudio-unload <instance-id>
  pi.registerCommand("lmstudio-unload", {
    description: "Unload a model instance via the LM Studio native API",
    handler: async (args, ctx) => {
      debugLog("unload command invoked", args);
      const { config, warnings } = loadConfigFromSettings(ctx.cwd);
      for (const warning of warnings) {
        ctx.ui.notify(`[lmstudio] ${warning}`, "warning");
      }

      const trimmedArgs = args.trim();
      if (!trimmedArgs) {
        ctx.ui.notify("[lmstudio] instance_id is required", "warning");
        return;
      }

      try {
        const result = await unloadLmStudioModel(config, trimmedArgs);
        ctx.ui.notify(`[lmstudio] model unloaded: ${result.instance_id}`, "info");
        // Refresh provider so Pi sees the updated state
        await refreshAfterOperation(pi, ctx, refresh);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`[lmstudio] unload failed: ${msg}`, "warning");
      }
    },
  });
}
