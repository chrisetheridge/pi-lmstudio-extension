import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  DEFAULT_CONFIG,
  buildProviderConfig,
  fetchOpenAiModels,
  fetchLmStudioModels,
  loadConfigFromSettings,
  mergeConfig,
  parseModelsPayload,
  refreshProvider,
  type LmStudioModelInfo,
  type LmStudioConfig,
} from "../src/index.js";

const ORIGINAL_PI_CODING_AGENT_DIR = process.env.PI_CODING_AGENT_DIR;

afterEach(() => {
  if (ORIGINAL_PI_CODING_AGENT_DIR === undefined) {
    delete process.env.PI_CODING_AGENT_DIR;
  } else {
    process.env.PI_CODING_AGENT_DIR = ORIGINAL_PI_CODING_AGENT_DIR;
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const rawModel = (id: string): LmStudioModelInfo => ({
  id,
  name: id,
  type: "llm",
  input: ["text"],
  loaded: false,
  loadedInstanceIds: [],
  source: "openai",
});

describe("mergeConfig", () => {
  it("uses defaults when settings are missing", () => {
    expect(mergeConfig()).toEqual(DEFAULT_CONFIG);
  });

  it("merges global and project settings with project taking precedence", () => {
    const globalConfig: Partial<LmStudioConfig> = {
      baseUrl: "http://global.test/v1",
      providerName: "global-local",
      contextWindow: 64000,
      reasoning: true,
    };
    const projectConfig: Partial<LmStudioConfig> = {
      providerName: "local",
      maxTokens: 8192,
    };

    expect(mergeConfig(globalConfig, projectConfig)).toEqual({
      ...DEFAULT_CONFIG,
      baseUrl: "http://global.test/v1",
      nativeBaseUrl: "http://global.test/api/v1",
      providerName: "local",
      contextWindow: 64000,
      maxTokens: 8192,
      reasoning: true,
    });
  });

  it("normalizes baseUrl by removing trailing slashes", () => {
    expect(mergeConfig({ baseUrl: "http://localhost:1234/v1///" }).baseUrl).toBe("http://localhost:1234/v1");
  });

  it("accepts a bare LM Studio server URL and normalizes it for OpenAI-compatible requests", () => {
    expect(mergeConfig({ baseUrl: "http://192.168.2.88:1234" })).toMatchObject({
      baseUrl: "http://192.168.2.88:1234/v1",
      nativeBaseUrl: "http://192.168.2.88:1234/api/v1",
    });
  });
});

describe("loadConfigFromSettings", () => {
  it("reads lmstudio settings from global and project Pi settings files", () => {
    const root = join(tmpdir(), `pi-extension-lmstudio-${crypto.randomUUID()}`);
    const agentDir = join(root, "agent");
    const cwd = join(root, "project");
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(
      join(agentDir, "settings.json"),
      JSON.stringify({ lmstudio: { baseUrl: "http://global.test/v1", contextWindow: 64000 } }),
    );
    writeFileSync(join(cwd, ".pi", "settings.json"), JSON.stringify({ lmstudio: { maxTokens: 2048 } }));

    const loaded = loadConfigFromSettings(cwd, agentDir);

    expect(loaded.config).toEqual({
      ...DEFAULT_CONFIG,
      baseUrl: "http://global.test/v1",
      nativeBaseUrl: "http://global.test/api/v1",
      contextWindow: 64000,
      maxTokens: 2048,
    });
    expect(loaded.warnings).toEqual([]);
  });

  it("ignores invalid settings JSON and records a warning", () => {
    const root = join(tmpdir(), `pi-extension-lmstudio-${crypto.randomUUID()}`);
    const agentDir = join(root, "agent");
    const cwd = join(root, "project");
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(join(agentDir, "settings.json"), "{not json");

    const loaded = loadConfigFromSettings(cwd, agentDir);

    expect(loaded.config).toEqual(DEFAULT_CONFIG);
    expect(loaded.warnings[0]).toContain("Could not parse");
  });
});

describe("parseModelsPayload", () => {
  it("parses OpenAI-compatible model list responses", () => {
    const models = parseModelsPayload({
      data: [{ id: "qwen2.5-coder-7b" }, { id: "llama-3.2" }],
    });

    expect(models).toEqual(["qwen2.5-coder-7b", "llama-3.2"]);
  });

  it("filters malformed model entries", () => {
    const models = parseModelsPayload({
      data: [{ id: "valid" }, { id: "" }, { object: "model" }, null],
    });

    expect(models).toEqual(["valid"]);
  });

  it("throws on malformed response shapes", () => {
    expect(() => parseModelsPayload({ models: [] })).toThrow("Expected LM Studio /models response");
  });
});

describe("parseNativeModelsPayload", () => {
  it("parses current LM Studio native models responses with a models array", async () => {
    const { parseNativeModelsPayload } = await import("../src/index.js");

    expect(
      parseNativeModelsPayload({
        models: [
          {
            type: "llm",
            key: "unsloth/qwen3.6-35b-a3b",
            display_name: "Qwen3.6 35B A3B UD",
            max_context_length: 262144,
            loaded_instances: [
              {
                id: "unsloth/qwen3.6-35b-a3b",
                config: {
                  context_length: 64213,
                },
              },
            ],
            capabilities: {
              vision: true,
              trained_for_tool_use: true,
            },
          },
        ],
      }),
    ).toEqual([
      expect.objectContaining({
        id: "unsloth/qwen3.6-35b-a3b",
        name: "Qwen3.6 35B A3B UD",
        input: ["text", "image"],
        loaded: true,
        loadedInstanceIds: ["unsloth/qwen3.6-35b-a3b"],
        contextWindow: 64213,
      }),
    ]);
  });
});

describe("buildProviderConfig", () => {
  it("uses provider local while preserving raw model IDs", () => {
    const config = mergeConfig();
    const providerConfig = buildProviderConfig(config, [rawModel("qwen2.5-coder-7b")]);

    expect(config.providerName).toBe("local");
    expect(providerConfig.models).toMatchObject([
      {
        id: "qwen2.5-coder-7b",
        name: "qwen2.5-coder-7b",
        api: "openai-completions",
        reasoning: false,
        input: ["text"],
        contextWindow: 128000,
        maxTokens: 16384,
        compat: {
          supportsDeveloperRole: false,
          supportsReasoningEffort: false,
          supportsStrictMode: false,
          maxTokensField: "max_tokens",
        },
      },
    ]);
    expect(providerConfig).toMatchObject({
      baseUrl: "http://localhost:1234/v1",
      apiKey: "lmstudio",
      api: "openai-completions",
    });
  });
});

describe("fetchOpenAiModels", () => {
  it("fetches models from the normalized /v1/models endpoint", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "local-model" }] })));

    await expect(fetchOpenAiModels(mergeConfig({ baseUrl: "http://192.168.2.88:1234" }), fetchImpl)).resolves.toEqual([
      expect.objectContaining({ id: "local-model" }),
    ]);
    expect(fetchImpl).toHaveBeenCalledWith("http://192.168.2.88:1234/v1/models", expect.objectContaining({ method: "GET" }));
  });
});

describe("fetchLmStudioModels", () => {
  it("fetches and parses models from baseUrl/models", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "local-model" }] })));

    await expect(fetchLmStudioModels("http://localhost:1234/v1", fetchImpl)).resolves.toEqual(["local-model"]);
    expect(fetchImpl).toHaveBeenCalledWith("http://localhost:1234/v1/models", expect.objectContaining({ method: "GET" }));
  });

  it("throws a useful error for non-OK responses", async () => {
    const fetchImpl = vi.fn(async () => new Response("not found", { status: 404, statusText: "Not Found" }));

    await expect(fetchLmStudioModels("http://localhost:1234/v1", fetchImpl)).rejects.toThrow(
      "model fetch failed: 404 Not Found",
    );
  });
});

describe("refreshProvider", () => {
  it("registers the configured provider with fetched models", async () => {
    const pi = { registerProvider: vi.fn() };
    const result = await refreshProvider(pi, mergeConfig(), async () => ({ models: [rawModel("raw-model")], source: "openai" }));

    expect(result).toEqual({ ok: true, count: 1, models: ["raw-model"], source: "openai" });
    expect(pi.registerProvider).toHaveBeenCalledWith(
      "local",
      expect.objectContaining({
        models: [expect.objectContaining({ id: "raw-model" })],
      }),
    );
  });

  it("does not throw or register models when fetch fails", async () => {
    const pi = { registerProvider: vi.fn() };
    const result = await refreshProvider(pi, mergeConfig(), async () => {
      throw new Error("connection refused");
    });

    expect(result).toEqual({ ok: false, error: "connection refused" });
    expect(pi.registerProvider).not.toHaveBeenCalled();
  });
});

describe("lmStudioExtension", () => {
  it("registers discovered models during extension load so saved defaults can restore", async () => {
    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ models: [{ type: "llm", key: "startup-model" }] }))));
    const root = join(tmpdir(), `pi-extension-lmstudio-extension-${crypto.randomUUID()}`);
    const agentDir = join(root, "agent");
    mkdirSync(agentDir, { recursive: true });
    process.env.PI_CODING_AGENT_DIR = agentDir;

    const { default: lmStudioExtension } = await import("../src/index.js");
    const pi = {
      registerFlag: vi.fn(),
      getFlag: vi.fn(),
      on: vi.fn(),
      registerProvider: vi.fn(),
      unregisterProvider: vi.fn(),
      registerCommand: vi.fn(),
    };

    await lmStudioExtension(pi as never);

    expect(pi.registerProvider).toHaveBeenCalledWith(
      "local",
      expect.objectContaining({
        models: [expect.objectContaining({ id: "startup-model" })],
      }),
    );
  });

  it("resolves the debug flag on session_start after CLI flags are available", async () => {
    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: [] }))));
    const root = join(tmpdir(), `pi-extension-lmstudio-extension-${crypto.randomUUID()}`);
    const agentDir = join(root, "agent");
    const cwd = join(root, "project");
    mkdirSync(agentDir, { recursive: true });
    mkdirSync(cwd, { recursive: true });
    process.env.PI_CODING_AGENT_DIR = agentDir;

    const { default: lmStudioExtension, isDebugEnabled } = await import("../src/index.js");
    const handlers = new Map<string, (event: unknown, ctx: { cwd: string; ui: { notify: () => void } }) => Promise<void>>();
    let flagsAvailable = false;
    const pi = {
      registerFlag: vi.fn(),
      getFlag: vi.fn((name: string) => (flagsAvailable && name === "lmstudio-debug" ? true : undefined)),
      on: vi.fn((event: string, handler: (event: unknown, ctx: { cwd: string; ui: { notify: () => void } }) => Promise<void>) => {
        handlers.set(event, handler);
      }),
      registerProvider: vi.fn(),
      unregisterProvider: vi.fn(),
      registerCommand: vi.fn(),
    };

    await lmStudioExtension(pi as never);

    expect(isDebugEnabled()).toBe(false);

    flagsAvailable = true;
    await handlers.get("session_start")?.({ type: "session_start", reason: "new" }, { cwd, ui: { notify: vi.fn() } });

    expect(isDebugEnabled()).toBe(true);
  });
});
