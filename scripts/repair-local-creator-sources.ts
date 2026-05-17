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
  execute(statement: string | ExecuteStatement): Promise<ExecuteResult>;
  close(): void;
}

interface CreatorRow {
  readonly id: string;
  readonly sourceType: SourceType;
  readonly sourceExternalId: string;
  readonly displayName: string;
  readonly description: string | null;
  readonly imageUrl: string | null;
  readonly canonicalUrl: string | null;
  readonly metadataJson: string | null;
  readonly createdAt: number;
  readonly contentCount: number;
  readonly subscriptionCount: number;
}

interface FeedRow {
  readonly id: string;
  readonly creatorId: string;
  readonly sourceType: SourceType;
  readonly sourceExternalId: string;
  readonly url: string;
  readonly title: string | null;
  readonly description: string | null;
  readonly refreshCadenceSeconds: number | null;
  readonly lastNormalRefreshAt: number | null;
  readonly nextRefreshAfter: number | null;
  readonly adapterMetadataJson: string | null;
  readonly createdAt: number;
  readonly feedContentCount: number;
}

interface SubscriptionRow {
  readonly id: string;
  readonly userId: string;
  readonly creatorId: string;
}

interface LegacyFeedRow {
  readonly creatorName: string;
  readonly feedName: string | null;
  readonly url: string;
  readonly sourceType: SourceType;
  readonly sourceExternalId: string;
}

interface RepairCounts {
  creatorMerges: number;
  feedMerges: number;
  creatorIdentityUpdates: number;
  feedIdentityUpdates: number;
  movedContentItems: number;
  movedSubscriptions: number;
  deletedDuplicateSubscriptions: number;
  insertedMissingFeeds: number;
  skippedLegacyFeeds: number;
}

const databaseUrl = process.env.DATABASE_URL ?? "file:./local.db";
const applyChanges = process.argv.includes("--apply");
const includeLegacyFeeds = !process.argv.includes("--skip-legacy-feeds");
const legacyContainer = process.env.FEELITY_LEGACY_MYSQL_CONTAINER ?? "feedelityDB";
const legacyMysqlUri = process.env.FEELITY_LEGACY_MYSQL_URI ?? "strapi:feedelity@localhost:3306/Feedelity";

const counts: RepairCounts = {
  creatorMerges: 0,
  feedMerges: 0,
  creatorIdentityUpdates: 0,
  feedIdentityUpdates: 0,
  movedContentItems: 0,
  movedSubscriptions: 0,
  deletedDuplicateSubscriptions: 0,
  insertedMissingFeeds: 0,
  skippedLegacyFeeds: 0,
};

const client = createSqliteClient(databaseUrl);

try {
  await client.execute("PRAGMA foreign_keys = ON");
  await client.execute("BEGIN IMMEDIATE");
  try {
    await repairDuplicateCreators(client);
    await canonicalizeRemainingIdentities(client);
    if (includeLegacyFeeds) {
      await restoreMissingLegacyFeeds(client);
    }
    await canonicalizeRemainingIdentities(client);
    await assertRepaired(client);

    if (applyChanges) {
      await client.execute("COMMIT");
    } else {
      await client.execute("ROLLBACK");
    }
  } catch (error: unknown) {
    await client.execute("ROLLBACK");
    throw error;
  }

  console.log(JSON.stringify({ mode: applyChanges ? "applied" : "dry-run", databaseUrl, counts }, null, 2));
} finally {
  client.close();
}

async function repairDuplicateCreators(db: Client): Promise<void> {
  const creators = await listCreators(db);
  const feeds = await listFeeds(db);
  const creatorsByName = groupBy(creators, (creator) => normalizeName(creator.displayName));

  for (const group of creatorsByName.values()) {
    if (group.length < 2 || !isSafeAutoMergeGroup(group, feeds)) {
      continue;
    }

    const keeper = chooseKeeper(group, feeds);
    for (const duplicate of group) {
      if (duplicate.id === keeper.id) {
        continue;
      }
      await mergeCreator(db, duplicate, keeper);
    }
  }
}

async function canonicalizeRemainingIdentities(db: Client): Promise<void> {
  const feeds = await listFeeds(db);

  for (const feed of feeds) {
    const canonicalExternalId = canonicalFeedExternalId(feed);
    if (canonicalExternalId === null || canonicalExternalId === feed.sourceExternalId) {
      continue;
    }

    const existingFeed = await findFeedByIdentity(db, feed.sourceType, canonicalExternalId);
    if (existingFeed !== null && existingFeed.id !== feed.id) {
      await mergeFeed(db, feed, existingFeed);
      continue;
    }

    await db.execute({
      sql: "update feed set source_external_id = ? where id = ?",
      args: [canonicalExternalId, feed.id],
    });
    counts.feedIdentityUpdates += 1;
  }

  const creators = await listCreators(db);
  for (const creator of creators) {
    const creatorFeeds = await listFeedsForCreator(db, creator.id);
    const canonicalExternalId = preferredCreatorExternalId(creator, creatorFeeds);
    if (canonicalExternalId === null || canonicalExternalId === creator.sourceExternalId) {
      continue;
    }

    const existingCreator = await findCreatorByIdentity(db, creator.sourceType, canonicalExternalId);
    if (existingCreator !== null && existingCreator.id !== creator.id) {
      await mergeCreator(db, creator, existingCreator);
      continue;
    }

    await db.execute({
      sql: "update creator set source_external_id = ? where id = ?",
      args: [canonicalExternalId, creator.id],
    });
    counts.creatorIdentityUpdates += 1;
  }
}

async function restoreMissingLegacyFeeds(db: Client): Promise<void> {
  const legacyFeeds = readLegacyFeeds();
  const creators = await listCreators(db);
  const creatorsByName = groupBy(creators, (creator) => normalizeName(creator.displayName));

  for (const legacyFeed of legacyFeeds) {
    const existingFeed = await findFeedByIdentity(db, legacyFeed.sourceType, legacyFeed.sourceExternalId);
    if (existingFeed !== null) {
      continue;
    }

    const creator = await findCreatorForLegacyFeed(db, legacyFeed, creatorsByName);
    if (creator === null) {
      counts.skippedLegacyFeeds += 1;
      continue;
    }

    await db.execute({
      sql: `insert into feed (
        id, creator_id, source_type, source_external_id, url, title, description,
        refresh_cadence_seconds, adapter_metadata_json
      ) values (?, ?, ?, ?, ?, ?, null, null, ?)`,
      args: [
        crypto.randomUUID(),
        creator.id,
        legacyFeed.sourceType,
        legacyFeed.sourceExternalId,
        legacyFeed.url,
        legacyFeed.feedName,
        JSON.stringify({ repairedFromLegacyFeedLookup: true }),
      ],
    });
    counts.insertedMissingFeeds += 1;
  }
}

async function findCreatorForLegacyFeed(
  db: Client,
  legacyFeed: LegacyFeedRow,
  creatorsByName: ReadonlyMap<string, readonly CreatorRow[]>,
): Promise<CreatorRow | null> {
  const sourceIdentityMatch = await findCreatorByIdentity(db, legacyFeed.sourceType, legacyFeed.sourceExternalId);
  if (sourceIdentityMatch !== null) {
    return sourceIdentityMatch;
  }

  const creatorGroup = creatorsByName.get(normalizeName(legacyFeed.creatorName));
  const nameMatch = creatorGroup?.length === 1 ? creatorGroup[0] : undefined;
  if (nameMatch === undefined || await hasConflictingLegacyFeedIdentity(db, nameMatch, legacyFeed)) {
    return null;
  }

  return nameMatch;
}

async function hasConflictingLegacyFeedIdentity(db: Client, creator: CreatorRow, legacyFeed: LegacyFeedRow): Promise<boolean> {
  if (creator.sourceType === legacyFeed.sourceType && creator.sourceExternalId !== legacyFeed.sourceExternalId) {
    return true;
  }

  const feeds = await listFeedsForCreator(db, creator.id);
  return feeds.some((feed) => feed.sourceType === legacyFeed.sourceType && feed.sourceExternalId !== legacyFeed.sourceExternalId);
}

async function mergeCreator(db: Client, duplicate: CreatorRow, keeper: CreatorRow): Promise<void> {
  const duplicateFeeds = await listFeedsForCreator(db, duplicate.id);
  const keeperFeeds = await listFeedsForCreator(db, keeper.id);

  for (const duplicateFeed of duplicateFeeds) {
    const duplicateCanonicalId = canonicalFeedExternalId(duplicateFeed) ?? duplicateFeed.sourceExternalId;
    const keeperFeed = keeperFeeds.find((feed) =>
      feed.sourceType === duplicateFeed.sourceType
      && (feed.sourceExternalId === duplicateCanonicalId || canonicalFeedExternalId(feed) === duplicateCanonicalId),
    );

    if (keeperFeed === undefined) {
      await db.execute({ sql: "update feed set creator_id = ? where id = ?", args: [keeper.id, duplicateFeed.id] });
      continue;
    }

    await mergeFeed(db, duplicateFeed, keeperFeed);
  }

  const movedContentItems = await db.execute({
    sql: "update content_item set creator_id = ? where creator_id = ?",
    args: [keeper.id, duplicate.id],
  });
  counts.movedContentItems += rowsAffected(movedContentItems.rowsAffected);

  await moveSubscriptions(db, duplicate.id, keeper.id);
  await db.execute({ sql: "update refresh_run set requested_creator_id = ? where requested_creator_id = ?", args: [keeper.id, duplicate.id] });
  await moveMigrationMappings(db, "creator", duplicate.id, keeper.id);
  await db.execute({ sql: "delete from creator where id = ?", args: [duplicate.id] });
  counts.creatorMerges += 1;
}

async function mergeFeed(db: Client, duplicate: FeedRow, keeper: FeedRow): Promise<void> {
  const duplicateLinks = await db.execute({
    sql: "select content_item_id, source_external_id, raw_import_ref from feed_content where feed_id = ?",
    args: [duplicate.id],
  });

  for (const row of duplicateLinks.rows) {
    await db.execute({
      sql: `insert into feed_content (feed_id, content_item_id, source_external_id, raw_import_ref)
        values (?, ?, ?, ?)
        on conflict(feed_id, content_item_id) do nothing`,
      args: [keeper.id, text(row, "content_item_id"), text(row, "source_external_id"), nullableText(row, "raw_import_ref")],
    });
  }

  await db.execute({ sql: "delete from feed_content where feed_id = ?", args: [duplicate.id] });
  await db.execute({ sql: "update refresh_run set requested_feed_id = ? where requested_feed_id = ?", args: [keeper.id, duplicate.id] });
  await db.execute({ sql: "update refresh_feed_result set feed_id = ? where feed_id = ?", args: [keeper.id, duplicate.id] });
  await moveMigrationMappings(db, "feed", duplicate.id, keeper.id);
  await db.execute({ sql: "delete from feed where id = ?", args: [duplicate.id] });

  const canonicalExternalId = canonicalFeedExternalId(keeper);
  if (canonicalExternalId !== null && canonicalExternalId !== keeper.sourceExternalId) {
    const collision = await findFeedByIdentity(db, keeper.sourceType, canonicalExternalId);
    if (collision === null || collision.id === keeper.id) {
      await db.execute({ sql: "update feed set source_external_id = ? where id = ?", args: [canonicalExternalId, keeper.id] });
      counts.feedIdentityUpdates += 1;
    }
  }

  counts.feedMerges += 1;
}

async function moveSubscriptions(db: Client, duplicateCreatorId: string, keeperCreatorId: string): Promise<void> {
  const subscriptions = await db.execute({
    sql: "select id, user_id, creator_id from subscription where creator_id = ?",
    args: [duplicateCreatorId],
  });

  for (const row of subscriptions.rows) {
    const subscription = toSubscription(row);
    const existing = await db.execute({
      sql: "select id from subscription where user_id = ? and creator_id = ? limit 1",
      args: [subscription.userId, keeperCreatorId],
    });
    if (existing.rows.length > 0) {
      await db.execute({ sql: "delete from subscription where id = ?", args: [subscription.id] });
      counts.deletedDuplicateSubscriptions += 1;
      continue;
    }

    await db.execute({ sql: "update subscription set creator_id = ? where id = ?", args: [keeperCreatorId, subscription.id] });
    counts.movedSubscriptions += 1;
  }
}

async function moveMigrationMappings(db: Client, entityType: string, duplicateId: string, keeperId: string): Promise<void> {
  const mappings = await db.execute({
    sql: "select id from migration_mapping where new_entity_type = ? and new_entity_id = ?",
    args: [entityType, duplicateId],
  });

  for (const row of mappings.rows) {
    const mappingId = text(row, "id");
    try {
      await db.execute({ sql: "update migration_mapping set new_entity_id = ? where id = ?", args: [keeperId, mappingId] });
    } catch (error: unknown) {
      if (!isUniqueConstraintError(error)) {
        throw error;
      }
      await db.execute({ sql: "delete from migration_mapping where id = ?", args: [mappingId] });
    }
  }
}

async function assertRepaired(db: Client): Promise<void> {
  const duplicateNames = await db.execute(`select lower(trim(display_name)) as name_key, count(*) as creator_count
    from creator
    group by name_key
    having count(*) > 1`);
  if (duplicateNames.rows.length > 0) {
    throw new Error(`Duplicate creator names remain: ${duplicateNames.rows.map((row) => text(row, "name_key")).join(", ")}`);
  }

  const malformedYouTube = await db.execute(`select id from feed
    where source_type = 'youtube'
      and instr(url, 'channel_id=') > 0
      and source_external_id != substr(url, instr(url, 'channel_id=') + 11)`);
  if (malformedYouTube.rows.length > 0) {
    throw new Error(`${malformedYouTube.rows.length} malformed YouTube feed identities remain.`);
  }

  const crossCreatorLinks = await db.execute(`select count(*) as count
    from content_item ci
    join feed_content fc on fc.content_item_id = ci.id
    join feed f on f.id = fc.feed_id
    where f.creator_id <> ci.creator_id`);
  const crossCreatorLinkCount = number(crossCreatorLinks.rows[0], "count");
  if (crossCreatorLinkCount > 0) {
    throw new Error(`${crossCreatorLinkCount} cross-creator feed content links remain.`);
  }

  const louis = await db.execute(`select c.id, group_concat(distinct f.source_type) as feed_sources
    from creator c
    left join feed f on f.creator_id = c.id
    where lower(trim(c.display_name)) = 'louis rossmann'
    group by c.id`);
  if (louis.rows.length !== 1) {
    throw new Error(`Expected exactly one Louis Rossmann creator, found ${louis.rows.length}.`);
  }
  const feedSources = nullableText(louis.rows[0], "feed_sources") ?? "";
  if (!feedSources.split(",").includes("odysee") || !feedSources.split(",").includes("youtube")) {
    throw new Error(`Louis Rossmann does not have both odysee and youtube feeds: ${feedSources}.`);
  }
}

async function listCreators(db: Client): Promise<readonly CreatorRow[]> {
  const result = await db.execute(`select c.id, c.source_type, c.source_external_id, c.display_name, c.description,
      c.image_url, c.canonical_url, c.metadata_json, c.created_at,
      (select count(*) from content_item ci where ci.creator_id = c.id) as content_count,
      (select count(*) from subscription s where s.creator_id = c.id) as subscription_count
    from creator c`);
  return result.rows.map(toCreator);
}

async function listFeeds(db: Client): Promise<readonly FeedRow[]> {
  const result = await db.execute(`select f.id, f.creator_id, f.source_type, f.source_external_id, f.url, f.title,
      f.description, f.refresh_cadence_seconds, f.last_normal_refresh_at, f.next_refresh_after,
      f.adapter_metadata_json, f.created_at,
      (select count(*) from feed_content fc where fc.feed_id = f.id) as feed_content_count
    from feed f`);
  return result.rows.map(toFeed);
}

async function listFeedsForCreator(db: Client, creatorId: string): Promise<readonly FeedRow[]> {
  const result = await db.execute({
    sql: `select f.id, f.creator_id, f.source_type, f.source_external_id, f.url, f.title,
      f.description, f.refresh_cadence_seconds, f.last_normal_refresh_at, f.next_refresh_after,
      f.adapter_metadata_json, f.created_at,
      (select count(*) from feed_content fc where fc.feed_id = f.id) as feed_content_count
    from feed f where f.creator_id = ?`,
    args: [creatorId],
  });
  return result.rows.map(toFeed);
}

async function findFeedByIdentity(db: Client, sourceType: SourceType, sourceExternalId: string): Promise<FeedRow | null> {
  const result = await db.execute({
    sql: `select f.id, f.creator_id, f.source_type, f.source_external_id, f.url, f.title,
      f.description, f.refresh_cadence_seconds, f.last_normal_refresh_at, f.next_refresh_after,
      f.adapter_metadata_json, f.created_at,
      (select count(*) from feed_content fc where fc.feed_id = f.id) as feed_content_count
    from feed f where f.source_type = ? and f.source_external_id = ? limit 1`,
    args: [sourceType, sourceExternalId],
  });
  const row = result.rows[0];
  return row === undefined ? null : toFeed(row);
}

async function findCreatorByIdentity(db: Client, sourceType: SourceType, sourceExternalId: string): Promise<CreatorRow | null> {
  const result = await db.execute({
    sql: `select c.id, c.source_type, c.source_external_id, c.display_name, c.description,
      c.image_url, c.canonical_url, c.metadata_json, c.created_at,
      (select count(*) from content_item ci where ci.creator_id = c.id) as content_count,
      (select count(*) from subscription s where s.creator_id = c.id) as subscription_count
    from creator c where c.source_type = ? and c.source_external_id = ? limit 1`,
    args: [sourceType, sourceExternalId],
  });
  const row = result.rows[0];
  return row === undefined ? null : toCreator(row);
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
    `SELECT c.name AS creatorName, f.name AS feedName, f.url, f.type AS sourceType, COALESCE(f.external_id, '') AS sourceExternalId
      FROM creators c
      JOIN feeds_creator_links fcl ON fcl.creator_id = c.id
      JOIN feeds f ON f.id = fcl.feed_id
      WHERE f.type IN ('youtube', 'odysee', 'peertube')
      ORDER BY c.id, f.id`,
  ], { stdout: "pipe", stderr: "pipe" });

  if (!result.success) {
    throw new Error(`Legacy feed lookup failed: ${result.stderr.toString()}`);
  }

  const rows = parseJsonRows(result.stdout.toString());
  const feeds: LegacyFeedRow[] = [];
  for (const row of rows) {
    const sourceType = sourceTypeFromUnknown(field(row, "sourceType"));
    const url = stringFromUnknown(field(row, "url"));
    const derivedExternalId = canonicalExternalIdFromUrl(sourceType, url) ?? stringFromUnknown(field(row, "sourceExternalId"));
    if (derivedExternalId.length === 0) {
      continue;
    }
    feeds.push({
      creatorName: stringFromUnknown(field(row, "creatorName")),
      feedName: nullableStringFromUnknown(field(row, "feedName")),
      url,
      sourceType,
      sourceExternalId: derivedExternalId,
    });
  }

  return feeds;
}

function isSafeAutoMergeGroup(group: readonly CreatorRow[], feeds: readonly FeedRow[]): boolean {
  const sourceTypes = new Set(group.map((creator) => creator.sourceType));
  if (sourceTypes.size !== 1) {
    return false;
  }

  const canonicalIdentities = new Set<string>();
  for (const creator of group) {
    const creatorFeeds = feeds.filter((feed) => feed.creatorId === creator.id);
    const preferredExternalId = preferredCreatorExternalId(creator, creatorFeeds) ?? creator.sourceExternalId;
    canonicalIdentities.add(`${creator.sourceType}:${preferredExternalId}`);
  }

  return canonicalIdentities.size === 1;
}

function chooseKeeper(group: readonly CreatorRow[], feeds: readonly FeedRow[]): CreatorRow {
  return [...group].sort((left, right) => {
    const leftFeedLinks = feeds.filter((feed) => feed.creatorId === left.id).reduce((sum, feed) => sum + feed.feedContentCount, 0);
    const rightFeedLinks = feeds.filter((feed) => feed.creatorId === right.id).reduce((sum, feed) => sum + feed.feedContentCount, 0);
    const leftScore = left.contentCount + left.subscriptionCount + leftFeedLinks;
    const rightScore = right.contentCount + right.subscriptionCount + rightFeedLinks;
    if (leftScore !== rightScore) {
      return rightScore - leftScore;
    }
    return left.createdAt - right.createdAt;
  })[0] ?? group[0];
}

function preferredCreatorExternalId(creator: CreatorRow, feeds: readonly FeedRow[]): string | null {
  const sameSourceFeed = feeds.find((feed) => feed.sourceType === creator.sourceType);
  if (sameSourceFeed !== undefined) {
    return canonicalFeedExternalId(sameSourceFeed) ?? sameSourceFeed.sourceExternalId;
  }
  if (creator.sourceType === "youtube" && !creator.sourceExternalId.startsWith("UC") && creator.sourceExternalId.length === 22) {
    return `UC${creator.sourceExternalId}`;
  }
  return null;
}

function canonicalFeedExternalId(feed: FeedRow): string | null {
  return canonicalExternalIdFromUrl(feed.sourceType, feed.url);
}

function canonicalExternalIdFromUrl(sourceType: SourceType, urlText: string): string | null {
  try {
    const url = new URL(urlText);
    if (sourceType === "youtube") {
      const channelId = url.searchParams.get("channel_id");
      if (!isNonEmpty(channelId)) {
        return null;
      }
      return channelId.startsWith("UC") || channelId.length !== 22 ? channelId : `UC${channelId}`;
    }
    if (sourceType === "odysee" && url.pathname.startsWith("/$/rss/")) {
      const claim = decodeURIComponent(url.pathname.slice("/$/rss/".length).split("/")[0] ?? "");
      return isNonEmpty(claim) ? claim : null;
    }
    return null;
  } catch {
    return null;
  }
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
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

function toCreator(row: Row): CreatorRow {
  return {
    id: text(row, "id"),
    sourceType: sourceType(row, "source_type"),
    sourceExternalId: text(row, "source_external_id"),
    displayName: text(row, "display_name"),
    description: nullableText(row, "description"),
    imageUrl: nullableText(row, "image_url"),
    canonicalUrl: nullableText(row, "canonical_url"),
    metadataJson: nullableText(row, "metadata_json"),
    createdAt: number(row, "created_at"),
    contentCount: number(row, "content_count"),
    subscriptionCount: number(row, "subscription_count"),
  };
}

function toFeed(row: Row): FeedRow {
  return {
    id: text(row, "id"),
    creatorId: text(row, "creator_id"),
    sourceType: sourceType(row, "source_type"),
    sourceExternalId: text(row, "source_external_id"),
    url: text(row, "url"),
    title: nullableText(row, "title"),
    description: nullableText(row, "description"),
    refreshCadenceSeconds: nullableNumber(row, "refresh_cadence_seconds"),
    lastNormalRefreshAt: nullableNumber(row, "last_normal_refresh_at"),
    nextRefreshAfter: nullableNumber(row, "next_refresh_after"),
    adapterMetadataJson: nullableText(row, "adapter_metadata_json"),
    createdAt: number(row, "created_at"),
    feedContentCount: number(row, "feed_content_count"),
  };
}

function toSubscription(row: Row): SubscriptionRow {
  return {
    id: text(row, "id"),
    userId: text(row, "user_id"),
    creatorId: text(row, "creator_id"),
  };
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

function field(row: object, key: string): unknown {
  return Reflect.get(row, key);
}

function text(row: Row, key: string): string {
  const value = row[key];
  if (typeof value === "string") {
    return value;
  }
  throw new Error(`Expected ${key} to be text.`);
}

function nullableText(row: Row, key: string): string | null {
  const value = row[key];
  if (value === null) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  throw new Error(`Expected ${key} to be nullable text.`);
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

function nullableNumber(row: Row, key: string): number | null {
  const value = row[key];
  if (value === null) {
    return null;
  }
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  throw new Error(`Expected ${key} to be nullable numeric.`);
}

function sourceType(row: Row, key: string): SourceType {
  return sourceTypeFromUnknown(row[key]);
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

function isNonEmpty(value: string | null): value is string {
  return value !== null && value.trim().length > 0;
}

function rowsAffected(value: number | bigint | undefined): number {
  if (value === undefined) {
    return 0;
  }
  return typeof value === "bigint" ? Number(value) : value;
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

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Error && error.message.toLowerCase().includes("unique");
}

function createSqliteClient(url: string): Client {
  const filename = url.startsWith("file:") ? url.slice("file:".length) : url;
  const database = new Database(filename);
  return {
    async execute(statement) {
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
