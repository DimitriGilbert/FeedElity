/**
 * Stage 5 — Apply the generated collections to a REAL database.
 *
 * This is the ONLY stage in the pipeline that writes to a persistent database,
 * so it is gated behind explicit arguments and defaults to a dry run.
 *
 * Usage:
 *   bun scripts/classify/apply.ts --user <userId> --db <path-to-local.db> [--yes]
 *
 * Arguments:
 *   --user <id>     REQUIRED. The owning user's id. Must exist in the target DB.
 *   --db <path>     REQUIRED. Path to the SQLite/libSQL file to write to.
 *                   (Use a LOCAL dev/test DB. Never point this at production.)
 *   --yes           Actually write. Without it, the script runs in dry-run mode:
 *                   it validates everything and reports what it WOULD do, then
 *                   exits without writing.
 *   --sql <path>    Path to the generated SQL (default: data/collections.sql).
 *
 * Safety:
 *   - Refuses to run without --user and --db.
 *   - Dry-runs by default; --yes is required to mutate.
 *   - Validates that --user exists and every creatorId referenced exists in the
 *     target DB before writing anything.
 *   - The SQL is idempotent (ON CONFLICT DO NOTHING), so re-running is safe.
 *
 * Example:
 *   bun scripts/classify/apply.ts --user 5f3c... --db local.db            # dry run
 *   bun scripts/classify/apply.ts --user 5f3c... --db local.db --yes      # write
 */

import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

interface Args {
  user: string | null;
  db: string | null;
  yes: boolean;
  sql: string;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { user: null, db: null, yes: false, sql: resolve(here, "data/collections.sql") };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case "--user":
        if (next === undefined) throw new Error("--user requires a value");
        args.user = next;
        i++;
        break;
      case "--db":
        if (next === undefined) throw new Error("--db requires a value");
        args.db = next;
        i++;
        break;
      case "--sql":
        if (next === undefined) throw new Error("--sql requires a value");
        args.sql = next;
        i++;
        break;
      case "--yes":
        args.yes = true;
        break;
      case "--help":
      case "-h":
        console.log(USAGE);
        process.exit(0);
      default:
        if (a?.startsWith("--")) throw new Error(`Unknown argument: ${a}`);
    }
  }
  return args;
}

const USAGE = `\
Apply generated collections to a database.

  bun scripts/classify/apply.ts --user <userId> --db <dbPath> [--yes] [--sql <sqlPath>]

  --user <id>   REQUIRED. Owning user id (must exist in the DB).
  --db <path>   REQUIRED. SQLite file to write to. Use a LOCAL DB, never prod.
  --yes         Actually write. Without it, runs as a dry run (no writes).
  --sql <path>  Generated SQL file (default: data/collections.sql).
`;

async function main(): Promise<void> {
  const args = parseArgs(Bun.argv);

  if (args.user === null || args.db === null) {
    console.error(USAGE);
    process.exit(1);
  }
  if (!existsSync(args.db)) {
    console.error(`Database file not found: ${args.db}`);
    process.exit(1);
  }
  if (!existsSync(args.sql)) {
    console.error(`SQL file not found: ${args.sql}. Run build-sql.ts first.`);
    process.exit(1);
  }

  const sqlRaw = (await readFile(args.sql, "utf-8")).replaceAll(":USER_ID", args.user);

  // Open the TARGET database read-write, but only commit if --yes.
  const db = new Database(args.db);
  db.exec("PRAGMA foreign_keys = ON");

  // --- Pre-flight validation against the real DB ---
  const userRow = db.query("SELECT id FROM user WHERE id = ?").get(args.user) as { id: string } | null;
  if (userRow === null) {
    console.error(`User "${args.user}" does not exist in ${args.db}. Aborting.`);
    db.close();
    process.exit(1);
  }

  const schemaPresent =
    (db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='creator_collection'").get() as { name: string } | null) !== null;
  if (!schemaPresent) {
    console.error(`Table creator_collection not found in ${args.db}. Run the migration first.`);
    db.close();
    process.exit(1);
  }

  // Collect every creatorId referenced by the SQL and confirm they exist.
  const referencedCreatorIds = new Set<string>();
  for (const m of sqlRaw.matchAll(/collection_member \(.*?\) VALUES \('member-[^']+', '[^']+', '[^']+', '([^']+)'/g)) {
    referencedCreatorIds.add(m[1] as string);
  }
  // Load every creator id in the target DB once and check membership in JS.
  // (Avoids a giant IN (?, ?, ...) bind and any variable-count limits.)
  const existing = new Set(
    (db.query("SELECT id FROM creator").all() as { id: string }[]).map((row) => row.id),
  );
  const missing = [...referencedCreatorIds].filter((id) => !existing.has(id));

  const beforeCollections = (db.query("SELECT count(*) AS n FROM creator_collection WHERE user_id = ?").get(args.user) as { n: number }).n;
  const beforeMembers = (db.query("SELECT count(*) AS n FROM collection_member WHERE user_id = ?").get(args.user) as { n: number }).n;

  console.log("=== apply collections ===");
  console.log(`  database:        ${args.db}`);
  console.log(`  user:            ${args.user} (verified)`);
  console.log(`  memberships in SQL: ${referencedCreatorIds.size}`);
  console.log(`  referenced creators missing from DB: ${missing.length}`);
  console.log(`  current rows:    ${beforeCollections} collections, ${beforeMembers} memberships`);
  console.log(`  mode:            ${args.yes ? "WRITE (--yes)" : "DRY RUN (no writes)"}`);

  if (missing.length > 0) {
    console.error(`\nAborting: ${missing.length} referenced creator(s) are not in the target DB.`);
    for (const id of missing.slice(0, 10)) {
      console.error(`  - ${id}`);
    }
    db.close();
    process.exit(1);
  }

  if (!args.yes) {
    console.log("\nDry run complete. No rows written. Re-run with --yes to apply.");
    db.close();
    return;
  }

  // --- Write: execute the idempotent SQL, wrapped in a transaction. ---
  const statements = sqlRaw
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  db.exec("BEGIN");
  try {
    for (const stmt of statements) {
      db.exec(stmt);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    console.error("\nWrite failed and was rolled back:", (error as Error).message);
    db.close();
    process.exit(1);
  }

  const afterCollections = (db.query("SELECT count(*) AS n FROM creator_collection WHERE user_id = ?").get(args.user) as { n: number }).n;
  const afterMembers = (db.query("SELECT count(*) AS n FROM collection_member WHERE user_id = ?").get(args.user) as { n: number }).n;
  console.log("\nWritten.");
  console.log(`  collections now: ${afterCollections} (was ${beforeCollections})`);
  console.log(`  memberships now:  ${afterMembers} (was ${beforeMembers})`);
  db.close();
}

await main();
