import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { debugLog, log } from "../debug.js";
import { configureDebugLogging } from "../debug.js";
import { loadConfigFromSettings } from "../config/load.js";
import { refreshProvider } from "../provider.js";
import { fetchLmStudioModelInfo } from "../models/fetch.js";
import { registerCommands, setLastResult, setLastWarnings, updateCompletionCacheFromNativeModels } from "./commands.js";
import type { RefreshResult, LmStudioModelInfo } from "../types.js";

export default async function lmStudioExtension(pi: ExtensionAPI) {
  let lastResult: RefreshResult | undefined;
  let lastWarnings: string[] = [];
  let refreshInFlight: { cwd: string; promise: Promise<RefreshResult> } | undefined;
  const initialCwd = process.cwd();

  // Register the debug flag
  pi.registerFlag("lmstudio-debug", {
    description: "Enable verbose debug logging for LM Studio extension flows",
    type: "boolean",
    default: false,
  });

  async function refresh(cwd = process.cwd()): Promise<RefreshResult> {
    try {
      log.debug(`refreshing from cwd: ${cwd}`);
      const loaded = loadConfigFromSettings(cwd);
      lastWarnings = loaded.warnings;
      if (loaded.warnings.length > 0) {
        log.debug(`config warnings: ${loaded.warnings.join(", ")}`);
      }
      log.debug(`effective config: baseUrl=${loaded.config.baseUrl}, provider=${loaded.config.providerName}, contextWindow=${loaded.config.contextWindow}, maxTokens=${loaded.config.maxTokens}`);
      setLastWarnings(loaded.warnings);
      // Fetch model info to update completion cache for native models
      const modelInfoResult = await fetchLmStudioModelInfo(loaded.config, fetch);
      if (modelInfoResult.source === "native") {
        updateCompletionCacheFromNativeModels(modelInfoResult.models);
      }
      const result = await refreshProvider(pi, loaded.config, undefined, { quiet: cwd === initialCwd });
      lastResult = result;
      setLastResult(result);
      return result;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const failed: RefreshResult = { ok: false, error: msg };
      lastResult = failed;
      setLastResult(failed);
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

  void startRefresh(initialCwd);

  pi.on("session_start", async (_event, ctx) => {
    configureDebugLogging(pi.getFlag("lmstudio-debug"));
    const resultPromise = !lastResult || ctx.cwd !== initialCwd ? startRefresh(ctx.cwd, ctx.cwd !== initialCwd) : Promise.resolve(lastResult);
    void resultPromise.then((result) => {
      if (result.ok) {
        debugLog(`registered ${result.count} local model${result.count === 1 ? "" : "s"}`);
      } else {
        debugLog(`initial refresh failed: ${result.error}`);
      }
      for (const warning of lastWarnings) {
        debugLog(warning);
      }
    });
  });

  registerCommands(pi, (cwd?: string) => startRefresh(cwd, true));
}
