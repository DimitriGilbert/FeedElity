import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = import.meta.dir.replace(/\/scripts$/, "");
const PID_DIR = join(ROOT, ".serve");
const SERVER_PID_FILE = join(PID_DIR, "server.pid");
const CLIENT_PID_FILE = join(PID_DIR, "client.pid");

const DEFAULT_CLIENT_PORT = 42666;
const DEFAULT_SERVER_PORT = 42667;

function parseArgs(args: string[]): Record<string, string | boolean> {
  const parsed: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        parsed[key] = next;
        i++;
      } else {
        parsed[key] = true;
      }
    } else {
      parsed._command = arg;
    }
  }
  return parsed;
}

function readPid(file: string): number | null {
  if (!existsSync(file)) return null;
  const raw = readFileSync(file, "utf-8").trim();
  const pid = Number.parseInt(raw, 10);
  if (Number.isNaN(pid)) return null;
  try {
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function ensureDir(dir: string) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function parseEnvFile(filePath: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!existsSync(filePath)) return result;
  const content = readFileSync(filePath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    result[key] = value;
  }
  return result;
}

async function build(serverPort: number) {
  console.log("[build]  building all packages...");
  const proc = Bun.spawn(["bun", "run", "build"], {
    cwd: ROOT,
    env: {
      ...process.env,
      VITE_SERVER_URL: `http://localhost:${serverPort}`,
    },
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`build failed (exit code ${exitCode})`);
  }
}

function startServer(serverPort: number, clientPort: number, serverEnv: Record<string, string>): number {
  const proc = Bun.spawn(["bun", "run", "dist/index.mjs"], {
    cwd: join(ROOT, "apps/server"),
    env: {
      ...process.env,
      ...serverEnv,
      PORT: String(serverPort),
      CORS_ORIGIN: `http://localhost:${clientPort}`,
      BETTER_AUTH_URL: `http://localhost:${serverPort}`,
    },
    stdout: "inherit",
    stderr: "inherit",
    detached: true,
  });
  proc.unref();
  return proc.pid;
}

function startClient(clientPort: number, serverPort: number): number {
  const webDist = join(ROOT, "apps/web/dist");
  const scriptPath = join(PID_DIR, "client-server.ts");
  writeFileSync(scriptPath, CLIENT_SERVER_SCRIPT, "utf-8");

  const proc = Bun.spawn(["bun", "run", scriptPath], {
    cwd: ROOT,
    env: {
      ...process.env,
      FEELITY_SERVE_CLIENT_PORT: String(clientPort),
      FEELITY_SERVE_SERVER_PORT: String(serverPort),
      FEELITY_SERVE_WEB_DIST: webDist,
    },
    stdout: "inherit",
    stderr: "inherit",
    detached: true,
  });
  proc.unref();
  return proc.pid;
}

const CLIENT_SERVER_SCRIPT = `import { join } from "node:path";

const CLIENT_PORT = Number(process.env.FEELITY_SERVE_CLIENT_PORT);
const SERVER_PORT = Number(process.env.FEELITY_SERVE_SERVER_PORT);
const WEB_DIST = process.env.FEELITY_SERVE_WEB_DIST;

const server = Bun.serve({
  port: CLIENT_PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (
      url.pathname.startsWith("/rpc/") ||
      url.pathname.startsWith("/api/") ||
      url.pathname.startsWith("/api-reference/")
    ) {
      const target = new URL(req.url);
      target.protocol = "http:";
      target.host = "localhost";
      target.port = String(SERVER_PORT);
      const headers = new Headers(req.headers);
      headers.set("Host", target.host);
      const init: RequestInit = { method: req.method, headers };
      if (req.method !== "GET" && req.method !== "HEAD") {
        init.body = req.body;
      }
      return fetch(target, init);
    }

    let filePath = join(WEB_DIST, url.pathname);
    const file = Bun.file(filePath);
    if (!(await file.exists()) || (await file.stat())?.isDirectory) {
      filePath = join(WEB_DIST, "index.html");
    }
    return new Response(Bun.file(filePath));
  },
});
console.log("[web]    serving on http://localhost:" + server.port);
`;

async function cmdStart(args: string[]) {
  const parsed = parseArgs(args);
  const clientPort = Number(parsed["client-port"] ?? DEFAULT_CLIENT_PORT);
  const serverPort = Number(parsed["server-port"] ?? DEFAULT_SERVER_PORT);

  if (Number.isNaN(clientPort) || clientPort < 1 || clientPort > 65535) {
    throw new Error(`invalid client port: ${parsed["client-port"]}`);
  }
  if (Number.isNaN(serverPort) || serverPort < 1 || serverPort > 65535) {
    throw new Error(`invalid server port: ${parsed["server-port"]}`);
  }

  const existingServer = readPid(SERVER_PID_FILE);
  const existingClient = readPid(CLIENT_PID_FILE);
  if (existingServer !== null || existingClient !== null) {
    throw new Error("feedelity is already running. run 'feedelity stop' first.");
  }

  ensureDir(PID_DIR);

  const serverEnv = parseEnvFile(join(ROOT, "apps/server/.env"));

  await build(serverPort);

  console.log(`[server] starting on port ${serverPort}...`);
  const serverPid = startServer(serverPort, clientPort, serverEnv);
  writeFileSync(SERVER_PID_FILE, String(serverPid), "utf-8");

  await new Promise((resolve) => setTimeout(resolve, 1000));

  if (!isProcessRunning(serverPid)) {
    throw new Error("server process exited unexpectedly. check logs above and apps/server/.env configuration.");
  }

  console.log(`[web]    starting on port ${clientPort} (proxying /rpc /api /api-reference -> :${serverPort})...`);
  const clientPid = startClient(clientPort, serverPort);
  writeFileSync(CLIENT_PID_FILE, String(clientPid), "utf-8");

  await new Promise((resolve) => setTimeout(resolve, 500));

  if (!isProcessRunning(clientPid)) {
    process.kill(serverPid);
    throw new Error("client static server exited unexpectedly.");
  }

  console.log(``);
  console.log(`  web -> http://localhost:${clientPort}`);
  console.log(`  api -> http://localhost:${serverPort}`);
  console.log(`  pids -> ${PID_DIR}/`);
  console.log(``);
  console.log(`  run 'feedelity stop' to stop.`);
  console.log(``);
}

function cmdStop() {
  const clientPid = readPid(CLIENT_PID_FILE);
  const serverPid = readPid(SERVER_PID_FILE);

  if (clientPid === null && serverPid === null) {
    console.log("[stop]   nothing running.");
    return;
  }

  if (clientPid !== null) {
    try {
      process.kill(clientPid, "SIGTERM");
      console.log(`[stop]   client (pid ${clientPid}) stopped.`);
    } catch {
      console.log(`[stop]   client (pid ${clientPid}) already gone.`);
    }
    try { unlinkSync(CLIENT_PID_FILE); } catch {}
  }

  if (serverPid !== null) {
    try {
      process.kill(serverPid, "SIGTERM");
      console.log(`[stop]   server (pid ${serverPid}) stopped.`);
    } catch {
      console.log(`[stop]   server (pid ${serverPid}) already gone.`);
    }
    try { unlinkSync(SERVER_PID_FILE); } catch {}
  }

  console.log("[stop]   done.");
}

async function main() {
  const command = process.argv[2];

  switch (command) {
    case "start":
      await cmdStart(process.argv.slice(3));
      break;
    case "stop":
      cmdStop();
      break;
    default:
      console.log("usage: feedelity <start|stop> [options]");
      console.log("");
      console.log("commands:");
      console.log("  start   build and serve in background");
      console.log("  stop    stop background services");
      console.log("");
      console.log("start options:");
      console.log(`  --client-port <port>   client port (default ${DEFAULT_CLIENT_PORT})`);
      console.log(`  --server-port <port>   server port (default ${DEFAULT_SERVER_PORT})`);
      process.exit(command === undefined ? 1 : 0);
  }
}

main().catch((err) => {
  console.error(`[error]  ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
