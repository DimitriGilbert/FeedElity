import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, normalize, relative, resolve } from "node:path";

import { runSqlMigration } from "@FeedElity/db/bootstrap";
import { parseDesktopLocalPortConfig, parseDesktopRemoteServerConfig, type RuntimeMode } from "@FeedElity/env/runtime";

const desktopLocalPort = 3217;
const hmrViewOrigin = "http://localhost:3001";
const initialMigrationId = "0000_fuzzy_greymalkin";
const initialMigrationFilename = `${initialMigrationId}.sql`;

export interface DesktopBackendEnvironment {
  readonly RUNTIME_MODE?: string;
  readonly VITE_RUNTIME_MODE?: string;
  readonly FEELITY_DESKTOP_MODE?: string;
  readonly FEELITY_DESKTOP_DATA_DIR?: string;
  readonly FEELITY_DESKTOP_MIGRATIONS_DIR?: string;
  readonly FEELITY_DESKTOP_STATIC_DIR?: string;
  readonly FEELITY_DESKTOP_CORS_ORIGIN?: string;
  readonly FEELITY_DESKTOP_PORT?: string;
  readonly FEELITY_DESKTOP_REMOTE_SERVER_URL?: string;
  readonly VITE_SERVER_URL?: string;
  readonly HOME?: string;
  readonly XDG_DATA_HOME?: string;
  readonly APPDATA?: string;
}

export interface DesktopBackendConfig {
  readonly mode: "desktop-local";
  readonly port: number;
  readonly serverUrl: string;
  readonly databaseUrl: string;
  readonly dataDirectory: string;
  readonly authSecretPath: string;
  readonly authSecret: string;
  readonly corsOrigin: string;
}

export interface DesktopRemoteBackendConfig {
  readonly mode: "desktop-remote";
  readonly serverUrl: string;
}

export type DesktopRuntimeConfig = DesktopBackendConfig | DesktopRemoteBackendConfig;

interface ServerModule {
  readonly app: {
    readonly fetch: (request: Request) => Response | Promise<Response>;
  };
}

interface FileSystemError extends Error {
  readonly code?: unknown;
}

export interface StartedDesktopBackend {
  readonly config: DesktopBackendConfig;
  readonly server: Bun.Server<undefined>;
}

export interface StartedDesktopRemoteBackend {
  readonly config: DesktopRemoteBackendConfig;
  readonly server: null;
}

export type StartedDesktopRuntimeBackend = StartedDesktopBackend | StartedDesktopRemoteBackend;

type StartDesktopLocalBackend = (env?: DesktopBackendEnvironment, port?: number) => Promise<StartedDesktopBackend>;

function isServerModule(value: unknown): value is ServerModule {
  if (typeof value !== "object" || value === null || !("app" in value)) {
    return false;
  }

  const appValue = value.app;
  return typeof appValue === "object" && appValue !== null && "fetch" in appValue && typeof appValue.fetch === "function";
}

function isMissingFileError(error: unknown): error is FileSystemError {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function requireHomeDirectory(env: DesktopBackendEnvironment): string {
  if (env.HOME !== undefined && env.HOME.length > 0) {
    return env.HOME;
  }

  throw new Error("Desktop local backend needs HOME or FEELITY_DESKTOP_DATA_DIR to resolve a writable data directory.");
}

function readProcessBackendEnvironment(): DesktopBackendEnvironment {
  return {
    RUNTIME_MODE: process.env.RUNTIME_MODE,
    VITE_RUNTIME_MODE: process.env.VITE_RUNTIME_MODE,
    FEELITY_DESKTOP_MODE: process.env.FEELITY_DESKTOP_MODE,
    FEELITY_DESKTOP_DATA_DIR: process.env.FEELITY_DESKTOP_DATA_DIR,
    FEELITY_DESKTOP_MIGRATIONS_DIR: process.env.FEELITY_DESKTOP_MIGRATIONS_DIR,
    FEELITY_DESKTOP_STATIC_DIR: process.env.FEELITY_DESKTOP_STATIC_DIR,
    FEELITY_DESKTOP_CORS_ORIGIN: process.env.FEELITY_DESKTOP_CORS_ORIGIN,
    FEELITY_DESKTOP_PORT: process.env.FEELITY_DESKTOP_PORT,
    FEELITY_DESKTOP_REMOTE_SERVER_URL: process.env.FEELITY_DESKTOP_REMOTE_SERVER_URL,
    VITE_SERVER_URL: process.env.VITE_SERVER_URL,
    HOME: process.env.HOME,
    XDG_DATA_HOME: process.env.XDG_DATA_HOME,
    APPDATA: process.env.APPDATA,
  };
}

function isDesktopRuntimeMode(value: string | undefined, mode: RuntimeMode): boolean {
  return value === mode;
}

export function resolveDesktopRuntimeMode(env: DesktopBackendEnvironment = readProcessBackendEnvironment()): DesktopRuntimeConfig["mode"] {
  if (
    env.FEELITY_DESKTOP_MODE === "remote" ||
    isDesktopRuntimeMode(env.RUNTIME_MODE, "desktop-remote") ||
    isDesktopRuntimeMode(env.VITE_RUNTIME_MODE, "desktop-remote")
  ) {
    return "desktop-remote";
  }

  if (
    env.FEELITY_DESKTOP_MODE !== undefined &&
    env.FEELITY_DESKTOP_MODE !== "local" &&
    env.FEELITY_DESKTOP_MODE !== "desktop-local"
  ) {
    throw new Error("FEELITY_DESKTOP_MODE must be local or remote.");
  }

  return "desktop-local";
}

export function resolveDesktopDataDirectory(
  env: DesktopBackendEnvironment = readProcessBackendEnvironment(),
  platform: NodeJS.Platform = process.platform,
): string {
  if (env.FEELITY_DESKTOP_DATA_DIR !== undefined && env.FEELITY_DESKTOP_DATA_DIR.length > 0) {
    return env.FEELITY_DESKTOP_DATA_DIR;
  }

  if (platform === "win32" && env.APPDATA !== undefined && env.APPDATA.length > 0) {
    return join(env.APPDATA, "FeedElity");
  }

  if (platform === "darwin") {
    return join(requireHomeDirectory(env), "Library", "Application Support", "FeedElity");
  }

  if (env.XDG_DATA_HOME !== undefined && env.XDG_DATA_HOME.length > 0) {
    return join(env.XDG_DATA_HOME, "FeedElity");
  }

  return join(requireHomeDirectory(env), ".local", "share", "FeedElity");
}

export function createDesktopLocalServerUrl(port: number = desktopLocalPort): string {
  return `http://127.0.0.1:${port}`;
}

export function isResolvedPathInsideRoot(root: string, targetPath: string): boolean {
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(targetPath);
  const relativePath = relative(resolvedRoot, resolvedTarget);

  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

export function addDesktopRuntimeQuery(viewUrl: string, config: DesktopRuntimeConfig | string): string {
  const runtimeConfig = typeof config === "string" ? { mode: "desktop-local" as const, serverUrl: config } : config;
  const separator = viewUrl.includes("?") ? "&" : "?";
  const params = new URLSearchParams({
    feedelityRuntimeMode: runtimeConfig.mode,
    feedelityServerUrl: runtimeConfig.serverUrl,
  });

  return `${viewUrl}${separator}${params.toString()}`;
}

export function resolveDesktopRemoteBackendConfig(env: DesktopBackendEnvironment = readProcessBackendEnvironment()): DesktopRemoteBackendConfig {
  return {
    mode: "desktop-remote",
    serverUrl: parseDesktopRemoteServerConfig({
      FEELITY_DESKTOP_REMOTE_SERVER_URL: env.FEELITY_DESKTOP_REMOTE_SERVER_URL ?? env.VITE_SERVER_URL,
    }),
  };
}

export async function startConfiguredDesktopBackend(
  env: DesktopBackendEnvironment = readProcessBackendEnvironment(),
  startLocalBackend: StartDesktopLocalBackend = startDesktopLocalBackend,
): Promise<StartedDesktopRuntimeBackend> {
  if (resolveDesktopRuntimeMode(env) === "desktop-remote") {
    return {
      config: resolveDesktopRemoteBackendConfig(env),
      server: null,
    };
  }

  return startLocalBackend(env);
}

async function readOrCreateAuthSecret(path: string): Promise<string> {
  try {
    const existing = (await readFile(path, "utf8")).trim();
    if (existing.length >= 32) {
      return existing;
    }
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw new Error(`Failed to read desktop auth secret at ${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const secret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
  await writeFile(path, `${secret}\n`, { mode: 0o600 });
  return secret;
}

export async function resolveDesktopBackendConfig(
  env: DesktopBackendEnvironment = readProcessBackendEnvironment(),
  port?: number,
): Promise<DesktopBackendConfig> {
  const resolvedPort = parseDesktopLocalPortConfig({ FEELITY_DESKTOP_PORT: port ?? env.FEELITY_DESKTOP_PORT });
  const dataDirectory = resolveDesktopDataDirectory(env);
  await mkdir(dataDirectory, { recursive: true });

  const serverUrl = createDesktopLocalServerUrl(resolvedPort);
  const authSecretPath = join(dataDirectory, "auth-secret");

  return {
    mode: "desktop-local",
    port: resolvedPort,
    serverUrl,
    databaseUrl: `file:${join(dataDirectory, "feedelity.db")}`,
    dataDirectory,
    authSecretPath,
    authSecret: await readOrCreateAuthSecret(authSecretPath),
    corsOrigin:
      env.FEELITY_DESKTOP_CORS_ORIGIN !== undefined && env.FEELITY_DESKTOP_CORS_ORIGIN.length > 0
        ? env.FEELITY_DESKTOP_CORS_ORIGIN
        : hmrViewOrigin,
  };
}

export async function findDesktopStaticDirectory(env: DesktopBackendEnvironment): Promise<string | null> {
  const candidates = [
    env.FEELITY_DESKTOP_STATIC_DIR ?? null,
    new URL("../views/mainview", import.meta.url).pathname,
  ].filter((path): path is string => path !== null);

  for (const candidate of candidates) {
    const indexFile = Bun.file(join(candidate, "index.html"));
    if (await indexFile.exists()) {
      return candidate;
    }
  }

  return null;
}

function toStaticPath(pathname: string): string | null {
  if (pathname === "/index.html") {
    return "index.html";
  }

  if (pathname.startsWith("/assets/") || pathname === "/robots.txt") {
    return normalize(pathname.slice(1));
  }

  return null;
}

async function createDesktopLocalFetch(
  appFetch: ServerModule["app"]["fetch"],
  env: DesktopBackendEnvironment,
): Promise<ServerModule["app"]["fetch"]> {
  const staticDirectory = await findDesktopStaticDirectory(env);
  if (staticDirectory === null) {
    return appFetch;
  }

  const staticRoot = resolve(staticDirectory);

  return async (request) => {
    const url = new URL(request.url);
    const staticPath = toStaticPath(url.pathname);
    if (staticPath !== null) {
      const filePath = resolve(staticRoot, staticPath);
      if (isResolvedPathInsideRoot(staticRoot, filePath)) {
        const file = Bun.file(filePath);
        if (await file.exists()) {
          return new Response(file);
        }
      }
    }

    return appFetch(request);
  };
}

export async function readInitialMigrationSql(env: DesktopBackendEnvironment): Promise<string> {
  const candidates = [
    env.FEELITY_DESKTOP_MIGRATIONS_DIR === undefined ? null : join(env.FEELITY_DESKTOP_MIGRATIONS_DIR, initialMigrationFilename),
    new URL(`../db-migrations/${initialMigrationFilename}`, import.meta.url).pathname,
  ].filter((path): path is string => path !== null);

  const failures: string[] = [];

  for (const candidate of candidates) {
    try {
      return await readFile(candidate, "utf8");
    } catch (error) {
      failures.push(`${candidate}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`Desktop local backend could not load database migration ${initialMigrationFilename}. ${failures.join("; ")}`);
}

export async function startDesktopLocalBackend(
  env: DesktopBackendEnvironment = readProcessBackendEnvironment(),
  port?: number,
): Promise<StartedDesktopBackend> {
  const config = await resolveDesktopBackendConfig(env, port);
  const migrationSql = await readInitialMigrationSql(env);

  await runSqlMigration({ databaseUrl: config.databaseUrl, migrationId: initialMigrationId, sql: migrationSql });

  process.env.RUNTIME_MODE = config.mode;
  process.env.DATABASE_URL = config.databaseUrl;
  process.env.BETTER_AUTH_SECRET = config.authSecret;
  process.env.BETTER_AUTH_URL = config.serverUrl;
  process.env.CORS_ORIGIN = config.corsOrigin;
  process.env.PORT = String(config.port);

  const serverModule = await import("server");
  if (!isServerModule(serverModule)) {
    throw new Error("Desktop local backend could not load the Hono server module.");
  }

  try {
    const fetch = await createDesktopLocalFetch(serverModule.app.fetch, env);

    return {
      config,
      server: Bun.serve({ port: config.port, fetch }),
    };
  } catch (error) {
    throw new Error(`Desktop local backend failed to start on ${config.serverUrl}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
