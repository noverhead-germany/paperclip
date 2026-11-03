// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { AdapterConfigFieldsProps } from "../types";
import { defaultCreateValues } from "../../components/agent-config-defaults";
import { invalidateConfigSchemaCache } from "../schema-config-fields";
import { TooltipProvider } from "../../components/ui/tooltip";
import { noverheadNodeUIAdapter } from "./index";

let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  invalidateConfigSchemaCache("noverhead_node");
});

it("renders the adapter schema URL and sends its value through the same config builder used for setup tests", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  invalidateConfigSchemaCache("noverhead_node");
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    expect(String(input)).toBe("/api/adapters/noverhead_node/config-schema");
    return {
      ok: true,
      json: async () => ({ fields: [{ key: "url", label: "NOverhead Node endpoint", type: "text", default: "http://node:18766/v1", required: true }] }),
    } as Response;
  }));
  const set = vi.fn();
  const props: AdapterConfigFieldsProps = {
    mode: "create", isCreate: true, adapterType: "noverhead_node", section: "configuration",
    values: { ...defaultCreateValues, adapterSchemaValues: {} }, set,
    config: {}, eff: (_group, _field, original) => original, mark: vi.fn(), models: [],
  };
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);

  await act(async () => root?.render(<TooltipProvider><noverheadNodeUIAdapter.ConfigFields {...props} /></TooltipProvider>));

  expect(container.textContent).toContain("NOverhead Node endpoint");
  expect(set).toHaveBeenCalledWith({ adapterSchemaValues: { url: "http://node:18766/v1" } });
  expect(noverheadNodeUIAdapter.buildAdapterConfig({
    ...defaultCreateValues,
    adapterSchemaValues: { url: "http://node:18767/v1" },
  })).toMatchObject({ url: "http://node:18767/v1", model: "noverhead/node-default" });
});
