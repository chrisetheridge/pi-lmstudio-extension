import type { LoadModelCommandArgs } from "../types.js";

/** Parse a boolean string value into boolean | undefined. */
export function parseBooleanArg(value: string): boolean | undefined {
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "true" || trimmed === "1" || trimmed === "yes") return true;
  if (trimmed === "false" || trimmed === "0" || trimmed === "no") return false;
  return undefined;
}

/** Parse a positive integer from a string, or throw. */
function parsePositiveInt(value: string): number {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0 || !Number.isInteger(num)) {
    throw new Error(`expected a positive integer, got "${value}"`);
  }
  return num;
}

/** Parse command arguments for /lmstudio-load. */
export function parseLoadArgs(args: string): LoadModelCommandArgs {
  const trimmed = args.trim();
  if (!trimmed) {
    throw new Error("model key is required");
  }

  // Split into tokens, respecting quoted strings
  const tokens: string[] = [];
  let current = "";
  let inQuote = false;

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === '"') {
      inQuote = !inQuote;
    } else if ((ch === " " || ch === "\t") && !inQuote) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current.length > 0) {
    tokens.push(current);
  }

  if (tokens.length === 0) {
    throw new Error("model key is required");
  }

  const model = tokens[0];
  const result: LoadModelCommandArgs = { model };

  // Parse flags starting from index 1
  for (let i = 1; i < tokens.length; i++) {
    const token = tokens[i];

    if (!token.startsWith("--")) {
      throw new Error(`unexpected argument "${token}" — expected a flag like --context-length`);
    }

    // Find the matching flag and its value (next token)
    let value: string | undefined;
    if (i + 1 < tokens.length && !tokens[i + 1].startsWith("--")) {
      value = tokens[i + 1];
      i++; // skip next token since we consumed it
    }

    switch (token) {
      case "--context-length": {
        if (value === undefined) throw new Error("--context-length requires a positive integer");
        result.contextLength = parsePositiveInt(value);
        break;
      }
      case "--flash-attention": {
        if (value !== undefined) {
          const parsed = parseBooleanArg(value);
          if (parsed === undefined)
            throw new Error(`--flash-attention expects true or false, got "${value}"`);
          result.flashAttention = parsed;
        } else {
          // Flag without value defaults to true
          result.flashAttention = true;
        }
        break;
      }
      case "--eval-batch-size": {
        if (value === undefined) throw new Error("--eval-batch-size requires a positive integer");
        result.evalBatchSize = parsePositiveInt(value);
        break;
      }
      case "--num-experts": {
        if (value === undefined) throw new Error("--num-experts requires a positive integer");
        result.numExperts = parsePositiveInt(value);
        break;
      }
      case "--offload-kv-cache-to-gpu": {
        if (value !== undefined) {
          const parsed = parseBooleanArg(value);
          if (parsed === undefined)
            throw new Error(`--offload-kv-cache-to-gpu expects true or false, got "${value}"`);
          result.offloadKvCacheToGpu = parsed;
        } else {
          result.offloadKvCacheToGpu = true;
        }
        break;
      }
      default:
        throw new Error(
          `unknown flag "${token}" — supported flags are --context-length, --flash-attention, --eval-batch-size, --num-experts, --offload-kv-cache-to-gpu`,
        );
    }
  }

  return result;
}
