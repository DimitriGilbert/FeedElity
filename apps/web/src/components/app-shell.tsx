import type {
  CatalogContentListItem,
  CatalogFeed,
  SourceType,
  UserContentStatus,
  UserSetting,
  UserSubscriptionWithCreator,
} from "@FeedElity/api";
import { For, Match, Show, Switch, createMemo, createResource, createSignal, untrack } from "solid-js";

import { authClient } from "@/lib/auth-client";
import { client } from "@/utils/orpc";

import { ContentListColumn } from "./app-shell-content-column";
import { CreatorSourceRow, FeedRow } from "./app-shell-rows";
import {
  AddSourceSection,
  PlaylistColumnSection,
  RefreshStatusSection,
  SettingsColumnSection,
  SubscriptionActionButton,
} from "./app-shell-source-sections";
import {
  creatorListLimit,
  creatorSearchInputId,
  creatorSourceFilterId,
  emptyAppendedPageState,
  feedListLimit,
  formatError,
  formatSourceLabel,
  pageHasMoreForKey,
  pageItemsForKey,
  shellGridClass,
  shellRootClass,
  sourceActionsRegionClass,
  sourceCatalogRegionClass,
  sourceColumnClass,
  sourceCreatorListRegionClass,
  sourceFeedListRegionClass,
  sourceHeaderRegionClass,
  toFeedListInput,
  toCreatorListInput,
  toReaderDensityFromSettings,
  type AppendedPageState,
  type BrowsableCreator,
  type CreatorListInput,
  type FeedListInput,
  type ReaderDensity,
  type ShellMode,
} from "./app-shell.contract";
import { SelectedContentViewer } from "./app-shell-viewer";

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

const allCreatorSourceFilterValue = "all";

const sourceFilterOptions: readonly SourceType[] = ["youtube", "odysee", "peertube"];

type SubscriptionAction = "subscribe" | "unsubscribe";

const emptyCatalogFeeds: readonly CatalogFeed[] = [];

const emptyBrowsableCreators: readonly BrowsableCreator[] = [];

const emptySubscriptions: readonly UserSubscriptionWithCreator[] = [];

const emptyUserContentStatuses: readonly UserContentStatus[] = [];

const emptyUserSettings: readonly UserSetting[] = [];

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
