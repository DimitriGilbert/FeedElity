import { lt } from "drizzle-orm";

import * as schema from "@FeedElity/db/schema";

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
  SourceType,
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
  readonly random?: () => number;
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

interface ProviderPause {
  readonly sourceType: SourceType;
  readonly until: Date;
  readonly reason: RefreshFeedErrorSummary;
}

const providerRefusalPauseMs = 15 * 60 * 1000;

/** Refresh feed results older than this are pruned once a run terminates (D8). */
const refreshFeedResultRetentionMs = 30 * 24 * 60 * 60 * 1000;

export interface PruneRefreshFeedResultsInput {
  /** Rows whose started_at is older than `now - olderThanMs` are deleted. */
  readonly olderThanMs: number;
  /** Clock for the cutoff computation; callers pass their run timestamp. */
  readonly now: Date;
}

export interface PruneRefreshFeedResultsResult {
  readonly deletedCount: number;
}

/**
 * Delete refresh feed results that aged out of the retention window with a
 * single DELETE on started_at (epoch-ms timestamp column). `olderThanMs` must
 * be a finite, non-negative number of milliseconds — a negative value would
 * delete fresh results and a non-finite value would build an invalid cutoff —
 * so invalid input throws before any rows are touched. DB errors propagate
 * to the caller, which decides how to degrade (see
 * pruneAfterTerminalRefreshState).
 */
export async function pruneRefreshFeedResultsForRetention(
  db: RepositoryDb,
  input: PruneRefreshFeedResultsInput,
): Promise<PruneRefreshFeedResultsResult> {
  if (!Number.isFinite(input.olderThanMs) || input.olderThanMs < 0) {
    throw new Error(
      `Refresh feed result retention prune requires a finite, non-negative olderThanMs (received ${String(input.olderThanMs)}).`,
    );
  }

  const cutoff = new Date(input.now.getTime() - input.olderThanMs);
  const deleted = await db
    .delete(schema.refreshFeedResult)
    .where(lt(schema.refreshFeedResult.startedAt, cutoff))
    .returning({ id: schema.refreshFeedResult.id });
  return { deletedCount: deleted.length };
}

/**
 * D8 retention hook, invoked after a run reaches ANY terminal state (normal
 * completion, catastrophic failure, and recovered runs all funnel through
 * processPreparedRefreshRun). A prune failure must not fail the
 * already-completed run report, so errors are caught and reported via
 * console.error with context and the run result is still returned — a
 * handled, logged degradation, never a silent swallow; the over-age rows stay
 * until the next terminal run prunes again.
 */
async function pruneAfterTerminalRefreshState(dependencies: RefreshServiceDependencies): Promise<void> {
  try {
    await pruneRefreshFeedResultsForRetention(dependencies.db, {
      olderThanMs: refreshFeedResultRetentionMs,
      now: dependencies.now(),
    });
  } catch (cause: unknown) {
    console.error("Refresh feed result retention prune failed after terminal run state; over-age rows are kept.", cause);
  }
}

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
  const existingFeedResults = await listRefreshFeedResultsForRun(dependencies.db, { refreshRunId: run.id, limit: 100_000 });
  const completedFeedIds = new Set(existingFeedResults.map((result) => result.feedId));
  const selection = selectFeedsForRefresh(feeds, run.force, run.startedAt);
  const completedFeeds = feeds.filter((feed) => completedFeedIds.has(feed.id));
  const selectedFeeds = selection.selected.filter((feed) => !completedFeedIds.has(feed.id));
  const skippedFeeds = selection.skipped.filter((skippedFeed) => !completedFeedIds.has(skippedFeed.feed.id));
  return processPreparedRefreshRun(dependencies, {
    run,
    force: run.force,
    selectedFeeds,
    reportFeeds: [...selection.selected, ...completedFeeds],
    skippedFeeds,
    existingFeedResults,
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
  const deferredFeeds: SkippedFeed[] = [];
  const providerPauses = new Map<SourceType, ProviderPause>();
  try {
    for (const [index, feed] of prepared.selectedFeeds.entries()) {
      const providerPause = activeProviderPause(providerPauses.get(feed.sourceType), dependencies.now());
      if (providerPause === null) {
        outcomes.push(await refreshOneFeed(dependencies, prepared.run.id, feed, prepared.force, providerPauses));
      } else {
        deferredFeeds.push({ feed, reason: "provider-paused" });
      }
      await updateRunningRefreshProgress(dependencies, prepared.run.id, prepared.existingFeedResults ?? [], outcomes);
      if (index < prepared.selectedFeeds.length - 1) {
        await waitBetweenFeeds(dependencies, prepared.selectedFeeds, index);
      }
    }
  } catch (cause: unknown) {
    const result = await completeCatastrophicRefreshFailure(dependencies, prepared, outcomes, deferredFeeds, cause);
    await pruneAfterTerminalRefreshState(dependencies);
    return result;
  }

  const existingFeedResults = prepared.existingFeedResults ?? [];
  const successes = outcomes.filter((outcome) => outcome.ok);
  const failures = outcomes.filter((outcome) => !outcome.ok);
  const existingSuccesses = existingFeedResults.filter((result) => result.status === "succeeded");
  const existingFailures = existingFeedResults.filter((result) => result.status === "failed");
  const completedAt = dependencies.now();
  const status = statusForCounts(successes.length + existingSuccesses.length, failures.length + existingFailures.length);
  const providerPauseSummaries = uniqueProviderPauseSummaries(providerPauses);
  const failureSummaries = [
    ...errorSummariesForResults(existingFailures),
    ...failures.map((failure) => failure.summary),
    ...providerPauseSummaries,
  ];
  const errorSummaryJson = failureSummaries.length === 0 ? null : JSON.stringify(failureSummaries);
  const completedRun = await completeRefreshRun(dependencies.db, {
    id: prepared.run.id,
    status,
    feedsRequestedCount: prepared.run.feedsRequestedCount,
    feedsSkippedCount: prepared.run.feedsSkippedCount + deferredFeeds.length,
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
  const skippedFeeds = [...prepared.skippedFeeds, ...deferredFeeds];

  await pruneAfterTerminalRefreshState(dependencies);

  return {
    run: completedRun,
    report: buildRefreshReport(completedRun, feedResults, reportFeeds, skippedFeeds),
    feedResults,
    selectedFeeds: prepared.selectedFeeds,
    skippedFeeds,
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
  deferredFeeds: readonly SkippedFeed[],
  cause: unknown,
): Promise<RefreshServiceResult> {
  const existingFeedResults = prepared.existingFeedResults ?? [];
  const successes = outcomes.filter((outcome) => outcome.ok);
  const failures = outcomes.filter((outcome) => !outcome.ok);
  const existingSuccesses = existingFeedResults.filter((result) => result.status === "succeeded");
  const existingFailures = existingFeedResults.filter((result) => result.status === "failed");
  const completedAt = dependencies.now();
  const feedsSucceededCount = successes.length + existingSuccesses.length;
  const feedsFailedCount = failures.length + existingFailures.length + 1;
  const errorSummary = {
    feedId: prepared.run.requestedFeedId ?? "refresh-run",
    code: "catalog-persistence-failed",
    message: cause instanceof Error ? cause.message : "Refresh run failed before all selected feeds were processed.",
  } satisfies RefreshFeedErrorSummary;
  const completedRun = await completeRefreshRun(dependencies.db, {
    id: prepared.run.id,
    status: statusForCounts(feedsSucceededCount, feedsFailedCount),
    feedsRequestedCount: prepared.run.feedsRequestedCount,
    feedsSkippedCount: prepared.run.feedsSkippedCount + deferredFeeds.length,
    feedsSucceededCount,
    feedsFailedCount,
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
  const skippedFeeds = [...prepared.skippedFeeds, ...deferredFeeds];
  return {
    run: completedRun,
    report: buildRefreshReport(completedRun, feedResults, reportFeeds, skippedFeeds),
    feedResults,
    selectedFeeds: prepared.selectedFeeds,
    skippedFeeds,
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
  providerPauses: Map<SourceType, ProviderPause>,
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
    let summary = fromAdapterError(feed.id, fetched.error);
    const refusalStatus = providerRefusalStatus(fetched.error);
    if (refusalStatus !== null) {
      summary = providerRefusalSummary(feed, fetched.error, refusalStatus);
      providerPauses.set(feed.sourceType, {
        sourceType: feed.sourceType,
        until: new Date(startedAt.getTime() + providerRefusalPauseMs),
        reason: summary,
      });
    }
    return recordFailure(dependencies, refreshRunId, feed.id, startedAt, summary);
  }

  try {
    const persisted = await persistNormalizedCatalog(dependencies.db, fetched.value, undefined);
    const completedAt = dependencies.now();
    const discoveredCount = fetched.value.items.length;
    const nextRefreshAfter = nextRefreshDate(completedAt, feed.sourceType, feed.refreshCadenceSeconds, dependencies.random ?? Math.random);
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

async function waitBetweenFeeds(dependencies: RefreshServiceDependencies, selectedFeeds: readonly CatalogFeed[], completedFeedIndex: number): Promise<void> {
  if (lastTwoCompletedFeedsUseDifferentProviders(selectedFeeds, completedFeedIndex)) {
    return;
  }

  const delayMs = delayBetweenFeedFetchesMs(dependencies.random ?? Math.random);
  if (delayMs <= 0) {
    return;
  }
  await (dependencies.wait ?? sleep)(delayMs);
}

function lastTwoCompletedFeedsUseDifferentProviders(selectedFeeds: readonly CatalogFeed[], completedFeedIndex: number): boolean {
  if (completedFeedIndex < 1) {
    return false;
  }

  const previousFeed = selectedFeeds[completedFeedIndex - 1];
  const currentFeed = selectedFeeds[completedFeedIndex];
  return previousFeed !== undefined && currentFeed !== undefined && previousFeed.sourceType !== currentFeed.sourceType;
}

function activeProviderPause(pause: ProviderPause | undefined, now: Date): ProviderPause | null {
  if (pause === undefined || pause.until.getTime() <= now.getTime()) {
    return null;
  }
  return pause;
}

function providerRefusalStatus(error: SourceAdapterError): number | null {
  const status = error.httpStatus ?? statusFromMessage(error.message);
  if (status === null) {
    return null;
  }
  return status === 429 || status >= 500 ? status : null;
}

function statusFromMessage(message: string): number | null {
  const match = /status\s+(\d{3})/i.exec(message);
  if (match === null) {
    return null;
  }
  const parsed = Number.parseInt(match[1] ?? "", 10);
  return Number.isInteger(parsed) ? parsed : null;
}

function providerRefusalSummary(feed: CatalogFeed, error: SourceAdapterError, status: number): RefreshFeedErrorSummary {
  const feedName = feed.title ?? feed.url;
  return {
    feedId: feed.id,
    code: "provider-refresh-paused",
    message: `${sourceLabel(feed.sourceType)} returned HTTP ${status} (${httpStatusReason(status)}) for "${feedName}" (${feed.url}). The adapter error was: ${error.message}. Further ${sourceLabel(feed.sourceType)} feeds were skipped for this run; retry later.`,
  };
}

function httpStatusReason(status: number): string {
  return httpStatusReasons[status] ?? "error";
}

const httpStatusReasons: Readonly<Record<number, string>> = {
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  408: "Request Timeout",
  429: "Too Many Requests",
  500: "Internal Server Error",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
};

function uniqueProviderPauseSummaries(providerPauses: ReadonlyMap<SourceType, ProviderPause>): readonly RefreshFeedErrorSummary[] {
  return [...providerPauses.values()].map((pause) => pause.reason);
}

function sourceLabel(sourceType: SourceType): string {
  if (sourceType === "youtube") {
    return "YouTube";
  }
  if (sourceType === "odysee") {
    return "Odysee";
  }
  return "PeerTube";
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
