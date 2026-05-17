import { existsSync, readdirSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";

type DesktopPlatform = "linux" | "macos" | "windows";
type Channel = "stable" | "canary";
type RuntimeMode = "local" | "remote";

interface BuildOptions {
  readonly platform: DesktopPlatform | null;
  readonly channel: Channel;
  readonly runtimeMode: RuntimeMode;
  readonly remoteServerUrl: string | null;
}

const repoRoot = resolve(import.meta.dir, "..");
const desktopDir = join(repoRoot, "apps", "desktop");
const nativeLinuxDir = join(repoRoot, ".native", "linux-x64", "extracted", "usr", "lib64");

const options = parseArgs(process.argv.slice(2));
const hostPlatform = getHostDesktopPlatform();
const requestedPlatform = options.platform ?? hostPlatform;

if (requestedPlatform !== hostPlatform) {
  throw new Error(
    `Cannot build ${requestedPlatform} desktop artifacts on ${hostPlatform}. Run this script on ${requestedPlatform} instead.`,
  );
}

if (options.runtimeMode === "remote" && options.remoteServerUrl === null) {
  throw new Error("Remote desktop builds require --server-url <url> or FEELITY_DESKTOP_REMOTE_SERVER_URL.");
}

if (hostPlatform === "linux") {
  run(["bun", join(repoRoot, "scripts", "prepare-desktop-linux-native.ts")], repoRoot);
}

const buildEnv = createBuildEnvironment(options, hostPlatform);

run(["turbo", "-F", "web", "build"], repoRoot, buildEnv);
run(["bun", "x", "electrobun", "build", `--env=${options.channel}`], desktopDir, buildEnv);

if (hostPlatform === "linux") {
  run(["bun", join(repoRoot, "scripts", "patch-desktop-linux-bundle.ts")], repoRoot, buildEnv);
}

console.log(`Desktop ${requestedPlatform} ${options.channel} build completed.`);

function parseArgs(args: readonly string[]): BuildOptions {
  let platform: DesktopPlatform | null = null;
  let channel: Channel = "stable";
  let runtimeMode: RuntimeMode = "local";
  let remoteServerUrl: string | null = process.env.FEELITY_DESKTOP_REMOTE_SERVER_URL ?? null;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--platform") {
      platform = parsePlatform(readValue(args, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--channel") {
      channel = parseChannel(readValue(args, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--runtime") {
      runtimeMode = parseRuntimeMode(readValue(args, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--server-url") {
      remoteServerUrl = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { platform, channel, runtimeMode, remoteServerUrl };
}

function readValue(args: readonly string[], index: number, name: string): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} requires a value.`);
  }
  return value;
}

function parsePlatform(value: string): DesktopPlatform {
  if (value === "linux" || value === "macos" || value === "windows") {
    return value;
  }
  throw new Error("--platform must be linux, macos, or windows.");
}

function parseChannel(value: string): Channel {
  if (value === "stable" || value === "canary") {
    return value;
  }
  throw new Error("--channel must be stable or canary.");
}

function parseRuntimeMode(value: string): RuntimeMode {
  if (value === "local" || value === "remote") {
    return value;
  }
  throw new Error("--runtime must be local or remote.");
}

function getHostDesktopPlatform(): DesktopPlatform {
  if (process.platform === "linux") {
    return "linux";
  }
  if (process.platform === "darwin") {
    return "macos";
  }
  if (process.platform === "win32") {
    return "windows";
  }
  throw new Error(`Unsupported host platform: ${process.platform}`);
}

function createBuildEnvironment(options: BuildOptions, hostPlatform: DesktopPlatform): NodeJS.ProcessEnv {
  const runtimeMode = options.runtimeMode === "remote" ? "desktop-remote" : "desktop-local";
  const serverUrl = options.runtimeMode === "remote" ? options.remoteServerUrl : "http://127.0.0.1:3217";
  if (serverUrl === null) {
    throw new Error("Server URL is required.");
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    VITE_RUNTIME_MODE: runtimeMode,
    VITE_SERVER_URL: serverUrl,
  };

  if (options.runtimeMode === "remote") {
    env.FEELITY_DESKTOP_REMOTE_SERVER_URL = serverUrl;
  }

  const libsqlNativeDir = findLibsqlNativePackageDir();
  env.NODE_PATH = [libsqlNativeDir, join(repoRoot, "node_modules"), process.env.NODE_PATH]
    .filter((value): value is string => value !== undefined && value.length > 0)
    .join(delimiter);

  if (hostPlatform === "linux") {
    env.LD_LIBRARY_PATH = [nativeLinuxDir, process.env.LD_LIBRARY_PATH]
      .filter((value): value is string => value !== undefined && value.length > 0)
      .join(delimiter);
  }

  return env;
}

function findLibsqlNativePackageDir(): string {
  const bunNodeModulesDir = join(repoRoot, "node_modules", ".bun");
  if (!existsSync(bunNodeModulesDir)) {
    return join(repoRoot, "node_modules");
  }

  const nativePackagePrefix = getLibsqlNativePackagePrefix();
  for (const entry of readdirSync(bunNodeModulesDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith(nativePackagePrefix)) {
      continue;
    }

    const packageDir = join(bunNodeModulesDir, entry.name, "node_modules", "@libsql", nativePackagePrefix.slice(8, -1));
    if (existsSync(packageDir)) {
      return packageDir;
    }
  }

  return join(repoRoot, "node_modules");
}

function getLibsqlNativePackagePrefix(): string {
  if (process.platform === "linux") {
    return "@libsql+linux-x64-gnu@";
  }
  if (process.platform === "darwin" && process.arch === "arm64") {
    return "@libsql+darwin-arm64@";
  }
  if (process.platform === "darwin") {
    return "@libsql+darwin-x64@";
  }
  if (process.platform === "win32") {
    return "@libsql+win32-x64-msvc@";
  }
  return "@libsql+linux-x64-gnu@";
}

function run(command: readonly string[], cwd: string, env: NodeJS.ProcessEnv = process.env): void {
  const result = Bun.spawnSync(command, {
    cwd,
    env,
    stdout: "inherit",
    stderr: "inherit",
  });

  if (!result.success) {
    throw new Error(`Command failed: ${command.join(" ")}`);
  }
}

function printUsage(): void {
  console.log(`Usage: bun scripts/build-desktop-release.ts [options]

Options:
  --platform linux|macos|windows   Assert the target platform. Must match the current host OS.
  --channel stable|canary          Build channel. Defaults to stable.
  --runtime local|remote           Desktop backend mode. Defaults to local.
  --server-url <url>               Required when --runtime remote unless env is set.
`);
}
