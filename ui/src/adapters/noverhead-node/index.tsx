import { buildPiLocalConfig } from "@paperclipai/adapter-pi-local/ui";
import { parsePiStdoutLine } from "@paperclipai/adapter-pi-local/ui";
import type { CreateConfigValues } from "@paperclipai/adapter-utils";
import type { AdapterConfigFieldsProps, UIAdapterModule } from "../types";
import { PiLocalConfigFields } from "../pi-local/config-fields";
import { SchemaConfigFields } from "../schema-config-fields";

export const NODE_DEFAULT_URL = "http://node:18766/v1";
export const NODE_MODEL = "noverhead/node-default";

function NOverheadNodeConfigFields(props: AdapterConfigFieldsProps) {
  return (
    <>
      <SchemaConfigFields {...props} section={props.section ?? "configuration"} />
      <PiLocalConfigFields {...props} />
    </>
  );
}

function buildNOverheadNodeConfig(values: CreateConfigValues): Record<string, unknown> {
  const config = buildPiLocalConfig(values);
  const configuredUrl = values.adapterSchemaValues?.url ?? values.url;
  return {
    ...config,
    model: NODE_MODEL,
    url: typeof configuredUrl === "string" && configuredUrl.trim() ? configuredUrl.trim() : NODE_DEFAULT_URL,
  };
}

export const noverheadNodeUIAdapter: UIAdapterModule = {
  type: "noverhead_node",
  label: "NOverhead Node",
  parseStdoutLine: parsePiStdoutLine,
  ConfigFields: NOverheadNodeConfigFields,
  buildAdapterConfig: buildNOverheadNodeConfig,
};
