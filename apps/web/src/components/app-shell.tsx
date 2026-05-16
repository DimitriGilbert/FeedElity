import type {
  CatalogContentDetail,
  CatalogContentListItem,
  CatalogContentSource,
  CatalogCreator,
  CatalogFeed,
  Playlist,
  SourceType,
  UserContentStatus,
  UserSetting,
  UserSubscriptionWithCreator,
} from "@FeedElity/api";
import { For, Match, Show, Switch, createMemo, createResource, createSignal, untrack } from "solid-js";

import { authClient } from "@/lib/auth-client";
import { client } from "@/utils/orpc";

import {
  ContentListItemRow,
  CreatorSourceRow,
  FeedRow,
  type ContentStatusFlags,
} from "./app-shell-rows";
import {
  AddSourceSection,
  PlaylistColumnSection,
  RefreshStatusSection,
  SettingsColumnSection,
  SubscriptionActionButton,
} from "./app-shell-source-sections";
import {
  contentCatalogFiltersLabel,
  contentColumnClass,
  contentHeaderRegionClass,
  contentHidePlayedInputId,
  contentLibraryFiltersLabel,
  contentListLimit,
  contentScrollRegionClass,
  contentSearchInputId,
  contentSourceFilterId,
  contentViewModeAllId,
  contentViewModeFavoritesId,
  contentViewModeHistoryId,
  contentViewModePlayedId,
  contentViewModeSubscribedId,
  creatorListLimit,
  creatorSearchInputId,
  creatorSourceFilterId,
  feedListLimit,
  formatSourceLabel,
  mergeUniqueContentItemsForDisplay,
  shellGridClass,
  shellRootClass,
  showsCatalogFilters,
  sourceActionsRegionClass,
  sourceCatalogRegionClass,
  sourceColumnClass,
  sourceCreatorListRegionClass,
  sourceFeedListRegionClass,
  sourceHeaderRegionClass,
  toContentListInput,
  toFeedListInput,
  toCreatorListInput,
  toReaderDensityFromSettings,
  toPlayableSources,
  viewerColumnClass,
  viewerScrollRegionClass,
  type ContentViewMode,
  type CreatorListInput,
  type ContentListInput,
  type FeedListInput,
  type PlayableSource,
  type ReaderDensity,
  type ShellMode,
} from "./app-shell.contract";

export {
  contentCatalogFiltersLabel,
  addSourceHelpId,
  addSourceInputId,
  contentColumnClass,
  contentHeaderRegionClass,
  contentHidePlayedInputId,
  contentListLimit,
  feedListLimit,
  contentScrollRegionClass,
  contentSearchInputId,
  contentSourceFilterId,
  contentViewModeAllId,
  contentViewModeFavoritesId,
  contentViewModeHistoryId,
  contentViewModePlayedId,
  contentViewModeSubscribedId,
  creatorListLimit,
  creatorSearchInputId,
  creatorSourceFilterId,
  desktopShellGridClass,
  formatRefreshReportSummary,
  formatRefreshRunSummary,
  formatSettingValue,
  getShellColumnCount,
  hasInternalAppHeader,
  playlistDescriptionInputId,
  playlistNameInputId,
  playlistSortInputId,
  readerDensityInputId,
  readerDensitySettingKey,
  readerDensityValues,
  refreshStatusRegionId,
  settingKeyInputId,
  settingKeyPattern,
  settingValueInputId,
  shellColumns,
  shellGridClass,
  shellPaneIds,
  shellRootClass,
  showsCatalogFilters,
  sourceActionsRegionClass,
  sourceCatalogRegionClass,
  sourceColumnClass,
  sourceCreatorListRegionClass,
  sourceFeedListRegionClass,
  sourceHeaderRegionClass,
  toContentListInput,
  toFeedListInput,
  toCreatorListInput,
  toReaderDensityFromSettings,
  toRefreshStatusResourceKey,
  toPlayableSources,
  toSafePlaybackUrl,
  toShellContentSelectionState,
  toShellSelectionState,
  viewerColumnClass,
  viewerScrollRegionClass,
  type ContentViewMode,
  type PlayableSource,
  type ReaderDensity,
  type ShellMode,
  type ShellColumnDefinition,
  type ShellContentSelectionState,
  type ShellSelectionState,
} from "./app-shell.contract";

const allContentSourceFilterValue = "all";

const allCreatorSourceFilterValue = "all";

const sourceFilterOptions: readonly SourceType[] = ["youtube", "odysee", "peertube"];

type ContentItemsResourceMode = "catalog" | "subscribed" | "favorites" | "history-opened" | "played";

type SubscriptionAction = "subscribe" | "unsubscribe";

type BrowsableCreator = CatalogCreator | UserSubscriptionWithCreator["creator"];

const emptyCatalogContentItems: readonly CatalogContentListItem[] = [];

const emptyCatalogContentSources: readonly CatalogContentSource[] = [];

const emptyCatalogFeeds: readonly CatalogFeed[] = [];

const emptyBrowsableCreators: readonly BrowsableCreator[] = [];

const emptyPlaylists: readonly Playlist[] = [];

const emptySubscriptions: readonly UserSubscriptionWithCreator[] = [];

const emptyUserContentStatuses: readonly UserContentStatus[] = [];

const emptyUserSettings: readonly UserSetting[] = [];

interface AppendedPageState<TItem> {
  readonly key: string;
  readonly items: readonly TItem[];
  readonly hasMore: boolean;
}

function emptyAppendedPageState<TItem>(): AppendedPageState<TItem> {
  return { key: "", items: [], hasMore: false };
}

function pageItemsForKey<TItem>(state: AppendedPageState<TItem>, key: string): readonly TItem[] {
  return state.key === key ? state.items : [];
}

function pageHasMoreForKey<TItem>(state: AppendedPageState<TItem>, key: string, firstPageLength: number, pageSize: number): boolean {
  return state.key === key ? state.hasMore : firstPageLength === pageSize;
}

function formatError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "Catalog request failed.";
}

function formatPublishedAt(publishedAt: Date | null): string {
  if (publishedAt === null) {
    return "Undated";
  }

  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(publishedAt);
}

function formatDuration(durationSeconds: number | null): string {
  if (durationSeconds === null) {
    return "Video";
  }

  const hours = Math.floor(durationSeconds / 3_600);
  const minutes = Math.floor((durationSeconds % 3_600) / 60);
  const seconds = durationSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function toSourceFilterValue(value: string): SourceType | null {
  return sourceFilterOptions.find((sourceType) => sourceType === value) ?? null;
}

function toCreatorListResourceKey(input: CreatorListInput): string {
  return [
    input.search ?? "",
    input.sourceType ?? "",
    input.limit.toString(),
    input.offset.toString(),
  ].join("\u001f");
}

function toFeedListResourceKey(input: FeedListInput | null): string | null {
  if (input === null) {
    return null;
  }

  return [
    input.creatorId ?? "",
    input.sourceType ?? "",
    input.limit.toString(),
    input.offset.toString(),
  ].join("\u001f");
}

function toContentItemsResourceKey(mode: ContentItemsResourceMode, input: ContentListInput, reloadKey: number): string {
  return [
    mode,
    reloadKey.toString(),
    input.search ?? "",
    input.creatorId ?? "",
    input.feedId ?? "",
    input.sourceType ?? "",
    input.limit.toString(),
    input.offset.toString(),
  ].join("\u001f");
}

function appendUniqueCreators(
  existingCreators: readonly BrowsableCreator[],
  nextCreators: readonly BrowsableCreator[],
): readonly BrowsableCreator[] {
  const creatorById = new Map(existingCreators.map((creator) => [creator.id, creator]));
  for (const creator of nextCreators) {
    creatorById.set(creator.id, creator);
  }

  return [...creatorById.values()];
}

function appendUniqueFeeds(existingFeeds: readonly CatalogFeed[], nextFeeds: readonly CatalogFeed[]): readonly CatalogFeed[] {
  const feedById = new Map(existingFeeds.map((feed) => [feed.id, feed]));
  for (const feed of nextFeeds) {
    feedById.set(feed.id, feed);
  }

  return [...feedById.values()];
}

function appendUniqueContentItems(
  existingContentItems: readonly CatalogContentListItem[],
  nextContentItems: readonly CatalogContentListItem[],
): readonly CatalogContentListItem[] {
  const contentItemById = new Map(existingContentItems.map((contentItem) => [contentItem.id, contentItem]));
  for (const contentItem of nextContentItems) {
    contentItemById.set(contentItem.id, contentItem);
  }

  return [...contentItemById.values()];
}

function toContentStatusFlags(statuses: readonly UserContentStatus[], contentItemId: string): ContentStatusFlags {
  let opened = false;
  let played = false;

  for (const status of statuses) {
    if (status.contentItemId !== contentItemId) {
      continue;
    }

    if (status.status === "opened") {
      opened = true;
    }
    if (status.status === "played") {
      played = true;
    }
  }

  return { opened, played };
}

async function listSubscribedLibraryContentItems(input: ContentListInput): Promise<readonly CatalogContentListItem[]> {
  return client.overlays.subscribedContentItems(input);
}

async function listOpenedHistoryContentItems(): Promise<readonly CatalogContentListItem[]> {
  const historyEntries = await client.overlays.contentHistory({ status: "opened" });

  return mergeUniqueContentItemsForDisplay(historyEntries.map((entry) => entry.content)).slice(0, contentListLimit);
}

async function listPlayedHistoryContentItems(): Promise<readonly CatalogContentListItem[]> {
  const historyEntries = await client.overlays.contentHistory({ status: "played" });

  return mergeUniqueContentItemsForDisplay(historyEntries.map((entry) => entry.content)).slice(0, contentListLimit);
}

function contentItemMatchesLocalFilters(contentItem: CatalogContentListItem, input: ContentListInput): boolean {
  if (input.creatorId !== undefined && contentItem.creatorId !== input.creatorId) {
    return false;
  }

  if (input.sourceType !== undefined && contentItem.sourceType !== input.sourceType) {
    return false;
  }

  if (input.search !== undefined) {
    const search = input.search.toLowerCase();
    return contentItem.title.toLowerCase().includes(search) || contentItem.creator.displayName.toLowerCase().includes(search);
  }

  return true;
}

interface CreatorSourceColumnProps {
  readonly isAuthenticated: () => boolean;
  readonly mode: ShellMode;
  readonly readerDensity: () => ReaderDensity;
  readonly settings: () => readonly UserSetting[];
  readonly settingsUnavailable: () => boolean;
  readonly selectedCreatorId: () => string | null;
  readonly selectedCreator: () => BrowsableCreator | null;
  readonly selectedFeed: () => CatalogFeed | null;
  readonly selectedPlaylistId: () => string | null;
  readonly playlistItemsReloadKey: () => number;
  readonly onCatalogChanged: () => void;
  readonly onSettingsChanged: () => Promise<void>;
  readonly onClearCreator: () => void;
  readonly onSelectCreator: (creator: BrowsableCreator) => void;
  readonly onSelectFeed: (feed: CatalogFeed | null) => void;
  readonly onSelectPlaylist: (playlistId: string | null) => void;
  readonly onSelectContent: (contentItem: CatalogContentListItem) => Promise<void>;
}

interface LoadMoreControlProps {
  readonly shownCount: number;
  readonly pageSize: number;
  readonly hasMore: boolean;
  readonly busy: boolean;
  readonly errorMessage: string | null;
  readonly label: string;
  readonly onLoadMore: () => Promise<void>;
}

function LoadMoreControl(props: LoadMoreControlProps) {
  return (
    <div class="mt-2 border border-border bg-background px-2 py-1.5" data-load-more-control>
      <div class="flex items-center justify-between gap-2">
        <span class="text-[0.68rem] text-muted-foreground" data-loaded-count>
          {props.shownCount} loaded
        </span>
        <Show when={props.hasMore}>
          <button
            type="button"
            class="border border-border bg-card px-2 py-1 text-[0.68rem] font-semibold text-card-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
            disabled={props.busy}
            onClick={async () => {
              await props.onLoadMore();
            }}
          >
            {props.busy ? "Loading" : props.label}
          </button>
        </Show>
      </div>
      <p class="mt-1 text-[0.62rem] text-muted-foreground">Pages load {props.pageSize} rows at a time.</p>
      <Show when={props.errorMessage}>
        {(message) => <p class="mt-1 text-[0.68rem] text-destructive">{message()}</p>}
      </Show>
    </div>
  );
}

function CreatorSourceColumn(props: CreatorSourceColumnProps) {
  const [search, setSearch] = createSignal("");
  const [sourceType, setSourceType] = createSignal<SourceType | null>(null);
  const [appendedCatalogCreatorPage, setAppendedCatalogCreatorPage] = createSignal<AppendedPageState<BrowsableCreator>>(emptyAppendedPageState());
  const [creatorPageBusy, setCreatorPageBusy] = createSignal(false);
  const [creatorPageError, setCreatorPageError] = createSignal<string | null>(null);
  const [appendedFeedPage, setAppendedFeedPage] = createSignal<AppendedPageState<CatalogFeed>>(emptyAppendedPageState());
  const [feedPageBusy, setFeedPageBusy] = createSignal(false);
  const [feedPageError, setFeedPageError] = createSignal<string | null>(null);
  const [libraryCreatorLimit, setLibraryCreatorLimit] = createSignal(creatorListLimit);
  const creatorListInput = createMemo(() => toCreatorListInput(search(), sourceType()));
  const creatorListResourceKey = createMemo(() => toCreatorListResourceKey(creatorListInput()));
  const [creators, { refetch: refetchCreators }] = createResource(
    creatorListResourceKey,
    () => client.catalog.creators(untrack(creatorListInput)),
  );
  const subscriptionsResourceInput = createMemo(() => {
    if (!props.isAuthenticated()) {
      return null;
    }

    return props.mode;
  });
  const [subscriptions, { refetch: refetchSubscriptions }] = createResource(subscriptionsResourceInput, () =>
    client.overlays.subscriptions(),
  );
  const feedListInput = createMemo(() => toFeedListInput(props.selectedCreatorId()));
  const feedListResourceKey = createMemo(() => toFeedListResourceKey(feedListInput()));
  const [feeds, { refetch: refetchFeeds }] = createResource(
    feedListResourceKey,
    () => {
      const input = untrack(feedListInput);
      return input === null ? emptyCatalogFeeds : client.catalog.feeds(input);
    },
  );
  const subscriptionCreatorIds = createMemo(() => new Set((subscriptions() ?? emptySubscriptions).map((subscription) => subscription.creator.id)));
  const listedCreators = createMemo<readonly BrowsableCreator[]>(() => {
    if (props.mode === "library") {
      const trimmedSearch = search().trim().toLowerCase();
      const subscribedCreators = (subscriptions() ?? emptySubscriptions).map((subscription) => subscription.creator);
      return subscribedCreators.filter((creator) => {
        const matchesSearch = trimmedSearch.length === 0 || creator.displayName.toLowerCase().includes(trimmedSearch);
        const matchesSourceType = sourceType() === null || creator.sourceType === sourceType();
        return matchesSearch && matchesSourceType;
      }).slice(0, libraryCreatorLimit());
    }

    return appendUniqueCreators(creators() ?? emptyBrowsableCreators, pageItemsForKey(appendedCatalogCreatorPage(), creatorListResourceKey()));
  });
  const creatorCount = createMemo(() => listedCreators().length);
  const catalogCreatorHasMore = createMemo(() =>
    pageHasMoreForKey(
      appendedCatalogCreatorPage(),
      creatorListResourceKey(),
      (creators() ?? emptyBrowsableCreators).length,
      creatorListLimit,
    ),
  );
  const libraryCreatorHasMore = createMemo(() => {
    if (props.mode !== "library") {
      return false;
    }

    const trimmedSearch = search().trim().toLowerCase();
    const matchingCreators = (subscriptions() ?? emptySubscriptions).filter((subscription) => {
      const creator = subscription.creator;
      const matchesSearch = trimmedSearch.length === 0 || creator.displayName.toLowerCase().includes(trimmedSearch);
      const matchesSourceType = sourceType() === null || creator.sourceType === sourceType();
      return matchesSearch && matchesSourceType;
    });

    return matchingCreators.length > libraryCreatorLimit();
  });

  const visibleFeeds = createMemo(() => appendUniqueFeeds(feeds() ?? emptyCatalogFeeds, pageItemsForKey(appendedFeedPage(), feedListResourceKey() ?? "")));
  const feedPageHasMore = createMemo(() => {
    const key = feedListResourceKey();
    if (key === null) {
      return false;
    }

    return pageHasMoreForKey(appendedFeedPage(), key, (feeds() ?? emptyCatalogFeeds).length, feedListLimit);
  });

  const loadMoreCreators = async () => {
    if (props.mode === "library") {
      setLibraryCreatorLimit((limit) => limit + creatorListLimit);
      return;
    }

    setCreatorPageBusy(true);
    setCreatorPageError(null);
    try {
      const key = creatorListResourceKey();
      const loadedCreators = listedCreators();
      const nextCreators = await client.catalog.creators({ ...creatorListInput(), offset: loadedCreators.length });
      setAppendedCatalogCreatorPage((currentPage) => ({
        key,
        items: appendUniqueCreators(pageItemsForKey(currentPage, key), nextCreators),
        hasMore: nextCreators.length === creatorListLimit,
      }));
    } catch (error) {
      setCreatorPageError(formatError(error));
    } finally {
      setCreatorPageBusy(false);
    }
  };

  const loadMoreFeeds = async () => {
    const input = feedListInput();
    if (input === null) {
      return;
    }

    setFeedPageBusy(true);
    setFeedPageError(null);
    try {
      const key = feedListResourceKey();
      if (key === null) {
        return;
      }

      const nextFeeds = await client.catalog.feeds({ ...input, offset: visibleFeeds().length });
      setAppendedFeedPage((currentPage) => ({
        key,
        items: appendUniqueFeeds(pageItemsForKey(currentPage, key), nextFeeds),
        hasMore: nextFeeds.length === feedListLimit,
      }));
    } catch (error) {
      setFeedPageError(formatError(error));
    } finally {
      setFeedPageBusy(false);
    }
  };

  const refreshSourcePaneResources = async () => {
    await refetchCreators();
    await refetchSubscriptions();
    if (props.selectedCreatorId() !== null) {
      await refetchFeeds();
    }
  };

  const updateSubscription = async (creatorId: string, action: SubscriptionAction) => {
    if (action === "subscribe") {
      await client.overlays.subscribeToCreator({ creatorId });
    } else {
      await client.overlays.unsubscribeFromCreator({ creatorId });
    }

    await refetchSubscriptions();
    if (props.mode === "library" && action === "unsubscribe" && props.selectedCreatorId() === creatorId) {
      props.onClearCreator();
    }
  };

  return (
    <section
      aria-labelledby="creator-source-title"
      class={sourceColumnClass}
      data-shell-column="creators"
    >
      <div class={sourceHeaderRegionClass} data-source-header-region>
        <div class="flex items-center justify-between gap-2">
          <h2 id="creator-source-title" class="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {props.mode === "library" ? "Library" : "Catalog"}
          </h2>
          <span class="text-[0.68rem] text-muted-foreground" data-creator-count>
            {creatorCount()} loaded
          </span>
        </div>
        <label class="sr-only" for={creatorSearchInputId}>
          Search creators
        </label>
        <input
          id={creatorSearchInputId}
          class="w-full border border-input bg-background px-2 py-1.5 text-xs text-foreground outline-none transition focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
          type="search"
          value={search()}
          placeholder="Search creators"
          autocomplete="off"
          onInput={(event) => {
            setSearch(event.currentTarget.value);
            setLibraryCreatorLimit(creatorListLimit);
          }}
        />
        <label class="sr-only" for={creatorSourceFilterId}>
          Filter creators by source type
        </label>
        <select
          id={creatorSourceFilterId}
          class="w-full border border-input bg-background px-2 py-1.5 text-xs text-foreground outline-none transition focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
          value={sourceType() ?? allCreatorSourceFilterValue}
          aria-label="Creator source-type filter"
          title="Filters creator rows by catalog source type. Select a creator to inspect all feeds."
          onChange={(event) => {
            setSourceType(toSourceFilterValue(event.currentTarget.value));
            setLibraryCreatorLimit(creatorListLimit);
          }}
        >
          <option value={allCreatorSourceFilterValue}>All creator sources</option>
          <For each={sourceFilterOptions}>
            {(source) => <option value={source}>{formatSourceLabel(source)}</option>}
          </For>
        </select>
      </div>
      <div class={sourceCatalogRegionClass} data-source-catalog-region>
        <div class={sourceCreatorListRegionClass} data-source-scroll-region>
          <Switch>
            <Match when={props.mode === "library" && subscriptions.loading}>
              <p class="text-xs font-semibold text-foreground">Loading Library</p>
              <p class="mt-2 text-[0.72rem] leading-5 text-muted-foreground">Loading your subscribed sources.</p>
            </Match>
            <Match when={props.mode === "catalog" && creators.loading}>
              <p class="text-xs font-semibold text-foreground">Loading sources</p>
              <p class="mt-2 text-[0.72rem] leading-5 text-muted-foreground">Loading the public catalog.</p>
            </Match>
            <Match when={props.mode === "library" && subscriptions.error !== undefined}>
              <p class="text-xs font-semibold text-destructive">Library unavailable</p>
              <p class="mt-2 text-[0.72rem] leading-5 text-muted-foreground">{formatError(subscriptions.error)}</p>
            </Match>
            <Match when={props.mode === "catalog" && creators.error !== undefined}>
              <p class="text-xs font-semibold text-destructive">Sources unavailable</p>
              <p class="mt-2 text-[0.72rem] leading-5 text-muted-foreground">{formatError(creators.error)}</p>
            </Match>
            <Match when={listedCreators().length === 0}>
              <p class="text-xs font-semibold text-foreground">No sources found</p>
              <p class="mt-2 text-[0.72rem] leading-5 text-muted-foreground">
                {props.mode === "library"
                  ? "Subscribed creators appear in your Library after you subscribe from the Catalog."
                  : search().trim().length === 0 && sourceType() === null
                  ? "The public catalog has no creators yet."
                  : "No creators match this search."}
              </p>
            </Match>
            <Match when={listedCreators()}>
              {(loadedCreators) => (
                <>
                <ol class="space-y-1" aria-label="Creator sources">
                  <For each={loadedCreators()}>
                    {(creator) => (
                      <li>
                        <CreatorSourceRow
                          creator={creator}
                          isAuthenticated={props.isAuthenticated()}
                          isSelected={props.selectedCreatorId() === creator.id}
                          isSubscribed={subscriptionCreatorIds().has(creator.id)}
                          showSubscriptionControl={props.mode === "catalog"}
                          readerDensity={props.readerDensity()}
                          onSelectCreator={props.onSelectCreator}
                          subscriptionControl={
                            <SubscriptionActionButton
                              creatorId={creator.id}
                              isSubscribed={subscriptionCreatorIds().has(creator.id)}
                              onUpdateSubscription={updateSubscription}
                            />
                          }
                        />
                      </li>
                    )}
                  </For>
                </ol>
                  <LoadMoreControl
                  shownCount={creatorCount()}
                  pageSize={creatorListLimit}
                  hasMore={props.mode === "library" ? libraryCreatorHasMore() : catalogCreatorHasMore()}
                  busy={creatorPageBusy()}
                  errorMessage={creatorPageError()}
                  label="Load more creators"
                  onLoadMore={loadMoreCreators}
                />
                </>
              )}
            </Match>
          </Switch>
        </div>
        <Show when={props.selectedCreator()}>
          {(creator) => (
            <aside class={sourceFeedListRegionClass} aria-label="Selected source feeds" data-source-feed-scroll-region>
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                  <p class="truncate text-xs font-semibold text-foreground">{creator().displayName}</p>
                  <p class="mt-1 text-[0.68rem] text-muted-foreground">
                    {subscriptionCreatorIds().has(creator().id) ? "Subscribed" : "Catalog creator"}
                  </p>
                </div>
                <Show when={props.isAuthenticated()}>
                  <SubscriptionActionButton
                    creatorId={creator().id}
                    isSubscribed={subscriptionCreatorIds().has(creator().id)}
                    onUpdateSubscription={updateSubscription}
                  />
                </Show>
              </div>
              <Switch>
                <Match when={feeds.loading}>
                  <p class="mt-2 text-[0.72rem] leading-5 text-muted-foreground">Loading feeds.</p>
                </Match>
                <Match when={feeds.error !== undefined}>
                  <p class="mt-2 text-[0.72rem] leading-5 text-destructive">Feeds unavailable.</p>
                </Match>
                <Match when={(feeds()?.length ?? 0) === 0}>
                  <p class="mt-2 text-[0.72rem] leading-5 text-muted-foreground">No feeds are attached to this creator.</p>
                </Match>
                <Match when={visibleFeeds()}>
                  {(selectedCreatorFeeds) => (
                    <>
                    <ul class="mt-2 space-y-1" aria-label="Feeds for selected creator">
                      <For each={selectedCreatorFeeds()}>
                        {(feed) => (
                          <FeedRow
                            feed={feed}
                            creatorImageUrl={creator().imageUrl}
                            isSelected={props.selectedFeed()?.id === feed.id}
                            readerDensity={props.readerDensity()}
                            onSelectFeed={(selectedFeed) => props.onSelectFeed(props.selectedFeed()?.id === selectedFeed.id ? null : selectedFeed)}
                          />
                        )}
                      </For>
                    </ul>
                    <LoadMoreControl
                      shownCount={selectedCreatorFeeds().length}
                      pageSize={feedListLimit}
                      hasMore={feedPageHasMore()}
                      busy={feedPageBusy()}
                      errorMessage={feedPageError()}
                      label="Load more feeds"
                      onLoadMore={loadMoreFeeds}
                    />
                    </>
                  )}
                </Match>
              </Switch>
            </aside>
          )}
        </Show>
      </div>
      <div class={sourceActionsRegionClass} data-source-actions-region>
        <AddSourceSection
          isAuthenticated={props.isAuthenticated}
          onSourceAdded={async (value) => {
            if (props.mode === "library") {
              await client.overlays.subscribeToCreator({ creatorId: value.creator.id });
            }

            await refreshSourcePaneResources();
            props.onSelectCreator(value.creator);
            props.onCatalogChanged();
          }}
        />
        <RefreshStatusSection
          isAuthenticated={props.isAuthenticated}
          selectedCreator={props.selectedCreator}
          selectedFeed={props.selectedFeed}
          onRefreshCompleted={async () => {
            await refreshSourcePaneResources();
            props.onCatalogChanged();
          }}
        />
        <Show when={props.isAuthenticated()}>
          <SettingsColumnSection
            settings={props.settings}
            settingsUnavailable={props.settingsUnavailable}
            onSettingsChanged={props.onSettingsChanged}
          />
          <PlaylistColumnSection
            selectedPlaylistId={props.selectedPlaylistId}
            playlistItemsReloadKey={props.playlistItemsReloadKey}
            onSelectPlaylist={props.onSelectPlaylist}
            onSelectContent={props.onSelectContent}
          />
        </Show>
      </div>
    </section>
  );
}

interface ContentListColumnProps {
  readonly isAuthenticated: () => boolean;
  readonly mode: ShellMode;
  readonly readerDensity: () => ReaderDensity;
  readonly selectedPlaylistId: () => string | null;
  readonly selectedCreator: () => BrowsableCreator | null;
  readonly selectedFeed: () => CatalogFeed | null;
  readonly selectedContentItemId: () => string | null;
  readonly catalogReloadKey: () => number;
  readonly favoritesReloadKey: () => number;
  readonly contentStatuses: () => readonly UserContentStatus[];
  readonly statusReloadKey: () => number;
  readonly onSelectContent: (contentItem: CatalogContentListItem) => Promise<void>;
  readonly onFavoriteChanged: () => void;
  readonly onMarkContentOpened: (contentItemId: string) => Promise<void>;
  readonly onMarkContentPlayed: (contentItemId: string) => Promise<void>;
  readonly onSelectPlaylist: (playlistId: string | null) => void;
  readonly onPlaylistItemAdded: () => void;
}

function ContentListColumn(props: ContentListColumnProps) {
  const [search, setSearch] = createSignal("");
  const [sourceType, setSourceType] = createSignal<SourceType | null>(null);
  const [viewMode, setViewMode] = createSignal<ContentViewMode>(props.mode === "library" ? "subscribed" : "catalog");
  const [hidePlayed, setHidePlayed] = createSignal(false);
  const [playlistActionError, setPlaylistActionError] = createSignal<string | null>(null);
  const [appendedContentPage, setAppendedContentPage] = createSignal<AppendedPageState<CatalogContentListItem>>(emptyAppendedPageState());
  const [contentPageBusy, setContentPageBusy] = createSignal(false);
  const [contentPageError, setContentPageError] = createSignal<string | null>(null);
  const authenticatedPlaylistSource = createMemo(() => (props.isAuthenticated() ? "content-list-playlists" : null));
  const [playlists] = createResource(authenticatedPlaylistSource, () => client.overlays.playlists());
  const contentListInput = createMemo(() =>
    toContentListInput(search(), props.selectedCreator()?.id ?? null, props.selectedFeed()?.id ?? null, sourceType()),
  );
  const contentItemsResourceMode = createMemo<ContentItemsResourceMode>(() => {
    if (props.isAuthenticated() && viewMode() === "favorites") {
      return "favorites";
    }

    if (props.isAuthenticated() && viewMode() === "history-opened") {
      return "history-opened";
    }

    if (props.isAuthenticated() && viewMode() === "played") {
      return "played";
    }

    if (props.mode === "library") {
      return "subscribed";
    }

    return "catalog";
  });
  const contentItemsResourceKey = createMemo(() => {
    const mode = contentItemsResourceMode();
    const reloadKey = mode === "favorites" ? props.favoritesReloadKey() : mode === "history-opened" || mode === "played" ? props.statusReloadKey() : props.catalogReloadKey();
    return toContentItemsResourceKey(mode, contentListInput(), reloadKey);
  });
  const [contentItems] = createResource(contentItemsResourceKey, () => {
    const mode = untrack(contentItemsResourceMode);
    const input = untrack(contentListInput);

    if (mode === "favorites") {
      return client.overlays.favoriteContentItems();
    }

    if (mode === "history-opened") {
      return listOpenedHistoryContentItems();
    }

    if (mode === "played") {
      return listPlayedHistoryContentItems();
    }

    if (mode === "subscribed") {
      return listSubscribedLibraryContentItems(input);
    }

    if (mode === "catalog") {
      return client.catalog.contentItems(input);
    }

    return [];
  });
  const favoriteItemsResourceInput = createMemo(() => {
    if (!props.isAuthenticated()) {
      return null;
    }

    return props.favoritesReloadKey();
  });
  const [favoriteItems, { refetch: refetchFavoriteItems }] = createResource(favoriteItemsResourceInput, () =>
    client.overlays.favoriteContentItems(),
  );
  const favoriteContentItemIds = createMemo(() => new Set((favoriteItems() ?? emptyCatalogContentItems).map((contentItem) => contentItem.id)));
  const listTargetPlaylistId = createMemo(() => {
    const loadedPlaylists = playlists() ?? emptyPlaylists;
    const selectedId = props.selectedPlaylistId();

    if (selectedId !== null && loadedPlaylists.some((playlist) => playlist.id === selectedId)) {
      return selectedId;
    }

    return loadedPlaylists[0]?.id ?? null;
  });
  const loadedContentItems = createMemo(() =>
    appendUniqueContentItems(contentItems() ?? emptyCatalogContentItems, pageItemsForKey(appendedContentPage(), contentItemsResourceKey())),
  );
  const contentPageHasMore = createMemo(() =>
    showsCatalogFilters(viewMode())
      && pageHasMoreForKey(appendedContentPage(), contentItemsResourceKey(), (contentItems() ?? emptyCatalogContentItems).length, contentListLimit),
  );
  const displayedContentItems = createMemo(() => {
    const currentContentItems = loadedContentItems();
    const input = contentListInput();
    const statuses = props.contentStatuses();
    const locallyFilteredItems = showsCatalogFilters(viewMode())
      ? currentContentItems
      : currentContentItems.filter((contentItem) => contentItemMatchesLocalFilters(contentItem, input));

    if (!props.isAuthenticated() || !hidePlayed()) {
      return locallyFilteredItems;
    }

    return locallyFilteredItems.filter((contentItem) => !toContentStatusFlags(statuses, contentItem.id).played);
  });
  const contentCount = createMemo(() => displayedContentItems().length);

  const contentSectionTitle = createMemo(() => {
    if (viewMode() === "favorites") {
      return "Favorites";
    }
    if (viewMode() === "history-opened") {
      return "History/Open";
    }
    if (viewMode() === "played") {
      return "Played";
    }

    return props.mode === "library" ? "Library" : "Catalog";
  });

  const contentContextLabel = createMemo(() => {
    if (viewMode() === "history-opened") {
      return "Opened videos · local filters";
    }
    if (viewMode() === "played") {
      return "Played videos · local filters";
    }

    if (viewMode() === "favorites") {
      return "Saved videos";
    }

    return props.selectedFeed()?.title ?? props.selectedFeed()?.url ?? props.selectedCreator()?.displayName ?? (props.mode === "library" ? "Subscribed content" : "All sources");
  });

  const visibleContentCollectionLabel = createMemo(() => {
    if (viewMode() === "favorites") {
      return "Favorite Library";
    }
    if (viewMode() === "history-opened") {
      return "Open History Library";
    }
    if (viewMode() === "played") {
      return "Played Library";
    }

    return props.mode === "library" ? "Subscribed Library" : "Catalog";
  });

  const visibleFiltersLabel = createMemo(() =>
    props.mode === "library" && viewMode() !== "catalog" ? contentLibraryFiltersLabel : contentCatalogFiltersLabel,
  );

  const toggleFavorite = async (contentItemId: string) => {
    try {
      await client.overlays.toggleContentFavorite({ contentItemId });
      props.onFavoriteChanged();
      await refetchFavoriteItems();
    } catch (error) {
      throw new Error(`Favorite update failed: ${formatError(error)}`);
    }
  };

  const markOpened = async (contentItemId: string) => {
    await props.onMarkContentOpened(contentItemId);
  };

  const markPlayed = async (contentItemId: string) => {
    await props.onMarkContentPlayed(contentItemId);
  };

  const addContentToPlaylist = async (contentItemId: string) => {
    const playlistId = listTargetPlaylistId();
    if (playlistId === null) {
      setPlaylistActionError("Create or select a playlist before adding videos.");
      return;
    }

    setPlaylistActionError(null);
    try {
      await client.overlays.addPlaylistItem({ playlistId, contentItemId });
      props.onSelectPlaylist(playlistId);
      props.onPlaylistItemAdded();
    } catch (error) {
      setPlaylistActionError(formatError(error));
    }
  };

  const loadMoreContentItems = async () => {
    const mode = contentItemsResourceMode();
    if (!showsCatalogFilters(viewMode()) || (mode !== "catalog" && mode !== "subscribed")) {
      return;
    }

    const key = contentItemsResourceKey();
    const input = { ...contentListInput(), offset: loadedContentItems().length };
    setContentPageBusy(true);
    setContentPageError(null);
    try {
      const nextContentItems = mode === "subscribed"
        ? await listSubscribedLibraryContentItems(input)
        : await client.catalog.contentItems(input);
      setAppendedContentPage((currentPage) => ({
        key,
        items: appendUniqueContentItems(pageItemsForKey(currentPage, key), nextContentItems),
        hasMore: nextContentItems.length === contentListLimit,
      }));
    } catch (error) {
      setContentPageError(formatError(error));
    } finally {
      setContentPageBusy(false);
    }
  };

  return (
    <section
      aria-labelledby="content-list-title"
      class={contentColumnClass}
      data-shell-column="content"
      data-selected-creator-id={props.selectedCreator()?.id ?? ""}
      data-selected-feed-id={props.selectedFeed()?.id ?? ""}
    >
      <div class={contentHeaderRegionClass} data-content-header-region>
        <div class="flex items-center justify-between gap-3">
          <h2 id="content-list-title" class="text-sm font-semibold tracking-tight text-card-foreground">
            {contentSectionTitle()}
          </h2>
          <span class="min-w-0 truncate border border-border bg-background px-2 py-1 text-[0.68rem] text-muted-foreground">
            {contentContextLabel()}
          </span>
        </div>
        <p class="mt-2 text-[0.68rem] text-muted-foreground" data-content-loaded-count>
          {contentCount()} loaded
        </p>
        <Show when={props.isAuthenticated()}>
          <div class="mt-2 grid grid-cols-4 gap-2" aria-label="Content view">
            <button
              id={props.mode === "library" ? contentViewModeSubscribedId : contentViewModeAllId}
              type="button"
              class="border border-border bg-background px-2 py-1.5 text-xs font-semibold text-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              aria-pressed={viewMode() === (props.mode === "library" ? "subscribed" : "catalog")}
              onClick={() => setViewMode(props.mode === "library" ? "subscribed" : "catalog")}
            >
              All
            </button>
            <button
              id={contentViewModeFavoritesId}
              type="button"
              class="border border-border bg-background px-2 py-1.5 text-xs font-semibold text-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              aria-pressed={viewMode() === "favorites"}
              onClick={() => setViewMode("favorites")}
            >
              Favorites
            </button>
            <button
              id={contentViewModeHistoryId}
              type="button"
              class="border border-border bg-background px-2 py-1.5 text-xs font-semibold text-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              aria-pressed={viewMode() === "history-opened"}
              onClick={() => setViewMode("history-opened")}
            >
              History/Open
            </button>
            <button
              id={contentViewModePlayedId}
              type="button"
              class="border border-border bg-background px-2 py-1.5 text-xs font-semibold text-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              aria-pressed={viewMode() === "played"}
              onClick={() => setViewMode("played")}
            >
              Played
            </button>
          </div>
        </Show>
        <Show when={showsCatalogFilters(viewMode()) || (props.isAuthenticated() && (viewMode() === "favorites" || viewMode() === "history-opened" || viewMode() === "played"))}>
          <div class="mt-2 grid grid-cols-[1fr_auto] gap-2" aria-label={visibleFiltersLabel()}>
            <label class="sr-only" for={contentSearchInputId}>
              Search content
            </label>
            <input
              id={contentSearchInputId}
              class="min-w-0 border border-input bg-background px-2 py-1.5 text-xs text-foreground outline-none transition focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
              type="search"
              value={search()}
              placeholder="Search videos"
              autocomplete="off"
              onInput={(event) => setSearch(event.currentTarget.value)}
            />
            <label class="sr-only" for={contentSourceFilterId}>
              Filter content by source
            </label>
            <select
              id={contentSourceFilterId}
              class="border border-input bg-background px-2 py-1.5 text-xs text-foreground outline-none transition focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
              value={sourceType() ?? allContentSourceFilterValue}
              onChange={(event) => setSourceType(toSourceFilterValue(event.currentTarget.value))}
            >
              <option value={allContentSourceFilterValue}>All</option>
              <For each={sourceFilterOptions}>
                {(source) => <option value={source}>{formatSourceLabel(source)}</option>}
              </For>
            </select>
          </div>
        </Show>
        <Show when={props.isAuthenticated()}>
          <label class="mt-2 flex items-center justify-between gap-2 border border-border bg-background px-2 py-1.5 text-[0.72rem] text-muted-foreground" for={contentHidePlayedInputId}>
            <span>Hide played</span>
            <input
              id={contentHidePlayedInputId}
              type="checkbox"
              checked={hidePlayed()}
              onChange={(event) => setHidePlayed(event.currentTarget.checked)}
            />
          </label>
          <Show when={!showsCatalogFilters(viewMode())}>
            <p class="mt-2 text-[0.68rem] leading-5 text-muted-foreground">
              Favorites and history are loaded from your Library, then search, source, creator, and Hide played are applied locally to the loaded videos.
            </p>
          </Show>
          <section class="mt-2 border border-border bg-background p-2" aria-label="Add feed-list videos to playlist" data-content-playlist-actions>
            <div class="grid grid-cols-[auto_1fr] items-center gap-2">
              <span class="text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Playlist</span>
              <Switch>
                <Match when={playlists.loading}>
                  <p class="text-[0.68rem] text-muted-foreground">Loading playlists.</p>
                </Match>
                <Match when={playlists.error !== undefined}>
                  <p class="text-[0.68rem] text-destructive">Playlists unavailable.</p>
                </Match>
                <Match when={(playlists()?.length ?? 0) === 0}>
                  <p class="text-[0.68rem] text-muted-foreground">Create a playlist in Sources to add videos from rows.</p>
                </Match>
                <Match when={(playlists()?.length ?? 0) > 0}>
                  <label class="sr-only" for="content-list-playlist-target">Playlist for row add buttons</label>
                  <select
                    id="content-list-playlist-target"
                    class="min-w-0 border border-input bg-background px-2 py-1 text-[0.68rem] text-foreground outline-none transition focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
                    value={listTargetPlaylistId() ?? ""}
                    onChange={(event) => props.onSelectPlaylist(event.currentTarget.value)}
                  >
                    <For each={playlists() ?? emptyPlaylists}>{(playlist) => <option value={playlist.id}>{playlist.name}</option>}</For>
                  </select>
                </Match>
              </Switch>
            </div>
            <Show when={playlistActionError()}>
              {(message) => <p class="mt-2 text-[0.68rem] text-destructive">{message()}</p>}
            </Show>
          </section>
        </Show>
      </div>
      <div class={contentScrollRegionClass} data-content-scroll-region>
        <Switch>
          <Match when={contentItems.loading}>
            <p class="text-xs font-semibold text-card-foreground">Loading videos</p>
            <p class="mt-2 text-[0.72rem] leading-5 text-muted-foreground">Loading {visibleContentCollectionLabel()} videos.</p>
          </Match>
          <Match when={contentItems.error !== undefined}>
            <p class="text-xs font-semibold text-destructive">Videos unavailable</p>
            <p class="mt-2 text-[0.72rem] leading-5 text-muted-foreground">{formatError(contentItems.error)}</p>
          </Match>
          <Match when={contentItems() !== undefined && displayedContentItems().length === 0}>
            <p class="text-xs font-semibold text-card-foreground">No videos found</p>
            <p class="mt-2 text-[0.72rem] leading-5 text-muted-foreground">
              {viewMode() === "favorites"
                ? "Favorite videos from the viewer or feed list to collect them here."
                : viewMode() === "history-opened"
                ? "Open videos to build your Library history, or clear local filters to see loaded history."
                : viewMode() === "played"
                ? "Play videos to build your played Library, or clear local filters to see loaded played history."
                : props.mode === "library" && search().trim().length === 0 && props.selectedCreator() === null && props.selectedFeed() === null && sourceType() === null
                ? "Your subscribed Library has no videos yet. Subscribe from the Catalog or refresh your sources."
                : search().trim().length === 0 && props.selectedCreator() === null && props.selectedFeed() === null && sourceType() === null
                ? "The public catalog has no videos yet."
                : "No videos match the current filters."}
            </p>
          </Match>
          <Match when={displayedContentItems().length > 0}>
              <ol class="space-y-1" aria-label={`${visibleContentCollectionLabel()} videos, ${contentCount()} shown`}>
                <For each={displayedContentItems()}>
                  {(contentItem) => (
                    <li>
                      <ContentListItemRow
                        contentItem={contentItem}
                        isAuthenticated={props.isAuthenticated()}
                        isFavorite={favoriteContentItemIds().has(contentItem.id)}
                        status={toContentStatusFlags(props.contentStatuses(), contentItem.id)}
                        selected={props.selectedContentItemId() === contentItem.id}
                        favoritesView={viewMode() === "favorites"}
                        readerDensity={props.readerDensity()}
                        targetPlaylistId={listTargetPlaylistId()}
                        formatError={formatError}
                        formatPublishedAt={formatPublishedAt}
                        formatDuration={formatDuration}
                        onSelectContent={props.onSelectContent}
                        onMarkOpened={markOpened}
                        onMarkPlayed={markPlayed}
                        onToggleFavorite={toggleFavorite}
                        onAddToPlaylist={addContentToPlaylist}
                      />
                    </li>
                  )}
                </For>
              </ol>
              <LoadMoreControl
                shownCount={contentCount()}
                pageSize={contentListLimit}
                hasMore={contentPageHasMore()}
                busy={contentPageBusy()}
                errorMessage={contentPageError()}
                label="Load more videos"
                onLoadMore={loadMoreContentItems}
              />
          </Match>
        </Switch>
      </div>
    </section>
  );
}

interface SelectedContentViewerProps {
  readonly isAuthenticated: () => boolean;
  readonly selectedContent: () => CatalogContentListItem | null;
  readonly selectedPlaylistId: () => string | null;
  readonly favoritesReloadKey: () => number;
  readonly contentStatuses: () => readonly UserContentStatus[];
  readonly contentStatusesLoading: () => boolean;
  readonly statusSelectionError: () => string | null;
  readonly onSelectPlaylist: (playlistId: string | null) => void;
  readonly onPlaylistItemAdded: () => void;
  readonly onFavoriteChanged: () => void;
  readonly onMarkContentOpened: (contentItemId: string) => Promise<void>;
  readonly onMarkContentPlayed: (contentItemId: string) => Promise<void>;
}

function SelectedContentViewer(props: SelectedContentViewerProps) {
  const selectedContentItemId = createMemo(() => props.selectedContent()?.id ?? null);
  const [contentDetail] = createResource(selectedContentItemId, (id) => client.catalog.contentDetail({ id }));
  const playableSources = createMemo(() => toPlayableSources(contentDetail()?.sources ?? emptyCatalogContentSources));
  const playableSourceIds = createMemo(() => playableSources().map((source) => source.id).join("\u001f"));
  const playbackSourceSwitcherLabel = createMemo(() => `Playback source, ${playableSources().length} options`);
  const authenticatedPlaylistSource = createMemo(() => (props.isAuthenticated() ? "playlists" : null));
  const [playlists, { refetch: refetchPlaylists }] = createResource(authenticatedPlaylistSource, () =>
    client.overlays.playlists(),
  );
  const [selectedSourceId, setSelectedSourceId] = createSignal<string | null>(null);
  const [targetPlaylistId, setTargetPlaylistId] = createSignal<string | null>(null);
  const [playlistActionError, setPlaylistActionError] = createSignal<string | null>(null);
  const [playlistActionBusy, setPlaylistActionBusy] = createSignal(false);
  const selectedFavoriteSource = createMemo(() => {
    const contentItemId = selectedContentItemId();
    if (!props.isAuthenticated() || contentItemId === null) {
      return null;
    }

    return `${contentItemId}\u001f${props.favoritesReloadKey().toString()}`;
  });
  const [favoriteItems, { refetch: refetchFavoriteItems }] = createResource(selectedFavoriteSource, () =>
    client.overlays.favoriteContentItems(),
  );
  const selectedContentIsFavorite = createMemo(() => {
    const contentItemId = selectedContentItemId();
    return contentItemId !== null && (favoriteItems() ?? emptyCatalogContentItems).some((contentItem) => contentItem.id === contentItemId);
  });
  const [favoriteActionError, setFavoriteActionError] = createSignal<string | null>(null);
  const [favoriteActionBusy, setFavoriteActionBusy] = createSignal(false);
  const selectedContentStatus = createMemo(() => {
    const contentItemId = selectedContentItemId();
    if (contentItemId === null) {
      return { opened: false, played: false };
    }

    return toContentStatusFlags(props.contentStatuses(), contentItemId);
  });
  const [statusActionError, setStatusActionError] = createSignal<string | null>(null);
  const [statusActionBusy, setStatusActionBusy] = createSignal<"opened" | "played" | null>(null);

  const selectedPlayableSource = createMemo(() => {
    const sourceIds = playableSourceIds();
    const sources = playableSources();
    const selectedId = selectedSourceId();
    if (sourceIds.length === 0) {
      return null;
    }

    return selectedId === null ? sources[0] ?? null : sources.find((source) => source.id === selectedId) ?? sources[0] ?? null;
  });
  const effectiveTargetPlaylistId = createMemo(() => {
    const loadedPlaylists = playlists() ?? emptyPlaylists;
    const explicitTargetId = targetPlaylistId();
    const selectedPlaylistId = props.selectedPlaylistId();

    if (explicitTargetId !== null && loadedPlaylists.some((playlist) => playlist.id === explicitTargetId)) {
      return explicitTargetId;
    }
    if (selectedPlaylistId !== null && loadedPlaylists.some((playlist) => playlist.id === selectedPlaylistId)) {
      return selectedPlaylistId;
    }

    return loadedPlaylists[0]?.id ?? null;
  });

  const addSelectedContentToPlaylist = async () => {
    const contentItemId = selectedContentItemId();
    const playlistId = effectiveTargetPlaylistId();
    if (contentItemId === null || playlistId === null) {
      setPlaylistActionError("Choose a playlist before adding this video.");
      return;
    }

    setPlaylistActionBusy(true);
    setPlaylistActionError(null);
    try {
      await client.overlays.addPlaylistItem({ playlistId, contentItemId });
      props.onSelectPlaylist(playlistId);
      props.onPlaylistItemAdded();
      await refetchPlaylists();
    } catch (error) {
      setPlaylistActionError(formatError(error));
    } finally {
      setPlaylistActionBusy(false);
    }
  };

  const toggleSelectedContentFavorite = async () => {
    const contentItemId = selectedContentItemId();
    if (contentItemId === null) {
      return;
    }

    setFavoriteActionBusy(true);
    setFavoriteActionError(null);
    try {
      await client.overlays.toggleContentFavorite({ contentItemId });
      props.onFavoriteChanged();
      await refetchFavoriteItems();
    } catch (error) {
      setFavoriteActionError(formatError(error));
    } finally {
      setFavoriteActionBusy(false);
    }
  };

  const markSelectedContentOpened = async () => {
    const contentItemId = selectedContentItemId();
    if (contentItemId === null) {
      return;
    }

    setStatusActionBusy("opened");
    setStatusActionError(null);
    try {
      await props.onMarkContentOpened(contentItemId);
    } catch (error) {
      setStatusActionError(formatError(error));
    } finally {
      setStatusActionBusy(null);
    }
  };

  const markSelectedContentPlayed = async () => {
    const contentItemId = selectedContentItemId();
    if (!props.isAuthenticated() || contentItemId === null) {
      return;
    }

    setStatusActionBusy("played");
    setStatusActionError(null);
    try {
      await props.onMarkContentPlayed(contentItemId);
    } catch (error) {
      setStatusActionError(formatError(error));
    } finally {
      setStatusActionBusy(null);
    }
  };

  return (
    <section
      aria-labelledby="selected-viewer-title"
      class={viewerColumnClass}
      data-shell-column="viewer"
      data-selected-content-item-id={selectedContentItemId() ?? ""}
    >
      <div class={viewerScrollRegionClass} data-viewer-scroll-region>
        <h2 id="selected-viewer-title" class="sr-only">Viewer</h2>
        <Switch>
          <Match when={selectedContentItemId() === null}>
            <div class="flex min-h-[18rem] items-center justify-center border border-border bg-muted px-6 text-center">
              <p class="text-sm leading-6 text-muted-foreground">Pick a video to open the viewer.</p>
            </div>
          </Match>
          <Match when={contentDetail.loading}>
            <div class="flex min-h-[18rem] items-center justify-center border border-border bg-muted px-6 text-center">
              <p class="text-sm leading-6 text-muted-foreground">Loading selected video.</p>
            </div>
          </Match>
          <Match when={contentDetail.error !== undefined}>
            <div class="border border-border bg-card p-4">
              <p class="text-sm font-semibold text-destructive">Video unavailable</p>
              <p class="mt-2 text-sm leading-6 text-muted-foreground">{formatError(contentDetail.error)}</p>
            </div>
          </Match>
          <Match when={contentDetail()}>
            {(detail) => (
              <div class="min-w-0">
                <PlaybackSurface
                  source={selectedPlayableSource()}
                  title={detail().title}
                  onNativePlay={markSelectedContentPlayed}
                />
                <Show when={playableSources().length > 1}>
                  <div class="mt-3 flex justify-end">
                    <label class="sr-only" for="viewer-source-switcher">
                      Playback source
                    </label>
                    <select
                      id="viewer-source-switcher"
                      class="w-52 border border-input bg-background px-2 py-1.5 text-xs text-foreground outline-none transition focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
                      value={selectedPlayableSource()?.id ?? ""}
                      aria-label={playbackSourceSwitcherLabel()}
                      title={playbackSourceSwitcherLabel()}
                      onChange={(event) => setSelectedSourceId(event.currentTarget.value)}
                    >
                      <For each={playableSources()}>
                        {(source) => (
                          <option value={source.id}>
                            {source.label}
                          </option>
                        )}
                      </For>
                    </select>
                  </div>
                </Show>
                <Show when={props.isAuthenticated()}>
                  <Show when={props.statusSelectionError()}>
                    {(message) => <p class="mt-3 border border-destructive px-3 py-2 text-xs text-destructive">{message()}</p>}
                  </Show>
                  <FavoriteActionControls
                    isFavorite={selectedContentIsFavorite()}
                    loading={favoriteItems.loading}
                    busy={favoriteActionBusy()}
                    actionError={favoriteActionError()}
                    onToggle={toggleSelectedContentFavorite}
                  />
                  <ContentStatusActionControls
                    status={selectedContentStatus()}
                    loading={props.contentStatusesLoading()}
                    busy={statusActionBusy()}
                    actionError={statusActionError()}
                    onMarkOpened={markSelectedContentOpened}
                    onMarkPlayed={markSelectedContentPlayed}
                  />
                  <PlaylistAddControls
                    playlists={playlists() ?? emptyPlaylists}
                    loading={playlists.loading}
                    error={playlists.error}
                    selectedPlaylistId={effectiveTargetPlaylistId()}
                    busy={playlistActionBusy()}
                    actionError={playlistActionError()}
                    onSelectPlaylist={setTargetPlaylistId}
                    onAdd={addSelectedContentToPlaylist}
                  />
                </Show>
                <ContentDetailBody detail={detail()} />
                <ContentDetailMetadata detail={detail()} playableSources={playableSources()} />
              </div>
            )}
          </Match>
        </Switch>
      </div>
    </section>
  );
}

interface PlaylistAddControlsProps {
  readonly playlists: readonly Playlist[];
  readonly loading: boolean;
  readonly error: unknown;
  readonly selectedPlaylistId: string | null;
  readonly busy: boolean;
  readonly actionError: string | null;
  readonly onSelectPlaylist: (playlistId: string) => void;
  readonly onAdd: () => Promise<void>;
}

interface FavoriteActionControlsProps {
  readonly isFavorite: boolean;
  readonly loading: boolean;
  readonly busy: boolean;
  readonly actionError: string | null;
  readonly onToggle: () => Promise<void>;
}

interface ContentStatusActionControlsProps {
  readonly status: ContentStatusFlags;
  readonly loading: boolean;
  readonly busy: "opened" | "played" | null;
  readonly actionError: string | null;
  readonly onMarkOpened: () => Promise<void>;
  readonly onMarkPlayed: () => Promise<void>;
}

function FavoriteActionControls(props: FavoriteActionControlsProps) {
  return (
    <section class="mt-3 border border-border bg-card p-2" aria-label="Favorite action for selected video">
      <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
        <p class="text-xs text-muted-foreground">
          {props.isFavorite ? "Saved in favorites." : "Add this video to favorites."}
        </p>
        <button
          type="button"
          class="border border-border bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
          aria-pressed={props.isFavorite}
          disabled={props.loading || props.busy}
          onClick={async () => {
            await props.onToggle();
          }}
        >
          {props.isFavorite ? "Remove favorite" : "Favorite"}
        </button>
      </div>
      <Show when={props.actionError}>
        {(message) => <p class="mt-2 text-xs text-destructive">{message()}</p>}
      </Show>
    </section>
  );
}

function ContentStatusActionControls(props: ContentStatusActionControlsProps) {
  return (
    <section
      class="mt-3 border border-border bg-card p-2"
      aria-label="Opened and played actions for selected video"
      data-opened={props.status.opened ? "true" : "false"}
      data-played={props.status.played ? "true" : "false"}
    >
      <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
        <p class="text-xs text-muted-foreground">
          {props.status.played ? "Played." : props.status.opened ? "Opened." : "Mark this video opened or played."}
        </p>
        <button
          type="button"
          class="border border-border bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
          aria-pressed={props.status.opened}
          disabled={props.loading || props.busy !== null || props.status.opened}
          onClick={async () => {
            await props.onMarkOpened();
          }}
        >
          {props.status.opened ? "Opened" : "Mark opened"}
        </button>
        <button
          type="button"
          class="border border-border bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
          aria-pressed={props.status.played}
          disabled={props.loading || props.busy !== null || props.status.played}
          onClick={async () => {
            await props.onMarkPlayed();
          }}
        >
          {props.status.played ? "Played" : "Mark played"}
        </button>
      </div>
      <Show when={props.actionError}>
        {(message) => <p class="mt-2 text-xs text-destructive">{message()}</p>}
      </Show>
    </section>
  );
}

function PlaylistAddControls(props: PlaylistAddControlsProps) {
  return (
    <section class="mt-3 border border-border bg-card p-2" aria-label="Playlist actions for selected video">
      <Switch>
        <Match when={props.loading}>
          <p class="text-xs text-muted-foreground">Loading playlists.</p>
        </Match>
        <Match when={props.error !== undefined}>
          <p class="text-xs text-destructive">Playlist actions unavailable.</p>
        </Match>
        <Match when={props.playlists.length === 0}>
          <p class="text-xs text-muted-foreground">Create a playlist in the sources column to save this video.</p>
        </Match>
        <Match when={props.playlists.length > 0}>
          <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
            <label class="sr-only" for="viewer-playlist-target">Save to playlist</label>
            <select
              id="viewer-playlist-target"
              class="min-w-0 border border-input bg-background px-2 py-1.5 text-xs text-foreground outline-none transition focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring sm:w-56"
              value={props.selectedPlaylistId ?? ""}
              onChange={(event) => props.onSelectPlaylist(event.currentTarget.value)}
            >
              <For each={props.playlists}>{(playlist) => <option value={playlist.id}>{playlist.name}</option>}</For>
            </select>
            <button
              type="button"
              class="border border-border bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
              disabled={props.busy || props.selectedPlaylistId === null}
              onClick={async () => {
                await props.onAdd();
              }}
            >
              Add to playlist
            </button>
          </div>
        </Match>
      </Switch>
      <Show when={props.actionError}>
        {(message) => <p class="mt-2 text-xs text-destructive">{message()}</p>}
      </Show>
    </section>
  );
}

interface PlaybackSurfaceProps {
  readonly source: PlayableSource | null;
  readonly title: string;
  readonly onNativePlay: () => Promise<void>;
}

function PlaybackSurface(props: PlaybackSurfaceProps) {
  return (
    <div class="aspect-video overflow-hidden border border-border bg-muted">
      <Switch>
        <Match when={props.source?.kind === "embed" && props.source !== null}>
          <iframe
            class="h-full w-full"
            src={props.source?.url ?? ""}
            title={props.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowfullscreen
            referrerpolicy="strict-origin-when-cross-origin"
          />
        </Match>
        <Match when={props.source?.kind === "native" && props.source !== null}>
          <video class="h-full w-full" src={props.source?.url ?? ""} controls preload="metadata" onPlay={props.onNativePlay}>
            <a class="text-primary underline" href={props.source?.url ?? ""}>
              Open video source
            </a>
          </video>
        </Match>
        <Match when={true}>
          <div class="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
            No safe playable source is available for this video.
          </div>
        </Match>
      </Switch>
    </div>
  );
}

interface ContentDetailBodyProps {
  readonly detail: CatalogContentDetail;
}

function ContentDetailBody(props: ContentDetailBodyProps) {
  return (
    <article class="mt-4 space-y-3">
      <div>
        <h3 class="text-xl font-semibold tracking-tight text-foreground">{props.detail.title}</h3>
        <p class="mt-2 text-sm text-muted-foreground">
          {props.detail.creator.displayName} · {formatPublishedAt(props.detail.publishedAt)} · {formatDuration(props.detail.durationSeconds)}
        </p>
      </div>
      <Show when={props.detail.description}>
        {(description) => <p class="whitespace-pre-line text-sm leading-6 text-foreground">{description()}</p>}
      </Show>
      <Show when={props.detail.canonicalUrl}>
        {(canonicalUrl) => (
          <a
            class="inline-flex border border-border bg-card px-3 py-2 text-xs font-semibold text-card-foreground transition hover:border-ring hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            href={canonicalUrl()}
            rel="noreferrer"
            target="_blank"
          >
            Open original
          </a>
        )}
      </Show>
    </article>
  );
}

interface ContentDetailMetadataProps {
  readonly detail: CatalogContentDetail | undefined;
  readonly playableSources: readonly PlayableSource[];
}

function ContentDetailMetadata(props: ContentDetailMetadataProps) {
  return (
    <section class="mt-4 border-t border-border" aria-label="Selected video metadata">
      <Show when={props.detail?.creator}>
        {(creator) => (
          <section class="border-b border-border py-3">
            <p class="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Creator</p>
            <p class="mt-2 text-sm font-semibold text-card-foreground">{creator().displayName}</p>
            <p class="mt-1 text-xs text-muted-foreground">{formatSourceLabel(creator().sourceType)}</p>
          </section>
        )}
      </Show>
      <Show when={(props.detail?.feeds.length ?? 0) > 0}>
        <section class="border-b border-border py-3">
          <p class="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Feeds</p>
          <ul class="mt-2 space-y-1" aria-label="Feeds containing selected video">
            <For each={props.detail?.feeds ?? emptyCatalogFeeds}>{(feed) => <FeedRow feed={feed} />}</For>
          </ul>
        </section>
      </Show>
      <Show when={props.playableSources.length > 0}>
        <section class="py-3">
          <p class="text-[0.68rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Playable sources</p>
          <ul class="mt-2 space-y-1" aria-label="Playable sources for selected video">
            <For each={props.playableSources}>
              {(source) => (
                <li class="border border-border bg-background px-2 py-1.5">
                  <p class="text-[0.72rem] font-semibold text-foreground">{source.label}</p>
                  <a class="mt-1 block truncate text-[0.68rem] text-muted-foreground underline" href={source.canonicalUrl} rel="noreferrer" target="_blank">
                    Source page
                  </a>
                </li>
              )}
            </For>
          </ul>
        </section>
      </Show>
    </section>
  );
}

export interface AppShellProps {
  readonly mode?: ShellMode;
}

export default function AppShell(props: AppShellProps) {
  const mode = props.mode ?? "catalog";
  const session = authClient.useSession();
  const isAuthenticated = createMemo(() => !session().isPending && session().data !== null);
  const [selectedCreator, setSelectedCreator] = createSignal<BrowsableCreator | null>(null);
  const [selectedFeed, setSelectedFeed] = createSignal<CatalogFeed | null>(null);
  const [selectedContent, setSelectedContent] = createSignal<CatalogContentListItem | null>(null);
  const [selectedPlaylistId, setSelectedPlaylistId] = createSignal<string | null>(null);
  const [playlistItemsReloadKey, setPlaylistItemsReloadKey] = createSignal(0);
  const [catalogReloadKey, setCatalogReloadKey] = createSignal(0);
  const [favoritesReloadKey, setFavoritesReloadKey] = createSignal(0);
  const [statusReloadKey, setStatusReloadKey] = createSignal(0);
  const [statusSelectionError, setStatusSelectionError] = createSignal<string | null>(null);
  const settingsResourceInput = createMemo(() => {
    if (!isAuthenticated()) {
      return null;
    }

    return "settings";
  });
  const [settings, { refetch: refetchSettings }] = createResource(settingsResourceInput, () => client.overlays.settings());
  const readerDensity = createMemo(() => toReaderDensityFromSettings(settings() ?? emptyUserSettings));
  const contentStatusesResourceInput = createMemo(() => {
    if (!isAuthenticated()) {
      return null;
    }

    return statusReloadKey();
  });
  const [contentStatuses, { refetch: refetchContentStatuses }] = createResource(contentStatusesResourceInput, () =>
    client.overlays.contentStatuses(),
  );
  const selectedCreatorId = createMemo(() => selectedCreator()?.id ?? null);
  const selectedContentItemId = createMemo(() => selectedContent()?.id ?? null);

  const selectCreator = (creator: BrowsableCreator) => {
    setSelectedCreator(creator);
    setSelectedFeed(null);
    setSelectedContent(null);
  };

  const selectFeed = (feed: CatalogFeed | null) => {
    setSelectedFeed(feed);
    setSelectedContent(null);
  };

  const reconcileStatusState = async () => {
    setStatusReloadKey((key) => key + 1);
    await refetchContentStatuses();
  };

  const markContentOpened = async (contentItemId: string) => {
    if (!isAuthenticated()) {
      return;
    }

    await client.overlays.markContentOpened({ contentItemId });
    await reconcileStatusState();
  };

  const markContentPlayed = async (contentItemId: string) => {
    if (!isAuthenticated()) {
      return;
    }

    await client.overlays.markContentPlayed({ contentItemId });
    await reconcileStatusState();
  };

  const selectContent = async (contentItem: CatalogContentListItem) => {
    setSelectedContent(contentItem);
    setStatusSelectionError(null);
    try {
      await markContentOpened(contentItem.id);
    } catch (error) {
      setStatusSelectionError(`Opened status update failed: ${formatError(error)}`);
    }
  };

  return (
    <main class={shellRootClass}>
      <div class={shellGridClass} data-reader-density={readerDensity()}>
        <CreatorSourceColumn
          isAuthenticated={isAuthenticated}
          mode={mode}
          readerDensity={readerDensity}
          settings={() => settings() ?? emptyUserSettings}
          settingsUnavailable={() => settings.error !== undefined}
          selectedCreatorId={selectedCreatorId}
          selectedCreator={selectedCreator}
          selectedFeed={selectedFeed}
          selectedPlaylistId={selectedPlaylistId}
          playlistItemsReloadKey={playlistItemsReloadKey}
          onCatalogChanged={() => setCatalogReloadKey((key) => key + 1)}
          onSettingsChanged={async () => {
            await refetchSettings();
          }}
          onClearCreator={() => {
            setSelectedCreator(null);
            setSelectedFeed(null);
            setSelectedContent(null);
          }}
          onSelectCreator={selectCreator}
          onSelectFeed={selectFeed}
          onSelectPlaylist={setSelectedPlaylistId}
          onSelectContent={selectContent}
        />
        <ContentListColumn
          isAuthenticated={isAuthenticated}
          mode={mode}
          selectedCreator={selectedCreator}
          selectedFeed={selectedFeed}
          selectedPlaylistId={selectedPlaylistId}
          selectedContentItemId={selectedContentItemId}
          catalogReloadKey={catalogReloadKey}
          favoritesReloadKey={favoritesReloadKey}
          readerDensity={readerDensity}
          contentStatuses={() => contentStatuses() ?? emptyUserContentStatuses}
          statusReloadKey={statusReloadKey}
          onSelectContent={selectContent}
          onFavoriteChanged={() => setFavoritesReloadKey((key) => key + 1)}
          onMarkContentOpened={markContentOpened}
          onMarkContentPlayed={markContentPlayed}
          onSelectPlaylist={setSelectedPlaylistId}
          onPlaylistItemAdded={() => setPlaylistItemsReloadKey((key) => key + 1)}
        />
        <SelectedContentViewer
          isAuthenticated={isAuthenticated}
          selectedContent={selectedContent}
          selectedPlaylistId={selectedPlaylistId}
          favoritesReloadKey={favoritesReloadKey}
          contentStatuses={() => contentStatuses() ?? emptyUserContentStatuses}
          contentStatusesLoading={() => contentStatuses.loading}
          statusSelectionError={statusSelectionError}
          onSelectPlaylist={setSelectedPlaylistId}
          onPlaylistItemAdded={() => setPlaylistItemsReloadKey((key) => key + 1)}
          onFavoriteChanged={() => setFavoritesReloadKey((key) => key + 1)}
          onMarkContentOpened={markContentOpened}
          onMarkContentPlayed={markContentPlayed}
        />
      </div>
    </main>
  );
}
