import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { createDbConnection } from "./connection";

async function createDatabaseUrl(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));

  return `file:${join(directory, "test.db")}`;
}

describe("createDbConnection pragmas", () => {
  test("activates WAL journal mode and a 5s busy timeout on the created client", async () => {
    const databaseUrl = await createDatabaseUrl("feedelity-db-connection-pragmas-");
    const { client } = await createDbConnection(databaseUrl);

    try {
      const journalMode = await client.execute("PRAGMA journal_mode");
      const busyTimeout = await client.execute("PRAGMA busy_timeout");

      expect(journalMode.rows[0]?.journal_mode).toBe("wal");
      expect(busyTimeout.rows[0]?.timeout).toBe(5000);
    } finally {
      client.close();
    }
  });

  // The libsql local driver executes statements synchronously on the calling
  // event loop, so a contended write would block this process for the whole
  // busy_timeout window and the first connection could never commit from a
  // timer. The contending writer therefore runs in a child `bun` process that
  // opens its own connection through the same createDbConnection factory; the
  // child's insert starts while the first connection holds the write lock, and
  // busy_timeout must carry it until the commit lands instead of failing with
  // SQLITE_BUSY.
  test("lets a second connection write while the first holds the database open", async () => {
    const databaseUrl = await createDatabaseUrl("feedelity-db-connection-concurrent-writer-");
    const first = await createDbConnection(databaseUrl);

    try {
      await first.client.execute("CREATE TABLE probe (id integer PRIMARY KEY, value text NOT NULL)");
      await first.client.execute("BEGIN IMMEDIATE");
      await first.client.execute("INSERT INTO probe (value) VALUES ('first')");

      const childScript = `
const { createDbConnection } = await import(process.env.CONNECTION_ENTRY);
const { client } = await createDbConnection(process.env.PROBE_DB_URL);
try {
  await client.execute("INSERT INTO probe (value) VALUES ('second')");
  console.log("CHILD_WRITE_OK");
} finally {
  client.close();
}
`;
      const writer = Bun.spawn(["bun", "-e", childScript], {
        cwd: join(import.meta.dir, ".."),
        env: {
          ...process.env,
          CONNECTION_ENTRY: join(import.meta.dir, "connection.ts"),
          PROBE_DB_URL: databaseUrl,
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      // Long enough that the child process has booted and hit the write lock
      // (a cold `bun` boot takes well under 200ms), short enough that the
      // child's 5s busy_timeout has huge margin.
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 400);
      });
      await first.client.execute("COMMIT");

      const [exitCode, stdout, stderr] = await Promise.all([
        writer.exited,
        Bun.readableStreamToText(writer.stdout),
        Bun.readableStreamToText(writer.stderr),
      ]);
      const childSucceeded = exitCode === 0 && stdout.includes("CHILD_WRITE_OK");
      if (!childSucceeded) {
        throw new Error(
          `Concurrent writer failed (exit ${exitCode}): ${stderr.trim() || stdout.trim()}`,
        );
      }

      const written = await first.client.execute("SELECT value FROM probe ORDER BY id");

      expect(written.rows.map((row) => row.value)).toEqual(["first", "second"]);
    } finally {
      first.client.close();
    }
  }, 10000);
});
