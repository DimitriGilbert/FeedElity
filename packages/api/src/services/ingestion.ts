import type {
  CatalogContentItem,
  CatalogContentSource,
  CatalogCreator,
  CatalogFeed,
  FeedContentLink,
} from "../domain/catalog";
import {
  findContentItemBySourceIdentity,
  findContentSourceByCanonicalUrl,
  findCreatorBySourceIdentity,
  findFeedBySourceIdentity,
  findOrCreateContentItem,
  findOrCreateContentSource,
  findOrCreateCreator,
  findOrCreateFeed,
  linkFeedContent,
  type RepositoryDb,
} from "../repositories/catalog";
import { findOrCreateSubscription } from "../repositories/overlays";
import type { UserSubscription } from "../domain/overlays";
import type { SourceAdapterError, SourceAdapterErrorCode } from "../sources";
import type { SourceAdapterRegistry } from "../sources/registry";
import type { NormalizedCatalogPayload } from "../sources/types";
import { effectiveRefreshCadenceSeconds } from "./refresh-policy";

export interface IngestionServiceDependencies {
  readonly db: RepositoryDb;
  readonly sourceRegistry: SourceAdapterRegistry;
}

export interface AddSourceInput {
  readonly sourceInput: string;
  readonly userId?: string;
}

export type AddSourceResult = AddSourceSuccess | AddSourceFailure;

export interface AddSourceSuccess {
  readonly ok: true;
  readonly value: AddSourceValue;
}

export interface AddSourceValue {
  readonly creator: CatalogCreator;
  readonly feeds: readonly CatalogFeed[];
  readonly contentItems: readonly CatalogContentItem[];
  readonly contentSources: readonly CatalogContentSource[];
  readonly feedContents: readonly FeedContentLink[];
  readonly subscription: UserSubscription | null;
  readonly created: IngestionCreatedCounts;
}

export interface IngestionCreatedCounts {
  readonly creators: number;
  readonly feeds: number;
  readonly contentItems: number;
  readonly contentSources: number;
}

export interface AddSourceFailure {
  readonly ok: false;
  readonly error: IngestionError;
}

export type IngestionErrorCode = SourceAdapterErrorCode | "adapter-not-registered" | "catalog-persistence-failed";

export interface IngestionError {
  readonly code: IngestionErrorCode;
  readonly message: string;
  readonly input: string;
  readonly cause?: unknown;
}

export interface BatchAddSourceInput {
  readonly sourceInputs: readonly string[];
  readonly userId?: string;
}

export interface BatchAddSourceResult {
  readonly results: readonly BatchAddSourceItemResult[];
  readonly successesCount: number;
  readonly failuresCount: number;
}

export type BatchAddSourceItemResult = BatchAddSourceItemSuccess | BatchAddSourceItemFailure;

export interface BatchAddSourceItemSuccess {
  readonly ok: true;
  readonly sourceInput: string;
  readonly value: AddSourceValue;
}

export interface BatchAddSourceItemFailure {
  readonly ok: false;
  readonly sourceInput: string;
  readonly error: IngestionError;
}

export async function addSource(
  dependencies: IngestionServiceDependencies,
  input: AddSourceInput,
): Promise<AddSourceResult> {
  const detection = dependencies.sourceRegistry.detectSourceInput(input.sourceInput);
  if (!detection.ok) {
    return { ok: false, error: fromAdapterError(input.sourceInput, detection.error) };
  }

  const adapter = dependencies.sourceRegistry.getAdapter(detection.value.sourceType);
  if (adapter === null) {
    return {
      ok: false,
      error: {
        code: "adapter-not-registered",
        message: "Detected source type does not have a registered adapter.",
        input: input.sourceInput,
      },
    };
  }

  const resolved = await adapter.resolveInput(detection.value);
  if (!resolved.ok) {
    return { ok: false, error: fromAdapterError(input.sourceInput, resolved.error) };
  }

  const payload = await adapter.fetchCatalog(resolved.value);
  if (!payload.ok) {
    return { ok: false, error: fromAdapterError(input.sourceInput, payload.error) };
  }

  try {
    const value = await persistNormalizedCatalog(dependencies.db, payload.value, input.userId);
    return { ok: true, value };
  } catch (cause: unknown) {
    return {
      ok: false,
      error: {
        code: "catalog-persistence-failed",
        message: "Source catalog payload could not be persisted.",
        input: input.sourceInput,
        cause,
      },
    };
  }
}

export async function batchAddSources(
  dependencies: IngestionServiceDependencies,
  input: BatchAddSourceInput,
): Promise<BatchAddSourceResult> {
  const results: BatchAddSourceItemResult[] = [];

  for (const sourceInput of input.sourceInputs) {
    const result = await addSource(dependencies, { sourceInput, userId: input.userId });
    if (result.ok) {
      results.push({ ok: true, sourceInput, value: result.value });
    } else {
      results.push({ ok: false, sourceInput, error: result.error });
    }
  }

  const successesCount = results.filter((result) => result.ok).length;
  return {
    results,
    successesCount,
    failuresCount: results.length - successesCount,
  };
}

export async function persistNormalizedCatalog(
  db: RepositoryDb,
  payload: NormalizedCatalogPayload,
  userId: string | undefined,
): Promise<AddSourceValue> {
  const existingCreator = await findCreatorBySourceIdentity(db, payload.creator);
  const creator = await findOrCreateCreator(db, payload.creator);
  const feeds: CatalogFeed[] = [];
  const contentItems: CatalogContentItem[] = [];
  const contentSources: CatalogContentSource[] = [];
  const feedContents: FeedContentLink[] = [];
  let createdFeeds = 0;
  let createdContentItems = 0;
  let createdContentSources = 0;

  for (const feedInput of payload.feeds) {
    const existingFeed = await findFeedBySourceIdentity(db, feedInput);
    const feed = await findOrCreateFeed(db, {
      ...feedInput,
      creatorId: creator.id,
      refreshCadenceSeconds: effectiveRefreshCadenceSeconds(feedInput.sourceType, feedInput.refreshCadenceSeconds),
    });
    feeds.push(feed);
    if (existingFeed === null) {
      createdFeeds += 1;
    }
  }

  for (const normalizedItem of payload.items) {
    const existingContentItem = await findContentItemBySourceIdentity(db, normalizedItem.contentItem);
    const contentItem = await findOrCreateContentItem(db, { ...normalizedItem.contentItem, creatorId: creator.id });
    contentItems.push(contentItem);
    if (existingContentItem === null) {
      createdContentItems += 1;
    }

    for (const sourceInput of normalizedItem.sources) {
      const existingContentSource = await findContentSourceByCanonicalUrl(
        db,
        sourceInput.sourceType,
        sourceInput.canonicalUrl,
      );
      const contentSource = await findOrCreateContentSource(db, { ...sourceInput, contentItemId: contentItem.id });
      contentSources.push(contentSource);
      if (existingContentSource === null) {
        createdContentSources += 1;
      }
    }

    for (const feed of feeds) {
      const feedContent = await linkFeedContent(db, {
        ...normalizedItem.feedContent,
        feedId: feed.id,
        contentItemId: contentItem.id,
      });
      feedContents.push(feedContent);
    }
  }

  const subscription = userId === undefined ? null : await findOrCreateSubscription(db, { userId, creatorId: creator.id });

  return {
    creator,
    feeds,
    contentItems,
    contentSources,
    feedContents,
    subscription,
    created: {
      creators: existingCreator === null ? 1 : 0,
      feeds: createdFeeds,
      contentItems: createdContentItems,
      contentSources: createdContentSources,
    },
  };
}

function fromAdapterError(input: string, error: SourceAdapterError): IngestionError {
  return {
    code: error.code,
    message: error.message,
    input: error.input ?? input,
    cause: error.cause,
  };
}
