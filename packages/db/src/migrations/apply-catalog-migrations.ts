/**
 * CLI for the catalog data migrations (see ./catalog-data-migrations.ts).
 *
 * Converges a FeedElity catalog database to the cross-source creator schema:
 * merges duplicate per-source creator rows first, then applies the schema
 * convergence. Every step is idempotent and recorded in __feedelity_migrations.
 *
 * Usage:
 *   bun run db:repair --db <path-to-sqlite-file>            # dry run
 *   bun run db:repair --db <path-to-sqlite-file> --yes      # write
 *   bun run db:repair --yes                                 # use DATABASE_URL from .env
 *
 * Safety:
 *   - Dry-runs by default; --yes is required to mutate.
 *   - Point --db at a COPY of a database you care about, never the live file.
 *   - Each step runs in its own transaction and is rolled back on any error.
 */

import "dotenv/config";

import { existsSync } from "node:fs";

import {
  inspectCatalog,
  openCatalogDatabase,
  resolveDatabaseFilePath,
  runCatalogDataMigrations,
  type CatalogInspection,
} from "./catalog-data-migrations";

interface Args {
  db: string | null;
  yes: boolean;
}

const USAGE = `\
Converge a FeedElity catalog database to the cross-source creator schema.

  bun run db:repair --db <dbPath> [--yes]
  bun run db:repair --yes                    # uses DATABASE_URL from the environment/.env

--db <path>   SQLite file (or file: URL) to migrate. Use a COPY of a database you care about.
--yes         Actually write. Without it, runs as a dry run (reports only).
--help        Show this help.

Idempotent: safe to re-run; already-applied steps are skipped.
`;

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { db: null, yes: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) {
      continue;
    }
    if (arg === "--db") {
      const next = argv[i + 1];
      if (next === undefined) {
        throw new Error("--db requires a value");
      }
      args.db = next;
      i++;
      continue;
    }
    if (arg.startsWith("--db=")) {
      const value = arg.slice("--db=".length);
      if (value.length === 0) {
        throw new Error("--db requires a value");
      }
      args.db = value;
      continue;
    }
    if (arg === "--yes") {
      args.yes = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(USAGE);
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function resolveTargetDatabase(args: Args): string {
  if (args.db !== null) {
    return args.db;
  }
  const fromEnv = process.env.DATABASE_URL;
  if (fromEnv === undefined || fromEnv.trim().length === 0) {
    throw new Error("no database given: pass --db <path> or set DATABASE_URL (loaded from .env)");
  }
  return fromEnv.trim();
}

function describeSchemaState(state: CatalogInspection): string {
  const parts = [
    state.schema.legacySourceColumnsPresent.length > 0
      ? `legacy source columns present (${state.schema.legacySourceColumnsPresent.join(", ")})`
      : "no legacy source columns",
    `name_key: ${state.schema.hasNameKeyColumn ? "present" : "missing"}`,
    `last_content_published_at: ${state.schema.hasLastContentPublishedAtColumn ? "present" : "missing"}`,
    state.schema.missingIndexes.length > 0
      ? `missing indexes: ${state.schema.missingIndexes.join(", ")}`
      : "expected indexes present",
  ];
  return parts.join("; ");
}

function printInspection(label: string, state: CatalogInspection): void {
  console.log(`${label}:`);
  console.log(
    `  creators: ${state.counts.creators}  feeds: ${state.counts.feeds}  content items: ${state.counts.contentItems}  subscriptions: ${state.counts.subscriptions}`,
  );
  console.log(
    `  merge groups: ${state.mergeSummary.groups} (${state.mergeSummary.creatorsMergedAway} creator row(s) merged away)`,
  );
  for (const action of state.mergePlan.groups) {
    console.log(
      `    - ${action.canonical.displayName} (${action.canonical.sourceType}:${action.canonical.sourceExternalId}) <- ${action.mergedAwayIds.length} row(s)`,
    );
  }
  console.log(`  schema: ${describeSchemaState(state)}`);
  console.log(`  foreign_key_check violations: ${state.foreignKeyViolations}`);
}

async function main(): Promise<void> {
  const args = parseArgs(Bun.argv.slice(2));
  const target = resolveTargetDatabase(args);
  const databasePath = resolveDatabaseFilePath(target);
  if (databasePath !== ":memory:" && !existsSync(databasePath)) {
    throw new Error(`database file does not exist: ${databasePath}`);
  }

  const beforeDb = openCatalogDatabase(target, { readOnly: true });
  const before = inspectCatalog(beforeDb);
  beforeDb.close();

  console.log("=== feedelity catalog data migrations ===");
  console.log(`  database: ${target}`);
  console.log(`  mode:     ${args.yes ? "WRITE (--yes)" : "DRY RUN (no writes)"}\n`);
  printInspection("before", before);

  const report = await runCatalogDataMigrations({ databaseUrl: target, apply: args.yes });

  console.log("");
  for (const step of report.steps) {
    console.log(`step ${step.id}: ${step.applied ? "applied" : "not applied"}`);
    console.log(`  ${step.description}`);
    for (const detail of step.details) {
      console.log(`  - ${detail}`);
    }
  }
  console.log(`\napplied steps: ${report.appliedCount}`);

  if (!args.yes) {
    console.log("\nDry run complete. No rows written. Re-run with --yes to apply.");
    return;
  }

  const afterDb = openCatalogDatabase(target, { readOnly: true });
  const after = inspectCatalog(afterDb);
  afterDb.close();

  console.log("");
  printInspection("after", after);
  console.log(
    `\ncreators: ${before.counts.creators} -> ${after.counts.creators} (delta ${after.counts.creators - before.counts.creators})`,
  );
  if (after.foreignKeyViolations > 0) {
    console.log(
      `note: ${after.foreignKeyViolations} foreign_key_check violation(s) pre-existed and were not touched by this migration`,
    );
  }
}

try {
  await main();
} catch (error) {
  console.error(`db:repair failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
