import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { log } from "../debug.js";
import { configureDebugLogging } from "../debug.js";
import { loadConfigFromSettings } from "../config/load.js";
import { refreshProvider } from "../provider.js";
import { fetchLmStudioModelInfo } from "../models/fetch.js";
import { registerCommands, setLastResult, setLastWarnings } from "./commands.js";
import type { RefreshResult } from "../types.js";

export default async function lmStudioExtension(pi: ExtensionAPI) {
  let lastResult: RefreshResult | undefined;
  let lastWarnings: string[] = [];

  // Register the debug flag
  pi.registerFlag("lmstudio-debug", {
    description: "Enable verbose debug logging for LM Studio extension flows",
    type: "boolean",
    default: false,
  });

  async function refresh(cwd = process.cwd()): Promise<RefreshResult> {
    log.debug(`refreshing from cwd: ${cwd}`);
    const loaded = loadConfigFromSettings(cwd);
    lastWarnings = loaded.warnings;
    if (loaded.warnings.length > 0) {
      log.debug(`config warnings: ${loaded.warnings.join(", ")}`);
    }
    log.debug(`effective config: baseUrl=${loaded.config.baseUrl}, provider=${loaded.config.providerName}, contextWindow=${loaded.config.contextWindow}, maxTokens=${loaded.config.maxTokens}`);
    setLastWarnings(loaded.warnings);
    const result = await refreshProvider(pi, loaded.config);
    lastResult = result;
    setLastResult(result);
    return result;
  }

  pi.on("session_start", async (_event, ctx) => {
    configureDebugLogging(pi.getFlag("lmstudio-debug"));
    lastResult = await refresh(ctx.cwd);
    if (lastResult.ok) {
      log.info(`registered ${lastResult.count} local model${lastResult.count === 1 ? "" : "s"}`);
    } else {
      log.error(`initial refresh failed: ${lastResult.error}`);
    }
    for (const warning of lastWarnings) {
      log.warn(warning);
    }
  });

  registerCommands(pi, refresh);
}
