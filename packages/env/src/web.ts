import { createEnv } from "@t3-oss/env-core";

import { absoluteHttpUrlSchema, parseWebRuntimeConfig, runtimeModeSchema } from "./runtime";

interface RuntimeLocationLike {
  readonly search: string;
}

interface RuntimeGlobalLike {
  readonly location?: RuntimeLocationLike;
}

const runtimeEnv = import.meta.env ?? process.env;
const runtimeGlobal = globalThis as RuntimeGlobalLike;

function readRuntimeConfigOverride() {
  const search = runtimeGlobal.location?.search;
  if (search === undefined || search.length === 0) {
    return {};
  }

  const params = new URLSearchParams(search);

  return {
    mode: params.get("feedelityRuntimeMode"),
    serverUrl: params.get("feedelityServerUrl"),
  };
}

export const env = createEnv({
  clientPrefix: "VITE_",
  client: {
    VITE_RUNTIME_MODE: runtimeModeSchema.default("local"),
    VITE_SERVER_URL: absoluteHttpUrlSchema,
  },
  runtimeEnv,
  emptyStringAsUndefined: true,
});

export const webRuntimeConfig = parseWebRuntimeConfig(env, readRuntimeConfigOverride());
