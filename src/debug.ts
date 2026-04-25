import { consola } from "consola";

const NAMESPACE = "lmstudio";

/** Tagged consola instance for the LM Studio extension */
const log = consola.withTag(NAMESPACE);

/** Whether debug mode is enabled (via CLI flag or env) */
let debugEnabled = false;

/** Debug-only logging helper — logs detailed metadata when debug mode is active */
export function debugLog(label: string, data?: unknown): void {
  if (!debugEnabled) return;
  log.debug(label, data);
}

/** Check if debug mode is active */
export function isDebugEnabled(): boolean {
  return debugEnabled;
}

export function configureDebugLogging(flagValue: boolean | string | undefined): void {
  const debugFromFlag = flagValue === true;
  const debugFromEnv = process.env.PI_LMSTUDIO_DEBUG === "1" || process.env.PI_LMSTUDIO_DEBUG === "true";
  debugEnabled = debugFromFlag || debugFromEnv;
  if (debugEnabled) {
    log.info("LM Studio debug mode enabled");
  }
}

/** Wrap an async operation and log timing */
export function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now();
  log.debug(`▶ ${label}`);
  return fn()
    .then((result) => {
      const ms = performance.now() - start;
      log.debug(`✓ ${label} completed in ${ms.toFixed(2)}ms`);
      return result;
    })
    .catch((err) => {
      const ms = performance.now() - start;
      log.error(`✗ ${label} failed after ${ms.toFixed(2)}ms: ${err instanceof Error ? err.message : err}`);
      throw err;
    });
}

export { log };
