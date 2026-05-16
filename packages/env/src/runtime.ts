import { z } from "zod";

export const runtimeModeSchema = z.enum(["local", "web", "desktop-local", "desktop-remote"]);

export const serverRuntimeModeSchema = runtimeModeSchema.exclude(["desktop-remote"]);

export const absoluteHttpUrlSchema = z
  .url()
  .refine((value) => {
    const parsed = new URL(value);

    return parsed.protocol === "http:" || parsed.protocol === "https:";
  }, "URL must use http or https.")
  .transform((value) => value.replace(/\/+$/, ""));

export const desktopLocalPortSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(65_535)
  .refine((port) => port !== 3000, "Desktop local backend port must not use 3000.")
  .default(3217);

export type RuntimeMode = z.infer<typeof runtimeModeSchema>;
export type ServerRuntimeMode = z.infer<typeof serverRuntimeModeSchema>;

export interface WebRuntimeConfigInput {
  readonly VITE_RUNTIME_MODE?: string;
  readonly VITE_SERVER_URL?: string;
}

export interface DesktopLocalPortConfigInput {
  readonly FEELITY_DESKTOP_PORT?: string | number;
}

export interface DesktopRemoteServerConfigInput {
  readonly FEELITY_DESKTOP_REMOTE_SERVER_URL?: string;
}

export interface WebRuntimeConfigOverrideInput {
  readonly mode?: string | null;
  readonly serverUrl?: string | null;
}

export interface WebRuntimeConfig {
  readonly mode: RuntimeMode;
  readonly serverUrl: string;
  readonly rpcUrl: string;
}

const webRuntimeConfigSchema = z.object({
  VITE_RUNTIME_MODE: runtimeModeSchema.default("local"),
  VITE_SERVER_URL: absoluteHttpUrlSchema,
});

export function appendRuntimePath(baseUrl: string, path: `/${string}`): string {
  const normalizedBaseUrl = absoluteHttpUrlSchema.parse(baseUrl);

  return `${normalizedBaseUrl}${path}`;
}

export function parseDesktopLocalPortConfig(input: DesktopLocalPortConfigInput = {}): number {
  return desktopLocalPortSchema.parse(input.FEELITY_DESKTOP_PORT);
}

export function parseDesktopRemoteServerConfig(input: DesktopRemoteServerConfigInput): string {
  return absoluteHttpUrlSchema.parse(input.FEELITY_DESKTOP_REMOTE_SERVER_URL);
}

export function parseWebRuntimeConfig(
  input: WebRuntimeConfigInput,
  override: WebRuntimeConfigOverrideInput = {},
): WebRuntimeConfig {
  const parsed = webRuntimeConfigSchema.parse({
    ...input,
    ...(override.mode === undefined || override.mode === null ? {} : { VITE_RUNTIME_MODE: override.mode }),
    ...(override.serverUrl === undefined || override.serverUrl === null ? {} : { VITE_SERVER_URL: override.serverUrl }),
  });

  return {
    mode: parsed.VITE_RUNTIME_MODE,
    serverUrl: parsed.VITE_SERVER_URL,
    rpcUrl: appendRuntimePath(parsed.VITE_SERVER_URL, "/rpc"),
  };
}
