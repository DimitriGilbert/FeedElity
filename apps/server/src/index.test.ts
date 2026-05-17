import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runSqlMigration } from "@FeedElity/db/bootstrap";
import { beforeAll, expect, test } from "bun:test";

const initialMigrationId = "0000_fuzzy_greymalkin";

beforeAll(async () => {
  const databaseUrl = `file:${join(tmpdir(), `feedelity-server-index-${crypto.randomUUID()}.db`)}`;

  process.env.RUNTIME_MODE = "local";
  process.env.DATABASE_URL = databaseUrl;
  process.env.BETTER_AUTH_SECRET = "server-smoke-test-secret-minimum-32";
  process.env.BETTER_AUTH_URL = "http://localhost:3002";
  process.env.CORS_ORIGIN = "http://localhost:3001";
  process.env.PORT = "3002";
  process.env.NODE_ENV = "test";

  const migrationSql = await readFile(
    join(import.meta.dir, `../../../packages/db/src/migrations/${initialMigrationId}.sql`),
    "utf8",
  );
  await runSqlMigration({ databaseUrl, migrationId: initialMigrationId, sql: migrationSql });
});

test("server bootstrap responds to the health endpoint", async () => {
  const { app } = await import("./index");

  const response = await app.request("/");

  expect(response.status).toBe(200);
  expect(await response.text()).toBe("OK");
});

test("refresh recovery starter is exported and idempotent", async () => {
  const { ensureRefreshRecoveryStarted } = await import("./index");

  const firstStart = ensureRefreshRecoveryStarted();
  const secondStart = ensureRefreshRecoveryStarted();

  expect(secondStart).toBe(firstStart);
  await firstStart;
});
