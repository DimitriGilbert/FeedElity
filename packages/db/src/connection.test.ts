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
  // opens its own connection through the same createDbConnection factory. The
  // child prints an ATTEMPTING_INSERT sentinel immediately before its INSERT;
  // the parent waits for that sentinel (so no fixed sleep guesses at the
  // child's boot time), asserts the writer is still pending against the held
  // write lock — a broken busy_timeout would fail the child fast with
  // SQLITE_BUSY instead of keeping it pending — then commits and awaits the
  // child's success.
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
  console.log("ATTEMPTING_INSERT");
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

      const stdoutDecoder = new TextDecoder();
      const stdoutReader = writer.stdout.getReader();
      let childStdout = "";
      for (;;) {
        const { done, value } = await stdoutReader.read();
        if (done) {
          throw new Error(`Concurrent writer exited before its insert attempt: ${childStdout.trim()}`);
        }
        childStdout += stdoutDecoder.decode(value, { stream: true });
        if (childStdout.includes("ATTEMPTING_INSERT")) {
          break;
        }
      }

      // The child has issued its INSERT against the held write lock. It must
      // still be pending (busy_timeout carries the wait); a child that already
      // exited here means the write failed fast instead of waiting on the lock.
      const pendingOrExited = await Promise.race([
        writer.exited.then(() => "exited" as const),
        new Promise<"pending">((resolve) => {
          setTimeout(() => resolve("pending"), 100);
        }),
      ]);
      expect(pendingOrExited).toBe("pending");

      await first.client.execute("COMMIT");

      for (;;) {
        const { done, value } = await stdoutReader.read();
        if (done) {
          break;
        }
        childStdout += stdoutDecoder.decode(value, { stream: true });
      }
      stdoutReader.releaseLock();

      const [exitCode, stderr] = await Promise.all([
        writer.exited,
        Bun.readableStreamToText(writer.stderr),
      ]);
      const childSucceeded = exitCode === 0 && childStdout.includes("CHILD_WRITE_OK");
      if (!childSucceeded) {
        throw new Error(
          `Concurrent writer failed (exit ${exitCode}): ${stderr.trim() || childStdout.trim()}`,
        );
      }

      const written = await first.client.execute("SELECT value FROM probe ORDER BY id");

      expect(written.rows.map((row) => row.value)).toEqual(["first", "second"]);
    } finally {
      first.client.close();
    }
  }, 10000);
});
