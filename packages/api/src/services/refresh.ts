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
  listRefreshFeedResultsForRun,
  listRunningRefreshRuns,
  recordRefreshFeedResult,
  type RepositoryDb,
  updateFeedRefreshMetadata,
  updateRefreshRunProgress,
} from "../repositories/catalog";
import type { SourceAdapterError } from "../sources";
import type { SourceAdapterRegistry } from "../sources/registry";
import { persistNormalizedCatalog } from "./ingestion";
import { delayBetweenFeedFetchesMs, nextRefreshDate } from "./refresh-policy";

export interface RefreshServiceDependencies {
  readonly db: RepositoryDb;
  readonly sourceRegistry: SourceAdapterRegistry;
  readonly now: () => Date;
  readonly wait?: (milliseconds: number) => Promise<void>;
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

export interface RefreshStartResult extends RefreshServiceResult {
  readonly process: () => Promise<RefreshServiceResult>;
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
  const prepared = await prepareRefreshRun(dependencies, {
    scope: "all",
    force: input.force ?? false,
    requestedCreatorId: null,
    requestedFeedId: null,
    feeds,
  });
  return processPreparedRefreshRun(dependencies, prepared);
}

export async function startRefreshAll(
  dependencies: RefreshServiceDependencies,
  input: RefreshAllInput = {},
): Promise<RefreshStartResult> {
  const feeds = await listCatalogFeeds(dependencies.db);
  const prepared = await prepareRefreshRun(dependencies, {
    scope: "all",
    force: input.force ?? false,
    requestedCreatorId: null,
    requestedFeedId: null,
    feeds,
  });
  return {
    run: prepared.run,
    report: buildRefreshReport(prepared.run, [], prepared.selectedFeeds, prepared.skippedFeeds),
    feedResults: [],
    selectedFeeds: prepared.selectedFeeds,
    skippedFeeds: prepared.skippedFeeds,
    process: () => processPreparedRefreshRun(dependencies, prepared),
  };
}

export async function recoverRunningRefreshRuns(dependencies: RefreshServiceDependencies): Promise<readonly RefreshRun[]> {
  const runningRuns = await listRunningRefreshRuns(dependencies.db, { limit: 25 });
  for (const run of runningRuns) {
    scheduleRecoveredRefreshRun(dependencies, run);
  }
  return runningRuns;
}

function scheduleRecoveredRefreshRun(dependencies: RefreshServiceDependencies, run: RefreshRun): void {
  setTimeout(() => {
    resumeRefreshRun(dependencies, run).catch((error: unknown) => {
      console.error("Recovered refresh run failed.", error);
    });
  }, 0);
}

export async function resumeRefreshRun(
  dependencies: RefreshServiceDependencies,
  run: RefreshRun,
): Promise<RefreshServiceResult> {
  const feeds = await feedsForRefreshRun(dependencies, run);
  const completedResults = await listRefreshFeedResultsForRun(dependencies.db, { refreshRunId: run.id, limit: 100_000 });
  const completedFeedIds = new Set(completedResults.map((result) => result.feedId));
  const selection = selectFeedsForRefresh(feeds, run.force, run.startedAt);
  const selectedFeeds = selection.selected.filter((feed) => !completedFeedIds.has(feed.id));
  return processPreparedRefreshRun(dependencies, {
    run,
    force: run.force,
    selectedFeeds,
    reportFeeds: selection.selected,
    skippedFeeds: selection.skipped,
    existingFeedResults: completedResults,
  });
}

export async function refreshCreator(
  dependencies: RefreshServiceDependencies,
  input: RefreshCreatorInput,
): Promise<RefreshServiceResult> {
  const feeds = await listCatalogFeedsForCreator(dependencies.db, input.creatorId);
  const prepared = await prepareRefreshRun(dependencies, {
    scope: "creator",
    force: input.force ?? false,
    requestedCreatorId: input.creatorId,
    requestedFeedId: null,
    feeds,
  });
  return processPreparedRefreshRun(dependencies, prepared);
}

async function feedsForRefreshRun(dependencies: RefreshServiceDependencies, run: RefreshRun): Promise<readonly CatalogFeed[]> {
  if (run.scope === "creator") {
    return run.requestedCreatorId === null ? [] : listCatalogFeedsForCreator(dependencies.db, run.requestedCreatorId);
  }
  if (run.scope === "feed") {
    return run.requestedFeedId === null ? [] : listCatalogFeedById(dependencies.db, run.requestedFeedId);
  }
  return listCatalogFeeds(dependencies.db);
}

export async function refreshFeed(
  dependencies: RefreshServiceDependencies,
  input: RefreshFeedInput,
): Promise<RefreshServiceResult> {
  const feeds = await listCatalogFeedById(dependencies.db, input.feedId);
  const prepared = await prepareRefreshRun(dependencies, {
    scope: "feed",
    force: input.force ?? false,
    requestedCreatorId: null,
    requestedFeedId: input.feedId,
    feeds,
  });
  return processPreparedRefreshRun(dependencies, prepared);
}

interface RunRefreshInput {
  readonly scope: RefreshScope;
  readonly force: boolean;
  readonly requestedCreatorId: string | null;
  readonly requestedFeedId: string | null;
  readonly feeds: readonly CatalogFeed[];
}

interface PreparedRefreshRun {
  readonly run: RefreshRun;
  readonly force: boolean;
  readonly selectedFeeds: readonly CatalogFeed[];
  readonly reportFeeds?: readonly CatalogFeed[];
  readonly skippedFeeds: readonly SkippedFeed[];
  readonly existingFeedResults?: readonly RefreshFeedResult[];
}

async function prepareRefreshRun(
  dependencies: RefreshServiceDependencies,
  input: RunRefreshInput,
): Promise<PreparedRefreshRun> {
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

  return {
    run: runningRun,
    force: input.force,
    selectedFeeds,
    skippedFeeds: selection.skipped,
    existingFeedResults: [],
  };
}

async function processPreparedRefreshRun(
  dependencies: RefreshServiceDependencies,
  prepared: PreparedRefreshRun,
): Promise<RefreshServiceResult> {
  const outcomes: FeedRefreshOutcome[] = [];
  try {
    for (const [index, feed] of prepared.selectedFeeds.entries()) {
      outcomes.push(await refreshOneFeed(dependencies, prepared.run.id, feed, prepared.force));
      await updateRunningRefreshProgress(dependencies, prepared.run.id, prepared.existingFeedResults ?? [], outcomes);
      if (index < prepared.selectedFeeds.length - 1) {
        await waitBetweenFeeds(dependencies, feed, prepared.force);
      }
    }
  } catch (cause: unknown) {
    return completeCatastrophicRefreshFailure(dependencies, prepared, outcomes, cause);
  }

  const existingFeedResults = prepared.existingFeedResults ?? [];
  const successes = outcomes.filter((outcome) => outcome.ok);
  const failures = outcomes.filter((outcome) => !outcome.ok);
  const existingSuccesses = existingFeedResults.filter((result) => result.status === "succeeded");
  const existingFailures = existingFeedResults.filter((result) => result.status === "failed");
  const completedAt = dependencies.now();
  const status = statusForCounts(successes.length + existingSuccesses.length, failures.length + existingFailures.length);
  const failureSummaries = [...errorSummariesForResults(existingFailures), ...failures.map((failure) => failure.summary)];
  const errorSummaryJson = failureSummaries.length === 0 ? null : JSON.stringify(failureSummaries);
  const completedRun = await completeRefreshRun(dependencies.db, {
    id: prepared.run.id,
    status,
    feedsRequestedCount: prepared.run.feedsRequestedCount,
    feedsSkippedCount: prepared.run.feedsSkippedCount,
    feedsSucceededCount: successes.length + existingSuccesses.length,
    feedsFailedCount: failures.length + existingFailures.length,
    itemsDiscoveredCount: sum(successes, (success) => success.discoveredCount) + sum(existingFeedResults, (result) => result.itemsDiscoveredCount),
    itemsCreatedCount: sum(successes, (success) => success.createdCount) + sum(existingFeedResults, (result) => result.itemsCreatedCount),
    itemsUpdatedCount: sum(successes, (success) => success.updatedCount) + sum(existingFeedResults, (result) => result.itemsUpdatedCount),
    completedAt,
    errorSummaryJson,
  });
  const feedResults = [...existingFeedResults, ...outcomes.map((outcome) => outcome.result)];
  const reportFeeds = prepared.reportFeeds ?? prepared.selectedFeeds;

  return {
    run: completedRun,
    report: buildRefreshReport(completedRun, feedResults, reportFeeds, prepared.skippedFeeds),
    feedResults,
    selectedFeeds: prepared.selectedFeeds,
    skippedFeeds: prepared.skippedFeeds,
  };
}

async function updateRunningRefreshProgress(
  dependencies: RefreshServiceDependencies,
  refreshRunId: string,
  existingFeedResults: readonly RefreshFeedResult[],
  outcomes: readonly FeedRefreshOutcome[],
): Promise<void> {
  const successes = outcomes.filter((outcome) => outcome.ok);
  const failures = outcomes.filter((outcome) => !outcome.ok);
  const existingSuccesses = existingFeedResults.filter((result) => result.status === "succeeded");
  const existingFailures = existingFeedResults.filter((result) => result.status === "failed");
  await updateRefreshRunProgress(dependencies.db, {
    id: refreshRunId,
    feedsSucceededCount: successes.length + existingSuccesses.length,
    feedsFailedCount: failures.length + existingFailures.length,
    itemsDiscoveredCount: sum(successes, (success) => success.discoveredCount) + sum(existingFeedResults, (result) => result.itemsDiscoveredCount),
    itemsCreatedCount: sum(successes, (success) => success.createdCount) + sum(existingFeedResults, (result) => result.itemsCreatedCount),
    itemsUpdatedCount: sum(successes, (success) => success.updatedCount) + sum(existingFeedResults, (result) => result.itemsUpdatedCount),
    errorSummaryJson: failures.length === 0 ? null : JSON.stringify(failures.map((failure) => failure.summary)),
  });
}

async function completeCatastrophicRefreshFailure(
  dependencies: RefreshServiceDependencies,
  prepared: PreparedRefreshRun,
  outcomes: readonly FeedRefreshOutcome[],
  cause: unknown,
): Promise<RefreshServiceResult> {
  const existingFeedResults = prepared.existingFeedResults ?? [];
  const successes = outcomes.filter((outcome) => outcome.ok);
  const failures = outcomes.filter((outcome) => !outcome.ok);
  const existingSuccesses = existingFeedResults.filter((result) => result.status === "succeeded");
  const existingFailures = existingFeedResults.filter((result) => result.status === "failed");
  const completedAt = dependencies.now();
  const errorSummary = {
    feedId: prepared.run.requestedFeedId ?? "refresh-run",
    code: "catalog-persistence-failed",
    message: cause instanceof Error ? cause.message : "Refresh run failed before all selected feeds were processed.",
  } satisfies RefreshFeedErrorSummary;
  const completedRun = await completeRefreshRun(dependencies.db, {
    id: prepared.run.id,
    status: successes.length === 0 ? "failed" : "partial",
    feedsRequestedCount: prepared.run.feedsRequestedCount,
    feedsSkippedCount: prepared.run.feedsSkippedCount,
    feedsSucceededCount: successes.length + existingSuccesses.length,
    feedsFailedCount: failures.length + existingFailures.length + 1,
    itemsDiscoveredCount: sum(successes, (success) => success.discoveredCount) + sum(existingFeedResults, (result) => result.itemsDiscoveredCount),
    itemsCreatedCount: sum(successes, (success) => success.createdCount) + sum(existingFeedResults, (result) => result.itemsCreatedCount),
    itemsUpdatedCount: sum(successes, (success) => success.updatedCount) + sum(existingFeedResults, (result) => result.itemsUpdatedCount),
    completedAt,
    errorSummaryJson: JSON.stringify([
      ...errorSummariesForResults(existingFailures),
      ...failures.map((failure) => failure.summary),
      errorSummary,
    ]),
  });
  const feedResults = [...existingFeedResults, ...outcomes.map((outcome) => outcome.result)];
  const reportFeeds = prepared.reportFeeds ?? prepared.selectedFeeds;
  return {
    run: completedRun,
    report: buildRefreshReport(completedRun, feedResults, reportFeeds, prepared.skippedFeeds),
    feedResults,
    selectedFeeds: prepared.selectedFeeds,
    skippedFeeds: prepared.skippedFeeds,
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
    const nextRefreshAfter = nextRefreshDate(completedAt, feed.sourceType, feed.id, feed.refreshCadenceSeconds);
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

async function waitBetweenFeeds(dependencies: RefreshServiceDependencies, feed: CatalogFeed, force: boolean): Promise<void> {
  const delayMs = delayBetweenFeedFetchesMs(feed.sourceType, force);
  if (delayMs <= 0) {
    return;
  }
  await (dependencies.wait ?? sleep)(delayMs);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
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

function errorSummariesForResults(results: readonly RefreshFeedResult[]): readonly RefreshFeedErrorSummary[] {
  return results.flatMap((result) => {
    const error = parseRefreshError(result.errorSummaryJson);
    return error === null ? [] : [error];
  });
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
