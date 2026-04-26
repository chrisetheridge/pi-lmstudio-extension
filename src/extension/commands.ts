import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { log } from "../debug.js";
import { loadConfigFromSettings } from "../config/load.js";
import type { RefreshResult } from "../types.js";
import {
  createCompletionCache,
  updateCacheFromDiscoveredModels,
  updateCacheFromNativeModels,
  getModelIdCompletions,
  getLoadedInstanceIdCompletions,
  getFlagCompletions,
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

export function registerCommands(pi: ExtensionAPI, refresh: (cwd?: string) => Promise<RefreshResult>): void {
  pi.registerCommand("lmstudio-refresh", {
    description: "Refresh LM Studio local models",
    handler: async (_args, ctx) => {
      log.info("refresh command invoked");
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
      log.info("status command invoked");
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
}
