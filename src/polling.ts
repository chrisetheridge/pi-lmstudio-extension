import type { RefreshReason, LmStudioRefreshState, ModelChange } from "./types.js";

/** Stable-sorted model IDs for deterministic comparison. */
function sortedModelIds(models: string[]): string[] {
  return [...models].sort();
}

/** Compare two sets of model IDs and return added/removed. */
export function detectModelChanges(
  previous: string[],
  current: string[],
): ModelChange {
  const prevSet = new Set(previous);
  const currSet = new Set(current);
  const added: string[] = [];
  const removed: string[] = [];

  for (const id of sortedModelIds(current)) {
    if (!prevSet.has(id)) {
      added.push(id);
    }
  }
  for (const id of sortedModelIds(previous)) {
    if (!currSet.has(id)) {
      removed.push(id);
    }
  }

  return { added, removed };
}

/** Format a model change summary string. */
export function formatChangeNotification(change: ModelChange): string {
  const parts: string[] = [];
  if (change.added.length > 0) {
    parts.push(`+${change.added.length} model(s)`);
  }
  if (change.removed.length > 0) {
    parts.push(`-${change.removed.length} model(s)`);
  }
  return parts.join(", ") || "no change";
}

/** Create a fresh polling state. */
export function createRefreshState(): LmStudioRefreshState {
  return {
    lastResult: undefined,
    lastWarnings: [],
    lastRefreshAt: undefined,
    lastRefreshReason: undefined,
    lastRegisteredModels: [],
  };
}

/** Update polling state after a refresh completes. */
export function updateRefreshState(
  state: LmStudioRefreshState,
  result: LmStudioRefreshState["lastResult"],
  reason: RefreshReason,
): void {
  state.lastResult = result;
  state.lastRefreshAt = Date.now();
  state.lastRefreshReason = reason;

  if (result?.ok) {
    state.lastRegisteredModels = sortedModelIds(result.models);
  }
}

/** Start an auto-refresh timer. Returns a cleanup function. */
export function startAutoRefresh(
  intervalMs: number,
  onTick: () => void,
): () => void {
  const id = setInterval(onTick, intervalMs) as unknown as ReturnType<typeof setInterval>;

  // Mark the interval so it can be cleared without leaking in Node.js
  if (typeof id === "object" && id !== null && "unref" in id) {
    (id as NodeJS.Timeout).unref?.();
  }

  return () => clearInterval(id);
}

/** Stop an auto-refresh timer. */
export function stopAutoRefresh(cleanup: (() => void) | undefined): void {
  cleanup?.();
}
