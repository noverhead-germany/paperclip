import { describe, expect, it } from "vitest";
import { getUIAdapter, listUIAdapters } from "./registry";
import { getAdapterDisplay } from "./adapter-display-registry";
import { CONNECT_SOURCE_NAMES } from "../components/AdapterLoginChrome";
import type { CreateConfigValues } from "@paperclipai/adapter-utils";

describe("NOverhead onboarding source", () => {
  it("registers a real Pi-backed third source while retaining Claude and OpenAI", () => {
    for (const type of ["claude_local", "codex_local", "noverhead_node"]) {
      expect(listUIAdapters().some(adapter => adapter.type === type)).toBe(true);
      expect(getAdapterDisplay(type).recommended).toBe(true);
    }
    expect(CONNECT_SOURCE_NAMES.noverhead_node).toBe("NOverhead Node");
    const built = getUIAdapter("noverhead_node").buildAdapterConfig({ url: "http://node:18766/v1" } as CreateConfigValues);
    expect(built).toMatchObject({ url: "http://node:18766/v1", model: "noverhead/node-default" });
    expect(built).not.toHaveProperty("apiKey");
  });
});
