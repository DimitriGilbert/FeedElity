import type { CatalogFeed, SourceType } from "../domain/catalog";
import { listCatalogFeeds, updateCreatorMetadata, type RepositoryDb } from "../repositories/catalog";
import type { CreatorMetadata, FetchCreatorMetadataInput } from "../sources/types";
import type { SourceAdapterRegistry } from "../sources/registry";

export interface CreatorMetadataServiceDependencies {
  readonly db: RepositoryDb;
  readonly sourceRegistry: SourceAdapterRegistry;
  readonly now: () => Date;
}

export type CreatorMetadataRefreshRunStatus = "running" | "succeeded" | "failed" | "partial";

export interface CreatorMetadataFeedFailure {
  readonly feedId: string;
  readonly sourceType: SourceType;
  readonly code: string;
  readonly message: string;
}

export interface CreatorMetadataRefreshStatus {
  readonly id: string;
  readonly status: CreatorMetadataRefreshRunStatus;
  readonly startedAt: Date;
  readonly completedAt: Date | null;
  readonly feedsTotal: number;
  readonly feedsProcessed: number;
  readonly feedsSkippedCount: number;
  readonly creatorsUpdatedCount: number;
  readonly creatorsUnchangedCount: number;
  readonly feedsFailedCount: number;
  readonly failures: readonly CreatorMetadataFeedFailure[];
}

interface CreatorMetadataRunState {
  id: string;
  status: CreatorMetadataRefreshRunStatus;
  startedAt: Date;
  completedAt: Date | null;
  feedsTotal: number;
  feedsProcessed: number;
  feedsSkippedCount: number;
  creatorsUpdatedCount: number;
  creatorsUnchangedCount: number;
  feedsFailedCount: number;
  failures: CreatorMetadataFeedFailure[];
}

export interface StartCreatorMetadataRefreshResult {
  readonly started: boolean;
  readonly status: CreatorMetadataRefreshStatus;
}

let activeRun: CreatorMetadataRunState | null = null;
let lastCompletedRun: CreatorMetadataRunState | null = null;

export function getCreatorMetadataRefreshStatus(): CreatorMetadataRefreshStatus | null {
  const state = activeRun ?? lastCompletedRun;
  return state === null ? null : snapshot(state);
}

/**
 * Start a background creator-metadata refresh over the whole catalog. A second
 * invocation while a run is still active does not start a parallel job; it
 * returns the active run's status with `started: false`.
 */
export function startCreatorMetadataRefresh(
  dependencies: CreatorMetadataServiceDependencies,
): StartCreatorMetadataRefreshResult {
  if (activeRun !== null) {
    return { started: false, status: snapshot(activeRun) };
  }

  const state = createRunState(dependencies.now());
  activeRun = state;
  setTimeout(() => {
    executeCreatorMetadataRefresh(dependencies, state)
      .catch((error: unknown) => {
        console.error("Background creator metadata refresh failed.", error);
        state.status = "failed";
        state.completedAt = dependencies.now();
      })
      .finally(() => {
        if (activeRun === state) {
          activeRun = null;
        }
        lastCompletedRun = state;
      });
  }, 0);
  return { started: true, status: snapshot(state) };
}

/**
 * Run the creator-metadata refresh synchronously (awaitable) and return its
 * final status. Used by tests and by callers that want to await completion.
 */
export async function refreshCreatorMetadata(
  dependencies: CreatorMetadataServiceDependencies,
): Promise<CreatorMetadataRefreshStatus> {
  const state = createRunState(dependencies.now());
  try {
    return await executeCreatorMetadataRefresh(dependencies, state);
  } finally {
    if (activeRun === null) {
      lastCompletedRun = state;
    }
  }
}

async function executeCreatorMetadataRefresh(
  dependencies: CreatorMetadataServiceDependencies,
  state: CreatorMetadataRunState,
): Promise<CreatorMetadataRefreshStatus> {
  const feeds = await listCatalogFeeds(dependencies.db);
  state.feedsTotal = feeds.length;

  const metadataByCreator = new Map<string, AppliedCreatorMetadata>();
  for (const feed of feeds) {
    await refreshMetadataForFeed(dependencies, state, metadataByCreator, feed);
  }

  for (const [creatorId, metadata] of metadataByCreator) {
    const result = await updateCreatorMetadata(dependencies.db, {
      creatorId,
      imageUrl: metadata.imageUrl,
      description: metadata.description,
      canonicalUrl: metadata.canonicalUrl,
    });
    if (result.changed) {
      state.creatorsUpdatedCount += 1;
    } else {
      state.creatorsUnchangedCount += 1;
    }
  }

  state.completedAt = dependencies.now();
  state.status = state.feedsFailedCount === 0 ? "succeeded" : "partial";
  return snapshot(state);
}

/**
 * Fetch metadata for one feed and merge it into the per-creator accumulator
 * (first feed to supply a field wins, so later feeds cannot clobber an
 * already-determined value). Feed refresh-cadence metadata is never touched:
 * this job only reads feed rows and writes creator presentation columns.
 */
async function refreshMetadataForFeed(
  dependencies: CreatorMetadataServiceDependencies,
  state: CreatorMetadataRunState,
  metadataByCreator: Map<string, AppliedCreatorMetadata>,
  feed: CatalogFeed,
): Promise<void> {
  const adapter = dependencies.sourceRegistry.getAdapter(feed.sourceType);
  if (adapter === null) {
    state.feedsProcessed += 1;
    state.feedsFailedCount += 1;
    state.failures.push({
      feedId: feed.id,
      sourceType: feed.sourceType,
      code: "adapter-not-registered",
      message: "Feed source type does not have a registered adapter.",
    });
    return;
  }
  if (adapter.fetchCreatorMetadata === undefined) {
    state.feedsSkippedCount += 1;
    return;
  }

  try {
    const input: FetchCreatorMetadataInput & { readonly sourceType: SourceType } = {
      sourceType: feed.sourceType,
      sourceExternalId: feed.sourceExternalId,
      feedUrl: feed.url,
    };
    const fetched = await adapter.fetchCreatorMetadata(input);
    state.feedsProcessed += 1;
    if (!fetched.ok) {
      state.feedsFailedCount += 1;
      state.failures.push({
        feedId: feed.id,
        sourceType: feed.sourceType,
        code: fetched.error.code,
        message: fetched.error.message,
      });
      return;
    }
    mergeCreatorMetadata(metadataByCreator, feed.creatorId, fetched.value);
  } catch (cause: unknown) {
    state.feedsProcessed += 1;
    state.feedsFailedCount += 1;
    state.failures.push({
      feedId: feed.id,
      sourceType: feed.sourceType,
      code: "metadata-fetch-failed",
      message: cause instanceof Error ? cause.message : "Creator metadata fetch threw an unexpected error.",
    });
  }
}

interface AppliedCreatorMetadata {
  imageUrl?: string;
  description?: string;
  canonicalUrl?: string;
}

function mergeCreatorMetadata(
  metadataByCreator: Map<string, AppliedCreatorMetadata>,
  creatorId: string,
  metadata: CreatorMetadata,
): void {
  const existing = metadataByCreator.get(creatorId);
  metadataByCreator.set(creatorId, {
    imageUrl: existing?.imageUrl ?? metadata.imageUrl,
    description: existing?.description ?? metadata.description,
    canonicalUrl: existing?.canonicalUrl ?? metadata.canonicalUrl,
  });
}

function createRunState(startedAt: Date): CreatorMetadataRunState {
  return {
    id: crypto.randomUUID(),
    status: "running",
    startedAt,
    completedAt: null,
    feedsTotal: 0,
    feedsProcessed: 0,
    feedsSkippedCount: 0,
    creatorsUpdatedCount: 0,
    creatorsUnchangedCount: 0,
    feedsFailedCount: 0,
    failures: [],
  };
}

function snapshot(state: CreatorMetadataRunState): CreatorMetadataRefreshStatus {
  return {
    id: state.id,
    status: state.status,
    startedAt: state.startedAt,
    completedAt: state.completedAt,
    feedsTotal: state.feedsTotal,
    feedsProcessed: state.feedsProcessed,
    feedsSkippedCount: state.feedsSkippedCount,
    creatorsUpdatedCount: state.creatorsUpdatedCount,
    creatorsUnchangedCount: state.creatorsUnchangedCount,
    feedsFailedCount: state.feedsFailedCount,
    failures: [...state.failures],
  };
}
