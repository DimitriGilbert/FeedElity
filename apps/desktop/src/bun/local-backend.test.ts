import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { createClient } from "@libsql/client";
import { afterEach, describe, expect, test } from "bun:test";

import {
  addDesktopRuntimeQuery,
  createDesktopLocalServerUrl,
  findDesktopStaticDirectory,
  isResolvedPathInsideRoot,
  readInitialMigrationSql,
  resolveDesktopBackendConfig,
  resolveDesktopDataDirectory,
  resolveDesktopRemoteBackendConfig,
  resolveDesktopRuntimeMode,
  startConfiguredDesktopBackend,
  startDesktopLocalBackend,
  type StartedDesktopBackend,
} from "./local-backend";

const migrationsDirectory = join(import.meta.dir, "../../../../packages/db/src/migrations");

let startedBackend: StartedDesktopBackend | null = null;

afterEach(() => {
  startedBackend?.server.stop(true);
  startedBackend = null;
});

describe("desktop local backend config", () => {
  test("resolves a Linux data directory outside packaged app paths", () => {
    expect(resolveDesktopDataDirectory({ XDG_DATA_HOME: "/home/user/.local/state", HOME: "/home/user" }, "linux")).toBe(
      "/home/user/.local/state/FeedElity",
    );
  });

  test("uses a deterministic non-3000 localhost backend URL", () => {
    expect(createDesktopLocalServerUrl()).toBe("http://127.0.0.1:3217");
  });

  test("adds desktop runtime config to packaged and HMR view URLs", () => {
    expect(addDesktopRuntimeQuery("views://mainview/index.html", "http://127.0.0.1:3217")).toBe(
      "views://mainview/index.html?feedelityRuntimeMode=desktop-local&feedelityServerUrl=http%3A%2F%2F127.0.0.1%3A3217",
    );
    expect(addDesktopRuntimeQuery("http://localhost:3001", { mode: "desktop-remote", serverUrl: "https://api.feedelity.example" })).toBe(
      "http://localhost:3001?feedelityRuntimeMode=desktop-remote&feedelityServerUrl=https%3A%2F%2Fapi.feedelity.example",
    );
  });

  test("creates stable local database and auth paths", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "feedelity-desktop-config-"));
    const config = await resolveDesktopBackendConfig({ FEELITY_DESKTOP_DATA_DIR: dataDirectory }, 33217);

    expect(config).toMatchObject({
      mode: "desktop-local",
      port: 33217,
      serverUrl: "http://127.0.0.1:33217",
      databaseUrl: `file:${join(dataDirectory, "feedelity.db")}`,
      authSecretPath: join(dataDirectory, "auth-secret"),
    });
    expect(config.authSecret.length).toBeGreaterThanOrEqual(32);
  });

  test("uses a validated desktop port from environment input", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "feedelity-desktop-env-port-"));
    const config = await resolveDesktopBackendConfig({ FEELITY_DESKTOP_DATA_DIR: dataDirectory, FEELITY_DESKTOP_PORT: "33219" });

    expect(config.port).toBe(33219);
    expect(config.serverUrl).toBe("http://127.0.0.1:33219");
  });

  test("rejects port 3000 for desktop local backend config", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "feedelity-desktop-rejected-port-"));

    await expect(resolveDesktopBackendConfig({ FEELITY_DESKTOP_DATA_DIR: dataDirectory, FEELITY_DESKTOP_PORT: "3000" })).rejects.toThrow();
  });
});

describe("desktop remote backend config", () => {
  test("defaults the desktop runtime to local unless remote mode is explicit", () => {
    expect(resolveDesktopRuntimeMode({})).toBe("desktop-local");
    expect(resolveDesktopRuntimeMode({ FEELITY_DESKTOP_MODE: "remote" })).toBe("desktop-remote");
    expect(resolveDesktopRuntimeMode({ VITE_RUNTIME_MODE: "desktop-remote" })).toBe("desktop-remote");
  });

  test("normalizes the explicit remote server URL", () => {
    expect(
      resolveDesktopRemoteBackendConfig({
        VITE_RUNTIME_MODE: "desktop-remote",
        FEELITY_DESKTOP_REMOTE_SERVER_URL: "https://api.feedelity.example///",
      }),
    ).toEqual({
      mode: "desktop-remote",
      serverUrl: "https://api.feedelity.example",
    });
  });

  test("rejects missing and non-HTTP(S) remote server URLs", () => {
    expect(() => resolveDesktopRemoteBackendConfig({ VITE_RUNTIME_MODE: "desktop-remote" })).toThrow();
    expect(() =>
      resolveDesktopRemoteBackendConfig({ VITE_RUNTIME_MODE: "desktop-remote", FEELITY_DESKTOP_REMOTE_SERVER_URL: "file:///tmp/feedelity.db" }),
    ).toThrow();
  });

  test("does not start the local backend in remote mode", async () => {
    const started = await startConfiguredDesktopBackend(
      {
        VITE_RUNTIME_MODE: "desktop-remote",
        FEELITY_DESKTOP_REMOTE_SERVER_URL: "https://api.feedelity.example/",
      },
      () => {
        throw new Error("Local backend must not start in desktop remote mode.");
      },
    );

    expect(started).toEqual({
      config: {
        mode: "desktop-remote",
        serverUrl: "https://api.feedelity.example",
      },
      server: null,
    });
  });
});

describe("desktop packaged resources", () => {
  test("loads migrations only from packaged resources or explicit overrides", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "feedelity-desktop-migrations-"));
    const explicitMigrationsDirectory = join(dataDirectory, "migrations");
    await mkdir(explicitMigrationsDirectory);
    await writeFile(join(explicitMigrationsDirectory, "0000_fuzzy_greymalkin.sql"), "CREATE TABLE explicit_migration (id text);");

    await expect(readInitialMigrationSql({})).rejects.toThrow("Desktop local backend could not load database migration");
    await expect(readInitialMigrationSql({})).rejects.not.toThrow("packages/db/src/migrations");
    await expect(readInitialMigrationSql({ FEELITY_DESKTOP_MIGRATIONS_DIR: explicitMigrationsDirectory })).resolves.toBe(
      "CREATE TABLE explicit_migration (id text);",
    );
  });

  test("discovers static files only from packaged resources or explicit overrides", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "feedelity-desktop-static-"));
    const explicitStaticDirectory = join(dataDirectory, "static");
    await mkdir(explicitStaticDirectory);
    await writeFile(join(explicitStaticDirectory, "index.html"), "<main>explicit static</main>");

    expect(await findDesktopStaticDirectory({ FEELITY_DESKTOP_STATIC_DIR: explicitStaticDirectory })).toBe(explicitStaticDirectory);
  });

  test("uses resolved path containment instead of unsafe prefix matching", () => {
    expect(isResolvedPathInsideRoot("/tmp/feedelity-static", "/tmp/feedelity-static/assets/app.js")).toBe(true);
    expect(isResolvedPathInsideRoot("/tmp/feedelity-static", "/tmp/feedelity-static-evil/assets/app.js")).toBe(false);
  });
});

describe("desktop local backend startup", () => {
  test("starts Hono against a migrated local SQLite database", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "feedelity-desktop-backend-"));
    const staticDirectory = join(dataDirectory, "static");
    await mkdir(staticDirectory);
    await writeFile(join(staticDirectory, "index.html"), "<main>desktop shell</main>");

    const port = await getAvailablePort();
    startedBackend = await startDesktopLocalBackend(
      {
        FEELITY_DESKTOP_DATA_DIR: dataDirectory,
        FEELITY_DESKTOP_MIGRATIONS_DIR: migrationsDirectory,
        FEELITY_DESKTOP_STATIC_DIR: staticDirectory,
      },
      port,
    );

    const response = await fetch(`${startedBackend.config.serverUrl}/`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("<main>desktop shell</main>");

    const shellResponse = await fetch(`${startedBackend.config.serverUrl}/index.html`);
    expect(shellResponse.status).toBe(200);
    expect(await shellResponse.text()).toBe("<main>desktop shell</main>");

    const client = createClient({ url: startedBackend.config.databaseUrl });
    try {
      const creators = await client.execute("SELECT id FROM creator LIMIT 1");
      expect(creators.rows).toEqual([]);
    } finally {
      client.close();
    }
  });

  test("rejects static symlinks that resolve outside the static root", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "feedelity-desktop-symlink-escape-"));
    const staticDirectory = join(dataDirectory, "static");
    const assetsDirectory = join(staticDirectory, "assets");
    const outsideFile = join(dataDirectory, "outside.txt");
    await mkdir(assetsDirectory, { recursive: true });
    await writeFile(join(staticDirectory, "index.html"), "<main>desktop shell</main>");
    await writeFile(outsideFile, "outside static root");
    await symlink(outsideFile, join(assetsDirectory, "outside.txt"));

    const port = await getAvailablePort();
    startedBackend = await startDesktopLocalBackend(
      {
        FEELITY_DESKTOP_DATA_DIR: dataDirectory,
        FEELITY_DESKTOP_MIGRATIONS_DIR: migrationsDirectory,
        FEELITY_DESKTOP_STATIC_DIR: staticDirectory,
      },
      port,
    );

    const response = await fetch(`${startedBackend.config.serverUrl}/assets/outside.txt`);
    expect(response.status).toBe(404);
  });

  test("returns 404 for broken static symlinks", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "feedelity-desktop-broken-symlink-"));
    const staticDirectory = join(dataDirectory, "static");
    const assetsDirectory = join(staticDirectory, "assets");
    await mkdir(assetsDirectory, { recursive: true });
    await writeFile(join(staticDirectory, "index.html"), "<main>desktop shell</main>");
    await symlink(join(dataDirectory, "missing.txt"), join(assetsDirectory, "missing.txt"));

    const port = await getAvailablePort();
    startedBackend = await startDesktopLocalBackend(
      {
        FEELITY_DESKTOP_DATA_DIR: dataDirectory,
        FEELITY_DESKTOP_MIGRATIONS_DIR: migrationsDirectory,
        FEELITY_DESKTOP_STATIC_DIR: staticDirectory,
      },
      port,
    );

    const response = await fetch(`${startedBackend.config.serverUrl}/assets/missing.txt`);
    expect(response.status).toBe(404);
  });

  test("falls back to the next available port when the configured port is occupied", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "feedelity-desktop-port-fallback-"));
    const staticDirectory = join(dataDirectory, "static");
    await mkdir(staticDirectory);
    await writeFile(join(staticDirectory, "index.html"), "<main>desktop shell</main>");

    const port = await getAvailablePortWithFreeNextPort();
    const occupiedServer = await occupyPort(port);

    try {
      startedBackend = await startDesktopLocalBackend(
        {
          FEELITY_DESKTOP_DATA_DIR: dataDirectory,
          FEELITY_DESKTOP_MIGRATIONS_DIR: migrationsDirectory,
          FEELITY_DESKTOP_STATIC_DIR: staticDirectory,
        },
        port,
      );

      expect(startedBackend.config.port).toBe(port + 1);
      expect(startedBackend.config.serverUrl).toBe(`http://127.0.0.1:${port + 1}`);
      expect(process.env.BETTER_AUTH_URL).toBe(startedBackend.config.serverUrl);
      expect(process.env.PORT).toBe(String(startedBackend.config.port));

      const response = await fetch(`${startedBackend.config.serverUrl}/`);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("<main>desktop shell</main>");
    } finally {
      await closeServer(occupiedServer);
    }
  });
});

async function getAvailablePortWithFreeNextPort(): Promise<number> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const port = await getAvailablePort();
    const nextPortServer = await tryOccupyPort(port + 1);
    if (nextPortServer !== null) {
      await closeServer(nextPortServer);
      return port;
    }
  }

  throw new Error("Could not allocate adjacent local test ports");
}

async function tryOccupyPort(port: number): Promise<Server | null> {
  try {
    return await occupyPort(port);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EADDRINUSE") {
      return null;
    }

    throw error;
  }
}

async function occupyPort(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => {
      resolve(server);
    });
  });
}

async function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => {
        if (error !== undefined) {
          reject(error);
          return;
        }

        if (address === null || typeof address === "string") {
          reject(new Error("Could not allocate a local test port"));
          return;
        }

        resolve(address.port);
      });
    });
  });
}
