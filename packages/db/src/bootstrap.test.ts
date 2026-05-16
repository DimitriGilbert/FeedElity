import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createClient } from "@libsql/client";
import { describe, expect, test } from "bun:test";

import { runSqlMigration } from "./bootstrap";

async function createDatabaseUrl(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));

  return `file:${join(directory, "test.db")}`;
}

describe("SQL bootstrap migrations", () => {
  test("records a successful migration and skips repeat application", async () => {
    const databaseUrl = await createDatabaseUrl("feedelity-db-bootstrap-success-");
    const sql = "CREATE TABLE sample (id text PRIMARY KEY NOT NULL);";

    await runSqlMigration({ databaseUrl, migrationId: "sample", sql });
    await runSqlMigration({ databaseUrl, migrationId: "sample", sql });

    const client = createClient({ url: databaseUrl });
    try {
      const migrations = await client.execute("SELECT id FROM __feedelity_migrations WHERE id = 'sample'");
      const tables = await client.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sample'");

      expect(migrations.rows).toHaveLength(1);
      expect(tables.rows).toHaveLength(1);
    } finally {
      client.close();
    }
  });

  test("rolls back statements and does not record the migration after partial failure", async () => {
    const databaseUrl = await createDatabaseUrl("feedelity-db-bootstrap-failure-");

    await expect(
      runSqlMigration({
        databaseUrl,
        migrationId: "fails-after-first-statement",
        sql: "CREATE TABLE partial_failure (id text PRIMARY KEY NOT NULL);--> statement-breakpoint\nCREATE TABLE partial_failure (id text);",
      }),
    ).rejects.toThrow();

    const client = createClient({ url: databaseUrl });
    try {
      const tables = await client.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'partial_failure'");
      const migrationTable = await client.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__feedelity_migrations'");

      expect(tables.rows).toEqual([]);
      expect(migrationTable.rows).toEqual([]);
    } finally {
      client.close();
    }
  });
});
