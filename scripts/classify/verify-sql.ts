/**
 * Stage 4 — Smoke-test the generated collection SQL on a THROWAWAY in-memory DB.
 *
 * Creates the FeedElity schema (user, creator, creator_collection,
 * collection_member) in a fresh :memory: SQLite database, inserts a stub user
 * and the real creator ids from the dump, then runs collections.sql against it.
 * Asserts row counts and that no foreign-key constraints are violated.
 *
 * This NEVER touches local.db or the production database. It is in-memory only
 * and discarded when the process exits.
 *
 * Usage:
 *   bun scripts/classify/verify-sql.ts [--user <userId>]
 *
 * The --user value must be a concrete id (it is the collections' owner and is
 * needed to satisfy the user_id foreign key). It defaults to a test stub id.
 */

import { Database } from "bun:sqlite";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(here, "data");

const args = parseArgs(Bun.argv);
const testUserId = args.user ?? "test-user-id";

interface DumpCreator {
  readonly id: string;
  readonly displayName: string;
}

function parseArgs(argv: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a?.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else {
        out[key] = "true";
      }
    }
  }
  return out;
}

// Minimal subset of the FeedElity schema: only the tables the collection SQL
// touches, plus their FK targets (user, creator). Mirrors migration 0000 + 0001.
const schemaSql = [
  `CREATE TABLE user (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    email_verified INTEGER NOT NULL DEFAULT 0,
    image TEXT,
    account_state TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
  )`,
  `CREATE TABLE creator (
    id TEXT PRIMARY KEY NOT NULL,
    source_type TEXT NOT NULL,
    source_external_id TEXT NOT NULL,
    display_name TEXT NOT NULL,
    description TEXT,
    image_url TEXT,
    canonical_url TEXT,
    metadata_json TEXT,
    created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
  )`,
  `CREATE TABLE creator_collection (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    position INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    updated_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer))
  )`,
  "CREATE UNIQUE INDEX creator_collection_id_user_uidx ON creator_collection (id, user_id)",
  `CREATE TABLE collection_member (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    collection_id TEXT NOT NULL REFERENCES creator_collection(id) ON DELETE CASCADE,
    creator_id TEXT NOT NULL REFERENCES creator(id) ON DELETE CASCADE,
    added_at INTEGER NOT NULL DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
    CONSTRAINT collection_member_collection_owner_fk FOREIGN KEY (collection_id, user_id) REFERENCES creator_collection(id, user_id) ON DELETE CASCADE
  )`,
  "CREATE UNIQUE INDEX collection_member_collection_creator_uidx ON collection_member (collection_id, creator_id)",
];

async function main(): Promise<void> {
  const dump = JSON.parse(await readFile(resolve(dataDir, "creators.json"), "utf-8")) as readonly DumpCreator[];
  let sqlRaw = await readFile(resolve(dataDir, "collections.sql"), "utf-8");
  if (sqlRaw.includes(":USER_ID")) {
    // Substitute the placeholder with the concrete test user id for this run.
    sqlRaw = sqlRaw.replaceAll(":USER_ID", testUserId);
  }

  const db = new Database(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  for (const stmt of schemaSql) {
    db.exec(stmt);
  }

  // Seed a stub user + every real creator id so FKs resolve exactly as in prod.
  db.query(
    "INSERT INTO user (id, name, email, email_verified) VALUES (?, ?, ?, 1)",
  ).run(testUserId, testUserId, `${testUserId}@example.test`);
  const insertCreator = db.query(
    "INSERT INTO creator (id, source_type, source_external_id, display_name) VALUES (?, 'youtube', ?, ?)",
  );
  for (const c of dump) {
    insertCreator.run(c.id, c.id, c.displayName);
  }

  // Run the generated SQL. Strip full-line SQL comments first (they may contain
  // ';'), then execute each statement separately so ON CONFLICT upserts parse
  // cleanly. Descriptions contain no ';' so a top-level split is safe here.
  const statements = sqlRaw
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  let applied = 0;
  for (const stmt of statements) {
    db.exec(stmt);
    applied++;
  }

  // --- Assertions ---
  const collectionCount = db.query("SELECT count(*) AS n FROM creator_collection").get() as { n: number };
  const memberCount = db.query("SELECT count(*) AS n FROM collection_member").get() as { n: number };

  // FK integrity: with foreign_keys ON, every member must reference an existing
  // collection AND creator AND user. A mismatch would have thrown on insert; we
  // double-check there are no orphans by joining.
  const orphanMembers = db
    .query(
      "SELECT count(*) AS n FROM collection_member m LEFT JOIN creator c ON c.id = m.creator_id LEFT JOIN creator_collection cc ON cc.id = m.collection_id WHERE c.id IS NULL OR cc.id IS NULL",
    )
    .get() as { n: number };

  // Idempotency: re-run and confirm counts do not change.
  for (const stmt of statements) {
    db.exec(stmt);
  }
  const memberCountAfterRerun = db.query("SELECT count(*) AS n FROM collection_member").get() as { n: number };

  console.log("=== verify-sql (in-memory, no prod/dev touch) ===");
  console.log(`  applied statements:    ${applied}`);
  console.log(`  collections created:   ${collectionCount.n} (expected 11)`);
  console.log(`  memberships inserted:  ${memberCount.n}`);
  console.log(`  orphan memberships:    ${orphanMembers.n} (expected 0)`);
  console.log(`  memberships after rerun: ${memberCountAfterRerun.n} (must equal above => idempotent)`);

  const failures: string[] = [];
  if (collectionCount.n !== 11) failures.push(`collection count ${collectionCount.n} != 11`);
  if (orphanMembers.n !== 0) failures.push(`${orphanMembers.n} orphan memberships`);
  if (memberCount.n !== memberCountAfterRerun.n) failures.push("not idempotent on re-run");

  if (failures.length > 0) {
    console.error("\nFAILED:");
    for (const f of failures) {
      console.error(`  - ${f}`);
    }
    process.exit(1);
  }
  console.log("\nOK — SQL is valid, FK-clean, and idempotent on a throwaway in-memory DB.");
  db.close();
}

await main();
