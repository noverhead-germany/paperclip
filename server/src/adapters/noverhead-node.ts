import { execute as executePi, testEnvironment as testPi, preparePiRuntimeConfig } from "@paperclipai/adapter-pi-local/server";
import type { ServerAdapterModule } from "./types.js";

export const NODE_MODEL = "noverhead/node-default";
export const NODE_KEY = "NOVERHEAD_NODE_API_KEY";
export const NODE_DEFAULT_URL = "http://node:18766/v1";

/** A configured Pi preset; Node owns provider/model selection and authorization. */
export function nodeAdapterConfig(config: Record<string, unknown>): Record<string, unknown> {
  const address = typeof config.url === "string" && config.url.trim()
    ? config.url.trim() : process.env.NOVERHEAD_NODE_URL ?? NODE_DEFAULT_URL;
  const url = new URL(address);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash
    || !["node", "localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    || url.pathname.replace(/\/$/, "") !== "/v1") {
    throw new Error("Use the configured local NOverhead Node /v1 endpoint.");
  }
  const env = config.env && typeof config.env === "object" && !Array.isArray(config.env)
    ? config.env as Record<string, unknown> : {};
  if (typeof env[NODE_KEY] !== "string" || !env[NODE_KEY].trim())
    throw new Error("A resolved NOverhead Node bearer credential is required.");
  return {
    ...config,
    model: NODE_MODEL,
    timeoutSec: 180,
    env: {
      ...env,
      PAPERCLIP_PI_PROVIDERS: JSON.stringify({ noverhead: {
        baseUrl: url.toString().replace(/\/$/, ""),
        api: "openai-completions",
        apiKey: `{env:${NODE_KEY}}`,
        models: [{ id: "node-default", name: "NOverhead Node", reasoning: false,
          input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 32768, maxTokens: 4096 }],
      } }),
    },
  };
}

export function createNOverheadNodeAdapter(pi: ServerAdapterModule): ServerAdapterModule {
  return {
    ...pi,
    type: "noverhead_node",
    models: [{ id: NODE_MODEL, label: "Node configured provider" }],
    listModels: async () => [{ id: NODE_MODEL, label: "Node configured provider" }],
    execute: async ctx => {
      if (ctx.executionTarget?.kind === "remote") throw new Error("NOverhead Node currently requires the local Paperclip execution environment.");
      return executePi({ ...ctx, config: nodeAdapterConfig(ctx.config) });
    },
    testEnvironment: async ctx => {
      try {
        if (ctx.executionTarget?.kind === "remote") throw new Error("NOverhead Node currently requires the local Paperclip execution environment.");
        const config = nodeAdapterConfig(ctx.config as Record<string, unknown>);
        const env = config.env as Record<string, string>;
        const providers = JSON.parse(env.PAPERCLIP_PI_PROVIDERS) as { noverhead: { baseUrl: string } };
        const response = await fetch(`${providers.noverhead.baseUrl}/models`, {
          headers: { authorization: `Bearer ${env[NODE_KEY]}` }, signal: AbortSignal.timeout(15_000), redirect: "error",
        });
        if (!response.ok) throw new Error(`Node authorization/configuration check failed (HTTP ${response.status}).`);
        const inventory = await response.json() as { data?: Array<{ id: string }> };
        if (!inventory.data?.some(model => model.id === "node-default")) throw new Error("Node does not advertise its configured model.");
        const prepared = await preparePiRuntimeConfig({ env });
        try {
          const result = await testPi({ ...ctx, config: { ...config, env: prepared.env } });
          const passed = result.checks.some(check => check.code === "pi_hello_probe_passed" && check.level === "info");
          return { ...result, adapterType: "noverhead_node", status: passed && result.status !== "fail" ? "pass" : "fail",
            checks: [...result.checks, { code: "noverhead_node_authenticated", level: "info", message: "Node authenticated the scoped credential and advertised its configured model." }] };
        } finally { await prepared.cleanup(); }
      } catch (error) {
        // Never include provider payloads or the resolved token in diagnostics.
        return { adapterType: "noverhead_node", status: "fail", testedAt: new Date().toISOString(),
          checks: [{ code: "noverhead_node_connection_failed", level: "error",
            message: error instanceof Error && /^(Use the configured|A resolved|Node |NOverhead Node)/.test(error.message)
              ? error.message : "Could not connect to NOverhead Node. Check its address, bearer grant and Pi installation." }] };
      }
    },
    getConfigSchema: () => ({
      fields: [{
        key: "url",
        label: "NOverhead Node endpoint",
        type: "text",
        default: process.env.NOVERHEAD_NODE_URL?.trim() || NODE_DEFAULT_URL,
        required: true,
        hint: "OpenAI-compatible /v1 endpoint for the local NOverhead Node. The API key is managed separately as a Paperclip secret.",
      }],
    }),
    agentConfigurationDoc: "# NOverhead Node\nUses Pi and the OpenAI-compatible Node gateway. Set url to the local Node /v1 endpoint and bind NOVERHEAD_NODE_API_KEY through Paperclip secrets. Node selects the provider and model. No Claude/OpenAI account is required.",
  };
}
