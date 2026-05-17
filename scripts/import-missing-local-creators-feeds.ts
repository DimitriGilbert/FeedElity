import { Database } from "bun:sqlite";

type SourceType = "youtube" | "odysee" | "peertube";

type SqlValue = string | number | bigint | Uint8Array | null;

type Row = Record<string, SqlValue>;

interface ExecuteStatement {
  readonly sql: string;
  readonly args?: readonly SqlValue[];
}

interface ExecuteResult {
  readonly rows: readonly Row[];
  readonly rowsAffected?: number | bigint;
}

interface Client {
  execute(statement: string | ExecuteStatement): ExecuteResult;
  close(): void;
}

interface LegacyFeedRow {
  readonly creatorOldId: number;
  readonly creatorName: string;
  readonly creatorDescription: string | null;
  readonly feedOldId: number;
  readonly feedName: string | null;
  readonly url: string;
  readonly sourceType: SourceType;
  readonly sourceExternalId: string;
}

interface LocalCreatorRow {
  readonly id: string;
  readonly sourceType: SourceType;
  readonly sourceExternalId: string;
  readonly displayName: string;
}

interface LocalFeedRow {
  readonly id: string;
  readonly creatorId: string;
  readonly sourceType: SourceType;
  readonly sourceExternalId: string;
}

interface Counts {
  readonly legacyCreators: number;
  readonly legacyFeeds: number;
  createdCreators: number;
  reusedCreators: number;
  insertedFeeds: number;
  reusedFeeds: number;
  movedFeeds: number;
  skippedCreatorGroups: number;
  skippedFeeds: number;
  insertedSubscriptions: number;
  reusedSubscriptions: number;
}

const databaseUrl = process.env.DATABASE_URL ?? "file:./local.db";
const applyChanges = process.argv.includes("--apply");
const legacyContainer = process.env.FEELITY_LEGACY_MYSQL_CONTAINER ?? "feedelityDB";
const legacyMysqlUri = process.env.FEELITY_LEGACY_MYSQL_URI ?? "strapi:feedelity@localhost:3306/Feedelity";

const db = createSqliteClient(databaseUrl);

try {
  const legacyFeeds = readLegacyFeeds();
  const legacyCreatorIds = new Set(legacyFeeds.map((feed) => feed.creatorOldId));
  const counts: Counts = {
    legacyCreators: legacyCreatorIds.size,
    legacyFeeds: legacyFeeds.length,
    createdCreators: 0,
    reusedCreators: 0,
    insertedFeeds: 0,
    reusedFeeds: 0,
    movedFeeds: 0,
    skippedCreatorGroups: 0,
    skippedFeeds: 0,
    insertedSubscriptions: 0,
    reusedSubscriptions: 0,
  };

  db.execute("PRAGMA foreign_keys = ON");
  db.execute("BEGIN IMMEDIATE");
  try {
    const users = listUserIds(db);
    if (users.length === 0) {
      throw new Error("No local users exist to subscribe recovered creators to.");
    }

    const feedsByCreatorId = groupBy(legacyFeeds, (feed) => String(feed.creatorOldId));
    for (const creatorFeeds of feedsByCreatorId.values()) {
      const firstFeed = creatorFeeds[0];
      if (firstFeed === undefined) {
        continue;
      }

      const creator = findOrCreateCreatorForLegacyFeeds(db, firstFeed, creatorFeeds, counts);
      if (creator === null) {
        continue;
      }
      for (const legacyFeed of creatorFeeds) {
        findOrCreateFeedForLegacyFeed(db, creator.id, legacyFeed, counts);
      }

      for (const userId of users) {
        findOrCreateSubscription(db, userId, creator.id, counts);
      }
    }

    assertRecovered(db, counts.legacyCreators - counts.skippedCreatorGroups, counts.legacyFeeds - counts.skippedFeeds, users);

    if (applyChanges) {
      db.execute("COMMIT");
    } else {
      db.execute("ROLLBACK");
    }
  } catch (error: unknown) {
    db.execute("ROLLBACK");
    throw error;
  }

  console.log(JSON.stringify({ mode: applyChanges ? "applied" : "dry-run", databaseUrl, userCount: listUserIds(db).length, counts }, null, 2));
} finally {
  db.close();
}

function findOrCreateCreatorForLegacyFeeds(
  client: Client,
  legacyCreator: LegacyFeedRow,
  legacyFeeds: readonly LegacyFeedRow[],
  counts: Counts,
): LocalCreatorRow | null {
  const sourceIdentityMatches = collectCreatorsBySourceIdentities(client, legacyFeeds);
  if (sourceIdentityMatches.length > 1) {
    counts.skippedCreatorGroups += 1;
    counts.skippedFeeds += legacyFeeds.length;
    return null;
  }

  const existingByFeedIdentity = sourceIdentityMatches[0];
  if (existingByFeedIdentity !== undefined) {
    counts.reusedCreators += 1;
    return existingByFeedIdentity;
  }

  const existingByName = findCreatorByName(client, legacyCreator.creatorName);
  if (existingByName !== null && !hasConflictingSourceIdentity(existingByName, legacyFeeds)) {
    counts.reusedCreators += 1;
    return existingByName;
  }

  const primaryFeed = choosePrimaryFeed(legacyFeeds);
  const creatorId = crypto.randomUUID();
  client.execute({
    sql: `insert into creator (
      id, source_type, source_external_id, display_name, description, image_url, canonical_url, metadata_json
    ) values (?, ?, ?, ?, ?, null, ?, ?)`,
    args: [
      creatorId,
      primaryFeed.sourceType,
      primaryFeed.sourceExternalId,
      legacyCreator.creatorName,
      legacyCreator.creatorDescription,
      canonicalCreatorUrl(primaryFeed),
      JSON.stringify({ repairedFromLegacyCreatorId: legacyCreator.creatorOldId }),
    ],
  });
  counts.createdCreators += 1;

  return {
    id: creatorId,
    sourceType: primaryFeed.sourceType,
    sourceExternalId: primaryFeed.sourceExternalId,
    displayName: legacyCreator.creatorName,
  };
}

function findOrCreateFeedForLegacyFeed(client: Client, creatorId: string, legacyFeed: LegacyFeedRow, counts: Counts): LocalFeedRow {
  const existing = findFeedBySourceIdentity(client, legacyFeed.sourceType, legacyFeed.sourceExternalId);
  if (existing !== null) {
    counts.reusedFeeds += 1;
    if (existing.creatorId !== creatorId) {
      counts.skippedFeeds += 1;
    }
    return existing;
  }

  const feedId = crypto.randomUUID();
  client.execute({
    sql: `insert into feed (
      id, creator_id, source_type, source_external_id, url, title, description,
      refresh_cadence_seconds, adapter_metadata_json
    ) values (?, ?, ?, ?, ?, ?, null, null, ?)`,
    args: [
      feedId,
      creatorId,
      legacyFeed.sourceType,
      legacyFeed.sourceExternalId,
      canonicalFeedUrl(legacyFeed),
      legacyFeed.feedName,
      JSON.stringify({ repairedFromLegacyFeedId: legacyFeed.feedOldId }),
    ],
  });
  counts.insertedFeeds += 1;

  return {
    id: feedId,
    creatorId,
    sourceType: legacyFeed.sourceType,
    sourceExternalId: legacyFeed.sourceExternalId,
  };
}

function findOrCreateSubscription(client: Client, userId: string, creatorId: string, counts: Counts): void {
  const existing = client.execute({
    sql: "select id from subscription where user_id = ? and creator_id = ? limit 1",
    args: [userId, creatorId],
  });
  if (existing.rows.length > 0) {
    counts.reusedSubscriptions += 1;
    return;
  }

  client.execute({
    sql: "insert into subscription (id, user_id, creator_id) values (?, ?, ?)",
    args: [crypto.randomUUID(), userId, creatorId],
  });
  counts.insertedSubscriptions += 1;
}

function assertRecovered(client: Client, expectedCreators: number, expectedFeeds: number, userIds: readonly string[]): void {
  const creatorCount = number(client.execute("select count(*) as count from creator").rows[0], "count");
  if (creatorCount < expectedCreators) {
    throw new Error(`Expected at least ${expectedCreators} creators, found ${creatorCount}.`);
  }

  const feedCount = number(client.execute("select count(*) as count from feed").rows[0], "count");
  if (feedCount < expectedFeeds) {
    throw new Error(`Expected at least ${expectedFeeds} feeds, found ${feedCount}.`);
  }

  for (const userId of userIds) {
    const subscriptionCount = number(client.execute({
      sql: "select count(*) as count from subscription where user_id = ?",
      args: [userId],
    }).rows[0], "count");
    if (subscriptionCount < expectedCreators) {
      throw new Error(`Expected user ${userId} to have at least ${expectedCreators} subscriptions, found ${subscriptionCount}.`);
    }
  }

  const malformedYouTube = number(client.execute(`select count(*) as count from feed
    where source_type = 'youtube'
      and instr(url, 'channel_id=') > 0
      and source_external_id != substr(url, instr(url, 'channel_id=') + 11)`).rows[0], "count");
  if (malformedYouTube > 0) {
    throw new Error(`${malformedYouTube} malformed YouTube feed identities remain.`);
  }
}

function readLegacyFeeds(): readonly LegacyFeedRow[] {
  const result = Bun.spawnSync([
    "docker",
    "exec",
    legacyContainer,
    "mysqlsh",
    "--sql",
    "--result-format=json/array",
    "--uri",
    legacyMysqlUri,
    "-e",
    `SELECT c.id AS creatorOldId, c.name AS creatorName, c.description AS creatorDescription,
      f.id AS feedOldId, f.name AS feedName, f.url, f.type AS sourceType, COALESCE(f.external_id, '') AS sourceExternalId
      FROM creators c
      JOIN feeds_creator_links fcl ON fcl.creator_id = c.id
      JOIN feeds f ON f.id = fcl.feed_id
      WHERE f.type IN ('youtube', 'odysee', 'peertube')
      ORDER BY c.id, f.id`,
  ], { stdout: "pipe", stderr: "pipe" });

  if (!result.success) {
    throw new Error(`Legacy feed lookup failed: ${result.stderr.toString()}`);
  }

  const feeds: LegacyFeedRow[] = [];
  for (const row of parseJsonRows(result.stdout.toString())) {
    const sourceType = sourceTypeFromUnknown(field(row, "sourceType"));
    const url = stringFromUnknown(field(row, "url"));
    const sourceExternalId = canonicalExternalIdFromUrl(sourceType, url) ?? stringFromUnknown(field(row, "sourceExternalId"));
    if (sourceExternalId.length === 0) {
      throw new Error(`Could not derive source identity for legacy feed ${String(field(row, "feedOldId"))}.`);
    }
    feeds.push({
      creatorOldId: numberFromUnknown(field(row, "creatorOldId")),
      creatorName: stringFromUnknown(field(row, "creatorName")),
      creatorDescription: nullableStringFromUnknown(field(row, "creatorDescription")),
      feedOldId: numberFromUnknown(field(row, "feedOldId")),
      feedName: nullableStringFromUnknown(field(row, "feedName")),
      url,
      sourceType,
      sourceExternalId,
    });
  }
  return feeds;
}

function listUserIds(client: Client): readonly string[] {
  return client.execute("select id from user order by created_at").rows.map((row) => text(row, "id"));
}

function findCreatorByName(client: Client, displayName: string): LocalCreatorRow | null {
  const result = client.execute({
    sql: "select id, source_type, source_external_id, display_name from creator where lower(trim(display_name)) = ? limit 1",
    args: [normalizeName(displayName)],
  });
  const row = result.rows[0];
  return row === undefined ? null : toCreator(row);
}

function findCreatorBySourceIdentity(client: Client, sourceType: SourceType, sourceExternalId: string): LocalCreatorRow | null {
  const result = client.execute({
    sql: "select id, source_type, source_external_id, display_name from creator where source_type = ? and source_external_id = ? limit 1",
    args: [sourceType, sourceExternalId],
  });
  const row = result.rows[0];
  return row === undefined ? null : toCreator(row);
}

function findFeedBySourceIdentity(client: Client, sourceType: SourceType, sourceExternalId: string): LocalFeedRow | null {
  const result = client.execute({
    sql: "select id, creator_id, source_type, source_external_id from feed where source_type = ? and source_external_id = ? limit 1",
    args: [sourceType, sourceExternalId],
  });
  const row = result.rows[0];
  return row === undefined ? null : toFeed(row);
}

function collectCreatorsBySourceIdentities(client: Client, legacyFeeds: readonly LegacyFeedRow[]): readonly LocalCreatorRow[] {
  const creatorsById = new Map<string, LocalCreatorRow>();
  for (const legacyFeed of legacyFeeds) {
    const result = client.execute({
      sql: `select distinct c.id, c.source_type, c.source_external_id, c.display_name
        from creator c
        left join feed f on f.creator_id = c.id
        where (c.source_type = ? and c.source_external_id = ?)
          or (f.source_type = ? and f.source_external_id = ?)`,
      args: [legacyFeed.sourceType, legacyFeed.sourceExternalId, legacyFeed.sourceType, legacyFeed.sourceExternalId],
    });
    for (const row of result.rows) {
      const creator = toCreator(row);
      creatorsById.set(creator.id, creator);
    }
  }
  return [...creatorsById.values()];
}

function choosePrimaryFeed(feeds: readonly LegacyFeedRow[]): LegacyFeedRow {
  const odysee = feeds.find((feed) => feed.sourceType === "odysee");
  if (odysee !== undefined) {
    return odysee;
  }
  const youtube = feeds.find((feed) => feed.sourceType === "youtube");
  if (youtube !== undefined) {
    return youtube;
  }
  const first = feeds[0];
  if (first === undefined) {
    throw new Error("Cannot choose a primary feed for an empty feed list.");
  }
  return first;
}

function canonicalFeedUrl(feed: LegacyFeedRow): string {
  if (feed.sourceType === "youtube") {
    return `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(feed.sourceExternalId)}`;
  }
  if (feed.sourceType === "odysee") {
    return `https://odysee.com/$/rss/${encodeURIComponent(feed.sourceExternalId)}`;
  }
  return feed.url;
}

function canonicalCreatorUrl(feed: LegacyFeedRow): string | null {
  if (feed.sourceType === "youtube") {
    return `https://www.youtube.com/channel/${encodeURIComponent(feed.sourceExternalId)}`;
  }
  if (feed.sourceType === "odysee") {
    return `https://odysee.com/${encodeURIComponent(feed.sourceExternalId)}`;
  }
  return null;
}

function canonicalExternalIdFromUrl(sourceType: SourceType, urlText: string): string | null {
  try {
    const url = new URL(urlText);
    if (sourceType === "youtube") {
      const channelId = url.searchParams.get("channel_id");
      if (channelId === null || channelId.trim().length === 0) {
        return null;
      }
      return channelId.startsWith("UC") || channelId.length !== 22 ? channelId : `UC${channelId}`;
    }
    if (sourceType === "odysee" && url.pathname.startsWith("/$/rss/")) {
      const claim = decodeURIComponent(url.pathname.slice("/$/rss/".length).split("/")[0] ?? "");
      return claim.trim().length > 0 ? claim : null;
    }
    return null;
  } catch {
    return null;
  }
}

function parseJsonRows(output: string): readonly object[] {
  const cleanOutput = stripAnsiEscapes(output);
  const start = cleanOutput.indexOf("[");
  const end = cleanOutput.lastIndexOf("]");
  if (start < 0 || end < start) {
    throw new Error("Legacy lookup did not return a JSON array.");
  }
  const parsed: unknown = JSON.parse(cleanOutput.slice(start, end + 1));
  if (!Array.isArray(parsed)) {
    throw new Error("Legacy lookup JSON was not an array.");
  }
  return parsed.map((row): object => {
    if (typeof row !== "object" || row === null || Array.isArray(row)) {
      throw new Error("Legacy lookup contained a non-object row.");
    }
    return row;
  });
}

function stripAnsiEscapes(output: string): string {
  return output.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

function hasConflictingSourceIdentity(candidate: LocalCreatorRow, legacyFeeds: readonly LegacyFeedRow[]): boolean {
  return legacyFeeds.some(
    (feed) => feed.sourceType === candidate.sourceType && feed.sourceExternalId !== candidate.sourceExternalId,
  );
}

function field(row: object, key: string): unknown {
  return Reflect.get(row, key);
}

function toCreator(row: Row): LocalCreatorRow {
  return {
    id: text(row, "id"),
    sourceType: sourceTypeFromUnknown(row.source_type),
    sourceExternalId: text(row, "source_external_id"),
    displayName: text(row, "display_name"),
  };
}

function toFeed(row: Row): LocalFeedRow {
  return {
    id: text(row, "id"),
    creatorId: text(row, "creator_id"),
    sourceType: sourceTypeFromUnknown(row.source_type),
    sourceExternalId: text(row, "source_external_id"),
  };
}

function groupBy<T>(items: readonly T[], keyForItem: (item: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const key = keyForItem(item);
    const group = grouped.get(key);
    if (group === undefined) {
      grouped.set(key, [item]);
    } else {
      group.push(item);
    }
  }
  return grouped;
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function text(row: Row, key: string): string {
  const value = row[key];
  if (typeof value === "string") {
    return value;
  }
  throw new Error(`Expected ${key} to be text.`);
}

function number(row: Row | undefined, key: string): number {
  if (row === undefined) {
    throw new Error(`Expected row for ${key}.`);
  }
  const value = row[key];
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  throw new Error(`Expected ${key} to be numeric.`);
}

function numberFromUnknown(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }
  throw new Error("Expected numeric value.");
}

function sqliteRowsFromUnknown(value: unknown): readonly Row[] {
  if (!Array.isArray(value)) {
    throw new Error("SQLite query did not return a row array.");
  }
  return value.map(sqliteRowFromUnknown);
}

function sqliteRowFromUnknown(value: unknown): Row {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("SQLite query returned a non-object row.");
  }
  const row: Row = {};
  for (const key of Object.keys(value)) {
    row[key] = sqliteValueFromUnknown(Reflect.get(value, key));
  }
  return row;
}

function sqliteValueFromUnknown(value: unknown): SqlValue {
  if (typeof value === "string" || typeof value === "number" || typeof value === "bigint" || value === null || value instanceof Uint8Array) {
    return value;
  }
  throw new Error(`SQLite query returned unsupported value: ${String(value)}`);
}

function sourceTypeFromUnknown(value: unknown): SourceType {
  if (value === "youtube" || value === "odysee" || value === "peertube") {
    return value;
  }
  throw new Error(`Unsupported source type: ${String(value)}`);
}

function stringFromUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  throw new Error("Expected string value.");
}

function nullableStringFromUnknown(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  throw new Error("Expected nullable string value.");
}

function createSqliteClient(url: string): Client {
  const filename = url.startsWith("file:") ? url.slice("file:".length) : url;
  const database = new Database(filename);
  return {
    execute(statement) {
      const sql = typeof statement === "string" ? statement : statement.sql;
      const args = typeof statement === "string" ? [] : [...(statement.args ?? [])];
      const trimmedSql = sql.trim().toLowerCase();
      if (trimmedSql.startsWith("select") || trimmedSql.startsWith("with")) {
        return { rows: sqliteRowsFromUnknown(database.query(sql).all(...args)) };
      }
      const result = database.query(sql).run(...args);
      return { rows: [], rowsAffected: result.changes };
    },
    close() {
      database.close();
    },
  };
}
