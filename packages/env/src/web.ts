import { createEnv } from "@t3-oss/env-core";

import {
  absoluteHttpUrlSchema,
  parseWebRuntimeConfig,
  runtimeModeSchema,
  type WebRuntimeConfig,
  type WebRuntimeConfigInput,
} from "./runtime";

interface RuntimeLocationLike {
  readonly origin: string;
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

// In a container, the SPA is served by nginx from the same origin it proxies
// to. Defaulting to the page's own origin lets the build ship without a baked
// host and still work behind any deployment domain. Query-string override and
// an explicit VITE_SERVER_URL still take precedence when present.
export function resolveWebServerUrl(input: WebRuntimeConfigInput): string | undefined {
  if (input.VITE_SERVER_URL !== undefined && input.VITE_SERVER_URL.length > 0) {
    return input.VITE_SERVER_URL;
  }

  const origin = runtimeGlobal.location?.origin;
  if (origin !== undefined && origin.length > 0) {
    return origin;
  }

  return undefined;
}

export const env = createEnv({
  clientPrefix: "VITE_",
  client: {
    VITE_RUNTIME_MODE: runtimeModeSchema.default("local"),
    VITE_SERVER_URL: absoluteHttpUrlSchema.optional(),
  },
  runtimeEnv,
  emptyStringAsUndefined: true,
});

// Resolve lazily: the page origin is only available in the browser, and importing
// this module outside one (e.g. tests) must not throw on a missing server URL.
// The getter runs once on first read and caches, so behavior is stable per page load.
let cachedConfig: WebRuntimeConfig | null = null;

export const webRuntimeConfig: WebRuntimeConfig = {
  get mode() {
    return resolveConfig().mode;
  },
  get serverUrl() {
    return resolveConfig().serverUrl;
  },
  get rpcUrl() {
    return resolveConfig().rpcUrl;
  },
};

function resolveConfig(): WebRuntimeConfig {
  if (cachedConfig === null) {
    cachedConfig = parseWebRuntimeConfig(
      { VITE_RUNTIME_MODE: env.VITE_RUNTIME_MODE, VITE_SERVER_URL: resolveWebServerUrl({ VITE_SERVER_URL: env.VITE_SERVER_URL }) },
      readRuntimeConfigOverride(),
    );
  }
  return cachedConfig;
}
