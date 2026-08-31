import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Database, type SQLQueryBindings } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import { contentCrossSourceKey } from "../cross-source-key";
import { creatorNameKey } from "../creator-merge-plan";
import {
  inspectCatalog,
  openCatalogDatabase,
  resolveDatabaseFilePath,
  runCatalogDataMigrations,
  type CatalogInspection,
} from "./catalog-data-migrations";

const SCOTT_CANONICAL_ID = "11111111-1111-4111-8111-111111111111";
const SCOTT_ODYSEE_ID = "22222222-2222-4222-8222-222222222222";
const SCOTT_CLAIM_REVISION_ID = "33333333-3333-4333-8333-333333333333";
const SOLO_ID = "44444444-4444-4444-8444-444444444444";
const DAMAGED_KEY_ID = "55555555-5555-4555-8555-555555555555";

function legacySchemaSql(options: { readonly withLastPublishedColumn: boolean }): string {
  const lastPublishedColumn = options.withLastPublishedColumn ? ",\n    last_content_published_at integer" : "";
  return `
  CREATE TABLE creator (
    id text PRIMARY KEY NOT NULL,
    source_type text NOT NULL,
    source_external_id text NOT NULL,
    display_name text NOT NULL,
    created_at integer NOT NULL,
    updated_at integer NOT NULL${lastPublishedColumn}
  );
  CREATE UNIQUE INDEX creator_source_identity_uidx ON creator (source_type, source_external_id);
  CREATE TABLE feed (
    id text PRIMARY KEY NOT NULL,
    creator_id text NOT NULL REFERENCES creator(id) ON DELETE CASCADE,
    source_type text NOT NULL,
    source_external_id text NOT NULL
  );
  CREATE UNIQUE INDEX feed_source_identity_uidx ON feed (source_type, source_external_id);
  CREATE TABLE content_item (
    id text PRIMARY KEY NOT NULL,
    creator_id text NOT NULL REFERENCES creator(id) ON DELETE CASCADE,
    source_type text NOT NULL,
    source_external_id text NOT NULL,
    title text NOT NULL,
    published_at integer,
    created_at integer NOT NULL DEFAULT 0
  );
  CREATE UNIQUE INDEX content_item_source_identity_uidx ON content_item (source_type, source_external_id);
  CREATE TABLE refresh_run (
    id text PRIMARY KEY NOT NULL,
    requested_creator_id text REFERENCES creator(id) ON DELETE SET NULL
  );
  CREATE TABLE subscription (
    user_id text NOT NULL,
    creator_id text NOT NULL REFERENCES creator(id) ON DELETE CASCADE,
    created_at integer NOT NULL,
    PRIMARY KEY (user_id, creator_id)
  );
  CREATE TABLE creator_collection (
    id text PRIMARY KEY NOT NULL,
    user_id text NOT NULL,
    display_name text NOT NULL,
    created_at integer NOT NULL
  );
  CREATE TABLE collection_member (
    id text PRIMARY KEY NOT NULL,
    user_id text NOT NULL,
    collection_id text NOT NULL REFERENCES creator_collection(id) ON DELETE CASCADE,
    creator_id text NOT NULL REFERENCES creator(id) ON DELETE CASCADE,
    added_at integer NOT NULL
  );
  CREATE UNIQUE INDEX collection_member_collection_creator_uidx ON collection_member (collection_id, creator_id);
`;
}

async function createLegacyDatabaseFile(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  return join(directory, "legacy.db");
}

function createLegacyDatabase(path: string, options: { readonly withLastPublishedColumn: boolean }): Database {
  const db = new Database(path);
  db.exec(legacySchemaSql(options));
  return db;
}

/**
 * Seed the production-like legacy shape: three "Scott Manley" rows sharing one
 * display name (youtube, odysee handle, odysee claim revision) plus an
 * unrelated solo creator.
 */
function seedLegacyRows(db: Database, options: { readonly withLastPublishedColumn: boolean }): void {
  // The youtube row has the most items, so it wins the canonical pick.
  insertCreator(db, options, SCOTT_CANONICAL_ID, "youtube", "UCscott-yt", "Scott Manley", 300);
  insertCreator(db, options, SCOTT_ODYSEE_ID, "odysee", "@scottmanley", "Scott Manley", 100);
  insertCreator(db, options, SCOTT_CLAIM_REVISION_ID, "odysee", "@scottmanley:5", "Scott Manley", 0);
  insertCreator(db, options, SOLO_ID, "youtube", "UCsolo", "Unique Channel", 50);

  insertFeed(db, "f-yt", SCOTT_CANONICAL_ID, "youtube", "UCscott-yt");
  insertFeed(db, "f-od", SCOTT_ODYSEE_ID, "odysee", "@scottmanley");
  insertFeed(db, "f-rev", SCOTT_CLAIM_REVISION_ID, "odysee", "@scottmanley:5");
  insertFeed(db, "f-solo", SOLO_ID, "youtube", "UCsolo");

  insertContentItem(db, "i-yt-1", SCOTT_CANONICAL_ID, "yt-1", 100);
  insertContentItem(db, "i-yt-2", SCOTT_CANONICAL_ID, "yt-2", 200);
  insertContentItem(db, "i-yt-3", SCOTT_CANONICAL_ID, "yt-3", 300);
  // The odysee row carries the newest item: absorbing it must move the
  // canonical creator's last_content_published_at forward.
  insertContentItem(db, "i-od-1", SCOTT_ODYSEE_ID, "od-1", 400);
  insertContentItem(db, "i-solo-1", SOLO_ID, "solo-1", 50);

  db.query("INSERT INTO refresh_run (id, requested_creator_id) VALUES (?, ?)").run("rr-1", SCOTT_ODYSEE_ID);

  insertSubscription(db, "user-1", SCOTT_CANONICAL_ID);
  insertSubscription(db, "user-1", SCOTT_ODYSEE_ID);
  insertSubscription(db, "user-2", SCOTT_CLAIM_REVISION_ID);

  db.query(
    "INSERT INTO creator_collection (id, user_id, display_name, created_at) VALUES (?, ?, ?, ?)",
  ).run("col-1", "user-1", "Favorite channels", 1);
  db.query(
    "INSERT INTO creator_collection (id, user_id, display_name, created_at) VALUES (?, ?, ?, ?)",
  ).run("col-2", "user-1", "Duplicated membership", 2);
  // col-1 only follows the odysee row: the membership must be re-pointed.
  insertCollectionMember(db, "cm-1", "user-1", "col-1", SCOTT_ODYSEE_ID);
  insertCollectionMember(db, "cm-2", "user-1", "col-1", SOLO_ID);
  // col-2 follows both the youtube and the odysee row: dedup must leave one.
  insertCollectionMember(db, "cm-3", "user-1", "col-2", SCOTT_CANONICAL_ID);
  insertCollectionMember(db, "cm-4", "user-1", "col-2", SCOTT_ODYSEE_ID);
}

function insertCreator(
  db: Database,
  options: { readonly withLastPublishedColumn: boolean },
  id: string,
  sourceType: string,
  sourceExternalId: string,
  displayName: string,
  lastPublished: number,
): void {
  const result =
    options.withLastPublishedColumn === true
      ? db
          .query(
            "INSERT INTO creator (id, source_type, source_external_id, display_name, created_at, updated_at, last_content_published_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          )
          .run(id, sourceType, sourceExternalId, displayName, 1, 1, lastPublished)
      : db
          .query(
            "INSERT INTO creator (id, source_type, source_external_id, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
          )
          .run(id, sourceType, sourceExternalId, displayName, 1, 1);
  if (result.changes !== 1) {
    throw new Error(`failed to insert creator ${id}`);
  }
}

function insertFeed(db: Database, id: string, creatorId: string, sourceType: string, sourceExternalId: string): void {
  db.query("INSERT INTO feed (id, creator_id, source_type, source_external_id) VALUES (?, ?, ?, ?)").run(
    id,
    creatorId,
    sourceType,
    sourceExternalId,
  );
}

function insertContentItem(
  db: Database,
  id: string,
  creatorId: string,
  sourceExternalId: string,
  publishedAt: number,
): void {
  db.query(
    "INSERT INTO content_item (id, creator_id, source_type, source_external_id, title, published_at) VALUES (?, ?, 'youtube', ?, ?, ?)",
  ).run(id, creatorId, sourceExternalId, `Title ${id}`, publishedAt);
}

function insertSubscription(db: Database, userId: string, creatorId: string): void {
  db.query("INSERT INTO subscription (user_id, creator_id, created_at) VALUES (?, ?, ?)").run(userId, creatorId, 1);
}

function insertCollectionMember(
  db: Database,
  id: string,
  userId: string,
  collectionId: string,
  creatorId: string,
): void {
  db.query(
    "INSERT INTO collection_member (id, user_id, collection_id, creator_id, added_at) VALUES (?, ?, ?, ?, ?)",
  ).run(id, userId, collectionId, creatorId, 1);
}

function queryNumber(db: Database, sql: string, ...params: SQLQueryBindings[]): number {
  const row: unknown = db.query(sql).get(...params);
  if (typeof row !== "object" || row === null || !("n" in row)) {
    throw new Error(`count query returned an unexpected row: ${sql}`);
  }
  const n: unknown = row.n;
  if (typeof n !== "number" && typeof n !== "bigint") {
    throw new Error(`count query did not return a number: ${sql}`);
  }
  return Number(n);
}

function queryOptionalNumber(db: Database, sql: string, ...params: SQLQueryBindings[]): number | null {
  const row: unknown = db.query(sql).get(...params);
  if (typeof row !== "object" || row === null || !("v" in row)) {
    throw new Error(`scalar query returned an unexpected row: ${sql}`);
  }
  const v: unknown = row.v;
  if (v === null) {
    return null;
  }
  if (typeof v !== "number" && typeof v !== "bigint") {
    throw new Error(`scalar query did not return a number: ${sql}`);
  }
  return Number(v);
}

function queryString(db: Database, sql: string, ...params: SQLQueryBindings[]): string {
  const row: unknown = db.query(sql).get(...params);
  if (typeof row !== "object" || row === null || !("v" in row)) {
    throw new Error(`scalar query returned an unexpected row: ${sql}`);
  }
  const v: unknown = row.v;
  if (typeof v !== "string") {
    throw new Error(`scalar query did not return a string: ${sql}`);
  }
  return v;
}

function loadColumnNames(db: Database, tableName: string): readonly string[] {
  const rows: readonly unknown[] = db.query(`PRAGMA table_info(${tableName})`).all();
  const names: string[] = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null || !("name" in row)) {
      throw new Error(`PRAGMA table_info(${tableName}) returned an unexpected row`);
    }
    if (typeof row.name !== "string") {
      throw new Error(`PRAGMA table_info(${tableName}) returned a non-string column name`);
    }
    names.push(row.name);
  }
  return names;
}

function creatorColumnNames(db: Database): readonly string[] {
  return loadColumnNames(db, "creator");
}

function indexNames(db: Database): ReadonlySet<string> {
  const rows: readonly unknown[] = db.query("SELECT name FROM sqlite_master WHERE type = 'index'").all();
  const names = new Set<string>();
  for (const row of rows) {
    if (typeof row !== "object" || row === null || !("name" in row) || typeof row.name !== "string") {
      throw new Error("index list query returned an unexpected row");
    }
    names.add(row.name);
  }
  return names;
}

function inspectDatabaseFile(path: string): CatalogInspection {
  const db = openCatalogDatabase(path, { readOnly: true });
  try {
    return inspectCatalog(db);
  } finally {
    db.close();
  }
}

describe("name_key backfill parity", () => {
  test("backfilled name_key equals creatorNameKey for every display-name shape", async () => {
    // Shapes the previous SQL backfill got wrong: it stripped EVERY "@" (not
    // just leading handles) and only ASCII spaces (not tabs/newlines).
    const displayNames = [
      "Tech@Home", // internal "@" must survive into the key
      "  @ScottManley:5 ", // leading handle + :claimId revision + padding
      "Tabbed\tName\nLines", // whitespace beyond ASCII spaces must collapse
      "Half as Interesting", // plain multi-word name
    ];
    const path = await createLegacyDatabaseFile("feedelity-db-name-key-");
    const seedDb = createLegacyDatabase(path, { withLastPublishedColumn: true });
    for (const [index, displayName] of displayNames.entries()) {
      insertCreator(
        seedDb,
        { withLastPublishedColumn: true },
        `name-key-${index}`,
        "youtube",
        `UC-name-key-${index}`,
        displayName,
        0,
      );
    }
    seedDb.close();

    const report = await runCatalogDataMigrations({ databaseUrl: path, apply: true });

    expect(report.appliedCount).toBe(4);
    const db = openCatalogDatabase(path, { readOnly: true });
    try {
      // The unique index is created after the backfill: it only exists if every
      // row received a key, and per-row parity rules out NULL keys.
      expect(indexNames(db).has("creator_name_key_uidx")).toBe(true);
      const rows: readonly unknown[] = db
        .query("SELECT display_name AS displayName, name_key AS nameKey FROM creator")
        .all();
      expect(rows).toHaveLength(displayNames.length);
      for (const row of rows) {
        if (typeof row !== "object" || row === null || !("displayName" in row) || !("nameKey" in row)) {
          throw new Error("creator name_key query returned an unexpected row");
        }
        if (typeof row.displayName !== "string" || typeof row.nameKey !== "string") {
          throw new Error("creator name_key query returned non-string displayName/name_key");
        }
        expect(row.nameKey).toBe(creatorNameKey(row.displayName));
      }
    } finally {
      db.close();
    }
  });

  test("recomputes a wrong non-NULL name_key left by the divergent SQL backfill", async () => {
    const path = await createLegacyDatabaseFile("feedelity-db-name-key-damaged-");
    const seedDb = createLegacyDatabase(path, { withLastPublishedColumn: true });
    insertCreator(seedDb, { withLastPublishedColumn: true }, DAMAGED_KEY_ID, "youtube", "UC-damaged", "Tech@Home", 0);
    // Damage applied post-hoc to model the old SQL backfill: it stripped the
    // interior "@", storing "techhome" instead of creatorNameKey("Tech@Home").
    seedDb.exec("ALTER TABLE creator ADD COLUMN name_key text");
    seedDb.query("UPDATE creator SET name_key = 'techhome' WHERE id = ?").run(DAMAGED_KEY_ID);
    seedDb.close();

    const report = await runCatalogDataMigrations({ databaseUrl: path, apply: true });

    expect(report.appliedCount).toBe(4);
    const mergeDetails = report.steps[0]?.details.join("\n") ?? "";
    expect(mergeDetails).toContain("recomputed name_key for 1 row(s)");

    const db = openCatalogDatabase(path, { readOnly: true });
    try {
      expect(creatorNameKey("Tech@Home")).toBe("tech@home");
      expect(queryString(db, "SELECT name_key AS v FROM creator WHERE id = ?", DAMAGED_KEY_ID)).toBe("tech@home");
    } finally {
      db.close();
    }
  });
});

describe("resolveDatabaseFilePath", () => {
  test("strips file: URLs and keeps plain paths", () => {
    expect(resolveDatabaseFilePath("file:../../local.db")).toBe("../../local.db");
    expect(resolveDatabaseFilePath("file:///tmp/uxfix.db")).toBe("/tmp/uxfix.db");
    expect(resolveDatabaseFilePath("/tmp/uxfix.db")).toBe("/tmp/uxfix.db");
    expect(resolveDatabaseFilePath(":memory:")).toBe(":memory:");
  });

  test("rejects remote database URLs", () => {
    expect(() => resolveDatabaseFilePath("libsql://my-db.turso.io")).toThrow("Unsupported remote database URL");
    expect(() => resolveDatabaseFilePath("https://example.com/db")).toThrow("Unsupported remote database URL");
  });
});

describe("runCatalogDataMigrations on a legacy-shaped database", () => {
  test("merges duplicated creators, converges the schema, and records the step", async () => {
    const path = await createLegacyDatabaseFile("feedelity-db-catalog-apply-");
    const seedDb = createLegacyDatabase(path, { withLastPublishedColumn: true });
    seedLegacyRows(seedDb, { withLastPublishedColumn: true });
    seedDb.close();

    const report = await runCatalogDataMigrations({ databaseUrl: path, apply: true });

    expect(report.apply).toBe(true);
    expect(report.appliedCount).toBe(4);
    expect(report.steps).toHaveLength(4);
    expect(report.steps[0]?.id).toBe("creator_cross_source_merge");
    expect(report.steps[0]?.applied).toBe(true);
    expect(report.steps[1]?.id).toBe("content_cross_source_key");
    expect(report.steps[1]?.applied).toBe(true);
    expect(report.steps[1]?.details.some((detail) => detail.startsWith("backfilled cross_source_key for 5"))).toBe(
      true,
    );
    expect(report.steps[2]?.id).toBe("content_item_list_order_idx");
    expect(report.steps[2]?.applied).toBe(true);
    expect(report.steps[2]?.details.join("\n")).toContain("created index content_item_published_created_id_idx");
    expect(report.steps[3]?.id).toBe("refresh_feed_result_retention");
    expect(report.steps[3]?.applied).toBe(true);
    expect(report.steps[3]?.details.join("\n")).toContain("refresh_feed_result table does not exist yet");

    const after = inspectDatabaseFile(path);
    // 4 creators -> 2 (the three Scott Manley rows collapse onto the youtube one).
    expect(after.counts.creators).toBe(2);
    expect(after.counts.feeds).toBe(4);
    expect(after.counts.contentItems).toBe(5);
    expect(after.mergeSummary.groups).toBe(0);
    expect(after.foreignKeyViolations).toBe(0);

    const db = openCatalogDatabase(path, { readOnly: true });
    try {
      // Feeds, refresh runs, subscriptions, items, and collection memberships
      // were re-pointed onto the canonical creator.
      expect(queryNumber(db, "SELECT count(*) AS n FROM feed WHERE creator_id = ?", SCOTT_CANONICAL_ID)).toBe(3);
      expect(queryNumber(db, "SELECT count(*) AS n FROM refresh_run WHERE requested_creator_id = ?", SCOTT_CANONICAL_ID)).toBe(1);
      expect(queryNumber(db, "SELECT count(*) AS n FROM subscription")).toBe(2);
      expect(queryNumber(db, "SELECT count(*) AS n FROM subscription WHERE creator_id = ?", SCOTT_CANONICAL_ID)).toBe(2);
      expect(queryNumber(db, "SELECT count(*) AS n FROM content_item WHERE creator_id = ?", SCOTT_CANONICAL_ID)).toBe(4);
      // Collection memberships survive the merge: col-1 re-pointed, col-2 deduped.
      expect(queryNumber(db, "SELECT count(*) AS n FROM collection_member")).toBe(3);
      expect(
        queryNumber(
          db,
          "SELECT count(*) AS n FROM collection_member WHERE collection_id = 'col-2' AND creator_id = ?",
          SCOTT_CANONICAL_ID,
        ),
      ).toBe(1);
      // The absorbed odysee item moved the canonical creator's latest publish forward.
      expect(queryOptionalNumber(db, "SELECT last_content_published_at AS v FROM creator WHERE id = ?", SCOTT_CANONICAL_ID)).toBe(400);
      expect(queryOptionalNumber(db, "SELECT last_content_published_at AS v FROM creator WHERE id = ?", SOLO_ID)).toBe(50);
      expect(queryNumber(db, "SELECT count(*) AS n FROM creator WHERE name_key = 'scottmanley'")).toBe(1);
      expect(queryNumber(db, "SELECT count(*) AS n FROM __feedelity_migrations WHERE id = 'creator_cross_source_merge'")).toBe(1);
      expect(queryNumber(db, "SELECT count(*) AS n FROM __feedelity_migrations WHERE id = 'content_cross_source_key'")).toBe(1);

      // Schema convergence: legacy columns/index gone, cross-source indexes present.
      const columns = creatorColumnNames(db);
      expect(columns).not.toContain("source_type");
      expect(columns).not.toContain("source_external_id");
      expect(columns).toContain("name_key");
      expect(columns).toContain("last_content_published_at");
      const contentColumns = loadColumnNames(db, "content_item");
      expect(contentColumns).toContain("cross_source_key");
      const indexes = indexNames(db);
      expect(indexes.has("creator_source_identity_uidx")).toBe(false);
      expect(indexes.has("creator_name_key_uidx")).toBe(true);
      expect(indexes.has("creator_display_name_idx")).toBe(true);
      expect(indexes.has("creator_last_content_published_at_idx")).toBe(true);
      expect(indexes.has("content_item_cross_source_key_idx")).toBe(true);
      expect(indexes.has("content_item_published_created_id_idx")).toBe(true);

      // Every item carries the mirror key derived from its creator's name_key
      // and its title, computed by the parity-tested mirrored function.
      expect(queryNumber(db, "SELECT count(*) AS n FROM content_item WHERE cross_source_key IS NULL")).toBe(0);
      const itemRows: readonly unknown[] = db
        .query(
          "SELECT i.id AS id, c.name_key AS nameKey, i.title AS title, i.cross_source_key AS crossSourceKey " +
            "FROM content_item i INNER JOIN creator c ON c.id = i.creator_id",
        )
        .all();
      expect(itemRows).toHaveLength(5);
      for (const row of itemRows) {
        if (typeof row !== "object" || row === null || !("id" in row) || !("nameKey" in row) || !("title" in row) || !("crossSourceKey" in row)) {
          throw new Error("content_item backfill query returned an unexpected row");
        }
        if (typeof row.nameKey !== "string" || typeof row.title !== "string") {
          throw new Error("content_item backfill query returned non-string name_key/title");
        }
        expect(row.crossSourceKey).toBe(contentCrossSourceKey(row.nameKey, row.title));
      }
    } finally {
      db.close();
    }
  });

  test("is a no-op when re-run against the already-migrated database", async () => {
    const path = await createLegacyDatabaseFile("feedelity-db-catalog-rerun-");
    const seedDb = createLegacyDatabase(path, { withLastPublishedColumn: true });
    seedLegacyRows(seedDb, { withLastPublishedColumn: true });
    seedDb.close();

    await runCatalogDataMigrations({ databaseUrl: path, apply: true });
    const secondRun = await runCatalogDataMigrations({ databaseUrl: path, apply: true });

    expect(secondRun.appliedCount).toBe(0);
    expect(secondRun.steps).toHaveLength(4);
    expect(secondRun.steps[0]?.applied).toBe(false);
    expect(secondRun.steps[0]?.details).toEqual(["skipped: migration id already recorded"]);
    expect(secondRun.steps[1]?.applied).toBe(false);
    expect(secondRun.steps[1]?.details).toEqual(["skipped: migration id already recorded"]);
    expect(secondRun.steps[2]?.applied).toBe(false);
    expect(secondRun.steps[2]?.details).toEqual(["skipped: migration id already recorded"]);
    expect(secondRun.steps[3]?.applied).toBe(false);
    expect(secondRun.steps[3]?.details).toEqual(["skipped: migration id already recorded"]);

    const after = inspectDatabaseFile(path);
    expect(after.counts.creators).toBe(2);
    expect(after.foreignKeyViolations).toBe(0);
  });

  test("reports what apply would do and writes nothing in dry-run mode", async () => {
    const path = await createLegacyDatabaseFile("feedelity-db-catalog-dryrun-");
    const seedDb = createLegacyDatabase(path, { withLastPublishedColumn: true });
    seedLegacyRows(seedDb, { withLastPublishedColumn: true });
    seedDb.close();

    const report = await runCatalogDataMigrations({ databaseUrl: path, apply: false });

    expect(report.apply).toBe(false);
    expect(report.appliedCount).toBe(0);
    expect(report.steps[0]?.applied).toBe(false);
    const details = report.steps[0]?.details.join("\n") ?? "";
    expect(details).toContain("would merge 1 duplicate group(s): 2 creator row(s) absorbed");
    expect(details).toContain("drop legacy column(s) source_type, source_external_id");
    expect(details).toContain("add name_key column");

    // The content_cross_source_key step reports the planned column, index, and
    // backfill work without writing.
    expect(report.steps).toHaveLength(4);
    expect(report.steps[1]?.id).toBe("content_cross_source_key");
    expect(report.steps[1]?.applied).toBe(false);
    const keyStepDetails = report.steps[1]?.details.join("\n") ?? "";
    expect(keyStepDetails).toContain("add content_item.cross_source_key column");
    expect(keyStepDetails).toContain("create index content_item_cross_source_key_idx");
    expect(keyStepDetails).toContain("backfill cross_source_key for 5 content_item row(s)");
    expect(keyStepDetails).toContain("no writes performed (dry run)");

    // The list-order index step reports the planned composite index without
    // writing.
    expect(report.steps[2]?.id).toBe("content_item_list_order_idx");
    expect(report.steps[2]?.applied).toBe(false);
    const listOrderStepDetails = report.steps[2]?.details.join("\n") ?? "";
    expect(listOrderStepDetails).toContain("create index content_item_published_created_id_idx");
    expect(listOrderStepDetails).toContain("no writes performed (dry run)");

    // The retention step reports that this legacy shape has no refresh table.
    expect(report.steps[3]?.id).toBe("refresh_feed_result_retention");
    expect(report.steps[3]?.applied).toBe(false);
    expect(report.steps[3]?.details.join("\n")).toContain("refresh_feed_result table does not exist yet");

    // Nothing was written: no migration record, no schema change, no merge.
    const db = openCatalogDatabase(path, { readOnly: true });
    try {
      expect(queryNumber(db, "SELECT count(*) AS n FROM creator")).toBe(4);
      expect(queryNumber(db, "SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = '__feedelity_migrations'")).toBe(0);
      expect(queryNumber(db, "SELECT count(*) AS n FROM sqlite_master WHERE type = 'index' AND name = 'content_item_published_created_id_idx'")).toBe(0);
      expect(creatorColumnNames(db)).toContain("source_type");
      expect(creatorColumnNames(db)).not.toContain("name_key");
    } finally {
      db.close();
    }

    const contentDb = openCatalogDatabase(path, { readOnly: true });
    try {
      expect(loadColumnNames(contentDb, "content_item")).not.toContain("cross_source_key");
      expect(queryNumber(contentDb, "SELECT count(*) AS n FROM content_item")).toBe(5);
    } finally {
      contentDb.close();
    }
  });

  test("also converges a legacy database that lacks the last_content_published_at column", async () => {
    const path = await createLegacyDatabaseFile("feedelity-db-catalog-0002-");
    const seedDb = createLegacyDatabase(path, { withLastPublishedColumn: false });
    seedLegacyRows(seedDb, { withLastPublishedColumn: false });
    seedDb.close();

    const report = await runCatalogDataMigrations({ databaseUrl: path, apply: true });
    expect(report.appliedCount).toBe(4);

    const after = inspectDatabaseFile(path);
    expect(after.counts.creators).toBe(2);
    expect(after.schema.hasLastContentPublishedAtColumn).toBe(true);
    expect(after.schema.missingIndexes).toEqual([]);

    const db = openCatalogDatabase(path, { readOnly: true });
    try {
      // Full backfill from 0002: canonical scottmanley absorbed the newest item.
      expect(queryOptionalNumber(db, "SELECT last_content_published_at AS v FROM creator WHERE id = ?", SCOTT_CANONICAL_ID)).toBe(400);
      expect(queryOptionalNumber(db, "SELECT last_content_published_at AS v FROM creator WHERE id = ?", SOLO_ID)).toBe(50);
    } finally {
      db.close();
    }
  });

  test("treats an already-converged database with zero merge groups as done", async () => {
    const path = await createLegacyDatabaseFile("feedelity-db-catalog-converged-");
    const seedDb = createLegacyDatabase(path, { withLastPublishedColumn: true });
    seedLegacyRows(seedDb, { withLastPublishedColumn: true });
    seedDb.close();
    await runCatalogDataMigrations({ databaseUrl: path, apply: true });

    // Simulate a database whose schema is already correct but whose migration
    // ids are missing (e.g. created via db:push): each step must detect
    // convergence by inspection, do nothing, and still get recorded.
    const db = openCatalogDatabase(path, { readOnly: false });
    try {
      db.exec("DELETE FROM __feedelity_migrations");
    } finally {
      db.close();
    }

    const report = await runCatalogDataMigrations({ databaseUrl: path, apply: true });
    expect(report.appliedCount).toBe(4);
    expect(report.steps[0]?.details[0]).toContain("already converged");
    expect(report.steps[1]?.details[0]).toContain(
      "already converged: content_item.cross_source_key exists, is indexed, and has no NULL rows",
    );
    expect(report.steps[2]?.details[0]).toContain(
      "already converged: index content_item_published_created_id_idx exists",
    );
    expect(report.steps[3]?.details[0]).toContain("refresh_feed_result table does not exist yet");

    const secondRun = await runCatalogDataMigrations({ databaseUrl: path, apply: true });
    expect(secondRun.appliedCount).toBe(0);
  });

  test("repairs a damaged name_key on an already-converged database instead of early-exiting", async () => {
    const path = await createLegacyDatabaseFile("feedelity-db-catalog-damaged-key-");
    const seedDb = createLegacyDatabase(path, { withLastPublishedColumn: true });
    seedLegacyRows(seedDb, { withLastPublishedColumn: true });
    seedDb.close();
    await runCatalogDataMigrations({ databaseUrl: path, apply: true });

    // Damage one stored key post-migration (the old divergent SQL backfill
    // pattern), then clear the migration records to model a db:push-created
    // database: converged schema, zero merge groups, but a stale key that
    // would hide the canonical row from ingestion's TS-computed lookup.
    const db = openCatalogDatabase(path, { readOnly: false });
    try {
      db.query("UPDATE creator SET name_key = 'damagedkey' WHERE id = ?").run(SOLO_ID);
      db.exec("DELETE FROM __feedelity_migrations");
    } finally {
      db.close();
    }

    const report = await runCatalogDataMigrations({ databaseUrl: path, apply: true });

    expect(report.appliedCount).toBe(4);
    const mergeDetails = report.steps[0]?.details.join("\n") ?? "";
    expect(mergeDetails).not.toContain("already converged");
    expect(mergeDetails).toContain("recomputed name_key for 1 row(s)");

    const verify = openCatalogDatabase(path, { readOnly: true });
    try {
      expect(queryString(verify, "SELECT name_key AS v FROM creator WHERE id = ?", SOLO_ID)).toBe(
        creatorNameKey("Unique Channel"),
      );
    } finally {
      verify.close();
    }
  });
});

describe("content_item_list_order_idx step", () => {
  test("creates the composite list-order index and is a no-op when re-applied", async () => {
    const path = await createLegacyDatabaseFile("feedelity-db-list-order-idx-");
    const seedDb = createLegacyDatabase(path, { withLastPublishedColumn: true });
    seedLegacyRows(seedDb, { withLastPublishedColumn: true });
    seedDb.close();

    const report = await runCatalogDataMigrations({ databaseUrl: path, apply: true });

    const indexStep = report.steps.at(2);
    expect(indexStep?.id).toBe("content_item_list_order_idx");
    expect(indexStep?.applied).toBe(true);
    expect(indexStep?.details.join("\n")).toContain("created index content_item_published_created_id_idx");

    const db = openCatalogDatabase(path, { readOnly: true });
    try {
      expect(indexNames(db).has("content_item_published_created_id_idx")).toBe(true);
    } finally {
      db.close();
    }

    const secondRun = await runCatalogDataMigrations({ databaseUrl: path, apply: true });
    expect(secondRun.appliedCount).toBe(0);
    expect(secondRun.steps.at(2)?.id).toBe("content_item_list_order_idx");
    expect(secondRun.steps.at(2)?.applied).toBe(false);
    expect(secondRun.steps.at(2)?.details).toEqual(["skipped: migration id already recorded"]);
  });

  test("the newest-first list query plan uses the composite index with no TEMP B-TREE and no full scan", async () => {
    const path = await createLegacyDatabaseFile("feedelity-db-list-order-plan-");
    const seedDb = createLegacyDatabase(path, { withLastPublishedColumn: true });
    seedLegacyRows(seedDb, { withLastPublishedColumn: true });
    // Enough rows that LIMIT 50 is a strict subset, mirroring a real page of
    // the catalog list query.
    for (let index = 0; index < 120; index += 1) {
      insertContentItem(seedDb, `plan-item-${index}`, SCOTT_CANONICAL_ID, `plan-item-${index}`, index);
    }
    seedDb.close();
    await runCatalogDataMigrations({ databaseUrl: path, apply: true });

    const db = openCatalogDatabase(path, { readOnly: true });
    try {
      const planRows: readonly unknown[] = db
        .query(
          "EXPLAIN QUERY PLAN SELECT id, title, published_at FROM content_item " +
            "ORDER BY published_at DESC, created_at DESC, id DESC LIMIT 50",
        )
        .all();
      const planLines = planRows.map((row) => {
        if (typeof row !== "object" || row === null || !("detail" in row) || typeof row.detail !== "string") {
          throw new Error("EXPLAIN QUERY PLAN returned an unexpected row");
        }
        return row.detail;
      });
      const planText = planLines.join("\n");
      // The index satisfies the whole ORDER BY, so no sort step may appear and
      // every content_item access must go through the composite index.
      expect(planText).toContain("USING INDEX content_item_published_created_id_idx");
      expect(planText).not.toContain("TEMP B-TREE");
      expect(planLines.some((line) => line.includes("SCAN content_item") && !line.includes("USING INDEX"))).toBe(
        false,
      );
    } finally {
      db.close();
    }
  });
});

describe("refresh_feed_result_retention step", () => {
  test("deletes only refresh_feed_result rows older than 30 days and reports the count", async () => {
    const nowMs = Date.now();
    const path = await createLegacyDatabaseFile("feedelity-db-retention-");
    const seedDb = createModernSchemaDatabase(path);
    seedRetentionRows(seedDb, nowMs);
    seedDb.close();

    // Dry run: reports the planned delete without writing.
    const dryRun = await runCatalogDataMigrations({ databaseUrl: path, apply: false });
    const dryStep = dryRun.steps.at(3);
    expect(dryStep?.id).toBe("refresh_feed_result_retention");
    expect(dryStep?.applied).toBe(false);
    expect(dryStep?.details.join("\n")).toContain("would delete 1 refresh_feed_result row(s) older than 30 days");
    expect(dryStep?.details.join("\n")).toContain("no writes performed (dry run)");

    const apply = await runCatalogDataMigrations({ databaseUrl: path, apply: true });
    const appliedStep = apply.steps.at(3);
    expect(appliedStep?.id).toBe("refresh_feed_result_retention");
    expect(appliedStep?.applied).toBe(true);
    expect(appliedStep?.details).toEqual(["deleted 1 refresh_feed_result row(s) older than 30 days"]);

    const db = openCatalogDatabase(path, { readOnly: true });
    try {
      // The over-age row is gone; the 29-day-old boundary row and the
      // day-old row survive the strict `<` cutoff.
      expect(queryNumber(db, "SELECT count(*) AS n FROM refresh_feed_result WHERE id = 'rfr-old'")).toBe(0);
      expect(
        queryNumber(db, "SELECT count(*) AS n FROM refresh_feed_result WHERE id IN ('rfr-boundary', 'rfr-recent')"),
      ).toBe(2);
      expect(
        queryNumber(
          db,
          "SELECT count(*) AS n FROM refresh_feed_result WHERE started_at < (cast(unixepoch() - ? as integer) * 1000)",
          30 * 86400,
        ),
      ).toBe(0);
    } finally {
      db.close();
    }

    // Re-run is a no-op by migration id.
    const secondRun = await runCatalogDataMigrations({ databaseUrl: path, apply: true });
    expect(secondRun.steps.at(3)?.applied).toBe(false);
    expect(secondRun.steps.at(3)?.details).toEqual(["skipped: migration id already recorded"]);

    // And idempotent by predicate: clearing the record re-runs the step, which
    // deletes nothing new.
    const wipe = openCatalogDatabase(path, { readOnly: false });
    try {
      wipe.query("DELETE FROM __feedelity_migrations WHERE id = 'refresh_feed_result_retention'").run();
    } finally {
      wipe.close();
    }
    const thirdRun = await runCatalogDataMigrations({ databaseUrl: path, apply: true });
    expect(thirdRun.steps.at(3)?.applied).toBe(true);
    expect(thirdRun.steps.at(3)?.details).toEqual(["deleted 0 refresh_feed_result row(s) older than 30 days"]);
  });

  test("keeps the newest row of a feed whose every attempt is over-age", async () => {
    const nowMs = Date.now();
    const path = await createLegacyDatabaseFile("feedelity-db-retention-dead-");
    const seedDb = createModernSchemaDatabase(path);
    seedDeadFeedRows(seedDb, nowMs);
    seedDb.close();

    // Dry run: both rows are over-age, but the newest-row guard leaves one
    // deletable row.
    const dryRun = await runCatalogDataMigrations({ databaseUrl: path, apply: false });
    const dryStep = dryRun.steps.at(3);
    expect(dryStep?.id).toBe("refresh_feed_result_retention");
    expect(dryStep?.applied).toBe(false);
    expect(dryStep?.details.join("\n")).toContain("would delete 1 refresh_feed_result row(s) older than 30 days");

    const apply = await runCatalogDataMigrations({ databaseUrl: path, apply: true });
    expect(apply.steps.at(3)?.applied).toBe(true);
    expect(apply.steps.at(3)?.details).toEqual(["deleted 1 refresh_feed_result row(s) older than 30 days"]);

    const db = openCatalogDatabase(path, { readOnly: true });
    try {
      // The older attempt is pruned; the newest (also over-age) row survives so
      // the feed-health dashboard keeps surfacing the feed's stale-failure
      // state instead of degrading to "never attempted".
      expect(queryNumber(db, "SELECT count(*) AS n FROM refresh_feed_result WHERE id = 'rfr-dead-old'")).toBe(0);
      expect(queryNumber(db, "SELECT count(*) AS n FROM refresh_feed_result WHERE id = 'rfr-dead-newest'")).toBe(1);
    } finally {
      db.close();
    }

    // Predicate-level idempotency with the newest-row exception: clearing the
    // migration id re-runs the step, which still deletes 0 — the surviving
    // newest row matches the over-age predicate alone but is excluded by the
    // newest-row guard.
    const wipe = openCatalogDatabase(path, { readOnly: false });
    try {
      wipe.query("DELETE FROM __feedelity_migrations WHERE id = 'refresh_feed_result_retention'").run();
    } finally {
      wipe.close();
    }
    const thirdRun = await runCatalogDataMigrations({ databaseUrl: path, apply: true });
    expect(thirdRun.steps.at(3)?.applied).toBe(true);
    expect(thirdRun.steps.at(3)?.details).toEqual(["deleted 0 refresh_feed_result row(s) older than 30 days"]);
  });
});

/**
 * Current-schema fixture for the retention step: converged creator table plus
 * the refresh tables, so the first three steps converge immediately and the
 * runner reaches refresh_feed_result_retention against a populated table.
 */
function createModernSchemaDatabase(path: string): Database {
  const db = new Database(path);
  db.exec(`
    CREATE TABLE creator (
      id text PRIMARY KEY NOT NULL,
      name_key text NOT NULL,
      display_name text NOT NULL,
      last_content_published_at integer,
      created_at integer NOT NULL,
      updated_at integer NOT NULL
    );
    CREATE UNIQUE INDEX creator_name_key_uidx ON creator (name_key);
    CREATE INDEX creator_display_name_idx ON creator (display_name);
    CREATE INDEX creator_last_content_published_at_idx ON creator (last_content_published_at);
    CREATE TABLE feed (
      id text PRIMARY KEY NOT NULL,
      creator_id text NOT NULL REFERENCES creator(id) ON DELETE CASCADE,
      source_type text NOT NULL,
      source_external_id text NOT NULL,
      url text NOT NULL
    );
    CREATE UNIQUE INDEX feed_source_identity_uidx ON feed (source_type, source_external_id);
    CREATE TABLE content_item (
      id text PRIMARY KEY NOT NULL,
      creator_id text NOT NULL REFERENCES creator(id) ON DELETE CASCADE,
      source_type text NOT NULL,
      source_external_id text NOT NULL,
      title text NOT NULL,
      published_at integer,
      cross_source_key text,
      created_at integer NOT NULL DEFAULT 0
    );
    CREATE INDEX content_item_cross_source_key_idx ON content_item (cross_source_key);
    CREATE TABLE subscription (
      user_id text NOT NULL,
      creator_id text NOT NULL REFERENCES creator(id) ON DELETE CASCADE,
      created_at integer NOT NULL,
      PRIMARY KEY (user_id, creator_id)
    );
    CREATE TABLE refresh_run (
      id text PRIMARY KEY NOT NULL,
      requested_creator_id text REFERENCES creator(id) ON DELETE SET NULL
    );
    CREATE TABLE refresh_feed_result (
      id text PRIMARY KEY NOT NULL,
      refresh_run_id text NOT NULL REFERENCES refresh_run(id) ON DELETE CASCADE,
      feed_id text NOT NULL REFERENCES feed(id) ON DELETE CASCADE,
      status text NOT NULL,
      items_created_count integer NOT NULL DEFAULT 0,
      started_at integer NOT NULL,
      completed_at integer
    );
    CREATE UNIQUE INDEX refresh_feed_result_run_feed_uidx ON refresh_feed_result (refresh_run_id, feed_id);
    CREATE INDEX refresh_feed_result_feed_id_idx ON refresh_feed_result (feed_id);
  `);
  return db;
}

/** One creator/feed plus three feed results: 40d old, 29d old, and 1d old. */
function seedRetentionRows(db: Database, nowMs: number): void {
  db.query("INSERT INTO creator (id, name_key, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(
    "creator-retention",
    creatorNameKey("Retention Creator"),
    "Retention Creator",
    1,
    1,
  );
  db.query("INSERT INTO feed (id, creator_id, source_type, source_external_id, url) VALUES (?, ?, ?, ?, ?)").run(
    "feed-retention",
    "creator-retention",
    "youtube",
    "UC-retention",
    "https://retention.example.test/feed",
  );
  insertRetentionResult(db, "rfr-old", "rr-old", "feed-retention", "failed", nowMs - 40 * 86400 * 1000, 0);
  insertRetentionResult(db, "rfr-boundary", "rr-boundary", "feed-retention", "succeeded", nowMs - 29 * 86400 * 1000, 2);
  insertRetentionResult(db, "rfr-recent", "rr-recent", "feed-retention", "succeeded", nowMs - 1 * 86400 * 1000, 3);
}

/**
 * A long-dead feed whose BOTH attempts are over-age (45d and 40d): the prune
 * must delete only the older row and keep the newest regardless of age.
 */
function seedDeadFeedRows(db: Database, nowMs: number): void {
  db.query("INSERT INTO creator (id, name_key, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run(
    "creator-retention",
    creatorNameKey("Retention Creator"),
    "Retention Creator",
    1,
    1,
  );
  db.query("INSERT INTO feed (id, creator_id, source_type, source_external_id, url) VALUES (?, ?, ?, ?, ?)").run(
    "feed-dead",
    "creator-retention",
    "odysee",
    "UC-dead",
    "https://retention.example.test/dead",
  );
  insertRetentionResult(db, "rfr-dead-old", "rr-dead-old", "feed-dead", "failed", nowMs - 45 * 86400 * 1000, 0);
  insertRetentionResult(db, "rfr-dead-newest", "rr-dead-newest", "feed-dead", "failed", nowMs - 40 * 86400 * 1000, 0);
}

function insertRetentionResult(
  db: Database,
  id: string,
  runId: string,
  feedId: string,
  status: string,
  startedAtMs: number,
  itemsCreatedCount: number,
): void {
  db.query("INSERT INTO refresh_run (id, requested_creator_id) VALUES (?, NULL)").run(runId);
  db.query(
    "INSERT INTO refresh_feed_result (id, refresh_run_id, feed_id, status, items_created_count, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(id, runId, feedId, status, itemsCreatedCount, startedAtMs, startedAtMs + 5_000);
}
