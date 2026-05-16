import { strapiExportSchema } from "./strapi-export";
import type {
  StrapiContentOption,
  StrapiCreator,
  StrapiExport,
  StrapiSubscriptionContentOption,
  StrapiUser,
} from "./strapi-export";

const exportedCollectionNames = [
  "users",
  "creators",
  "creator_options",
  "feeds",
  "feed_options",
  "feed_contents",
  "creator_contents",
  "content_options",
  "subscriptions",
  "subscription_options",
  "subscription_content_options",
  "playlists",
  "playlist_contents",
] as const;

type SourceType = "youtube" | "odysee" | "peertube" | "unknown";

interface OldStrapiMysqlAuditRow {
  readonly id: number;
  readonly created_at?: string | null;
  readonly updated_at?: string | null;
  readonly published_at?: string | null;
}

export interface OldStrapiMysqlUserRow extends OldStrapiMysqlAuditRow {
  readonly username: string;
  readonly email: string;
  readonly provider: string;
  readonly confirmed: boolean | 0 | 1;
  readonly blocked: boolean | 0 | 1;
}

export interface OldStrapiMysqlCreatorRow extends OldStrapiMysqlAuditRow {
  readonly name: string;
  readonly description: string | null;
}

export interface OldStrapiMysqlOptionRow extends OldStrapiMysqlAuditRow {
  readonly name: string;
  readonly type: string;
  readonly value: string;
}

export interface OldStrapiMysqlFeedRow extends OldStrapiMysqlAuditRow {
  readonly name: string;
  readonly url: string;
  readonly type: string;
  readonly external_id: string;
  readonly refreshed_at: string | null;
}

export interface OldStrapiMysqlCreatorContentRow extends OldStrapiMysqlAuditRow {
  readonly title: string;
  readonly type: string;
  readonly publication: string | null;
  readonly data: string | null;
}

export interface OldStrapiMysqlFeedContentRow extends OldStrapiMysqlAuditRow {
  readonly external_id: string;
  readonly raw?: string | null;
}

export interface OldStrapiMysqlSubscriptionRow extends OldStrapiMysqlAuditRow {}

export interface OldStrapiMysqlPlaylistRow extends OldStrapiMysqlAuditRow {
  readonly name: string;
  readonly description: string | null;
}

export interface OldStrapiMysqlPlaylistContentRow extends OldStrapiMysqlAuditRow {
  readonly Added: string | null;
  readonly position: number;
}

export interface OldStrapiMysqlRows {
  readonly users: readonly OldStrapiMysqlUserRow[];
  readonly creators: readonly OldStrapiMysqlCreatorRow[];
  readonly creatorOptions: readonly OldStrapiMysqlOptionRow[];
  readonly creatorOptionCreatorLinks: readonly CreatorOptionCreatorLinkRow[];
  readonly feeds: readonly OldStrapiMysqlFeedRow[];
  readonly feedCreatorLinks: readonly FeedCreatorLinkRow[];
  readonly feedOptions: readonly OldStrapiMysqlOptionRow[];
  readonly feedOptionFeedLinks: readonly FeedOptionFeedLinkRow[];
  readonly feedContents: readonly OldStrapiMysqlFeedContentRow[];
  readonly feedContentFeedLinks: readonly FeedContentFeedLinkRow[];
  readonly feedContentContentLinks: readonly FeedContentContentLinkRow[];
  readonly creatorContents: readonly OldStrapiMysqlCreatorContentRow[];
  readonly creatorContentCreatorLinks: readonly CreatorContentCreatorLinkRow[];
  readonly contentOptions: readonly OldStrapiMysqlOptionRow[];
  readonly contentOptionContentLinks: readonly ContentOptionContentLinkRow[];
  readonly subscriptions: readonly OldStrapiMysqlSubscriptionRow[];
  readonly subscriptionUserLinks: readonly SubscriptionUserLinkRow[];
  readonly subscriptionCreatorLinks: readonly SubscriptionCreatorLinkRow[];
  readonly subscriptionOptions: readonly OldStrapiMysqlOptionRow[];
  readonly subscriptionOptionSubscriptionLinks: readonly SubscriptionOptionSubscriptionLinkRow[];
  readonly subscriptionContentOptions: readonly OldStrapiMysqlOptionRow[];
  readonly subscriptionContentOptionSubscriptionLinks: readonly SubscriptionContentOptionSubscriptionLinkRow[];
  readonly subscriptionContentOptionContentLinks: readonly SubscriptionContentOptionContentLinkRow[];
  readonly playlists: readonly OldStrapiMysqlPlaylistRow[];
  readonly playlistUserLinks: readonly PlaylistUserLinkRow[];
  readonly playlistContents: readonly OldStrapiMysqlPlaylistContentRow[];
  readonly playlistContentPlaylistLinks: readonly PlaylistContentPlaylistLinkRow[];
  readonly playlistContentContentLinks: readonly PlaylistContentContentLinkRow[];
}

export interface OldMysqlExportMetadataInput {
  readonly exportedAt: string;
  readonly strapiVersion: string;
  readonly sourceInstanceId: string;
}

interface CreatorOptionCreatorLinkRow {
  readonly creator_option_id: number;
  readonly creator_id: number;
}

interface FeedCreatorLinkRow {
  readonly feed_id: number;
  readonly creator_id: number;
}

interface FeedOptionFeedLinkRow {
  readonly feed_option_id: number;
  readonly feed_id: number;
}

interface FeedContentFeedLinkRow {
  readonly feed_content_id: number;
  readonly feed_id: number;
}

interface FeedContentContentLinkRow {
  readonly feed_content_id: number;
  readonly content_id: number;
}

interface CreatorContentCreatorLinkRow {
  readonly creator_content_id: number;
  readonly creator_id: number;
}

interface ContentOptionContentLinkRow {
  readonly content_option_id: number;
  readonly content_id: number;
}

interface SubscriptionUserLinkRow {
  readonly subscription_id: number;
  readonly user_id: number;
}

interface SubscriptionCreatorLinkRow {
  readonly subscription_id: number;
  readonly creator_id: number;
}

interface SubscriptionOptionSubscriptionLinkRow {
  readonly subscription_option_id: number;
  readonly subscription_id: number;
}

interface SubscriptionContentOptionSubscriptionLinkRow {
  readonly subscription_content_option_id: number;
  readonly subscription_id: number;
}

interface SubscriptionContentOptionContentLinkRow {
  readonly subscription_content_option_id: number;
  readonly content_id: number;
}

interface PlaylistUserLinkRow {
  readonly playlist_id: number;
  readonly user_id: number;
}

interface PlaylistContentPlaylistLinkRow {
  readonly playlist_content_id: number;
  readonly playlist_id: number;
}

interface PlaylistContentContentLinkRow {
  readonly playlist_content_id: number;
  readonly content_id: number;
}

interface StrapiAuditFields {
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly publishedAt?: string | null;
}

interface OptionFields extends StrapiAuditFields {
  readonly oldId: number;
  readonly name: string;
  readonly type: string;
  readonly value: string;
}

interface RelationshipIndex<Row extends object, SourceKey extends keyof Row, TargetKey extends keyof Row> {
  readonly collectionName: string;
  readonly sourceFieldName: string;
  readonly targetFieldName: string;
  readonly linksBySourceId: ReadonlyMap<number, Row>;
  readonly sourceKey: SourceKey;
  readonly targetKey: TargetKey;
}

export function buildStrapiExportFromOldMysqlRows(
  rows: OldStrapiMysqlRows,
  metadataInput: OldMysqlExportMetadataInput,
): StrapiExport {
  return strapiExportSchema.parse(buildUnvalidatedStrapiExportFromOldMysqlRows(rows, metadataInput));
}

export function buildUnvalidatedStrapiExportFromOldMysqlRows(
  rows: OldStrapiMysqlRows,
  metadataInput: OldMysqlExportMetadataInput,
): StrapiExport {
  validateOldMysqlRelationshipRows(rows);

  const creatorOptionCreatorIndex = createRelationshipIndex(
    "creatorOptionCreatorLinks",
    "creator_option_id",
    "creator_id",
    rows.creatorOptionCreatorLinks,
  );
  const feedCreatorIndex = createRelationshipIndex("feedCreatorLinks", "feed_id", "creator_id", rows.feedCreatorLinks);
  const feedOptionFeedIndex = createRelationshipIndex("feedOptionFeedLinks", "feed_option_id", "feed_id", rows.feedOptionFeedLinks);
  const feedContentFeedIndex = createRelationshipIndex("feedContentFeedLinks", "feed_content_id", "feed_id", rows.feedContentFeedLinks);
  const feedContentContentIndex = createRelationshipIndex(
    "feedContentContentLinks",
    "feed_content_id",
    "content_id",
    rows.feedContentContentLinks,
  );
  const creatorContentCreatorIndex = createRelationshipIndex(
    "creatorContentCreatorLinks",
    "creator_content_id",
    "creator_id",
    rows.creatorContentCreatorLinks,
  );
  const contentOptionContentIndex = createRelationshipIndex(
    "contentOptionContentLinks",
    "content_option_id",
    "content_id",
    rows.contentOptionContentLinks,
  );
  const subscriptionUserIndex = createRelationshipIndex("subscriptionUserLinks", "subscription_id", "user_id", rows.subscriptionUserLinks);
  const subscriptionCreatorIndex = createRelationshipIndex(
    "subscriptionCreatorLinks",
    "subscription_id",
    "creator_id",
    rows.subscriptionCreatorLinks,
  );
  const subscriptionOptionSubscriptionIndex = createRelationshipIndex(
    "subscriptionOptionSubscriptionLinks",
    "subscription_option_id",
    "subscription_id",
    rows.subscriptionOptionSubscriptionLinks,
  );
  const subscriptionContentOptionSubscriptionIndex = createRelationshipIndex(
    "subscriptionContentOptionSubscriptionLinks",
    "subscription_content_option_id",
    "subscription_id",
    rows.subscriptionContentOptionSubscriptionLinks,
  );
  const subscriptionContentOptionContentIndex = createRelationshipIndex(
    "subscriptionContentOptionContentLinks",
    "subscription_content_option_id",
    "content_id",
    rows.subscriptionContentOptionContentLinks,
  );
  const playlistUserIndex = createRelationshipIndex("playlistUserLinks", "playlist_id", "user_id", rows.playlistUserLinks);
  const playlistContentPlaylistIndex = createRelationshipIndex(
    "playlistContentPlaylistLinks",
    "playlist_content_id",
    "playlist_id",
    rows.playlistContentPlaylistLinks,
  );
  const playlistContentContentIndex = createRelationshipIndex(
    "playlistContentContentLinks",
    "playlist_content_id",
    "content_id",
    rows.playlistContentContentLinks,
  );

  const exportData: StrapiExport = {
    metadata: {
      formatVersion: 1,
      exportedAt: metadataInput.exportedAt,
      source: {
        application: "feedelity-strapi",
        strapiVersion: metadataInput.strapiVersion,
        sourceInstanceId: metadataInput.sourceInstanceId,
      },
      fingerprintInputs: {
        schemaVersion: "feedelity-strapi-export-v1",
        collectionNames: [...exportedCollectionNames],
      },
    },
    users: sortByOldId(rows.users.map(mapUser)),
    creators: sortByOldId(rows.creators.map(mapCreator)),
    creatorOptions: sortByOldId(
      rows.creatorOptions.map((row) => ({
        ...mapOption(row),
        creatorId: requiredRelatedId(row.id, creatorOptionCreatorIndex),
      })),
    ),
    feeds: sortByOldId(
      rows.feeds.map((row) => ({
        ...auditFields(row),
        oldId: row.id,
        creatorId: requiredRelatedId(row.id, feedCreatorIndex),
        name: row.name,
        url: row.url,
        type: normalizeSourceType(row.type),
        externalId: row.external_id,
        refreshedAt: row.refreshed_at,
      })),
    ),
    feedOptions: sortByOldId(
      rows.feedOptions.map((row) => ({
        ...mapOption(row),
        feedId: requiredRelatedId(row.id, feedOptionFeedIndex),
      })),
    ),
    feedContents: sortByOldId(
      rows.feedContents.map((row) => ({
        ...auditFields(row),
        oldId: row.id,
        feedId: requiredRelatedId(row.id, feedContentFeedIndex),
        contentId: requiredRelatedId(row.id, feedContentContentIndex),
        externalId: row.external_id,
        raw: row.raw,
      })),
    ),
    creatorContents: sortByOldId(
      rows.creatorContents.map((row) => ({
        ...auditFields(row),
        oldId: row.id,
        creatorId: requiredRelatedId(row.id, creatorContentCreatorIndex),
        title: row.title,
        type: row.type,
        publication: row.publication,
        data: row.data,
      })),
    ),
    contentOptions: sortByOldId(
      rows.contentOptions.map((row) => ({
        ...mapOption(row),
        contentId: requiredRelatedId(row.id, contentOptionContentIndex),
        interpretedStatus: interpretStatusOption(row.name, row.value),
      })),
    ),
    subscriptions: sortByOldId(
      rows.subscriptions.map((row) => ({
        ...auditFields(row),
        oldId: row.id,
        userId: requiredRelatedId(row.id, subscriptionUserIndex),
        creatorId: requiredRelatedId(row.id, subscriptionCreatorIndex),
      })),
    ),
    subscriptionOptions: sortByOldId(
      rows.subscriptionOptions.map((row) => ({
        ...mapOption(row),
        subscriptionId: requiredRelatedId(row.id, subscriptionOptionSubscriptionIndex),
      })),
    ),
    subscriptionContentOptions: sortByOldId(
      rows.subscriptionContentOptions.map((row) => ({
        ...mapOption(row),
        subscriptionId: requiredRelatedId(row.id, subscriptionContentOptionSubscriptionIndex),
        contentId: requiredRelatedId(row.id, subscriptionContentOptionContentIndex),
        interpretedStatus: requiredStatusOption(row.name, row.value),
      })),
    ),
    playlists: sortByOldId(
      rows.playlists.map((row) => ({
        ...auditFields(row),
        oldId: row.id,
        userId: requiredRelatedId(row.id, playlistUserIndex),
        name: row.name,
        description: row.description,
      })),
    ),
    playlistContents: sortByOldId(
      rows.playlistContents.map((row) => ({
        ...auditFields(row),
        oldId: row.id,
        playlistId: requiredRelatedId(row.id, playlistContentPlaylistIndex),
        contentId: requiredRelatedId(row.id, playlistContentContentIndex),
        Added: row.Added,
        position: row.position,
      })),
    ),
  };

  return exportData;
}

function mapUser(row: OldStrapiMysqlUserRow): StrapiUser {
  return {
    ...auditFields(row),
    oldId: row.id,
    username: row.username,
    email: row.email,
    provider: row.provider,
    confirmed: toBoolean(row.confirmed),
    blocked: toBoolean(row.blocked),
  };
}

function mapCreator(row: OldStrapiMysqlCreatorRow): StrapiCreator {
  return {
    ...auditFields(row),
    oldId: row.id,
    name: row.name,
    description: row.description,
  };
}

function mapOption(row: OldStrapiMysqlOptionRow): OptionFields {
  return {
    ...auditFields(row),
    oldId: row.id,
    name: row.name,
    type: row.type,
    value: row.value,
  };
}

function auditFields(row: OldStrapiMysqlAuditRow): StrapiAuditFields {
  return {
    createdAt: normalizeOptionalTimestamp(row.created_at),
    updatedAt: normalizeOptionalTimestamp(row.updated_at),
    publishedAt: row.published_at,
  };
}

function normalizeOptionalTimestamp(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  return value;
}

function toBoolean(value: boolean | 0 | 1): boolean {
  return value === true || value === 1;
}

function normalizeSourceType(value: string): SourceType {
  switch (value) {
    case "youtube":
    case "odysee":
    case "peertube":
    case "unknown":
      return value;
    default:
      return "unknown";
  }
}

function sortByOldId<RecordWithOldId extends { readonly oldId: number }>(records: readonly RecordWithOldId[]): RecordWithOldId[] {
  return [...records].sort((left, right) => left.oldId - right.oldId);
}

function validateOldMysqlRelationshipRows(rows: OldStrapiMysqlRows): void {
  validateRelationshipRows(
    "creatorOptionCreatorLinks",
    "creator_option_id",
    "creator_id",
    rows.creatorOptionCreatorLinks,
    "creatorOptions",
    rows.creatorOptions,
    "creators",
    rows.creators,
  );
  validateRelationshipRows("feedCreatorLinks", "feed_id", "creator_id", rows.feedCreatorLinks, "feeds", rows.feeds, "creators", rows.creators);
  validateRelationshipRows(
    "feedOptionFeedLinks",
    "feed_option_id",
    "feed_id",
    rows.feedOptionFeedLinks,
    "feedOptions",
    rows.feedOptions,
    "feeds",
    rows.feeds,
  );
  validateRelationshipRows(
    "feedContentFeedLinks",
    "feed_content_id",
    "feed_id",
    rows.feedContentFeedLinks,
    "feedContents",
    rows.feedContents,
    "feeds",
    rows.feeds,
  );
  validateRelationshipRows(
    "feedContentContentLinks",
    "feed_content_id",
    "content_id",
    rows.feedContentContentLinks,
    "feedContents",
    rows.feedContents,
    "creatorContents",
    rows.creatorContents,
  );
  validateRelationshipRows(
    "creatorContentCreatorLinks",
    "creator_content_id",
    "creator_id",
    rows.creatorContentCreatorLinks,
    "creatorContents",
    rows.creatorContents,
    "creators",
    rows.creators,
  );
  validateRelationshipRows(
    "contentOptionContentLinks",
    "content_option_id",
    "content_id",
    rows.contentOptionContentLinks,
    "contentOptions",
    rows.contentOptions,
    "creatorContents",
    rows.creatorContents,
  );
  validateRelationshipRows(
    "subscriptionUserLinks",
    "subscription_id",
    "user_id",
    rows.subscriptionUserLinks,
    "subscriptions",
    rows.subscriptions,
    "users",
    rows.users,
  );
  validateRelationshipRows(
    "subscriptionCreatorLinks",
    "subscription_id",
    "creator_id",
    rows.subscriptionCreatorLinks,
    "subscriptions",
    rows.subscriptions,
    "creators",
    rows.creators,
  );
  validateRelationshipRows(
    "subscriptionOptionSubscriptionLinks",
    "subscription_option_id",
    "subscription_id",
    rows.subscriptionOptionSubscriptionLinks,
    "subscriptionOptions",
    rows.subscriptionOptions,
    "subscriptions",
    rows.subscriptions,
  );
  validateRelationshipRows(
    "subscriptionContentOptionSubscriptionLinks",
    "subscription_content_option_id",
    "subscription_id",
    rows.subscriptionContentOptionSubscriptionLinks,
    "subscriptionContentOptions",
    rows.subscriptionContentOptions,
    "subscriptions",
    rows.subscriptions,
  );
  validateRelationshipRows(
    "subscriptionContentOptionContentLinks",
    "subscription_content_option_id",
    "content_id",
    rows.subscriptionContentOptionContentLinks,
    "subscriptionContentOptions",
    rows.subscriptionContentOptions,
    "creatorContents",
    rows.creatorContents,
  );
  validateRelationshipRows(
    "playlistUserLinks",
    "playlist_id",
    "user_id",
    rows.playlistUserLinks,
    "playlists",
    rows.playlists,
    "users",
    rows.users,
  );
  validateRelationshipRows(
    "playlistContentPlaylistLinks",
    "playlist_content_id",
    "playlist_id",
    rows.playlistContentPlaylistLinks,
    "playlistContents",
    rows.playlistContents,
    "playlists",
    rows.playlists,
  );
  validateRelationshipRows(
    "playlistContentContentLinks",
    "playlist_content_id",
    "content_id",
    rows.playlistContentContentLinks,
    "playlistContents",
    rows.playlistContents,
    "creatorContents",
    rows.creatorContents,
  );
}

function validateRelationshipRows<
  LinkRow extends object,
  SourceKey extends keyof LinkRow,
  TargetKey extends keyof LinkRow,
  SourceRow extends OldStrapiMysqlAuditRow,
  TargetRow extends OldStrapiMysqlAuditRow,
>(
  linkCollectionName: string,
  sourceKey: SourceKey,
  targetKey: TargetKey,
  linkRows: readonly LinkRow[],
  sourceCollectionName: string,
  sourceRows: readonly SourceRow[],
  targetCollectionName: string,
  targetRows: readonly TargetRow[],
): void {
  const sourceIds = createOldIdSet(sourceRows);
  const targetIds = createOldIdSet(targetRows);

  linkRows.forEach((row) => {
    const sourceId = readNumericField(row, sourceKey, linkCollectionName);
    const targetId = readNumericField(row, targetKey, linkCollectionName);

    if (!sourceIds.has(sourceId)) {
      throw new Error(`${linkCollectionName}.${String(sourceKey)} references missing ${sourceCollectionName} oldId ${sourceId}.`);
    }
    if (!targetIds.has(targetId)) {
      throw new Error(`${linkCollectionName}.${String(targetKey)} references missing ${targetCollectionName} oldId ${targetId}.`);
    }
  });
}

function createOldIdSet<Row extends OldStrapiMysqlAuditRow>(rows: readonly Row[]): ReadonlySet<number> {
  return new Set(rows.map((row) => row.id));
}

function createRelationshipIndex<Row extends object, SourceKey extends keyof Row, TargetKey extends keyof Row>(
  collectionName: string,
  sourceKey: SourceKey,
  targetKey: TargetKey,
  rows: readonly Row[],
): RelationshipIndex<Row, SourceKey, TargetKey> {
  const linksBySourceId = new Map<number, Row>();
  rows.forEach((row) => {
    const sourceId = readNumericField(row, sourceKey, collectionName);
    if (linksBySourceId.has(sourceId)) {
      throw new Error(`${collectionName}.${String(sourceKey)} contains duplicate source id ${sourceId}.`);
    }
    linksBySourceId.set(sourceId, row);
  });
  return {
    collectionName,
    sourceFieldName: String(sourceKey),
    targetFieldName: String(targetKey),
    linksBySourceId,
    sourceKey,
    targetKey,
  };
}

function requiredRelatedId<Row extends object, SourceKey extends keyof Row, TargetKey extends keyof Row>(
  sourceId: number,
  index: RelationshipIndex<Row, SourceKey, TargetKey>,
): number {
  const link = index.linksBySourceId.get(sourceId);
  if (link === undefined) {
    throw new Error(`${index.collectionName}.${index.sourceFieldName} is missing required relationship for oldId ${sourceId}.`);
  }
  return readNumericField(link, index.targetKey, index.collectionName);
}

function readNumericField<Row extends object, FieldKey extends keyof Row>(row: Row, fieldKey: FieldKey, collectionName: string): number {
  const value = row[fieldKey];
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${collectionName}.${String(fieldKey)} must be a positive integer relationship id.`);
  }
  return value;
}

function interpretStatusOption(name: string, value: string): StrapiContentOption["interpretedStatus"] {
  if (!isStatusName(name)) {
    return undefined;
  }
  return {
    statusName: name,
    active: isActiveOptionValue(value),
  };
}

function requiredStatusOption(name: string, value: string): StrapiSubscriptionContentOption["interpretedStatus"] {
  if (!isStatusName(name)) {
    throw new Error(`subscriptionContentOptions.name must be one of open, opened, played, or favorite when interpreting status option ${name}.`);
  }
  return {
    statusName: name,
    active: isActiveOptionValue(value),
  };
}

function isStatusName(name: string): name is StrapiSubscriptionContentOption["interpretedStatus"]["statusName"] {
  return name === "open" || name === "opened" || name === "played" || name === "favorite";
}

function isActiveOptionValue(value: string): boolean {
  return value === "1" || value === "true" || value === "yes" || value === "on";
}
