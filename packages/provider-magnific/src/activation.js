import {
  createRuntimeEndpointAdapterFacet,
  runtimeConfigActionLimits,
  runtimeConfigCredentialRef,
  runtimeConfigExact,
  runtimeConfigObject,
  runtimeConfigPositiveInteger,
  runtimeConfigString,
} from "@hypit/hypit/runtime-kit";
import { createMagnificProvider, diagnoseMagnificProvider, magnificProviderModuleRef } from "./provider.js";

const adapter = createRuntimeEndpointAdapterFacet({
  use: magnificProviderModuleRef.name,
  activate(context) {
    if (context.pool === undefined) throw new Error("Magnific Provider Pool is required");
    const config = runtimeConfigObject(context.config ?? {}, "Magnific");
    runtimeConfigExact(config, [
      "baseUrl", "apiKey", "defaultConcurrency", "actionLimits", "pollIntervalMs", "requestTimeoutMs", "operationTimeoutMs",
    ], "Magnific");
    const apiKey = runtimeConfigCredentialRef(config.apiKey, "Magnific apiKey");
    if (apiKey === undefined) throw new Error("Magnific apiKey CredentialRef is required");
    const optional = {
      baseUrl: runtimeConfigString(config.baseUrl, "Magnific baseUrl"),
      defaultConcurrency: runtimeConfigPositiveInteger(config.defaultConcurrency, "Magnific defaultConcurrency"),
      actionLimits: runtimeConfigActionLimits(config.actionLimits),
      pollIntervalMs: runtimeConfigPositiveInteger(config.pollIntervalMs, "Magnific pollIntervalMs"),
      requestTimeoutMs: runtimeConfigPositiveInteger(config.requestTimeoutMs, "Magnific requestTimeoutMs"),
      operationTimeoutMs: runtimeConfigPositiveInteger(config.operationTimeoutMs, "Magnific operationTimeoutMs"),
    };
    const options = {
      instance: context.instance,
      pool: context.pool,
      apiKey,
      ...Object.fromEntries(Object.entries(optional).filter(([, value]) => value !== undefined)),
    };
    return {
      endpoint: createMagnificProvider(options),
      diagnose: async (doctor) => await diagnoseMagnificProvider(options, doctor),
    };
  },
});

export default {
  format: "hypit.node-package@1",
  hostFacets: [adapter],
};
