import { describe, expect, it } from "vitest";
import { getUIAdapter, listUIAdapters } from "./registry";
import { getAdapterDisplay } from "./adapter-display-registry";
import { CONNECT_SOURCE_NAMES } from "../components/AdapterLoginChrome";
import type { CreateConfigValues } from "@paperclipai/adapter-utils";
import { defaultCreateValues } from "../components/agent-config-defaults";

describe("NOverhead onboarding source", () => {
  it("registers a real Pi-backed third source while retaining Claude and OpenAI", () => {
    for (const type of ["claude_local", "codex_local", "noverhead_node"]) {
      expect(listUIAdapters().some(adapter => adapter.type === type)).toBe(true);
      expect(getAdapterDisplay(type).recommended).toBe(true);
    }
    expect(CONNECT_SOURCE_NAMES.noverhead_node).toBe("NOverhead Node");
    const adapter = getUIAdapter("noverhead_node");
    expect(adapter.ConfigFields).not.toBe(getUIAdapter("pi_local").ConfigFields);
    const built = adapter.buildAdapterConfig({
      ...defaultCreateValues,
      url: "http://node:18766/v1",
      adapterSchemaValues: { url: "http://node:18766/v1" },
    } satisfies CreateConfigValues);
    expect(built).toMatchObject({ url: "http://node:18766/v1", model: "noverhead/node-default" });
    expect(built).not.toHaveProperty("apiKey");
  });
});
