import { relations, sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const sourceTypeValues = ["youtube", "odysee", "peertube"] as const;
export const contentTypeValues = ["video"] as const;
export const refreshScopeValues = ["all", "creator", "feed"] as const;
export const refreshStatusValues = ["running", "succeeded", "failed", "partial"] as const;

const currentTimestampMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

export const creator = sqliteTable(
  "creator",
  {
    id: text("id").primaryKey(),
    sourceType: text("source_type", { enum: sourceTypeValues }).notNull(),
    sourceExternalId: text("source_external_id").notNull(),
    displayName: text("display_name").notNull(),
    description: text("description"),
    imageUrl: text("image_url"),
    canonicalUrl: text("canonical_url"),
    metadataJson: text("metadata_json"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(currentTimestampMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(currentTimestampMs)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("creator_source_identity_uidx").on(table.sourceType, table.sourceExternalId),
    index("creator_display_name_idx").on(table.displayName),
  ],
);

export const feed = sqliteTable(
  "feed",
  {
    id: text("id").primaryKey(),
    creatorId: text("creator_id")
      .notNull()
      .references(() => creator.id, { onDelete: "cascade" }),
    sourceType: text("source_type", { enum: sourceTypeValues }).notNull(),
    sourceExternalId: text("source_external_id").notNull(),
    url: text("url").notNull(),
    title: text("title"),
    description: text("description"),
    refreshCadenceSeconds: integer("refresh_cadence_seconds"),
    lastNormalRefreshAt: integer("last_normal_refresh_at", { mode: "timestamp_ms" }),
    nextRefreshAfter: integer("next_refresh_after", { mode: "timestamp_ms" }),
    adapterMetadataJson: text("adapter_metadata_json"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(currentTimestampMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(currentTimestampMs)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("feed_source_identity_uidx").on(table.sourceType, table.sourceExternalId),
    index("feed_creator_id_idx").on(table.creatorId),
    index("feed_next_refresh_after_idx").on(table.nextRefreshAfter),
  ],
);

export const contentItem = sqliteTable(
  "content_item",
  {
    id: text("id").primaryKey(),
    creatorId: text("creator_id")
      .notNull()
      .references(() => creator.id, { onDelete: "cascade" }),
    sourceType: text("source_type", { enum: sourceTypeValues }).notNull(),
    sourceExternalId: text("source_external_id").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    publishedAt: integer("published_at", { mode: "timestamp_ms" }),
    contentType: text("content_type", { enum: contentTypeValues }).default("video").notNull(),
    durationSeconds: integer("duration_seconds"),
    thumbnailUrl: text("thumbnail_url"),
    canonicalUrl: text("canonical_url"),
    metadataJson: text("metadata_json"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(currentTimestampMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(currentTimestampMs)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("content_item_source_identity_uidx").on(table.sourceType, table.sourceExternalId),
    index("content_item_creator_id_idx").on(table.creatorId),
    index("content_item_published_at_idx").on(table.publishedAt),
  ],
);

export const contentSource = sqliteTable(
  "content_source",
  {
    id: text("id").primaryKey(),
    contentItemId: text("content_item_id")
      .notNull()
      .references(() => contentItem.id, { onDelete: "cascade" }),
    sourceType: text("source_type", { enum: sourceTypeValues }).notNull(),
    sourceExternalId: text("source_external_id"),
    embedUrl: text("embed_url"),
    nativeMediaUrl: text("native_media_url"),
    canonicalUrl: text("canonical_url").notNull(),
    priority: integer("priority").default(0).notNull(),
    metadataJson: text("metadata_json"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(currentTimestampMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(currentTimestampMs)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("content_source_canonical_uidx").on(table.sourceType, table.canonicalUrl),
    uniqueIndex("content_source_item_priority_uidx").on(table.contentItemId, table.priority),
    index("content_source_content_item_id_idx").on(table.contentItemId),
  ],
);

export const feedContent = sqliteTable(
  "feed_content",
  {
    feedId: text("feed_id")
      .notNull()
      .references(() => feed.id, { onDelete: "cascade" }),
    contentItemId: text("content_item_id")
      .notNull()
      .references(() => contentItem.id, { onDelete: "cascade" }),
    sourceExternalId: text("source_external_id").notNull(),
    rawImportRef: text("raw_import_ref"),
    discoveredAt: integer("discovered_at", { mode: "timestamp_ms" }).default(currentTimestampMs).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.feedId, table.contentItemId], name: "feed_content_pk" }),
    uniqueIndex("feed_content_source_identity_uidx").on(table.feedId, table.sourceExternalId),
    index("feed_content_content_item_id_idx").on(table.contentItemId),
  ],
);

export const refreshRun = sqliteTable(
  "refresh_run",
  {
    id: text("id").primaryKey(),
    scope: text("scope", { enum: refreshScopeValues }).notNull(),
    force: integer("force", { mode: "boolean" }).default(false).notNull(),
    status: text("status", { enum: refreshStatusValues }).notNull(),
    requestedCreatorId: text("requested_creator_id").references(() => creator.id, { onDelete: "set null" }),
    requestedFeedId: text("requested_feed_id").references(() => feed.id, { onDelete: "set null" }),
    feedsRequestedCount: integer("feeds_requested_count").default(0).notNull(),
    feedsSkippedCount: integer("feeds_skipped_count").default(0).notNull(),
    feedsSucceededCount: integer("feeds_succeeded_count").default(0).notNull(),
    feedsFailedCount: integer("feeds_failed_count").default(0).notNull(),
    itemsDiscoveredCount: integer("items_discovered_count").default(0).notNull(),
    itemsCreatedCount: integer("items_created_count").default(0).notNull(),
    itemsUpdatedCount: integer("items_updated_count").default(0).notNull(),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).default(currentTimestampMs).notNull(),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
    errorSummaryJson: text("error_summary_json"),
  },
  (table) => [
    index("refresh_run_status_started_at_idx").on(table.status, table.startedAt),
    index("refresh_run_requested_creator_id_idx").on(table.requestedCreatorId),
    index("refresh_run_requested_feed_id_idx").on(table.requestedFeedId),
  ],
);

export const refreshFeedResult = sqliteTable(
  "refresh_feed_result",
  {
    id: text("id").primaryKey(),
    refreshRunId: text("refresh_run_id")
      .notNull()
      .references(() => refreshRun.id, { onDelete: "cascade" }),
    feedId: text("feed_id")
      .notNull()
      .references(() => feed.id, { onDelete: "cascade" }),
    status: text("status", { enum: refreshStatusValues }).notNull(),
    itemsDiscoveredCount: integer("items_discovered_count").default(0).notNull(),
    itemsCreatedCount: integer("items_created_count").default(0).notNull(),
    itemsUpdatedCount: integer("items_updated_count").default(0).notNull(),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).default(currentTimestampMs).notNull(),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
    errorSummaryJson: text("error_summary_json"),
  },
  (table) => [
    uniqueIndex("refresh_feed_result_run_feed_uidx").on(table.refreshRunId, table.feedId),
    index("refresh_feed_result_feed_id_idx").on(table.feedId),
  ],
);

export const creatorRelations = relations(creator, ({ many }) => ({
  feeds: many(feed),
  contentItems: many(contentItem),
  refreshRuns: many(refreshRun),
}));

export const feedRelations = relations(feed, ({ many, one }) => ({
  creator: one(creator, {
    fields: [feed.creatorId],
    references: [creator.id],
  }),
  feedContents: many(feedContent),
  refreshRuns: many(refreshRun),
  refreshFeedResults: many(refreshFeedResult),
}));

export const contentItemRelations = relations(contentItem, ({ many, one }) => ({
  creator: one(creator, {
    fields: [contentItem.creatorId],
    references: [creator.id],
  }),
  sources: many(contentSource),
  feedContents: many(feedContent),
}));

export const contentSourceRelations = relations(contentSource, ({ one }) => ({
  contentItem: one(contentItem, {
    fields: [contentSource.contentItemId],
    references: [contentItem.id],
  }),
}));

export const feedContentRelations = relations(feedContent, ({ one }) => ({
  feed: one(feed, {
    fields: [feedContent.feedId],
    references: [feed.id],
  }),
  contentItem: one(contentItem, {
    fields: [feedContent.contentItemId],
    references: [contentItem.id],
  }),
}));

export const refreshRunRelations = relations(refreshRun, ({ many, one }) => ({
  requestedCreator: one(creator, {
    fields: [refreshRun.requestedCreatorId],
    references: [creator.id],
  }),
  requestedFeed: one(feed, {
    fields: [refreshRun.requestedFeedId],
    references: [feed.id],
  }),
  feedResults: many(refreshFeedResult),
}));

export const refreshFeedResultRelations = relations(refreshFeedResult, ({ one }) => ({
  refreshRun: one(refreshRun, {
    fields: [refreshFeedResult.refreshRunId],
    references: [refreshRun.id],
  }),
  feed: one(feed, {
    fields: [refreshFeedResult.feedId],
    references: [feed.id],
  }),
}));
