import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "./schema";

/**
 * SQLite tuning applied to every connection created here, before the client is
 * returned or used.
 *
 * - `PRAGMA journal_mode = WAL` is persisted in the database file header and
 *   makes SQLite keep recent commits in `<dbfile>-wal` / `<dbfile>-shm`
 *   sidecar files next to the database (e.g. `local.db-wal` / `local.db-shm`
 *   next to the volume DB). Backups and the `db:repair` flow must treat the
 *   database and its sidecars as ONE unit: checkpoint the WAL (or stop the
 *   server) before copying, because a copy of the main file alone loses
 *   commits still sitting in the `-wal` file. `docker/server-entrypoint.sh`
 *   already deletes stale sidecars after seeding a fresh copy of the
 *   database.
 * - `PRAGMA busy_timeout = 5000` is per-connection (unlike the persistent
 *   journal mode), so it is set on every connection creation: writers wait up
 *   to 5 seconds for a contended lock instead of failing immediately with
 *   SQLITE_BUSY.
 *
 * The libsql client config has no pragma option; `client.execute("PRAGMA
 * ...")` is the supported execution path, and both statements are awaited so
 * no other statement can run against the database before they land.
 */
export async function createDbConnection(databaseUrl: string) {
  const client = createClient({
    url: databaseUrl,
  });

  await client.execute("PRAGMA journal_mode = WAL;");
  await client.execute("PRAGMA busy_timeout = 5000;");

  return {
    client,
    db: drizzle({ client, schema }),
  };
}
