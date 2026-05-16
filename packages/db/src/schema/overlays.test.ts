import { describe, expect, test } from "bun:test";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";

import {
  contentStatus,
  migrationMapping,
  migrationRun,
  playlist,
  playlistItem,
  subscription,
  userSetting,
} from "./overlays";

const userOwnedOverlayTables = [subscription, contentStatus, playlist, playlistItem, userSetting];

function columnNames(table: SQLiteTable): string[] {
  return getTableConfig(table).columns.map((column) => column.name);
}

function uniqueIndexColumnsByName(table: SQLiteTable, indexName: string): string[] {
  const indexConfig = getTableConfig(table).indexes.find((tableIndex) => tableIndex.config.name === indexName);

  expect(indexConfig).toBeDefined();
  expect(indexConfig?.config.unique).toBe(true);

  return indexConfig?.config.columns.map((column) => ("name" in column ? column.name : "sql_expression")) ?? [];
}

function indexColumnsByName(table: SQLiteTable, indexName: string): string[] {
  const indexConfig = getTableConfig(table).indexes.find((tableIndex) => tableIndex.config.name === indexName);

  expect(indexConfig).toBeDefined();

  return indexConfig?.config.columns.map((column) => ("name" in column ? column.name : "sql_expression")) ?? [];
}

function foreignKeyColumnsByName(
  table: SQLiteTable,
  foreignKeyName: string,
): { columns: string[]; foreignColumns: string[]; onDelete: string | undefined } {
  const foreignKeyConfig = getTableConfig(table).foreignKeys.find((tableForeignKey) => {
    return tableForeignKey.getName() === foreignKeyName;
  });

  expect(foreignKeyConfig).toBeDefined();

  const reference = foreignKeyConfig?.reference();

  return {
    columns: reference?.columns.map((column) => column.name) ?? [],
    foreignColumns: reference?.foreignColumns.map((column) => column.name) ?? [],
    onDelete: foreignKeyConfig?.onDelete,
  };
}

describe("user overlay and migration schema", () => {
  test("user-owned overlay tables carry explicit user ownership", () => {
    for (const table of userOwnedOverlayTables) {
      expect(columnNames(table)).toContain("user_id");
    }
  });

  test("subscriptions are unique per user and creator", () => {
    expect(uniqueIndexColumnsByName(subscription, "subscription_user_creator_uidx")).toEqual(["user_id", "creator_id"]);
  });

  test("content statuses are unique per user, content item, and status", () => {
    expect(uniqueIndexColumnsByName(contentStatus, "content_status_user_item_status_uidx")).toEqual([
      "user_id",
      "content_item_id",
      "status",
    ]);
  });

  test("playlist items enforce stable ordering and idempotent content membership", () => {
    expect(uniqueIndexColumnsByName(playlistItem, "playlist_item_playlist_position_uidx")).toEqual([
      "playlist_id",
      "position",
    ]);
    expect(uniqueIndexColumnsByName(playlistItem, "playlist_item_playlist_content_uidx")).toEqual([
      "playlist_id",
      "content_item_id",
    ]);
  });

  test("playlist items enforce owner consistency with their parent playlist", () => {
    expect(uniqueIndexColumnsByName(playlist, "playlist_id_user_uidx")).toEqual(["id", "user_id"]);
    expect(foreignKeyColumnsByName(playlistItem, "playlist_item_playlist_owner_fk")).toEqual({
      columns: ["playlist_id", "user_id"],
      foreignColumns: ["id", "user_id"],
      onDelete: "cascade",
    });
  });

  test("user settings are idempotent by setting key", () => {
    expect(uniqueIndexColumnsByName(userSetting, "user_setting_user_key_uidx")).toEqual(["user_id", "key"]);
  });

  test("migration runs and mappings declare idempotency constraints", () => {
    expect(uniqueIndexColumnsByName(migrationRun, "migration_run_source_fingerprint_uidx")).toEqual([
      "source_export_fingerprint",
    ]);
    expect(uniqueIndexColumnsByName(migrationMapping, "migration_mapping_run_old_entity_uidx")).toEqual([
      "migration_run_id",
      "old_entity_type",
      "old_entity_id",
    ]);
    expect(uniqueIndexColumnsByName(migrationMapping, "migration_mapping_run_new_entity_uidx")).toEqual([
      "migration_run_id",
      "new_entity_type",
      "new_entity_id",
    ]);
  });

  test("playlists are indexed by owner and list position", () => {
    expect(indexColumnsByName(playlist, "playlist_user_position_idx")).toEqual(["user_id", "position"]);
  });
});
