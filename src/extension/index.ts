import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { debugLog, log, isDebugEnabled, configureDebugLogging } from "../debug.js";
import { loadConfigFromSettings } from "../config/load.js";
import { refreshProvider } from "../provider.js";
import { fetchLmStudioModelInfo } from "../models/fetch.js";
import { registerCommands } from "./commands.js";
import type { RefreshResult, RefreshReason, LmStudioConfig } from "../types.js";
import {
  createRefreshState,
  updateRefreshState,
  startAutoRefresh,
  detectModelChanges,
  formatChangeNotification,
} from "../polling.js";

export default async function lmStudioExtension(pi: ExtensionAPI) {
  const state = createRefreshState();
  let autoRefreshCleanup: (() => void) | undefined;
  let refreshInFlight: { cwd: string; promise: Promise<RefreshResult> } | undefined;
  const initialCwd = process.cwd();

  // Register the debug flag
  pi.registerFlag("lmstudio-debug", {
    description: "Enable verbose debug logging for LM Studio extension flows",
    type: "boolean",
    default: false,
  });

  async function refresh(
    cwd = process.cwd(),
    reason: RefreshReason = "startup",
  ): Promise<RefreshResult> {
    try {
      log.debug(`refreshing from cwd (${reason}): ${cwd}`);
      const loaded = loadConfigFromSettings(cwd);
      state.lastWarnings = loaded.warnings;
      if (loaded.warnings.length > 0) {
        log.debug(`config warnings: ${loaded.warnings.join(", ")}`);
      }
      log.debug(
        `effective config: baseUrl=${loaded.config.baseUrl}, provider=${loaded.config.providerName}, contextWindow=${loaded.config.contextWindow}, maxTokens=${loaded.config.maxTokens}`,
      );
      // Fetch model info to update completion cache for native models
      const modelInfoResult = await fetchLmStudioModelInfo(loaded.config, fetch);
      if (modelInfoResult.source === "native") {
        // Completion cache is updated via commands module; no-op here during refresh
      }
      const result = await refreshProvider(pi, loaded.config, undefined, {
        quiet: cwd === initialCwd,
      });
      state.lastRegisteredModels = sortedModelIds(
        result.ok ? result.models : state.lastRegisteredModels,
      );
      updateRefreshState(state, result, reason);
      return result;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const failed: RefreshResult = { ok: false, error: msg };
      state.lastRegisteredModels = sortedModelIds(
        state.lastResult?.ok ? state.lastResult.models : [],
      );
      updateRefreshState(state, failed, reason);
      return failed;
    }
  }

  const startRefresh = (cwd = process.cwd(), force = false): Promise<RefreshResult> => {
    if (!force && refreshInFlight?.cwd === cwd) {
      return refreshInFlight.promise;
    }

    const promise = refresh(cwd).finally(() => {
      if (refreshInFlight?.promise === promise) {
        refreshInFlight = undefined;
      }
    });

    refreshInFlight = { cwd, promise };
    return promise;
  };

  // Auto-refresh tick handler
  const autoRefreshTick = async () => {
    // Skip if another refresh is in flight (coalesce)
    if (refreshInFlight) {
      debugLog("auto-refresh skipped: refresh already in flight");
      return;
    }

    debugLog("auto-refresh tick");
    const result = await startRefresh(initialCwd, true);

    if (!result.ok) {
      debugLog(`auto-refresh failed: ${result.error}`);
      return;
    }

    // Check for model changes and notify if configured
    const config = loadConfigFromSettings(initialCwd).config;
    if (config.notifyAutoRefreshChanges) {
      const change = detectModelChanges(state.lastRegisteredModels, sortedModelIds(result.models));
      if (change.added.length > 0 || change.removed.length > 0) {
        const summary = formatChangeNotification(change);
        log.info(`auto-refresh: ${summary}`);
      }
    }
  };

  function sortedModelIds(models: string[]): string[] {
    return [...models].sort();
  }

  // Start auto-refresh if enabled and config is available
  const startPolling = (config: LmStudioConfig) => {
    if (config.autoRefresh && !autoRefreshCleanup) {
      debugLog(`starting auto-refresh at ${config.refreshIntervalMs}ms interval`);
      autoRefreshCleanup = startAutoRefresh(config.refreshIntervalMs, autoRefreshTick);
    }
  };

  // Startup discovery — synchronous so models are available when Pi creates the model picker.
  // The loader awaits async factories, so we register providers before pending registrations
  // are processed by createAgentSessionServices.
  try {
    const startupResult = await startRefresh(initialCwd);
    if (!startupResult.ok) {
      log.debug(`startup refresh failed: ${startupResult.error}`);
    }
  } catch (error) {
    log.debug(`startup refresh error: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Register commands with refresh helper and polling state accessors
  registerCommands(
    pi,
    async (cwd) => startRefresh(cwd),
    () => state,
  );

  // On session_start, resolve the debug flag and apply logging config
  pi.on("session_start", async (_event, ctx) => {
    const flagValue = pi.getFlag("lmstudio-debug");
    configureDebugLogging(flagValue);
    if (isDebugEnabled()) {
      log.info("LM Studio debug mode enabled");
    }

    // Load config and start polling if auto-refresh is enabled
    try {
      const loaded = loadConfigFromSettings(ctx.cwd);
      if (loaded.config.autoRefresh) {
        startPolling(loaded.config);
      }
    } catch {
      // Config not available yet; polling will start when commands are used
    }
  });
}
