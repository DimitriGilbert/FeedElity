/**
 * Idempotent catalog DATA migrations, recorded in the `__feedelity_migrations`
 * table (same runner pattern as ../bootstrap.ts, but using bun:sqlite so steps
 * can run scripted TS logic instead of static SQL files).
 *
 * Why this exists: the drizzle migration journal is deliberately BEHIND the
 * schema files for the creator change (its snapshot still models the legacy
 * per-source creator), so `drizzle-kit generate` would produce an unsafe
 * migration (a unique name_key index over still-duplicated rows). Instead, the
 * `creator_cross_source_merge` step merges duplicate creator rows first and
 * then converges the creator table to the cross-source (name_key) schema on
 * whatever state it finds — legacy or current. The follow-up
 * `content_cross_source_key` step adds content_item.cross_source_key, indexes
 * it, and backfills mirror keys from each item's creator name_key plus its
 * normalized title.
 *
 * Each step runs in its own transaction: BEGIN IMMEDIATE -> check id -> run ->
 * insert id -> COMMIT; on any error the transaction is rolled back and the
 * error is rethrown with the step id. Steps must be idempotent so a re-run
 * after a partial failure converges.
 */

import { Database, type SQLQueryBindings } from "bun:sqlite";

import { contentCrossSourceKey } from "../cross-source-key";
import {
  buildMergePlan,
  creatorNameKey,
  summarizePlan,
  type CreatorRow,
  type MergePlan,
  type PlanSummary,
} from "../creator-merge-plan";

const migrationTableName = "__feedelity_migrations";

const createMigrationTableSql =
  `CREATE TABLE IF NOT EXISTS ${migrationTableName} (id text PRIMARY KEY NOT NULL, applied_at integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL)`;

/** Exact MAX(published_at) backfill from 0002_creator_last_published.sql. */
const LAST_CONTENT_PUBLISHED_AT_BACKFILL_SQL =
  "UPDATE `creator` SET `last_content_published_at` = (SELECT MAX(`published_at`) FROM `content_item` WHERE `content_item`.`creator_id` = `creator`.`id`)";

/** Legacy per-source identity columns that must not survive convergence. */
const LEGACY_CREATOR_SOURCE_COLUMNS = ["source_type", "source_external_id"] as const;

const CREATOR_SOURCE_IDENTITY_UIDX = "creator_source_identity_uidx";

const CREATOR_INDEX_DDL: Readonly<Record<string, string>> = {
  creator_name_key_uidx: "CREATE UNIQUE INDEX IF NOT EXISTS creator_name_key_uidx ON creator (name_key)",
  creator_display_name_idx: "CREATE INDEX IF NOT EXISTS creator_display_name_idx ON creator (display_name)",
  creator_last_content_published_at_idx:
    "CREATE INDEX IF NOT EXISTS creator_last_content_published_at_idx ON creator (last_content_published_at)",
};

const CREATOR_INDEXES = Object.keys(CREATOR_INDEX_DDL);

const CONTENT_CROSS_SOURCE_KEY_INDEX = "content_item_cross_source_key_idx";

export interface CatalogCounts {
  readonly creators: number;
  readonly feeds: number;
  readonly contentItems: number;
  readonly subscriptions: number;
}

export interface CreatorSchemaState {
  /** Legacy per-source columns still present on the creator table. */
  readonly legacySourceColumnsPresent: readonly string[];
  readonly hasNameKeyColumn: boolean;
  readonly hasLastContentPublishedAtColumn: boolean;
  /** Expected creator indexes that do not exist yet. */
  readonly missingIndexes: readonly string[];
}

export interface CatalogInspection {
  readonly counts: CatalogCounts;
  readonly schema: CreatorSchemaState;
  readonly mergePlan: MergePlan;
  readonly mergeSummary: PlanSummary;
  readonly foreignKeyViolations: number;
}

export interface CatalogDataMigrationStepReport {
  readonly id: string;
  /**
   * True only when the step actually ran and was recorded during this call.
   * Always false in dry-run mode; the step `details` describe what WOULD run.
   */
  readonly applied: boolean;
  readonly description: string;
  readonly details: readonly string[];
}

export interface CatalogDataMigrationReport {
  /** Mirrors the `apply` input so a report is self-describing. */
  readonly apply: boolean;
  readonly steps: readonly CatalogDataMigrationStepReport[];
  readonly appliedCount: number;
}

interface CatalogMigrationStep {
  readonly id: string;
  readonly description: string;
  /**
   * Inspect the database without writing when `apply` is false, or perform the
   * migration inside the caller's transaction when `apply` is true. Returns
   * human-readable detail lines for the report.
   */
  readonly run: (db: Database, apply: boolean) => readonly string[];
}

/**
 * Strip a leading `file:` from a libsql-style URL so bun:sqlite can open it,
 * and reject remote database URLs (the runner only converges local files).
 */
export function resolveDatabaseFilePath(databaseUrl: string): string {
  if (databaseUrl.startsWith("file:")) {
    // file:///abs/path -> /abs/path (file URLs carry the leading slash of the
    // path plus the URL authority separator).
    return databaseUrl.slice("file:".length).replace(/^\/{2,}/, "/");
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(databaseUrl)) {
    throw new Error(
      `Unsupported remote database URL for catalog data migrations: ${databaseUrl}. Provide a local SQLite file path.`,
    );
  }
  return databaseUrl;
}

/** Open a local catalog database with foreign keys enforced. */
export function openCatalogDatabase(databaseUrl: string, options: { readonly readOnly: boolean }): Database {
  const databasePath = resolveDatabaseFilePath(databaseUrl);
  // This bun:sqlite version misuses its open flags when an options object is
  // passed with a falsy `readonly` (SQLITE_MISUSE), so only pass options for
  // read-only opens.
  const db = options.readOnly ? new Database(databasePath, { readonly: true }) : new Database(databasePath);
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

/**
 * Run the ordered catalog data migrations. With `apply: false` this is a dry
 * run: nothing is written (the database is opened read-only), `applied` is
 * false for every step, and each step's `details` describe what apply would do.
 */
export async function runCatalogDataMigrations(input: {
  readonly databaseUrl: string;
  readonly apply: boolean;
}): Promise<CatalogDataMigrationReport> {
  const db = openCatalogDatabase(input.databaseUrl, { readOnly: !input.apply });
  try {
    const steps: CatalogDataMigrationStepReport[] = [];
    if (input.apply) {
      for (const step of catalogMigrationSteps) {
        steps.push(applyMigrationStep(db, step));
      }
    } else {
      const migrationsTableExists = tableExists(db, migrationTableName);
      for (const step of catalogMigrationSteps) {
        const recorded = migrationsTableExists && isMigrationRecorded(db, step.id);
        const details = recorded
          ? ["skipped: migration id already recorded"]
          : step.run(db, false);
        steps.push({ id: step.id, applied: false, description: step.description, details });
      }
    }
    return {
      apply: input.apply,
      steps,
      appliedCount: steps.filter((step) => step.applied).length,
    };
  } finally {
    db.close();
  }
}

function applyMigrationStep(db: Database, step: CatalogMigrationStep): CatalogDataMigrationStepReport {
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(createMigrationTableSql);
    if (isMigrationRecorded(db, step.id)) {
      db.exec("COMMIT");
      return {
        id: step.id,
        applied: false,
        description: step.description,
        details: ["skipped: migration id already recorded"],
      };
    }
    const details = step.run(db, true);
    db.query(`INSERT INTO ${migrationTableName} (id) VALUES (?)`).run(step.id);
    db.exec("COMMIT");
    return { id: step.id, applied: true, description: step.description, details };
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch (rollbackError) {
      throw new Error(
        `Catalog migration step "${step.id}" failed and rollback also failed: ${errorMessage(error)}; ` +
          `rollback: ${errorMessage(rollbackError)}`,
        { cause: error },
      );
    }
    throw new Error(`Catalog migration step "${step.id}" failed; transaction rolled back: ${errorMessage(error)}`, {
      cause: error,
    });
  }
}

const creatorCrossSourceMergeStep: CatalogMigrationStep = {
  id: "creator_cross_source_merge",
  description:
    "Merge duplicate per-source creator rows onto their canonical name_key creator, then converge the creator table to the cross-source schema (name_key + last_content_published_at).",
  run: runCreatorCrossSourceMerge,
};

const contentCrossSourceKeyStep: CatalogMigrationStep = {
  id: "content_cross_source_key",
  description:
    "Add content_item.cross_source_key, index it, and backfill the mirror key of existing items from their creator's name_key and normalized title.",
  run: runContentCrossSourceKey,
};

const catalogMigrationSteps: readonly CatalogMigrationStep[] = [
  creatorCrossSourceMergeStep,
  contentCrossSourceKeyStep,
];

function runCreatorCrossSourceMerge(db: Database, apply: boolean): readonly string[] {
  const before = inspectCatalog(db);

  if (before.mergeSummary.groups === 0 && isSchemaConverged(before.schema)) {
    return [
      "already converged: 0 merge groups and the creator table already has the cross-source schema",
      `foreign_key_check violations (pre-existing, untouched): ${before.foreignKeyViolations}`,
    ];
  }

  if (!apply) {
    return [
      `would merge ${before.mergeSummary.groups} duplicate group(s): ${before.mergeSummary.creatorsMergedAway} creator row(s) absorbed by their canonical creator`,
      `schema work: ${describeSchemaWork(before.schema)}`,
      "no writes performed (dry run)",
    ];
  }

  for (const action of before.mergePlan.groups) {
    for (const mergedAwayId of action.mergedAwayIds) {
      repointCreatorChildren(db, action.canonical.id, mergedAwayId);
    }
  }

  const details: string[] = [
    `merged ${before.mergeSummary.groups} duplicate group(s): ${before.mergeSummary.creatorsMergedAway} creator row(s) absorbed`,
  ];

  convergeCreatorSchema(db, before.schema, before.mergePlan, details);

  // The merge must not introduce NEW foreign-key orphans. Pre-existing
  // violations (damage already in the DB) are tolerated and reported.
  const violations = countForeignKeyViolations(db);
  if (violations > before.foreignKeyViolations) {
    throw new Error(
      `foreign_key_check reported ${violations} violation(s), up from ${before.foreignKeyViolations} pre-existing; ` +
        "the migration introduced new orphans",
    );
  }
  details.push(`foreign_key_check: ${violations} violation(s) (pre-existing: ${before.foreignKeyViolations})`);

  return details;
}

/**
 * Backfill content_item.cross_source_key. Runs after
 * creator_cross_source_merge so creator.name_key exists for the join. The key
 * function is the mirrored contentCrossSourceKey() from ../cross-source-key,
 * which the parity tests pin to the domain implementation in packages/api.
 */
function runContentCrossSourceKey(db: Database, apply: boolean): readonly string[] {
  const hasColumn = loadTableColumns(db, "content_item").has("cross_source_key");
  const hasIndex = indexExists(db, CONTENT_CROSS_SOURCE_KEY_INDEX);
  // Without the column every existing row is pending; with it, the NULL guard
  // keeps the backfill idempotent.
  const pendingCount = hasColumn
    ? readSingleNumber(db, "SELECT count(*) AS n FROM content_item WHERE cross_source_key IS NULL")
    : readSingleNumber(db, "SELECT count(*) AS n FROM content_item");

  if (hasColumn && hasIndex && pendingCount === 0) {
    return ["already converged: content_item.cross_source_key exists, is indexed, and has no NULL rows"];
  }

  if (!apply) {
    const work: string[] = [];
    if (!hasColumn) {
      work.push("add content_item.cross_source_key column");
    }
    if (!hasIndex) {
      work.push(`create index ${CONTENT_CROSS_SOURCE_KEY_INDEX}`);
    }
    work.push(`backfill cross_source_key for ${pendingCount} content_item row(s)`);
    work.push("no writes performed (dry run)");
    return work;
  }

  if (!hasColumn) {
    db.exec("ALTER TABLE content_item ADD COLUMN cross_source_key text");
  }
  if (!hasIndex) {
    db.exec(`CREATE INDEX IF NOT EXISTS ${CONTENT_CROSS_SOURCE_KEY_INDEX} ON content_item (cross_source_key)`);
  }

  const details: string[] = [];
  if (!hasColumn) {
    details.push("added content_item.cross_source_key column");
  }
  if (!hasIndex) {
    details.push(`created index ${CONTENT_CROSS_SOURCE_KEY_INDEX}`);
  }

  const pendingRows = loadContentItemsMissingCrossSourceKey(db);
  let backfilled = 0;
  for (const row of pendingRows) {
    // Titles with no letters or numbers normalize to empty: skip them and leave
    // the key NULL so callers never see a garbage linkage.
    const key = contentCrossSourceKey(row.nameKey, row.title);
    if (key === null) {
      continue;
    }
    db.query("UPDATE content_item SET cross_source_key = ? WHERE id = ?").run(key, row.id);
    backfilled += 1;
  }
  details.push(
    `backfilled cross_source_key for ${backfilled} content_item row(s)` +
      (pendingRows.length === backfilled ? "" : ` (skipped ${pendingRows.length - backfilled} with empty normalized titles)`),
  );

  return details;
}

interface ContentItemKeyRow {
  readonly id: string;
  readonly nameKey: string;
  readonly title: string;
}

function loadContentItemsMissingCrossSourceKey(db: Database): ContentItemKeyRow[] {
  const rows: readonly unknown[] = db
    .query(
      "SELECT i.id AS id, c.name_key AS nameKey, i.title AS title " +
        "FROM content_item i INNER JOIN creator c ON c.id = i.creator_id " +
        "WHERE i.cross_source_key IS NULL",
    )
    .all();
  return rows.map(parseContentItemKeyRow);
}

function parseContentItemKeyRow(row: unknown): ContentItemKeyRow {
  if (!isRecord(row)) {
    throw new Error("content_item cross-source-key query returned a non-object row");
  }
  const title = row["title"];
  if (typeof title !== "string") {
    throw new Error(`expected a string for content_item.title, got ${describeValue(title)}`);
  }
  return {
    id: requireStringField(row, "id", "content_item.id"),
    nameKey: requireStringField(row, "nameKey", "creator.name_key"),
    title,
  };
}

/** Re-point every child row of a merged-away creator, then delete the row. */
function repointCreatorChildren(db: Database, canonicalId: string, mergedAwayId: string): void {
  db.query("UPDATE content_item SET creator_id = ? WHERE creator_id = ?").run(canonicalId, mergedAwayId);
  db.query("UPDATE feed SET creator_id = ? WHERE creator_id = ?").run(canonicalId, mergedAwayId);
  db.query("UPDATE refresh_run SET requested_creator_id = ? WHERE requested_creator_id = ?").run(
    canonicalId,
    mergedAwayId,
  );
  // collection_member is unique on (collection_id, creator_id): drop each
  // collection's duplicate membership before re-pointing the survivor.
  // Without this the creator DELETE would cascade the memberships away.
  db.query(
    "DELETE FROM collection_member WHERE creator_id = ? AND collection_id IN " +
      "(SELECT collection_id FROM collection_member WHERE creator_id = ?)",
  ).run(mergedAwayId, canonicalId);
  db.query("UPDATE collection_member SET creator_id = ? WHERE creator_id = ?").run(canonicalId, mergedAwayId);
  // subscription is unique on (user_id, creator_id): same dedup-first pattern.
  db.query(
    "DELETE FROM subscription WHERE creator_id = ? AND user_id IN (SELECT user_id FROM subscription WHERE creator_id = ?)",
  ).run(mergedAwayId, canonicalId);
  db.query("UPDATE subscription SET creator_id = ? WHERE creator_id = ?").run(canonicalId, mergedAwayId);
  db.query("DELETE FROM creator WHERE id = ?").run(mergedAwayId);
}

function convergeCreatorSchema(
  db: Database,
  schema: CreatorSchemaState,
  plan: MergePlan,
  details: string[],
): void {
  if (schema.legacySourceColumnsPresent.length > 0) {
    // The unique index over the legacy identity columns must go before its
    // columns can be dropped.
    if (indexExists(db, CREATOR_SOURCE_IDENTITY_UIDX)) {
      db.exec(`DROP INDEX ${CREATOR_SOURCE_IDENTITY_UIDX}`);
    }
    for (const column of schema.legacySourceColumnsPresent) {
      db.exec(`ALTER TABLE creator DROP COLUMN ${column}`);
    }
    details.push(`dropped legacy creator column(s): ${schema.legacySourceColumnsPresent.join(", ")}`);
  }

  if (!schema.hasNameKeyColumn) {
    db.exec("ALTER TABLE creator ADD COLUMN name_key text");
    details.push("added creator.name_key column");
  }

  if (!schema.hasLastContentPublishedAtColumn) {
    db.exec("ALTER TABLE creator ADD COLUMN last_content_published_at integer");
    details.push("added creator.last_content_published_at column");
  }

  const backfilledNameKeys = backfillCreatorNameKeys(db);
  details.push(`backfilled name_key for ${backfilledNameKeys} row(s)`);

  for (const indexName of schema.missingIndexes) {
    const ddl = CREATOR_INDEX_DDL[indexName];
    if (ddl === undefined) {
      throw new Error(`no DDL registered for expected creator index "${indexName}"`);
    }
    db.exec(ddl);
  }

  if (!schema.hasLastContentPublishedAtColumn) {
    // The column is new: backfill every creator from the (already merged)
    // content_item rows, exactly like 0002_creator_last_published.sql.
    const backfilled = db.query(LAST_CONTENT_PUBLISHED_AT_BACKFILL_SQL).run().changes;
    details.push(`backfilled last_content_published_at for ${backfilled} row(s)`);
  } else if (plan.groups.length > 0) {
    // Canonical creators absorbed rows: their item set changed, so recompute.
    for (const action of plan.groups) {
      db.query(
        "UPDATE creator SET last_content_published_at = " +
          "(SELECT MAX(published_at) FROM content_item WHERE content_item.creator_id = ?) WHERE id = ?",
      ).run(action.canonical.id, action.canonical.id);
    }
    details.push(`recomputed last_content_published_at for ${plan.groups.length} canonical creator(s)`);
  }
}

/**
 * Backfill creator.name_key with creatorNameKey() — the same function the merge
 * plan and runtime ingestion use — so the stored key matches what
 * findCreatorByNameKey computes for every display-name shape (leading "@",
 * ":claimId" suffixes, internal "@", tabs/newlines). Parameterized per-row
 * UPDATE, same pattern as the cross_source_key backfill. Must run before the
 * unique creator_name_key_uidx index is created.
 */
function backfillCreatorNameKeys(db: Database): number {
  const rows: readonly unknown[] = db
    .query("SELECT id AS id, display_name AS displayName FROM creator WHERE name_key IS NULL")
    .all();
  let backfilled = 0;
  for (const row of rows) {
    if (!isRecord(row)) {
      throw new Error("creator name_key backfill query returned a non-object row");
    }
    const displayName = requireStringField(row, "displayName", "creator.display_name");
    const id = requireStringField(row, "id", "creator.id");
    const updated = db
      .query("UPDATE creator SET name_key = ? WHERE id = ?")
      .run(creatorNameKey(displayName), id).changes;
    backfilled += updated;
  }
  return backfilled;
}

function isSchemaConverged(schema: CreatorSchemaState): boolean {
  return (
    schema.legacySourceColumnsPresent.length === 0 &&
    schema.hasNameKeyColumn &&
    schema.hasLastContentPublishedAtColumn &&
    schema.missingIndexes.length === 0
  );
}

function describeSchemaWork(schema: CreatorSchemaState): string {
  const work: string[] = [];
  if (schema.legacySourceColumnsPresent.length > 0) {
    work.push(
      `drop legacy column(s) ${schema.legacySourceColumnsPresent.join(", ")} (and ${CREATOR_SOURCE_IDENTITY_UIDX} if present)`,
    );
  }
  if (!schema.hasNameKeyColumn) {
    work.push("add name_key column");
  }
  if (!schema.hasLastContentPublishedAtColumn) {
    work.push("add last_content_published_at column");
  }
  if (schema.missingIndexes.length > 0) {
    work.push(`create index(es) ${schema.missingIndexes.join(", ")}`);
  }
  return work.length === 0 ? "none" : work.join("; ");
}

/** Read the full catalog state: counts, creator schema state, and merge plan. */
export function inspectCatalog(db: Database): CatalogInspection {
  const columns = loadTableColumns(db, "creator");
  const mergePlan = buildMergePlan(loadCreatorRows(db, columns));
  return {
    counts: loadCatalogCounts(db),
    schema: {
      legacySourceColumnsPresent: LEGACY_CREATOR_SOURCE_COLUMNS.filter((column) => columns.has(column)),
      hasNameKeyColumn: columns.has("name_key"),
      hasLastContentPublishedAtColumn: columns.has("last_content_published_at"),
      missingIndexes: CREATOR_INDEXES.filter((indexName) => !indexExists(db, indexName)),
    },
    mergePlan,
    mergeSummary: summarizePlan(mergePlan),
    foreignKeyViolations: countForeignKeyViolations(db),
  };
}

function loadCatalogCounts(db: Database): CatalogCounts {
  return {
    creators: readSingleNumber(db, "SELECT count(*) AS n FROM creator"),
    feeds: readSingleNumber(db, "SELECT count(*) AS n FROM feed"),
    contentItems: readSingleNumber(db, "SELECT count(*) AS n FROM content_item"),
    subscriptions: readSingleNumber(db, "SELECT count(*) AS n FROM subscription"),
  };
}

/** Load the set of column names a table currently has. */
function loadTableColumns(db: Database, tableName: string): ReadonlySet<string> {
  const rows: readonly unknown[] = db.query(`PRAGMA table_info(${tableName})`).all();
  if (rows.length === 0) {
    throw new Error(
      `${tableName} table does not exist; apply the drizzle schema first (db:push or the bootstrap SQL migrations)`,
    );
  }
  const names = new Set<string>();
  for (const row of rows) {
    if (!isRecord(row)) {
      throw new Error(`PRAGMA table_info(${tableName}) returned a non-object row`);
    }
    const name = row["name"];
    if (typeof name !== "string" || name.length === 0) {
      throw new Error(`PRAGMA table_info(${tableName}) returned a row without a valid column name`);
    }
    names.add(name);
  }
  return names;
}

/**
 * Load creator rows in the union shape buildMergePlan expects, tolerating both
 * the legacy schema (source_type/source_external_id) and the converged schema
 * (absent columns are selected as NULL and reported as "unknown").
 */
function loadCreatorRows(db: Database, columns: ReadonlySet<string>): CreatorRow[] {
  const sourceTypeSelection = columns.has("source_type") ? "c.source_type" : "NULL";
  const sourceExternalIdSelection = columns.has("source_external_id") ? "c.source_external_id" : "NULL";
  const rows: readonly unknown[] = db
    .query(
      `SELECT c.id AS id, ${sourceTypeSelection} AS sourceType, ${sourceExternalIdSelection} AS sourceExternalId,
              c.display_name AS displayName, c.created_at AS createdAt,
              (SELECT count(*) FROM content_item i WHERE i.creator_id = c.id) AS contentCount,
              (SELECT count(*) FROM subscription s WHERE s.creator_id = c.id) AS subscriptionCount
       FROM creator c`,
    )
    .all();
  return rows.map(parseCreatorRow);
}

function parseCreatorRow(row: unknown): CreatorRow {
  if (!isRecord(row)) {
    throw new Error("creator row query returned a non-object row");
  }
  return {
    id: requireStringField(row, "id", "creator.id"),
    sourceType: optionalSourceIdentityField(row["sourceType"]),
    sourceExternalId: optionalSourceIdentityField(row["sourceExternalId"]),
    displayName: requireStringField(row, "displayName", "creator.display_name"),
    createdAt: requireNumberField(row, "createdAt", "creator.created_at"),
    contentCount: requireNumberField(row, "contentCount", "creator.contentCount"),
    subscriptionCount: requireNumberField(row, "subscriptionCount", "creator.subscriptionCount"),
  };
}

function requireStringField(record: Record<string, unknown>, key: string, column: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`expected a non-empty string for ${column}, got ${describeValue(value)}`);
  }
  return value;
}

function optionalSourceIdentityField(value: unknown): string {
  return typeof value === "string" ? value : "unknown";
}

function requireNumberField(record: Record<string, unknown>, key: string, column: string): number {
  const value = record[key];
  if (typeof value === "number" || typeof value === "bigint") {
    return Number(value);
  }
  throw new Error(`expected a number for ${column}, got ${describeValue(value)}`);
}

function describeValue(value: unknown): string {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

function readSingleNumber(db: Database, sql: string, ...params: SQLQueryBindings[]): number {
  const row: unknown = db.query(sql).get(...params);
  if (!isRecord(row)) {
    throw new Error(`count query returned a non-object row: ${sql}`);
  }
  const n = row["n"];
  if (typeof n !== "number" && typeof n !== "bigint") {
    throw new Error(`count query did not return a numeric "n" column: ${sql}`);
  }
  return Number(n);
}

function countForeignKeyViolations(db: Database): number {
  return db.query("PRAGMA foreign_key_check").all().length;
}

function tableExists(db: Database, name: string): boolean {
  return readSingleNumber(db, "SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?", name) > 0;
}

function indexExists(db: Database, name: string): boolean {
  return readSingleNumber(db, "SELECT count(*) AS n FROM sqlite_master WHERE type = 'index' AND name = ?", name) > 0;
}

function isMigrationRecorded(db: Database, id: string): boolean {
  return (
    readSingleNumber(db, `SELECT count(*) AS n FROM ${migrationTableName} WHERE id = ?`, id) > 0
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
