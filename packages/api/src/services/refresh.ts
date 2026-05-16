import type {
  CatalogFeed,
  RefreshFeedErrorSummary,
  RefreshFeedReport,
  RefreshFeedResult,
  RefreshFeedSkipReason,
  RefreshRun,
  RefreshRunReport,
  RefreshScope,
  RefreshStatus,
} from "../domain/catalog";
import {
  completeRefreshRun,
  createRefreshRun,
  listCatalogFeedById,
  listCatalogFeeds,
  listCatalogFeedsForCreator,
  recordRefreshFeedResult,
  type RepositoryDb,
  updateFeedRefreshMetadata,
} from "../repositories/catalog";
import type { SourceAdapterError } from "../sources";
import type { SourceAdapterRegistry } from "../sources/registry";
import { persistNormalizedCatalog } from "./ingestion";

export interface RefreshServiceDependencies {
  readonly db: RepositoryDb;
  readonly sourceRegistry: SourceAdapterRegistry;
  readonly now: () => Date;
}

export interface RefreshAllInput {
  readonly force?: boolean;
}

export interface RefreshCreatorInput {
  readonly creatorId: string;
  readonly force?: boolean;
}

export interface RefreshFeedInput {
  readonly feedId: string;
  readonly force?: boolean;
}

export interface RefreshServiceResult {
  readonly run: RefreshRun;
  readonly report: RefreshRunReport;
  readonly feedResults: readonly RefreshFeedResult[];
  readonly selectedFeeds: readonly CatalogFeed[];
  readonly skippedFeeds: readonly SkippedFeed[];
}

export interface SkippedFeed {
  readonly feed: CatalogFeed;
  readonly reason: RefreshFeedSkipReason;
}

interface FeedRefreshSuccess {
  readonly ok: true;
  readonly result: RefreshFeedResult;
  readonly discoveredCount: number;
  readonly createdCount: number;
  readonly updatedCount: number;
}

interface FeedRefreshFailure {
  readonly ok: false;
  readonly result: RefreshFeedResult;
  readonly summary: RefreshFeedErrorSummary;
}

type FeedRefreshOutcome = FeedRefreshSuccess | FeedRefreshFailure;

export async function refreshAll(
  dependencies: RefreshServiceDependencies,
  input: RefreshAllInput = {},
): Promise<RefreshServiceResult> {
  const feeds = await listCatalogFeeds(dependencies.db);
  return runRefresh(dependencies, {
    scope: "all",
    force: input.force ?? false,
    requestedCreatorId: null,
    requestedFeedId: null,
    feeds,
  });
}

export async function refreshCreator(
  dependencies: RefreshServiceDependencies,
  input: RefreshCreatorInput,
): Promise<RefreshServiceResult> {
  const feeds = await listCatalogFeedsForCreator(dependencies.db, input.creatorId);
  return runRefresh(dependencies, {
    scope: "creator",
    force: input.force ?? false,
    requestedCreatorId: input.creatorId,
    requestedFeedId: null,
    feeds,
  });
}

export async function refreshFeed(
  dependencies: RefreshServiceDependencies,
  input: RefreshFeedInput,
): Promise<RefreshServiceResult> {
  const feeds = await listCatalogFeedById(dependencies.db, input.feedId);
  return runRefresh(dependencies, {
    scope: "feed",
    force: input.force ?? false,
    requestedCreatorId: null,
    requestedFeedId: input.feedId,
    feeds,
  });
}

interface RunRefreshInput {
  readonly scope: RefreshScope;
  readonly force: boolean;
  readonly requestedCreatorId: string | null;
  readonly requestedFeedId: string | null;
  readonly feeds: readonly CatalogFeed[];
}

async function runRefresh(
  dependencies: RefreshServiceDependencies,
  input: RunRefreshInput,
): Promise<RefreshServiceResult> {
  const startedAt = dependencies.now();
  const selection = selectFeedsForRefresh(input.feeds, input.force, startedAt);
  const selectedFeeds = selection.selected;
  const runningRun = await createRefreshRun(dependencies.db, {
    scope: input.scope,
    force: input.force,
    status: "running",
    requestedCreatorId: input.requestedCreatorId,
    requestedFeedId: input.requestedFeedId,
    feedsRequestedCount: selectedFeeds.length,
    feedsSkippedCount: selection.skipped.length,
    startedAt,
  });

  const outcomes: FeedRefreshOutcome[] = [];
  for (const feed of selectedFeeds) {
    outcomes.push(await refreshOneFeed(dependencies, runningRun.id, feed, input.force));
  }

  const successes = outcomes.filter((outcome) => outcome.ok);
  const failures = outcomes.filter((outcome) => !outcome.ok);
  const completedAt = dependencies.now();
  const status = statusForCounts(successes.length, failures.length);
  const errorSummaryJson = failures.length === 0 ? null : JSON.stringify(failures.map((failure) => failure.summary));
  const completedRun = await completeRefreshRun(dependencies.db, {
    id: runningRun.id,
    status,
    feedsRequestedCount: selectedFeeds.length,
    feedsSkippedCount: selection.skipped.length,
    feedsSucceededCount: successes.length,
    feedsFailedCount: failures.length,
    itemsDiscoveredCount: sum(successes, (success) => success.discoveredCount),
    itemsCreatedCount: sum(successes, (success) => success.createdCount),
    itemsUpdatedCount: sum(successes, (success) => success.updatedCount),
    completedAt,
    errorSummaryJson,
  });
  const feedResults = outcomes.map((outcome) => outcome.result);

  return {
    run: completedRun,
    report: buildRefreshReport(completedRun, feedResults, selectedFeeds, selection.skipped),
    feedResults,
    selectedFeeds,
    skippedFeeds: selection.skipped,
  };
}

interface RefreshFeedSelection {
  readonly selected: readonly CatalogFeed[];
  readonly skipped: readonly SkippedFeed[];
}

function selectFeedsForRefresh(
  feeds: readonly CatalogFeed[],
  force: boolean,
  now: Date,
): RefreshFeedSelection {
  if (force) {
    return { selected: feeds, skipped: [] };
  }

  const selected: CatalogFeed[] = [];
  const skipped: SkippedFeed[] = [];

  for (const feed of feeds) {
    if (feed.refreshCadenceSeconds === null) {
      skipped.push({ feed, reason: "cadence-disabled" });
    } else if (isDueForNormalRefresh(feed, now)) {
      selected.push(feed);
    } else {
      skipped.push({ feed, reason: "not-due" });
    }
  }

  return { selected, skipped };
}

function isDueForNormalRefresh(feed: CatalogFeed, now: Date): boolean {
  return feed.nextRefreshAfter === null || feed.nextRefreshAfter.getTime() <= now.getTime();
}

async function refreshOneFeed(
  dependencies: RefreshServiceDependencies,
  refreshRunId: string,
  feed: CatalogFeed,
  force: boolean,
): Promise<FeedRefreshOutcome> {
  const startedAt = dependencies.now();
  const adapter = dependencies.sourceRegistry.getAdapter(feed.sourceType);
  if (adapter === null) {
    return recordFailure(dependencies, refreshRunId, feed.id, startedAt, {
      feedId: feed.id,
      code: "adapter-not-registered",
      message: "Feed source type does not have a registered adapter.",
    });
  }

  const fetched = await adapter.fetchCatalog({
    sourceType: feed.sourceType,
    sourceExternalId: feed.sourceExternalId,
    canonicalUrl: feed.url,
    title: feed.title,
  });

  if (!fetched.ok) {
    return recordFailure(dependencies, refreshRunId, feed.id, startedAt, fromAdapterError(feed.id, fetched.error));
  }

  try {
    const persisted = await persistNormalizedCatalog(dependencies.db, fetched.value, undefined);
    const completedAt = dependencies.now();
    const discoveredCount = fetched.value.items.length;
    const nextRefreshAfter = nextRefreshDate(completedAt, feed.refreshCadenceSeconds);
    if (!force) {
      await updateFeedRefreshMetadata(dependencies.db, {
        feedId: feed.id,
        refreshedAt: completedAt,
        nextRefreshAfter,
      });
    }
    const result = await recordRefreshFeedResult(dependencies.db, {
      refreshRunId,
      feedId: feed.id,
      status: "succeeded",
      itemsDiscoveredCount: discoveredCount,
      itemsCreatedCount: persisted.created.contentItems,
      itemsUpdatedCount: 0,
      startedAt,
      completedAt,
    });
    return { ok: true, result, discoveredCount, createdCount: persisted.created.contentItems, updatedCount: 0 };
  } catch (cause: unknown) {
    return recordFailure(dependencies, refreshRunId, feed.id, startedAt, {
      feedId: feed.id,
      code: "catalog-persistence-failed",
      message: cause instanceof Error ? cause.message : "Refresh catalog payload could not be persisted.",
    });
  }
}

async function recordFailure(
  dependencies: RefreshServiceDependencies,
  refreshRunId: string,
  feedId: string,
  startedAt: Date,
    summary: RefreshFeedErrorSummary,
): Promise<FeedRefreshFailure> {
  const completedAt = dependencies.now();
  const result = await recordRefreshFeedResult(dependencies.db, {
    refreshRunId,
    feedId,
    status: "failed",
    startedAt,
    completedAt,
    errorSummaryJson: JSON.stringify(summary),
  });
  return { ok: false, result, summary };
}

function fromAdapterError(feedId: string, error: SourceAdapterError): RefreshFeedErrorSummary {
  return {
    feedId,
    code: error.code,
    message: error.message,
  };
}

function nextRefreshDate(refreshedAt: Date, refreshCadenceSeconds: number | null): Date | null {
  if (refreshCadenceSeconds === null) {
    return null;
  }
  return new Date(refreshedAt.getTime() + refreshCadenceSeconds * 1000);
}

function statusForCounts(successCount: number, failureCount: number): RefreshStatus {
  if (failureCount === 0) {
    return "succeeded";
  }
  return successCount === 0 ? "failed" : "partial";
}

function buildRefreshReport(
  run: RefreshRun,
  feedResults: readonly RefreshFeedResult[],
  selectedFeeds: readonly CatalogFeed[],
  skippedFeeds: readonly SkippedFeed[],
): RefreshRunReport {
  const feedById = new Map(selectedFeeds.map((feed) => [feed.id, feed]));

  return {
    runId: run.id,
    scope: run.scope,
    force: run.force,
    status: run.status,
    selectedFeedCount: run.feedsRequestedCount,
    skippedFeedCount: run.feedsSkippedCount,
    feedsSucceededCount: run.feedsSucceededCount,
    feedsFailedCount: run.feedsFailedCount,
    itemsDiscoveredCount: run.itemsDiscoveredCount,
    itemsCreatedCount: run.itemsCreatedCount,
    itemsUpdatedCount: run.itemsUpdatedCount,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    feeds: [
      ...feedResults.map((feedResult) => {
        const feed = feedById.get(feedResult.feedId);
        if (feed === undefined) {
          throw new Error("Refresh feed result references an unknown selected feed.");
        }
        return toCompletedFeedReport(feedResult, feed);
      }),
      ...skippedFeeds.map((skippedFeed): RefreshFeedReport => ({
        feedId: skippedFeed.feed.id,
        feedTitle: skippedFeed.feed.title,
        feedUrl: skippedFeed.feed.url,
        sourceType: skippedFeed.feed.sourceType,
        status: "skipped",
        skipReason: skippedFeed.reason,
        itemsDiscoveredCount: 0,
        itemsCreatedCount: 0,
        itemsUpdatedCount: 0,
        error: null,
        startedAt: null,
        completedAt: null,
      })),
    ],
  };
}

function toCompletedFeedReport(result: RefreshFeedResult, feed: CatalogFeed): RefreshFeedReport {
  return {
    feedId: result.feedId,
    feedTitle: feed.title,
    feedUrl: feed.url,
    sourceType: feed.sourceType,
    status: result.status,
    skipReason: null,
    itemsDiscoveredCount: result.itemsDiscoveredCount,
    itemsCreatedCount: result.itemsCreatedCount,
    itemsUpdatedCount: result.itemsUpdatedCount,
    error: parseRefreshError(result.errorSummaryJson),
    startedAt: result.startedAt,
    completedAt: result.completedAt,
  };
}

function parseRefreshError(errorSummaryJson: string | null): RefreshFeedErrorSummary | null {
  if (errorSummaryJson === null) {
    return null;
  }

  const parsed: unknown = JSON.parse(errorSummaryJson);
  if (!isRefreshFeedErrorSummary(parsed)) {
    throw new Error("Stored refresh feed error summary is not valid.");
  }
  return parsed;
}

function isRefreshFeedErrorSummary(value: unknown): value is RefreshFeedErrorSummary {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.feedId === "string" &&
    typeof candidate.code === "string" &&
    typeof candidate.message === "string"
  );
}

function sum<TItem>(items: readonly TItem[], select: (item: TItem) => number): number {
  return items.reduce((total, item) => total + select(item), 0);
}
