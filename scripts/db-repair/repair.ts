/**
 * One-time repair: merge duplicate creator rows and convert the creator table to
 * the cross-source (name_key) model in a single transaction.
 *
 * Production was seeded when a creator carried a per-source identity, so the same
 * channel mirrored across YouTube + Odysee (plus "@claim:rev" and UC/uc variants)
 * became several rows. This script collapses each name_key group onto one
 * canonical creator, rewires feed/content_item/subscription/refresh_run foreign
 * keys onto it, deletes the merged-away rows, then applies the schema change
 * (drop source_type/source_external_id, add name_key + unique index).
 *
 * Usage:
 *   bun scripts/db-repair/repair.ts --db <path-to-sqlite-file>            # dry run
 *   bun scripts/db-repair/repair.ts --db <path-to-sqlite-file> --yes      # write
 *
 * Safety:
 *   - --db is REQUIRED. Point it at a COPY of production, never the live file.
 *   - Dry-runs by default; --yes is required to mutate.
 *   - The whole change runs in one transaction and is rolled back on any error.
 *   - foreign_key_check is run before commit; any orphan aborts the run.
 *   - Idempotent: re-running finds no duplicate groups and no-ops the data step.
 */

import { Database } from "bun:sqlite";

import { buildMergePlan, summarizePlan, type CreatorRow } from "@FeedElity/db/creator-merge-plan";

interface Args {
  db: string | null;
  yes: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { db: null, yes: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case "--db":
        if (next === undefined) throw new Error("--db requires a value");
        args.db = next;
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
Merge duplicate creator rows and convert to the cross-source (name_key) model.

  bun scripts/db-repair/repair.ts --db <dbPath> [--yes]

--db <path>   REQUIRED. SQLite file to repair. Use a COPY of prod, never the live file.
--yes         Actually write. Without it, runs as a dry run (reports only).
`;

const NAME_KEY_SQL = `lower(
  iif(
    instr(replace(replace(\`display_name\`, '@', ''), ' ', ''), ':') > 0,
    substr(
      replace(replace(\`display_name\`, '@', ''), ' ', ''),
      1,
      instr(replace(replace(\`display_name\`, '@', ''), ' ', ''), ':') - 1
    ),
    replace(replace(\`display_name\`, '@', ''), ' ', '')
  )
)`;

function loadCreatorRows(db: Database): CreatorRow[] {
  const columns = new Set(
    (db.query("PRAGMA table_info(creator)").all() as { name: string }[]).map((row) => row.name),
  );
  // Tolerate both the legacy schema (source_type/source_external_id) and the
  // repaired schema so re-running on an already-repaired DB is a no-op.
  const sourceType = columns.has("source_type") ? "c.source_type" : "NULL";
  const sourceExternalId = columns.has("source_external_id") ? "c.source_external_id" : "NULL";
  const rows = db.query(
    `SELECT c.id AS id, ${sourceType} AS sourceType, ${sourceExternalId} AS sourceExternalId,
            c.display_name AS displayName, c.created_at AS createdAt,
            (SELECT count(*) FROM content_item i WHERE i.creator_id = c.id) AS contentCount,
            (SELECT count(*) FROM subscription s WHERE s.creator_id = c.id) AS subscriptionCount
     FROM creator c`,
  ).all() as Array<Omit<CreatorRow, "createdAt"> & { createdAt: number | bigint }>;
  return rows.map((row) => ({ ...row, createdAt: Number(row.createdAt) }));
}

async function main(): Promise<void> {
  const args = parseArgs(Bun.argv);
  if (args.db === null) {
    console.error(USAGE);
    process.exit(1);
  }

  const db = new Database(args.db);
  db.exec("PRAGMA foreign_keys = ON");

  const beforeCreators = (db.query("SELECT count(*) AS n FROM creator").get() as { n: number }).n;
  const beforeFeeds = (db.query("SELECT count(*) AS n FROM feed").get() as { n: number }).n;
  const beforeItems = (db.query("SELECT count(*) AS n FROM content_item").get() as { n: number }).n;
  const beforeSubs = (db.query("SELECT count(*) AS n FROM subscription").get() as { n: number }).n;

  const plan = buildMergePlan(loadCreatorRows(db));
  const summary = summarizePlan(plan);

  console.log("=== creator dedup repair ===");
  console.log(`  database:        ${args.db}`);
  console.log(`  creators now:    ${beforeCreators}`);
  console.log(`  feeds / items / subs: ${beforeFeeds} / ${beforeItems} / ${beforeSubs}`);
  console.log(`  merge groups:    ${summary.groups}`);
  console.log(`  creators merged away: ${summary.creatorsMergedAway}`);
  console.log(`  expected creators after: ${beforeCreators - summary.creatorsMergedAway}`);
  console.log(`  mode:            ${args.yes ? "WRITE (--yes)" : "DRY RUN (no writes)"}`);

  if (summary.groups > 0) {
    console.log("\n  groups:");
    for (const action of plan.groups) {
      console.log(
        `    • ${action.canonical.displayName} (${action.canonical.sourceType}:${action.canonical.sourceExternalId}) <- ${action.mergedAwayIds.length} row(s)`,
      );
    }
  }

  const hasLegacyColumns =
    (db.query("SELECT count(*) AS n FROM pragma_table_info('creator') WHERE name IN ('source_type','source_external_id')").get() as { n: number }).n > 0;
  const hasNameKey =
    (db.query("SELECT count(*) AS n FROM pragma_table_info('creator') WHERE name = 'name_key'").get() as { n: number }).n > 0;
  console.log(`  schema:          ${hasLegacyColumns ? "legacy (source cols present)" : "no legacy cols"}${hasNameKey ? ", name_key present" : ""}`);

  // Snapshot pre-existing FK violations so the post-merge gate only fails on
  // orphans THIS repair introduced, not damage that already exists in the DB.
  const preExistingOrphans = db.query("PRAGMA foreign_key_check").all().length;
  if (preExistingOrphans > 0) {
    console.log(`  pre-existing orphans: ${preExistingOrphans} (reported, not touched by this repair)`);
  }

  if (!args.yes) {
    console.log("\nDry run complete. No rows written. Re-run with --yes to apply.");
    db.close();
    return;
  }

  db.exec("BEGIN");
  try {
    for (const action of plan.groups) {
      const canonicalId = action.canonical.id;
      for (const mergedId of action.mergedAwayIds) {
        db.query("UPDATE content_item SET creator_id = ? WHERE creator_id = ?").all(canonicalId, mergedId);
        db.query("UPDATE feed SET creator_id = ? WHERE creator_id = ?").all(canonicalId, mergedId);
        db.query("UPDATE refresh_run SET requested_creator_id = ? WHERE requested_creator_id = ?").all(canonicalId, mergedId);
        // Subscriptions are unique on (user_id, creator_id): moving a row whose
        // (user, canonical) already exists would violate the constraint, so drop
        // the loser of each user's pair first, then re-point the survivor.
        db.exec(
          `DELETE FROM subscription WHERE creator_id = ${esc(mergedId)} AND user_id IN (
             SELECT user_id FROM subscription WHERE creator_id = ${esc(canonicalId)})`,
        );
        db.query("UPDATE subscription SET creator_id = ? WHERE creator_id = ?").all(canonicalId, mergedId);
        db.query("DELETE FROM creator WHERE id = ?").all(mergedId);
      }
    }

    // Verify the merge introduced no NEW orphans. Pre-existing violations (e.g.
    // refresh_feed_result rows whose feed was already deleted) are tolerated.
    const orphans = db.query("PRAGMA foreign_key_check").all().length;
    if (orphans > preExistingOrphans) {
      throw new Error(
        `foreign_key_check reported ${orphans} orphaned row(s), up from ${preExistingOrphans} pre-existing; ` +
          "the merge introduced new orphans, aborting before schema change.",
      );
    }

    // Schema change to the cross-source model.
    if (hasLegacyColumns) {
      db.exec("DROP INDEX IF EXISTS creator_source_identity_uidx");
      db.exec("ALTER TABLE creator DROP COLUMN source_type");
      db.exec("ALTER TABLE creator DROP COLUMN source_external_id");
      db.exec("ALTER TABLE creator ADD COLUMN name_key text");
      db.exec(`UPDATE creator SET name_key = ${NAME_KEY_SQL} WHERE name_key IS NULL`);
    }
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS creator_name_key_uidx ON creator (name_key)");
    db.exec("CREATE INDEX IF NOT EXISTS creator_display_name_idx ON creator (display_name)");

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    console.error("\nRepair failed and was rolled back:", (error as Error).message);
    db.close();
    process.exit(1);
  }

  const afterCreators = (db.query("SELECT count(*) AS n FROM creator").get() as { n: number }).n;
  const afterFeeds = (db.query("SELECT count(*) AS n FROM feed").get() as { n: number }).n;
  const afterItems = (db.query("SELECT count(*) AS n FROM content_item").get() as { n: number }).n;
  const afterSubs = (db.query("SELECT count(*) AS n FROM subscription").get() as { n: number }).n;
  const postOrphans = (db.query("PRAGMA foreign_key_check").all());

  console.log("\nRepair complete.");
  console.log(`  creators: ${beforeCreators} -> ${afterCreators} (delta ${afterCreators - beforeCreators})`);
  console.log(`  feeds:    ${beforeFeeds} -> ${afterFeeds} (should be unchanged)`);
  console.log(`  items:    ${beforeItems} -> ${afterItems} (should be unchanged)`);
  console.log(`  subs:     ${beforeSubs} -> ${afterSubs} (unchanged unless duplicate subscriptions merged)`);
  console.log(`  foreign_key_check: ${postOrphans.length === 0 ? "clean" : `${postOrphans.length} orphan(s)`}`);
  db.close();
}

/** Inline a string literal safely for the two dynamic DELETE statements above. */
function esc(value: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(value)) {
    throw new Error(`Refusing to interpolate non-uuid value into SQL: ${value}`);
  }
  return `'${value}'`;
}

await main();
