import { describe, expect, test } from "bun:test";
import { getTableConfig, SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";

import {
  contentItem,
  contentSource,
  creator,
  feed,
  feedContent,
  refreshFeedResult,
  refreshRun,
  sourceTypeValues,
} from "./catalog";

const globalCatalogTables = [
  creator,
  feed,
  contentItem,
  contentSource,
  feedContent,
  refreshRun,
  refreshFeedResult,
];

function columnNames(table: SQLiteTable): string[] {
  return getTableConfig(table).columns.map((column) => column.name);
}

function indexColumnsByName(table: SQLiteTable, indexName: string): string[] {
  const indexConfig = getTableConfig(table).indexes.find((tableIndex) => tableIndex.config.name === indexName);

  expect(indexConfig).toBeDefined();

  return indexConfig?.config.columns.map((column) => ("name" in column ? column.name : "sql_expression")) ?? [];
}

/** Rendered index column expressions; DESC order lives in SQL-expression columns. */
function indexColumnExpressions(table: SQLiteTable, indexName: string): string[] {
  const indexConfig = getTableConfig(table).indexes.find((tableIndex) => tableIndex.config.name === indexName);

  expect(indexConfig).toBeDefined();

  const dialect = new SQLiteSyncDialect();
  return (
    indexConfig?.config.columns.map((column) => ("name" in column ? column.name : dialect.sqlToQuery(column).sql)) ?? []
  );
}

describe("global catalog schema", () => {
  test("catalog tables are not user-owned overlays", () => {
    const userOwnershipColumnNames = new Set(["user_id", "userId"]);

    for (const table of globalCatalogTables) {
      const tableColumnNames = columnNames(table);

      expect(tableColumnNames.some((columnName) => userOwnershipColumnNames.has(columnName))).toBe(false);
    }
  });

  test("source type values cover launch adapters", () => {
    expect(sourceTypeValues).toEqual(["youtube", "odysee", "peertube"]);
  });

  test("creators are keyed cross-source by normalized name; feeds and content items keep source identity", () => {
    expect(indexColumnsByName(creator, "creator_name_key_uidx")).toEqual(["name_key"]);
    expect(indexColumnsByName(feed, "feed_source_identity_uidx")).toEqual(["source_type", "source_external_id"]);
    expect(indexColumnsByName(contentItem, "content_item_source_identity_uidx")).toEqual([
      "source_type",
      "source_external_id",
    ]);
  });

  test("content_item declares the composite newest-first list-order index", () => {
    // DESC ordering is declared through SQL-expression columns, so the rendered
    // expression text (the DDL db:push generates) is the contract.
    expect(indexColumnExpressions(contentItem, "content_item_published_created_id_idx")).toEqual([
      '"content_item"."published_at" desc',
      '"content_item"."created_at" desc',
      '"content_item"."id" desc',
    ]);
  });

  test("playable content sources and feed associations declare idempotency constraints", () => {
    expect(indexColumnsByName(contentSource, "content_source_canonical_uidx")).toEqual([
      "source_type",
      "canonical_url",
    ]);
    expect(indexColumnsByName(contentSource, "content_source_item_priority_uidx")).toEqual([
      "content_item_id",
      "priority",
    ]);
    expect(indexColumnsByName(feedContent, "feed_content_source_identity_uidx")).toEqual([
      "feed_id",
      "source_external_id",
    ]);
  });

  test("refresh feed results are unique per refresh run and feed", () => {
    expect(indexColumnsByName(refreshFeedResult, "refresh_feed_result_run_feed_uidx")).toEqual([
      "refresh_run_id",
      "feed_id",
    ]);
  });
});
