import { relations, sql } from "drizzle-orm";
import { foreignKey, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { user } from "./auth";
import { contentItem, creator } from "./catalog";

export const contentStatusValues = ["opened", "played", "favorite"] as const;
export const playlistSortValues = ["manual", "published_at_desc", "published_at_asc", "added_at_desc", "added_at_asc"] as const;
export const migrationRunStatusValues = ["running", "succeeded", "failed", "partial"] as const;
export const migrationSeverityValues = ["info", "warning", "error"] as const;

const currentTimestampMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

export const subscription = sqliteTable(
  "subscription",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    creatorId: text("creator_id")
      .notNull()
      .references(() => creator.id, { onDelete: "cascade" }),
    titleOverride: text("title_override"),
    settingsJson: text("settings_json"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(currentTimestampMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(currentTimestampMs)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("subscription_user_creator_uidx").on(table.userId, table.creatorId),
    index("subscription_creator_id_idx").on(table.creatorId),
  ],
);

export const contentStatus = sqliteTable(
  "content_status",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    contentItemId: text("content_item_id")
      .notNull()
      .references(() => contentItem.id, { onDelete: "cascade" }),
    status: text("status", { enum: contentStatusValues }).notNull(),
    metadataJson: text("metadata_json"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(currentTimestampMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(currentTimestampMs)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("content_status_user_item_status_uidx").on(table.userId, table.contentItemId, table.status),
    index("content_status_content_item_id_idx").on(table.contentItemId),
    index("content_status_user_status_idx").on(table.userId, table.status),
  ],
);

export const playlist = sqliteTable(
  "playlist",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    sortMode: text("sort_mode", { enum: playlistSortValues }).default("manual").notNull(),
    position: integer("position").default(0).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(currentTimestampMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(currentTimestampMs)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("playlist_id_user_uidx").on(table.id, table.userId),
    index("playlist_user_position_idx").on(table.userId, table.position),
    index("playlist_user_name_idx").on(table.userId, table.name),
  ],
);

export const playlistItem = sqliteTable(
  "playlist_item",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    playlistId: text("playlist_id")
      .notNull()
      .references(() => playlist.id, { onDelete: "cascade" }),
    contentItemId: text("content_item_id")
      .notNull()
      .references(() => contentItem.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    addedAt: integer("added_at", { mode: "timestamp_ms" }).default(currentTimestampMs).notNull(),
  },
  (table) => [
    foreignKey({
      name: "playlist_item_playlist_owner_fk",
      columns: [table.playlistId, table.userId],
      foreignColumns: [playlist.id, playlist.userId],
    }).onDelete("cascade"),
    uniqueIndex("playlist_item_playlist_position_uidx").on(table.playlistId, table.position),
    uniqueIndex("playlist_item_playlist_content_uidx").on(table.playlistId, table.contentItemId),
    index("playlist_item_user_id_idx").on(table.userId),
    index("playlist_item_content_item_id_idx").on(table.contentItemId),
  ],
);

export const creatorCollection = sqliteTable(
  "creator_collection",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    position: integer("position").default(0).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(currentTimestampMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(currentTimestampMs)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("creator_collection_id_user_uidx").on(table.id, table.userId),
    index("creator_collection_user_position_idx").on(table.userId, table.position),
    index("creator_collection_user_name_idx").on(table.userId, table.name),
  ],
);

export const collectionMember = sqliteTable(
  "collection_member",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    collectionId: text("collection_id")
      .notNull()
      .references(() => creatorCollection.id, { onDelete: "cascade" }),
    creatorId: text("creator_id")
      .notNull()
      .references(() => creator.id, { onDelete: "cascade" }),
    addedAt: integer("added_at", { mode: "timestamp_ms" }).default(currentTimestampMs).notNull(),
  },
  (table) => [
    foreignKey({
      name: "collection_member_collection_owner_fk",
      columns: [table.collectionId, table.userId],
      foreignColumns: [creatorCollection.id, creatorCollection.userId],
    }).onDelete("cascade"),
    uniqueIndex("collection_member_collection_creator_uidx").on(table.collectionId, table.creatorId),
    index("collection_member_user_id_idx").on(table.userId),
    index("collection_member_creator_id_idx").on(table.creatorId),
  ],
);

export const userSetting = sqliteTable(
  "user_setting",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    valueJson: text("value_json").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(currentTimestampMs).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(currentTimestampMs)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [uniqueIndex("user_setting_user_key_uidx").on(table.userId, table.key)],
);

export const migrationRun = sqliteTable(
  "migration_run",
  {
    id: text("id").primaryKey(),
    sourceExportFingerprint: text("source_export_fingerprint").notNull(),
    sourceFilename: text("source_filename"),
    status: text("status", { enum: migrationRunStatusValues }).notNull(),
    startedAt: integer("started_at", { mode: "timestamp_ms" }).default(currentTimestampMs).notNull(),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
    usersImportedCount: integer("users_imported_count").default(0).notNull(),
    creatorsImportedCount: integer("creators_imported_count").default(0).notNull(),
    feedsImportedCount: integer("feeds_imported_count").default(0).notNull(),
    contentItemsImportedCount: integer("content_items_imported_count").default(0).notNull(),
    subscriptionsImportedCount: integer("subscriptions_imported_count").default(0).notNull(),
    playlistsImportedCount: integer("playlists_imported_count").default(0).notNull(),
    warningsJson: text("warnings_json"),
    failuresJson: text("failures_json"),
  },
  (table) => [
    uniqueIndex("migration_run_source_fingerprint_uidx").on(table.sourceExportFingerprint),
    index("migration_run_status_started_at_idx").on(table.status, table.startedAt),
  ],
);

export const migrationMapping = sqliteTable(
  "migration_mapping",
  {
    id: text("id").primaryKey(),
    migrationRunId: text("migration_run_id")
      .notNull()
      .references(() => migrationRun.id, { onDelete: "cascade" }),
    oldEntityType: text("old_entity_type").notNull(),
    oldEntityId: text("old_entity_id").notNull(),
    newEntityType: text("new_entity_type").notNull(),
    newEntityId: text("new_entity_id").notNull(),
    severity: text("severity", { enum: migrationSeverityValues }).default("info").notNull(),
    message: text("message"),
    metadataJson: text("metadata_json"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).default(currentTimestampMs).notNull(),
  },
  (table) => [
    uniqueIndex("migration_mapping_run_old_entity_uidx").on(
      table.migrationRunId,
      table.oldEntityType,
      table.oldEntityId,
    ),
    uniqueIndex("migration_mapping_run_new_entity_uidx").on(
      table.migrationRunId,
      table.newEntityType,
      table.newEntityId,
    ),
    index("migration_mapping_new_entity_idx").on(table.newEntityType, table.newEntityId),
  ],
);

export const subscriptionRelations = relations(subscription, ({ one }) => ({
  user: one(user, {
    fields: [subscription.userId],
    references: [user.id],
  }),
  creator: one(creator, {
    fields: [subscription.creatorId],
    references: [creator.id],
  }),
}));

export const contentStatusRelations = relations(contentStatus, ({ one }) => ({
  user: one(user, {
    fields: [contentStatus.userId],
    references: [user.id],
  }),
  contentItem: one(contentItem, {
    fields: [contentStatus.contentItemId],
    references: [contentItem.id],
  }),
}));

export const playlistRelations = relations(playlist, ({ many, one }) => ({
  user: one(user, {
    fields: [playlist.userId],
    references: [user.id],
  }),
  items: many(playlistItem),
}));

export const playlistItemRelations = relations(playlistItem, ({ one }) => ({
  user: one(user, {
    fields: [playlistItem.userId],
    references: [user.id],
  }),
  playlist: one(playlist, {
    fields: [playlistItem.playlistId],
    references: [playlist.id],
  }),
  contentItem: one(contentItem, {
    fields: [playlistItem.contentItemId],
    references: [contentItem.id],
  }),
}));

export const creatorCollectionRelations = relations(creatorCollection, ({ many, one }) => ({
  user: one(user, {
    fields: [creatorCollection.userId],
    references: [user.id],
  }),
  members: many(collectionMember),
}));

export const collectionMemberRelations = relations(collectionMember, ({ one }) => ({
  user: one(user, {
    fields: [collectionMember.userId],
    references: [user.id],
  }),
  collection: one(creatorCollection, {
    fields: [collectionMember.collectionId],
    references: [creatorCollection.id],
  }),
  creator: one(creator, {
    fields: [collectionMember.creatorId],
    references: [creator.id],
  }),
}));

export const userSettingRelations = relations(userSetting, ({ one }) => ({
  user: one(user, {
    fields: [userSetting.userId],
    references: [user.id],
  }),
}));

export const migrationRunRelations = relations(migrationRun, ({ many }) => ({
  mappings: many(migrationMapping),
}));

export const migrationMappingRelations = relations(migrationMapping, ({ one }) => ({
  migrationRun: one(migrationRun, {
    fields: [migrationMapping.migrationRunId],
    references: [migrationRun.id],
  }),
}));
