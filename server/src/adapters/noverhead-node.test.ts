import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServerAdapterModule } from "./types.js";

const pi = vi.hoisted(() => ({ execute: vi.fn(), test: vi.fn(), cleanup: vi.fn() }));
vi.mock("@paperclipai/adapter-pi-local/server", () => ({
  execute: pi.execute,
  testEnvironment: pi.test,
  preparePiRuntimeConfig: async ({ env }: { env: Record<string, string> }) => ({ env, cleanup: pi.cleanup }),
}));
import { createNOverheadNodeAdapter, nodeAdapterConfig, NODE_KEY, NODE_MODEL } from "./noverhead-node.js";

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("NOverhead Node adapter preset", () => {
  const config = { url: "http://node:18766/v1", env: { [NODE_KEY]: "test-node-token" } };
  const adapter = () => createNOverheadNodeAdapter({ type: "pi_local" } as ServerAdapterModule);

  it("preserves Pi and keeps provider credentials out of the declarative model registry", () => {
    const built = nodeAdapterConfig({ ...config, model: "caller-selected-provider" });
    expect(built.model).toBe(NODE_MODEL);
    const env = built.env as Record<string, string>;
    expect(env.PAPERCLIP_PI_PROVIDERS).not.toContain("test-node-token");
    expect(JSON.parse(env.PAPERCLIP_PI_PROVIDERS).noverhead).toMatchObject({
      baseUrl: config.url, api: "openai-completions", apiKey: `{env:${NODE_KEY}}`,
    });
    expect(() => nodeAdapterConfig({ ...config, url: "http://169.254.169.254/v1" })).toThrow();
    expect(() => nodeAdapterConfig({ ...config, env: {} })).toThrow();
  });

  it("does not treat an unauthorized Node or a mere runtime warning as a connection", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("private-body", { status: 403 })));
    const denied = await adapter().testEnvironment({ companyId: "company", adapterType: "noverhead_node", config });
    expect(denied.status).toBe("fail");
    expect(pi.test).not.toHaveBeenCalled();
    expect(JSON.stringify(denied)).not.toContain("private-body");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: [{ id: "node-default" }] })));
    pi.test.mockResolvedValue({ status: "warn", checks: [{ code: "pi_hello_probe_timed_out", level: "warn" }], testedAt: "now" });
    const warning = await adapter().testEnvironment({ companyId: "company", adapterType: "noverhead_node", config });
    expect(warning.status).toBe("fail");
    expect(pi.cleanup).toHaveBeenCalledOnce();
  });

  it("requires a successful provider hello through Pi and retains the existing execution machinery", async () => {
    const fetch = vi.fn(async () => Response.json({ data: [{ id: "node-default" }] }));
    vi.stubGlobal("fetch", fetch);
    pi.test.mockResolvedValue({ status: "pass", checks: [{ code: "pi_hello_probe_passed", level: "info" }], testedAt: "now" });
    const result = await adapter().testEnvironment({ companyId: "company", adapterType: "noverhead_node", config });
    expect(result.status).toBe("pass");
    expect(fetch).toHaveBeenCalledWith("http://node:18766/v1/models", expect.objectContaining({ headers: { authorization: "Bearer test-node-token" } }));
    expect(pi.test.mock.calls[0][0].config.model).toBe(NODE_MODEL);
    pi.execute.mockResolvedValue({ exitCode: 0, summary: "provider-result" });
    const execution = await adapter().execute({ config } as unknown as Parameters<ServerAdapterModule["execute"]>[0]);
    expect(execution.summary).toBe("provider-result");
    expect(pi.execute.mock.calls[0][0].config.model).toBe(NODE_MODEL);
  });
});
