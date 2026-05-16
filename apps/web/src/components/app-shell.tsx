import type {
  AddSourceResult,
  AddSourceValue,
  CatalogContentDetail,
  CatalogContentListItem,
  CatalogContentSource,
  CatalogCreator,
  CatalogFeed,
  IngestionError,
  Playlist,
  PlaylistItemWithContent,
  PlaylistSortMode,
  RefreshFeedResultWithFeed,
  RefreshRunReport,
  SourceType,
  UserContentStatus,
  UserSetting,
  UserSubscriptionWithCreator,
} from "@FeedElity/api";
import { CirclePlay, RadioTower, SquarePlay } from "lucide-solid";
import { For, Match, Show, Switch, createMemo, createResource, createSignal, untrack } from "solid-js";

import { authClient } from "@/lib/auth-client";
import { client } from "@/utils/orpc";

import {
  addSourceHelpId,
  addSourceInputId,
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
  formatRefreshReportSummary,
  formatRefreshRunSummary,
  formatSettingValue,
  formatSourceLabel,
  mergeUniqueContentItemsForDisplay,
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
  toRefreshStatusResourceKey,
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

interface ContentStatusFlags {
  readonly opened: boolean;
  readonly played: boolean;
}

const emptyCatalogContentItems: readonly CatalogContentListItem[] = [];

const emptyCatalogContentSources: readonly CatalogContentSource[] = [];

const emptyCatalogFeeds: readonly CatalogFeed[] = [];

const emptyBrowsableCreators: readonly BrowsableCreator[] = [];

const emptyPlaylists: readonly Playlist[] = [];

const emptyPlaylistItems: readonly PlaylistItemWithContent[] = [];

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

const playlistSortOptions: readonly { readonly value: PlaylistSortMode; readonly label: string }[] = [
  { value: "manual", label: "Manual" },
  { value: "published_at_desc", label: "Newest published" },
  { value: "published_at_asc", label: "Oldest published" },
  { value: "added_at_desc", label: "Newest added" },
  { value: "added_at_asc", label: "Oldest added" },
];

const readerDensityOptions: readonly { readonly value: ReaderDensity; readonly label: string; readonly helper: string }[] = [
  { value: "comfortable", label: "Comfortable", helper: "App default; roomier rows for scanning thumbnails and actions." },
  { value: "compact", label: "Compact", helper: "Denser rows for faster source and video scanning." },
];


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

function formatDateTime(value: Date | null): string {
  if (value === null) {
    return "Not completed";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function formatFeedRefreshMetadata(feed: CatalogFeed): string {
  if (feed.lastNormalRefreshAt === null) {
    return "Last refresh: Never";
  }

  return `Last refresh: ${formatDateTime(feed.lastNormalRefreshAt)}`;
}

function formatFeedNextRefreshMetadata(feed: CatalogFeed): string {
  if (feed.nextRefreshAfter === null) {
    return "Next normal refresh: Not scheduled";
  }

  return `Next normal refresh: ${formatDateTime(feed.nextRefreshAfter)}`;
}

function formatFeedLabel(feed: Pick<CatalogFeed, "title" | "url">): string {
  const title = feed.title?.trim();
  return title !== undefined && title.length > 0 ? title : feed.url;
}

function formatRefreshSkipReason(reason: RefreshRunReport["feeds"][number]["skipReason"]): string {
  if (reason === "cadence-disabled") {
    return "Skipped: normal refresh cadence is disabled for this feed.";
  }

  if (reason === "not-due") {
    return "Skipped: not due for normal refresh yet.";
  }

  return "";
}

function parseRefreshFeedResultError(errorSummaryJson: string | null): string | null {
  if (errorSummaryJson === null) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(errorSummaryJson);
    if (typeof parsed === "object" && parsed !== null && typeof (parsed as { readonly message?: unknown }).message === "string") {
      return (parsed as { readonly message: string }).message;
    }
  } catch {
    return "Refresh failed with an unreadable stored error.";
  }

  return "Refresh failed with an unreadable stored error.";
}

function formatPlaylistSortMode(sortMode: PlaylistSortMode): string {
  return playlistSortOptions.find((option) => option.value === sortMode)?.label ?? "Manual";
}

function toPlaylistSortMode(value: string): PlaylistSortMode {
  return playlistSortOptions.find((option) => option.value === value)?.value ?? "manual";
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

function readerDensityPaddingClass(readerDensity: ReaderDensity): string {
  return readerDensity === "compact" ? "p-1.5" : "p-2";
}

type SourceIndicatorContext = "content" | "feed";

function formatSourceIndicatorLabel(sourceType: SourceType, context: SourceIndicatorContext, sourceCount?: number): string {
  const sourceLabel = formatSourceLabel(sourceType);
  if (context === "feed") {
    return `${sourceLabel} feed source`;
  }

  if (sourceCount === undefined || sourceCount <= 1) {
    return `${sourceLabel} content source`;
  }

  return `${sourceLabel} primary content source, ${sourceCount} source records available`;
}

function SourceTypeIcon(props: { readonly sourceType: SourceType }) {
  const iconClass = "h-3.5 w-3.5";
  return (
    <Switch>
      <Match when={props.sourceType === "youtube"}>
        <SquarePlay class={iconClass} aria-hidden="true" />
      </Match>
      <Match when={props.sourceType === "odysee"}>
        <CirclePlay class={iconClass} aria-hidden="true" />
      </Match>
      <Match when={props.sourceType === "peertube"}>
        <RadioTower class={iconClass} aria-hidden="true" />
      </Match>
    </Switch>
  );
}

function SourceIconBadge(props: { readonly sourceType: SourceType; readonly context: SourceIndicatorContext; readonly sourceCount?: number }) {
  const label = createMemo(() => formatSourceIndicatorLabel(props.sourceType, props.context, props.sourceCount));
  return (
    <span
      class="inline-flex shrink-0 items-center gap-1 border border-border bg-background px-1 py-0.5 text-muted-foreground"
      role="img"
      aria-label={label()}
      title={label()}
    >
      <SourceTypeIcon sourceType={props.sourceType} />
      <Show when={props.sourceCount !== undefined && props.sourceCount > 1}>
        <span class="text-[0.62rem] font-semibold tabular-nums" aria-hidden="true">
          ×{props.sourceCount}
        </span>
      </Show>
    </span>
  );
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
                          onUpdateSubscription={updateSubscription}
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

interface CreatorSourceRowProps {
  readonly creator: BrowsableCreator;
  readonly isAuthenticated: boolean;
  readonly isSelected: boolean;
  readonly isSubscribed: boolean;
  readonly showSubscriptionControl: boolean;
  readonly readerDensity: ReaderDensity;
  readonly onSelectCreator: (creator: BrowsableCreator) => void;
  readonly onUpdateSubscription: (creatorId: string, action: SubscriptionAction) => Promise<void>;
}

function CreatorSourceRow(props: CreatorSourceRowProps) {
  return (
    <div class={`border border-border bg-card ${readerDensityPaddingClass(props.readerDensity)} text-card-foreground transition hover:border-ring hover:bg-accent hover:text-accent-foreground`}>
      <button
        type="button"
        class="w-full text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        aria-pressed={props.isSelected}
        data-selected={props.isSelected ? "true" : "false"}
        onClick={() => props.onSelectCreator(props.creator)}
      >
        <span class="block truncate text-xs font-semibold">{props.creator.displayName}</span>
        <span class="mt-1 flex items-center justify-between gap-2 text-[0.68rem] text-muted-foreground">
          <span class="truncate" title="Use the filter above to scope creator rows by catalog source type; select a creator to inspect its feeds.">
            Feeds
          </span>
          <Show when={props.isSubscribed}>
            <span class="shrink-0 border border-border bg-background px-1 py-0.5 text-[0.62rem] font-semibold uppercase tracking-[0.12em] text-foreground">
              Subscribed
            </span>
          </Show>
        </span>
      </button>
      <Show when={props.isAuthenticated && props.showSubscriptionControl}>
        <div class="mt-2 flex justify-end">
          <SubscriptionActionButton
            creatorId={props.creator.id}
            isSubscribed={props.isSubscribed}
            onUpdateSubscription={props.onUpdateSubscription}
          />
        </div>
      </Show>
    </div>
  );
}

interface SubscriptionActionButtonProps {
  readonly creatorId: string;
  readonly isSubscribed: boolean;
  readonly onUpdateSubscription: (creatorId: string, action: SubscriptionAction) => Promise<void>;
}

function SubscriptionActionButton(props: SubscriptionActionButtonProps) {
  const [busy, setBusy] = createSignal(false);
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null);
  const action = createMemo<SubscriptionAction>(() => (props.isSubscribed ? "unsubscribe" : "subscribe"));

  const updateSubscription = async () => {
    setBusy(true);
    setErrorMessage(null);
    try {
      await props.onUpdateSubscription(props.creatorId, action());
    } catch (error) {
      setErrorMessage(formatError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="min-w-0">
      <button
        type="button"
        class="border border-border bg-background px-2 py-1 text-[0.68rem] font-semibold text-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
        aria-pressed={props.isSubscribed}
        disabled={busy()}
        onClick={updateSubscription}
      >
        {props.isSubscribed ? "Unsubscribe" : "Subscribe"}
      </button>
      <Show when={errorMessage()}>
        {(message) => <p class="mt-1 max-w-32 truncate text-[0.68rem] text-destructive">{message()}</p>}
      </Show>
    </div>
  );
}

interface AddSourceSectionProps {
  readonly isAuthenticated: () => boolean;
  readonly onSourceAdded: (value: AddSourceValue) => Promise<void>;
}

function formatIngestionCounts(value: AddSourceValue): string {
  const reusedCreators = 1 - value.created.creators;
  const reusedFeeds = value.feeds.length - value.created.feeds;
  const reusedContentItems = value.contentItems.length - value.created.contentItems;

  return [
    `Creators: ${value.created.creators} created, ${reusedCreators} reused`,
    `Feeds: ${value.created.feeds} created, ${reusedFeeds} reused`,
    `Content: ${value.created.contentItems} created, ${reusedContentItems} reused`,
  ].join("; ");
}

function formatIngestionError(error: IngestionError): string {
  return `${error.code}: ${error.message}`;
}

function AddSourceSection(props: AddSourceSectionProps) {
  const [sourceInput, setSourceInput] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [successMessage, setSuccessMessage] = createSignal<string | null>(null);
  const [failureMessage, setFailureMessage] = createSignal<string | null>(null);

  const submitSource = async () => {
    const trimmedSourceInput = sourceInput().trim();
    if (trimmedSourceInput.length === 0) {
      setFailureMessage("Enter a source URL before adding it.");
      setSuccessMessage(null);
      return;
    }

    setBusy(true);
    setFailureMessage(null);
    setSuccessMessage(null);
    try {
      const result: AddSourceResult = await client.ingestion.addSource({ sourceInput: trimmedSourceInput });
      if (!result.ok) {
        setFailureMessage(formatIngestionError(result.error));
        return;
      }

      await props.onSourceAdded(result.value);
      setSuccessMessage(formatIngestionCounts(result.value));
      setSourceInput("");
    } catch (error) {
      setFailureMessage(formatError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section class="border-t border-border px-2 py-2" aria-labelledby="add-source-title" data-add-source-region>
      <div class="flex items-center justify-between gap-2">
        <h3 id="add-source-title" class="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Add source
        </h3>
        <span class="text-[0.68rem] text-muted-foreground">Manual</span>
      </div>
      <p id={addSourceHelpId} class="mt-2 text-[0.72rem] leading-5 text-muted-foreground">
        Paste a creator, channel, feed, or video URL supported by the YouTube, Odysee, or PeerTube adapters.
      </p>
      <Show when={props.isAuthenticated()}>
        <form
          class="mt-2 space-y-2 border border-border bg-background p-2"
          onSubmit={async (event) => {
            event.preventDefault();
            await submitSource();
          }}
        >
          <label class="sr-only" for={addSourceInputId}>Source URL</label>
          <input
            id={addSourceInputId}
            class="w-full border border-input bg-background px-2 py-1.5 text-xs text-foreground outline-none transition focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
            value={sourceInput()}
            maxlength={2048}
            placeholder="https://..."
            aria-describedby={addSourceHelpId}
            autocomplete="off"
            onInput={(event) => setSourceInput(event.currentTarget.value)}
          />
          <button
            type="submit"
            class="w-full border border-border bg-primary px-2 py-1.5 text-xs font-semibold text-primary-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
            disabled={busy()}
          >
            Add source
          </button>
        </form>
      </Show>
      <Show when={!props.isAuthenticated()}>
        <p class="mt-2 border border-border bg-background px-2 py-1.5 text-[0.72rem] leading-5 text-muted-foreground">
          Sign in to add or subscribe to sources. Public catalog browsing stays available.
        </p>
      </Show>
      <Show when={failureMessage()}>
        {(message) => <p class="mt-2 border border-destructive px-2 py-1.5 text-[0.72rem] leading-5 text-destructive">{message()}</p>}
      </Show>
      <Show when={successMessage()}>
        {(message) => (
          <p class="mt-2 border border-border bg-card px-2 py-1.5 text-[0.72rem] leading-5 text-card-foreground" role="status">
            {message()}
          </p>
        )}
      </Show>
    </section>
  );
}

interface RefreshStatusSectionProps {
  readonly isAuthenticated: () => boolean;
  readonly selectedCreator: () => BrowsableCreator | null;
  readonly selectedFeed: () => CatalogFeed | null;
  readonly onRefreshCompleted: () => Promise<void>;
}

function RefreshStatusSection(props: RefreshStatusSectionProps) {
  const [reloadKey, setReloadKey] = createSignal(0);
  const [busyAction, setBusyAction] = createSignal<
    "normal-all" | "force-all" | "normal-creator" | "force-creator" | "normal-feed" | "force-feed" | null
  >(null);
  const [refreshError, setRefreshError] = createSignal<string | null>(null);
  const [latestReport, setLatestReport] = createSignal<RefreshRunReport | null>(null);
  const statusResourceKey = createMemo(() => toRefreshStatusResourceKey(props.isAuthenticated(), reloadKey()));
  const [status] = createResource(
    statusResourceKey,
    () => client.refresh.status({ limit: 5, feedResultsLimit: 3 }),
  );

  const runAllRefresh = async (force: boolean) => {
    if (force && !globalThis.confirm("Force refresh all sources now?")) {
      return;
    }

    setBusyAction(force ? "force-all" : "normal-all");
    setRefreshError(null);
    try {
      const result = await client.refresh.runAll({ force });
      setLatestReport(result.report);
      setReloadKey((key) => key + 1);
      await props.onRefreshCompleted();
    } catch (error) {
      setRefreshError(formatError(error));
    } finally {
      setBusyAction(null);
    }
  };

  const runCreatorRefresh = async (force: boolean) => {
    const creator = props.selectedCreator();
    if (creator === null) {
      setRefreshError("Select a source before refreshing one creator.");
      return;
    }

    if (force && !globalThis.confirm(`Force refresh ${creator.displayName} now?`)) {
      return;
    }

    setBusyAction(force ? "force-creator" : "normal-creator");
    setRefreshError(null);
    try {
      const result = await client.refresh.runCreator({ creatorId: creator.id, force });
      setLatestReport(result.report);
      setReloadKey((key) => key + 1);
      await props.onRefreshCompleted();
    } catch (error) {
      setRefreshError(formatError(error));
    } finally {
      setBusyAction(null);
    }
  };

  const runFeedRefresh = async (force: boolean) => {
    const feed = props.selectedFeed();
    if (feed === null) {
      setRefreshError("Select a feed before refreshing one feed.");
      return;
    }

    if (force && !globalThis.confirm("Force refresh the selected feed now?")) {
      return;
    }

    setBusyAction(force ? "force-feed" : "normal-feed");
    setRefreshError(null);
    try {
      const result = await client.refresh.runFeed({ feedId: feed.id, force });
      setLatestReport(result.report);
      setReloadKey((key) => key + 1);
      await props.onRefreshCompleted();
    } catch (error) {
      setRefreshError(formatError(error));
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <section id={refreshStatusRegionId} class="border-t border-border px-2 py-2" aria-labelledby="refresh-status-title">
      <div class="flex items-center justify-between gap-2">
        <h3 id="refresh-status-title" class="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Refresh
        </h3>
        <span class="text-[0.68rem] text-muted-foreground">Manual only</span>
      </div>
      <Show when={props.isAuthenticated()}>
        <div class="mt-2 grid grid-cols-2 gap-2" aria-label="Manual refresh controls">
          <button
            type="button"
            class="border border-border bg-primary px-2 py-1.5 text-[0.68rem] font-semibold text-primary-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
            disabled={busyAction() !== null}
            onClick={async () => runAllRefresh(false)}
          >
            Normal all
          </button>
          <button
            type="button"
            class="border border-border bg-card px-2 py-1.5 text-[0.68rem] font-semibold text-card-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
            disabled={busyAction() !== null}
            onClick={async () => runAllRefresh(true)}
          >
            Force all
          </button>
          <button
            type="button"
            class="border border-border bg-card px-2 py-1.5 text-[0.68rem] font-semibold text-card-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
            disabled={busyAction() !== null || props.selectedCreator() === null}
            onClick={async () => runCreatorRefresh(false)}
          >
            Normal source
          </button>
          <button
            type="button"
            class="border border-border bg-card px-2 py-1.5 text-[0.68rem] font-semibold text-card-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
            disabled={busyAction() !== null || props.selectedCreator() === null}
            onClick={async () => runCreatorRefresh(true)}
          >
            Force source
          </button>
          <button
            type="button"
            class="border border-border bg-card px-2 py-1.5 text-[0.68rem] font-semibold text-card-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
            disabled={busyAction() !== null || props.selectedFeed() === null}
            onClick={async () => runFeedRefresh(false)}
          >
            Normal feed
          </button>
          <button
            type="button"
            class="border border-border bg-card px-2 py-1.5 text-[0.68rem] font-semibold text-card-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
            disabled={busyAction() !== null || props.selectedFeed() === null}
            onClick={async () => runFeedRefresh(true)}
          >
            Force feed
          </button>
        </div>
      </Show>
      <Show when={!props.isAuthenticated()}>
        <p class="mt-2 border border-border bg-background px-2 py-1.5 text-[0.72rem] leading-5 text-muted-foreground">
          Sign in to run manual refreshes.
        </p>
      </Show>
      <Show when={refreshError()}>
        {(message) => <p class="mt-2 border border-destructive px-2 py-1.5 text-[0.72rem] text-destructive">{message()}</p>}
      </Show>
      <Show when={busyAction()}>
        {(action) => (
          <p class="mt-2 border border-border bg-background px-2 py-1.5 text-[0.72rem] leading-5 text-muted-foreground" role="status" aria-live="polite">
            Manual refresh in progress: {action().replace("-", " ")}.
          </p>
        )}
      </Show>
      <Show when={latestReport()}>
        {(report) => (
          <div class="mt-2 border border-border bg-card px-2 py-1.5 text-[0.72rem] leading-5 text-card-foreground" role="status">
            <p>{formatRefreshReportSummary(report())}</p>
            <RefreshReportFeedList feeds={report().feeds} />
          </div>
        )}
      </Show>
      <Switch>
        <Match when={status.loading}>
          <p class="mt-2 text-[0.72rem] leading-5 text-muted-foreground">Loading refresh history.</p>
        </Match>
        <Match when={status.error !== undefined}>
          <p class="mt-2 text-[0.72rem] leading-5 text-destructive">Refresh history unavailable.</p>
        </Match>
        <Match when={(status()?.recentRuns.length ?? 0) === 0}>
          <p class="mt-2 text-[0.72rem] leading-5 text-muted-foreground">No refresh runs recorded.</p>
        </Match>
        <Match when={status()}>
          {(loadedStatus) => (
            <div class="mt-2 space-y-2">
              <ol class="space-y-1" aria-label="Recent refresh runs">
                <For each={loadedStatus().recentRuns}>
                  {(run) => (
                    <li class="border border-border bg-background px-2 py-1.5">
                      <p class="text-[0.72rem] font-semibold text-foreground">{formatRefreshRunSummary(run)}</p>
                      <p class="mt-1 text-[0.68rem] text-muted-foreground">{formatDateTime(run.completedAt)}</p>
                    </li>
                  )}
                </For>
              </ol>
              <RefreshFeedResultList results={loadedStatus().latestFeedResults} />
            </div>
          )}
        </Match>
      </Switch>
    </section>
  );
}

function RefreshReportFeedList(props: { readonly feeds: RefreshRunReport["feeds"] }) {
  return (
    <Show when={props.feeds.length > 0}>
      <ul class="mt-2 space-y-1" aria-label="Completed refresh feed details">
        <For each={props.feeds}>
          {(feed) => (
            <li class="border border-border bg-background px-2 py-1 text-[0.68rem] text-foreground">
              <div class="flex items-start justify-between gap-2">
                <span class="min-w-0 truncate font-semibold">{formatFeedLabel({ title: feed.feedTitle, url: feed.feedUrl })}</span>
                <span class="shrink-0 text-muted-foreground">{formatSourceLabel(feed.sourceType)}</span>
              </div>
              <p class="mt-1 text-muted-foreground">
                {feed.status === "skipped" && feed.skipReason !== null ? formatRefreshSkipReason(feed.skipReason) : `${feed.status}: ${feed.itemsCreatedCount} new`}
              </p>
              <Show when={feed.error}>
                {(error) => <p class="mt-1 text-destructive">{error().message}</p>}
              </Show>
            </li>
          )}
        </For>
      </ul>
    </Show>
  );
}

function RefreshFeedResultList(props: { readonly results: readonly RefreshFeedResultWithFeed[] }) {
  return (
    <Show when={props.results.length > 0}>
      <ul class="space-y-1" aria-label="Latest refresh feed results">
        <For each={props.results}>
          {(result) => (
            <li class="border border-border bg-card px-2 py-1 text-[0.68rem] text-card-foreground">
              <div class="flex items-center justify-between gap-2">
                <span class="min-w-0 truncate font-semibold">{formatFeedLabel(result.feed)}</span>
                <span class="shrink-0 text-muted-foreground">{result.status}</span>
              </div>
              <p class="mt-1 text-muted-foreground">{result.itemsCreatedCount} new</p>
              <Show when={parseRefreshFeedResultError(result.errorSummaryJson)}>
                {(message) => <p class="mt-1 text-destructive">{message()}</p>}
              </Show>
            </li>
          )}
        </For>
      </ul>
    </Show>
  );
}

interface SettingsColumnSectionProps {
  readonly settings: () => readonly UserSetting[];
  readonly settingsUnavailable: () => boolean;
  readonly onSettingsChanged: () => Promise<void>;
}

function SettingsColumnSection(props: SettingsColumnSectionProps) {
  const [settingKey, setSettingKey] = createSignal("");
  const [settingValue, setSettingValue] = createSignal("");
  const [settingsError, setSettingsError] = createSignal<string | null>(null);
  const [settingsBusyKey, setSettingsBusyKey] = createSignal<string | null>(null);
  const [formBusy, setFormBusy] = createSignal(false);
  const [readerDensityBusy, setReaderDensityBusy] = createSignal(false);
  const readerDensity = createMemo(() => toReaderDensityFromSettings(props.settings()));

  const saveSetting = async () => {
    const key = settingKey().trim();
    if (key.length === 0) {
      setSettingsError("Enter a settings key before saving.");
      return;
    }

    setFormBusy(true);
    setSettingsError(null);
    try {
      await client.overlays.saveSetting({ key, value: settingValue() });
      setSettingKey("");
      setSettingValue("");
      await props.onSettingsChanged();
    } catch (error) {
      setSettingsError(formatError(error));
    } finally {
      setFormBusy(false);
    }
  };

  const editSetting = (setting: UserSetting) => {
    setSettingKey(setting.key);
    setSettingValue(formatSettingValue(setting.valueJson));
    setSettingsError(null);
  };

  const deleteSetting = async (key: string) => {
    setSettingsBusyKey(key);
    setSettingsError(null);
    try {
      await client.overlays.deleteSetting({ key });
      if (settingKey() === key) {
        setSettingKey("");
        setSettingValue("");
      }
      await props.onSettingsChanged();
    } catch (error) {
      setSettingsError(formatError(error));
    } finally {
      setSettingsBusyKey(null);
    }
  };

  const saveReaderDensity = async (nextReaderDensity: ReaderDensity) => {
    setReaderDensityBusy(true);
    setSettingsError(null);
    try {
      await client.overlays.saveSetting({ key: readerDensitySettingKey, value: nextReaderDensity });
      await props.onSettingsChanged();
    } catch (error) {
      setSettingsError(formatError(error));
    } finally {
      setReaderDensityBusy(false);
    }
  };

  const useReaderDensityDefault = async () => {
    setReaderDensityBusy(true);
    setSettingsError(null);
    try {
      await client.overlays.deleteSetting({ key: readerDensitySettingKey });
      await props.onSettingsChanged();
    } catch (error) {
      setSettingsError(formatError(error));
    } finally {
      setReaderDensityBusy(false);
    }
  };

  return (
    <section class="border-t border-border px-2 py-2" aria-labelledby="settings-section-title" data-settings-entry-point>
      <div class="flex items-center justify-between gap-2">
        <h3 id="settings-section-title" class="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Settings
        </h3>
        <span class="text-[0.68rem] text-muted-foreground">{props.settings().length} saved</span>
      </div>
      <Show when={settingsError()}>
        {(message) => <p class="mt-2 border border-destructive px-2 py-1.5 text-[0.72rem] text-destructive">{message()}</p>}
      </Show>
      <Show when={props.settingsUnavailable()}>
        <p class="mt-2 border border-destructive px-2 py-1.5 text-[0.72rem] text-destructive">Settings unavailable.</p>
      </Show>
      <section class="mt-2 border border-border bg-background p-2" aria-labelledby="reader-density-title" data-typed-settings>
        <p id="reader-density-title" class="text-[0.72rem] font-semibold text-foreground">Reader density</p>
        <p class="mt-1 text-[0.68rem] leading-5 text-muted-foreground">
          Controls the actual spacing used by source, feed, and video rows. Comfortable is the app default when no setting is saved.
        </p>
        <label class="sr-only" for={readerDensityInputId}>Reader density</label>
        <select
          id={readerDensityInputId}
          class="mt-2 w-full border border-input bg-background px-2 py-1.5 text-xs text-foreground outline-none transition focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
          value={readerDensity()}
          disabled={readerDensityBusy() || props.settingsUnavailable()}
          onChange={async (event) => {
            const nextReaderDensity = readerDensityValues.find((value) => value === event.currentTarget.value);
            if (nextReaderDensity !== undefined) {
              await saveReaderDensity(nextReaderDensity);
            }
          }}
        >
          <For each={readerDensityOptions}>
            {(option) => <option value={option.value}>{option.label}</option>}
          </For>
        </select>
        <p class="mt-1 text-[0.68rem] leading-5 text-muted-foreground">
          {readerDensityOptions.find((option) => option.value === readerDensity())?.helper}
        </p>
        <button
          type="button"
          class="mt-2 w-full border border-border bg-card px-2 py-1 text-[0.68rem] font-semibold text-card-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
          disabled={readerDensityBusy() || props.settingsUnavailable()}
          onClick={useReaderDensityDefault}
        >
          Use app default
        </button>
      </section>
      <details class="mt-2 border border-border bg-background p-2" data-advanced-settings>
        <summary class="cursor-pointer text-[0.72rem] font-semibold text-foreground">Advanced settings</summary>
        <p class="mt-2 text-[0.68rem] leading-5 text-muted-foreground">
          Edit raw stored keys only when a typed control is unavailable.
        </p>
        <form
          class="mt-2 space-y-2 border border-border bg-card p-2"
          onSubmit={async (event) => {
            event.preventDefault();
            await saveSetting();
          }}
        >
          <label class="sr-only" for={settingKeyInputId}>Setting key</label>
          <input
            id={settingKeyInputId}
            class="w-full border border-input bg-background px-2 py-1.5 text-xs text-foreground outline-none transition focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
            value={settingKey()}
            maxlength={64}
            pattern={settingKeyPattern}
            placeholder="setting.key"
            autocomplete="off"
            onInput={(event) => setSettingKey(event.currentTarget.value)}
          />
          <label class="sr-only" for={settingValueInputId}>Setting value</label>
          <input
            id={settingValueInputId}
            class="w-full border border-input bg-background px-2 py-1.5 text-xs text-foreground outline-none transition focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
            value={settingValue()}
            maxlength={4096}
            placeholder="Value"
            onInput={(event) => setSettingValue(event.currentTarget.value)}
          />
          <div class="grid grid-cols-2 gap-2">
            <button
              type="submit"
              class="border border-border bg-primary px-2 py-1.5 text-xs font-semibold text-primary-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
              disabled={formBusy()}
            >
              Save
            </button>
            <button
              type="button"
              class="border border-border bg-card px-2 py-1.5 text-xs font-semibold text-card-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              onClick={() => {
                setSettingKey("");
                setSettingValue("");
                setSettingsError(null);
              }}
            >
              Clear
            </button>
          </div>
        </form>
        <Show when={props.settings().length === 0}>
          <p class="mt-2 text-[0.72rem] leading-5 text-muted-foreground">No settings have been saved.</p>
        </Show>
        <Show when={props.settings().length > 0}>
            <ol class="mt-2 space-y-1" aria-label="Saved settings">
              <For each={props.settings()}>
                {(setting) => (
                  <li class="border border-border bg-card p-2">
                    <button
                      type="button"
                      class="w-full text-left text-card-foreground transition hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      onClick={() => editSetting(setting)}
                    >
                      <span class="block truncate text-xs font-semibold">{setting.key}</span>
                      <span class="mt-1 block truncate text-[0.68rem] text-muted-foreground">
                        {formatSettingValue(setting.valueJson)}
                      </span>
                    </button>
                    <button
                      type="button"
                      class="mt-2 w-full border border-border bg-background px-2 py-1 text-[0.68rem] font-semibold text-destructive transition hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={settingsBusyKey() === setting.key}
                      onClick={async () => {
                        await deleteSetting(setting.key);
                      }}
                    >
                      Delete
                    </button>
                  </li>
                )}
              </For>
            </ol>
        </Show>
      </details>
    </section>
  );
}

interface PlaylistColumnSectionProps {
  readonly selectedPlaylistId: () => string | null;
  readonly playlistItemsReloadKey: () => number;
  readonly onSelectPlaylist: (playlistId: string | null) => void;
  readonly onSelectContent: (contentItem: CatalogContentListItem) => Promise<void>;
}

function PlaylistColumnSection(props: PlaylistColumnSectionProps) {
  const [playlists, { refetch: refetchPlaylists }] = createResource(() => client.overlays.playlists());
  const [playlistName, setPlaylistName] = createSignal("");
  const [playlistDescription, setPlaylistDescription] = createSignal("");
  const [playlistSortMode, setPlaylistSortMode] = createSignal<PlaylistSortMode>("manual");
  const [editingPlaylist, setEditingPlaylist] = createSignal<Playlist | null>(null);
  const [playlistError, setPlaylistError] = createSignal<string | null>(null);
  const [playlistBusy, setPlaylistBusy] = createSignal(false);
  const selectedPlaylistItemsInput = createMemo(() => {
    const playlistId = props.selectedPlaylistId();
    if (playlistId === null) {
      return null;
    }

    return `${playlistId}\u001f${props.playlistItemsReloadKey().toString()}`;
  });
  const [selectedPlaylistItems, { refetch: refetchSelectedPlaylistItems }] = createResource(
    selectedPlaylistItemsInput,
    (resourceKey) => {
      const [playlistId] = resourceKey.split("\u001f", 1);
      if (playlistId === undefined) {
        return emptyPlaylistItems;
      }

      return client.overlays.playlistItems({ playlistId });
    },
  );
  const selectedPlaylist = createMemo(
    () => playlists()?.find((playlist) => playlist.id === props.selectedPlaylistId()) ?? null,
  );
  const selectedPlaylistUsesManualOrder = createMemo(() => selectedPlaylist()?.sortMode === "manual");

  const editPlaylist = (playlist: Playlist | null) => {
    props.onSelectPlaylist(playlist?.id ?? null);
    setEditingPlaylist(playlist);
    setPlaylistName(playlist?.name ?? "");
    setPlaylistDescription(playlist?.description ?? "");
    setPlaylistSortMode(playlist?.sortMode ?? "manual");
  };

  const createPlaylist = async () => {
    const name = playlistName().trim();
    if (name.length === 0) {
      setPlaylistError("Name the playlist before saving.");
      return;
    }

    setPlaylistBusy(true);
    setPlaylistError(null);
    try {
      const playlist = await client.overlays.createPlaylist({
        name,
        description: playlistDescription().trim().length === 0 ? null : playlistDescription().trim(),
        sortMode: playlistSortMode(),
      });
      await refetchPlaylists();
      editPlaylist(playlist);
    } catch (error) {
      setPlaylistError(formatError(error));
    } finally {
      setPlaylistBusy(false);
    }
  };

  const updatePlaylist = async (playlist: Playlist) => {
    const name = playlistName().trim();
    if (name.length === 0) {
      setPlaylistError("Name the playlist before saving.");
      return;
    }

    setPlaylistBusy(true);
    setPlaylistError(null);
    try {
      await client.overlays.updatePlaylist({
        playlistId: playlist.id,
        name,
        description: playlistDescription().trim().length === 0 ? null : playlistDescription().trim(),
        sortMode: playlistSortMode(),
        position: playlist.position,
      });
      await refetchPlaylists();
    } catch (error) {
      setPlaylistError(formatError(error));
    } finally {
      setPlaylistBusy(false);
    }
  };

  const deletePlaylist = async (playlistId: string) => {
    setPlaylistBusy(true);
    setPlaylistError(null);
    try {
      await client.overlays.deletePlaylist({ playlistId });
      editPlaylist(null);
      await refetchPlaylists();
    } catch (error) {
      setPlaylistError(formatError(error));
    } finally {
      setPlaylistBusy(false);
    }
  };

  const removePlaylistItem = async (item: PlaylistItemWithContent) => {
    setPlaylistBusy(true);
    setPlaylistError(null);
    try {
      await client.overlays.removePlaylistItem({ playlistId: item.playlistId, playlistItemId: item.id });
      await refetchSelectedPlaylistItems();
    } catch (error) {
      setPlaylistError(formatError(error));
    } finally {
      setPlaylistBusy(false);
    }
  };

  const movePlaylistItem = async (item: PlaylistItemWithContent, direction: -1 | 1) => {
    const items = selectedPlaylistItems() ?? emptyPlaylistItems;
    const currentIndex = items.findIndex((candidate) => candidate.id === item.id);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= items.length) {
      return;
    }

    const orderedItemIds = items.map((candidate) => candidate.id);
    const currentId = orderedItemIds[currentIndex];
    const targetId = orderedItemIds[targetIndex];
    if (currentId === undefined || targetId === undefined) {
      return;
    }

    orderedItemIds[currentIndex] = targetId;
    orderedItemIds[targetIndex] = currentId;
    setPlaylistBusy(true);
    setPlaylistError(null);
    try {
      await client.overlays.reorderPlaylistItems({ playlistId: item.playlistId, playlistItemIds: orderedItemIds });
      await refetchSelectedPlaylistItems();
    } catch (error) {
      setPlaylistError(formatError(error));
    } finally {
      setPlaylistBusy(false);
    }
  };

  return (
    <section class="border-t border-border px-2 py-2" aria-labelledby="playlist-section-title">
      <div class="flex items-center justify-between gap-2">
        <h3 id="playlist-section-title" class="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Playlists
        </h3>
        <span class="text-[0.68rem] text-muted-foreground">{playlists()?.length ?? 0} saved</span>
      </div>
      <Show when={(playlists()?.length ?? 0) > 0}>
        <div class="mt-2">
          <label class="sr-only" for="source-playlist-selector">Selected playlist</label>
          <select
            id="source-playlist-selector"
            class="w-full border border-input bg-background px-2 py-1.5 text-xs text-foreground outline-none transition focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
            value={props.selectedPlaylistId() ?? ""}
            onChange={(event) => {
              const playlistId = event.currentTarget.value;
              editPlaylist(playlistId.length === 0 ? null : playlists()?.find((playlist) => playlist.id === playlistId) ?? null);
            }}
            data-compact-playlist-selector
          >
            <option value="">No playlist selected</option>
            <For each={playlists() ?? emptyPlaylists}>{(playlist) => <option value={playlist.id}>{playlist.name}</option>}</For>
          </select>
        </div>
      </Show>
      <Show when={playlistError()}>
        {(message) => <p class="mt-2 border border-destructive px-2 py-1.5 text-[0.72rem] text-destructive">{message()}</p>}
      </Show>
      <details class="mt-2 border border-border bg-background p-2" data-playlist-management-panel>
        <summary class="cursor-pointer text-xs font-semibold text-foreground">Manage playlists</summary>
        <form
          class="mt-2 space-y-2 border border-border bg-background p-2"
          onSubmit={async (event) => {
            event.preventDefault();
            const playlist = editingPlaylist();
            if (playlist === null) {
              await createPlaylist();
            } else {
              await updatePlaylist(playlist);
            }
          }}
        >
        <label class="sr-only" for={playlistNameInputId}>Playlist name</label>
        <input
          id={playlistNameInputId}
          class="w-full border border-input bg-background px-2 py-1.5 text-xs text-foreground outline-none transition focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
          value={playlistName()}
          maxlength={120}
          placeholder="Playlist name"
          onInput={(event) => setPlaylistName(event.currentTarget.value)}
        />
        <label class="sr-only" for={playlistDescriptionInputId}>Playlist description</label>
        <textarea
          id={playlistDescriptionInputId}
          class="min-h-14 w-full resize-none border border-input bg-background px-2 py-1.5 text-xs text-foreground outline-none transition focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
          value={playlistDescription()}
          maxlength={2000}
          placeholder="Description"
          onInput={(event) => setPlaylistDescription(event.currentTarget.value)}
        />
        <label class="sr-only" for={playlistSortInputId}>Playlist order</label>
        <select
          id={playlistSortInputId}
          class="w-full border border-input bg-background px-2 py-1.5 text-xs text-foreground outline-none transition focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
          value={playlistSortMode()}
          onChange={(event) => setPlaylistSortMode(toPlaylistSortMode(event.currentTarget.value))}
        >
          <For each={playlistSortOptions}>{(option) => <option value={option.value}>{option.label}</option>}</For>
        </select>
        <div class="grid grid-cols-2 gap-2">
          <button
            type="submit"
            class="border border-border bg-primary px-2 py-1.5 text-xs font-semibold text-primary-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
            disabled={playlistBusy()}
          >
            {editingPlaylist() === null ? "Create" : "Save"}
          </button>
          <button
            type="button"
            class="border border-border bg-card px-2 py-1.5 text-xs font-semibold text-card-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            onClick={() => {
              editPlaylist(null);
            }}
          >
            New
          </button>
        </div>
        </form>
        <Switch>
        <Match when={playlists.loading}>
          <p class="mt-2 text-[0.72rem] leading-5 text-muted-foreground">Loading playlists.</p>
        </Match>
        <Match when={playlists.error !== undefined}>
          <p class="mt-2 text-[0.72rem] leading-5 text-destructive">Playlists unavailable.</p>
        </Match>
        <Match when={(playlists()?.length ?? 0) === 0}>
          <p class="mt-2 text-[0.72rem] leading-5 text-muted-foreground">Create a playlist to collect videos.</p>
        </Match>
        <Match when={playlists()}>
          {(loadedPlaylists) => (
            <ol class="mt-2 space-y-1" aria-label="Playlists">
              <For each={loadedPlaylists()}>
                {(playlist) => (
                  <li class="border border-border bg-card p-2">
                    <button
                      type="button"
                      class="w-full text-left text-card-foreground transition hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      aria-pressed={props.selectedPlaylistId() === playlist.id}
                      onClick={() => editPlaylist(props.selectedPlaylistId() === playlist.id ? null : playlist)}
                    >
                      <span class="block truncate text-xs font-semibold">{playlist.name}</span>
                      <span class="mt-1 block truncate text-[0.68rem] text-muted-foreground">
                        {formatPlaylistSortMode(playlist.sortMode)}
                      </span>
                    </button>
                    <Show when={props.selectedPlaylistId() === playlist.id}>
                      <div class="mt-2 flex gap-2">
                        <button
                          type="button"
                          class="flex-1 border border-border bg-background px-2 py-1 text-[0.68rem] font-semibold text-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
                          disabled={playlistBusy()}
                          onClick={async () => {
                            await updatePlaylist(playlist);
                          }}
                        >
                          Update
                        </button>
                        <button
                          type="button"
                          class="flex-1 border border-border bg-background px-2 py-1 text-[0.68rem] font-semibold text-destructive transition hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
                          disabled={playlistBusy()}
                          onClick={async () => {
                            await deletePlaylist(playlist.id);
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </Show>
                  </li>
                )}
              </For>
            </ol>
          )}
        </Match>
        </Switch>
        <Show when={props.selectedPlaylistId() !== null}>
        <section class="mt-2 border-t border-border pt-2" aria-label="Selected playlist videos">
          <Switch>
            <Match when={selectedPlaylistItems.loading}>
              <p class="text-[0.72rem] leading-5 text-muted-foreground">Loading playlist videos.</p>
            </Match>
            <Match when={selectedPlaylistItems.error !== undefined}>
              <p class="text-[0.72rem] leading-5 text-destructive">Playlist videos unavailable.</p>
            </Match>
            <Match when={(selectedPlaylistItems()?.length ?? 0) === 0}>
              <p class="text-[0.72rem] leading-5 text-muted-foreground">Add the selected video from the viewer.</p>
            </Match>
            <Match when={selectedPlaylistItems()}>
              {(items) => (
                <ol class="space-y-1" aria-label="Videos in selected playlist">
                  <For each={items()}>
                    {(item, index) => (
                      <PlaylistItemRow
                        item={item}
                        itemIndex={index()}
                        itemCount={items().length}
                        busy={playlistBusy()}
                        showManualControls={selectedPlaylistUsesManualOrder()}
                        onSelectContent={props.onSelectContent}
                        onMove={movePlaylistItem}
                        onRemove={removePlaylistItem}
                      />
                    )}
                  </For>
                </ol>
              )}
            </Match>
          </Switch>
        </section>
        </Show>
      </details>
    </section>
  );
}

interface PlaylistItemRowProps {
  readonly item: PlaylistItemWithContent;
  readonly itemIndex: number;
  readonly itemCount: number;
  readonly busy: boolean;
  readonly showManualControls: boolean;
  readonly onSelectContent: (contentItem: CatalogContentListItem) => Promise<void>;
  readonly onMove: (item: PlaylistItemWithContent, direction: -1 | 1) => Promise<void>;
  readonly onRemove: (item: PlaylistItemWithContent) => Promise<void>;
}

function PlaylistItemRow(props: PlaylistItemRowProps) {
  return (
    <li class="border border-border bg-background p-2">
      <button
        type="button"
        class="w-full text-left text-foreground transition hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        onClick={async () => {
          await props.onSelectContent(props.item.content);
        }}
      >
        <span class="block truncate text-[0.72rem] font-semibold">{props.item.content.title}</span>
        <span class="mt-1 block truncate text-[0.68rem] text-muted-foreground">{props.item.content.creator.displayName}</span>
      </button>
      <div class={`mt-2 grid ${props.showManualControls ? "grid-cols-3" : "grid-cols-1"} gap-1`} data-manual-reorder={props.showManualControls ? "true" : "false"}>
        <Show when={props.showManualControls}>
          <button
            type="button"
            class="border border-border bg-card px-1 py-1 text-[0.68rem] text-card-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
            disabled={props.busy || props.itemIndex === 0}
            onClick={async () => {
              await props.onMove(props.item, -1);
            }}
          >
            Up
          </button>
          <button
            type="button"
            class="border border-border bg-card px-1 py-1 text-[0.68rem] text-card-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
            disabled={props.busy || props.itemIndex === props.itemCount - 1}
            onClick={async () => {
              await props.onMove(props.item, 1);
            }}
          >
            Down
          </button>
        </Show>
        <button
          type="button"
          class="border border-border bg-card px-1 py-1 text-[0.68rem] text-destructive transition hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
          disabled={props.busy}
          onClick={async () => {
            await props.onRemove(props.item);
          }}
        >
          Remove
        </button>
      </div>
    </li>
  );
}

interface FeedRowProps {
  readonly feed: CatalogFeed;
  readonly creatorImageUrl?: string | null;
  readonly isSelected?: boolean;
  readonly readerDensity?: ReaderDensity;
  readonly onSelectFeed?: (feed: CatalogFeed) => void;
}

function FeedRow(props: FeedRowProps) {
  const selected = createMemo(() => props.isSelected ?? false);
  const feedTitle = createMemo(() => props.feed.title ?? props.feed.url);
  const feedUrl = createMemo(() => (props.feed.title === null ? null : props.feed.url));
  const rowClass = createMemo(() =>
    `border border-border ${readerDensityPaddingClass(props.readerDensity ?? "comfortable")} transition hover:border-ring hover:bg-accent hover:text-accent-foreground ${selected() ? "bg-card" : "bg-background"}`,
  );
  const rowBodyClass = createMemo(() =>
    props.creatorImageUrl === null || props.creatorImageUrl === undefined
      ? "min-w-0"
      : "grid grid-cols-[2.75rem_1fr] gap-2",
  );
  const content = () => (
    <span class={rowBodyClass()}>
      <Show when={props.creatorImageUrl}>
        {(imageUrl) => (
          <span class="aspect-square overflow-hidden border border-border bg-muted" data-feed-image="creator">
            <img class="h-full w-full object-cover" src={imageUrl()} alt="" loading="lazy" />
          </span>
        )}
      </Show>
      <span class="min-w-0">
        <span class="flex items-center justify-between gap-2">
          <span class="min-w-0 truncate text-[0.72rem] font-semibold text-foreground" data-feed-title>
            {feedTitle()}
          </span>
          <span data-feed-source-chip>
            <SourceIconBadge sourceType={props.feed.sourceType} context="feed" />
          </span>
        </span>
        <Show when={feedUrl()}>
          {(url) => <span class="mt-1 block truncate text-[0.68rem] text-muted-foreground" data-feed-url>{url()}</span>}
        </Show>
        <span class="mt-1 block truncate text-[0.68rem] text-muted-foreground" data-feed-refresh-metadata>
          {formatFeedRefreshMetadata(props.feed)}
        </span>
        <span class="mt-1 block truncate text-[0.68rem] text-muted-foreground" data-feed-next-refresh-metadata>
          {formatFeedNextRefreshMetadata(props.feed)}
        </span>
        <Show when={props.onSelectFeed}>
          <span class="mt-1 block text-[0.68rem] font-semibold text-muted-foreground" data-feed-action-label>
            {selected() ? "Selected feed" : "Filter feed"}
          </span>
        </Show>
      </span>
    </span>
  );

  return (
    <li class={rowClass()} data-selected={selected() ? "true" : "false"} data-selected-feed-id={selected() ? props.feed.id : ""}>
      <Show
        when={props.onSelectFeed}
        fallback={
          content()
        }
      >
        {(onSelectFeed) => (
          <button
            type="button"
            class="w-full text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            aria-pressed={selected()}
            onClick={() => onSelectFeed()(props.feed)}
          >
            {content()}
          </button>
        )}
      </Show>
    </li>
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

interface ContentListItemRowProps {
  readonly contentItem: CatalogContentListItem;
  readonly isAuthenticated: boolean;
  readonly isFavorite: boolean;
  readonly status: ContentStatusFlags;
  readonly selected: boolean;
  readonly favoritesView: boolean;
  readonly readerDensity: ReaderDensity;
  readonly targetPlaylistId: string | null;
  readonly onSelectContent: (contentItem: CatalogContentListItem) => Promise<void>;
  readonly onMarkOpened: (contentItemId: string) => Promise<void>;
  readonly onMarkPlayed: (contentItemId: string) => Promise<void>;
  readonly onToggleFavorite: (contentItemId: string) => Promise<void>;
  readonly onAddToPlaylist: (contentItemId: string) => Promise<void>;
}

function ContentListItemRow(props: ContentListItemRowProps) {
  const [favoriteError, setFavoriteError] = createSignal<string | null>(null);
  const [favoriteBusy, setFavoriteBusy] = createSignal(false);
  const [statusError, setStatusError] = createSignal<string | null>(null);
  const [statusBusy, setStatusBusy] = createSignal<"opened" | "played" | null>(null);
  const [playlistBusy, setPlaylistBusy] = createSignal(false);
  const [playlistError, setPlaylistError] = createSignal<string | null>(null);
  const rowImageUrl = createMemo(() => props.contentItem.thumbnailUrl ?? props.contentItem.creator.imageUrl);
  const rowImageSource = createMemo(() => (props.contentItem.thumbnailUrl !== null ? "content" : props.contentItem.creator.imageUrl !== null ? "creator" : null));
  const contentButtonClass = createMemo(() =>
    rowImageUrl() === null
      ? "group w-full text-left text-foreground transition hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      : "group grid w-full grid-cols-[4.75rem_1fr] gap-2 text-left text-foreground transition hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
  );

  const toggleFavorite = async () => {
    setFavoriteBusy(true);
    setFavoriteError(null);
    try {
      await props.onToggleFavorite(props.contentItem.id);
    } catch (error) {
      setFavoriteError(formatError(error));
    } finally {
      setFavoriteBusy(false);
    }
  };

  const markOpened = async () => {
    setStatusBusy("opened");
    setStatusError(null);
    try {
      await props.onMarkOpened(props.contentItem.id);
    } catch (error) {
      setStatusError(formatError(error));
    } finally {
      setStatusBusy(null);
    }
  };

  const markPlayed = async () => {
    setStatusBusy("played");
    setStatusError(null);
    try {
      await props.onMarkPlayed(props.contentItem.id);
    } catch (error) {
      setStatusError(formatError(error));
    } finally {
      setStatusBusy(null);
    }
  };

  const addToPlaylist = async () => {
    setPlaylistBusy(true);
    setPlaylistError(null);
    try {
      await props.onAddToPlaylist(props.contentItem.id);
    } catch (error) {
      setPlaylistError(formatError(error));
    } finally {
      setPlaylistBusy(false);
    }
  };

  return (
    <div
      class={`border border-border ${readerDensityPaddingClass(props.readerDensity)} transition hover:border-ring hover:bg-accent hover:text-accent-foreground ${props.status.played ? "bg-muted" : props.status.opened ? "bg-card" : "bg-background"}`}
      data-selected={props.selected ? "true" : "false"}
      data-opened={props.status.opened ? "true" : "false"}
      data-played={props.status.played ? "true" : "false"}
      data-favorite={props.isFavorite ? "true" : "false"}
    >
      <button
        type="button"
        class={contentButtonClass()}
        aria-pressed={props.selected}
        onClick={async () => {
          await props.onSelectContent(props.contentItem);
        }}
      >
        <Show when={rowImageUrl()}>
          {(imageUrl) => (
            <span class="aspect-video overflow-hidden border border-border bg-muted" data-thumbnail-source={rowImageSource() ?? ""}>
              <img
                class="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                src={imageUrl()}
                alt=""
                loading="lazy"
              />
            </span>
          )}
        </Show>
        <span class="min-w-0">
          <span class="flex items-start justify-between gap-2">
            <span class="min-w-0 truncate text-xs font-semibold">{props.contentItem.title}</span>
            <span data-content-source-chip data-content-source-indicator>
              <SourceIconBadge sourceType={props.contentItem.sourceType} context="content" sourceCount={props.contentItem.sourceCount} />
            </span>
          </span>
          <span class="mt-1 block truncate text-[0.68rem] text-muted-foreground">
            {props.contentItem.creator.displayName}
          </span>
          <span class="mt-1 flex items-center justify-between gap-2 text-[0.68rem] text-muted-foreground">
            <span class="truncate">{formatPublishedAt(props.contentItem.publishedAt)}</span>
            <span class="shrink-0">{formatDuration(props.contentItem.durationSeconds)}</span>
          </span>
          <Show when={props.selected || props.status.opened || props.status.played || props.isFavorite}>
            <span class="mt-1 flex items-center gap-1 text-[0.62rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              <Show when={props.selected}>
                <span class="border border-border bg-background px-1 py-0.5" data-content-status="selected">Selected</span>
              </Show>
              <Show when={props.status.opened}>
                <span class="border border-border bg-background px-1 py-0.5" data-content-status="opened">Opened</span>
              </Show>
              <Show when={props.status.played}>
                <span class="border border-border bg-background px-1 py-0.5" data-content-status="played">Played</span>
              </Show>
              <Show when={props.isFavorite}>
                <span class="border border-border bg-background px-1 py-0.5" data-content-status="favorite">Favorite</span>
              </Show>
            </span>
          </Show>
        </span>
      </button>
      <Show when={props.isAuthenticated}>
        <div class="mt-2 flex items-center justify-end gap-2">
          <Show when={statusError()}>
            {(message) => <p class="min-w-0 flex-1 truncate text-[0.68rem] text-destructive">{message()}</p>}
          </Show>
          <Show when={favoriteError()}>
            {(message) => <p class="min-w-0 flex-1 truncate text-[0.68rem] text-destructive">{message()}</p>}
          </Show>
          <Show when={playlistError()}>
            {(message) => <p class="min-w-0 flex-1 truncate text-[0.68rem] text-destructive">{message()}</p>}
          </Show>
          <button
            type="button"
            class="border border-border bg-card px-2 py-1 text-[0.68rem] font-semibold text-card-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
            disabled={playlistBusy() || props.targetPlaylistId === null}
            onClick={addToPlaylist}
            data-content-row-add-playlist
          >
            Add to playlist
          </button>
          <button
            type="button"
            class="border border-border bg-card px-2 py-1 text-[0.68rem] font-semibold text-card-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
            aria-pressed={props.status.opened}
            disabled={statusBusy() !== null || props.status.opened}
            onClick={markOpened}
          >
            {props.status.opened ? "Opened" : "Mark opened"}
          </button>
          <button
            type="button"
            class="border border-border bg-card px-2 py-1 text-[0.68rem] font-semibold text-card-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
            aria-pressed={props.status.played}
            disabled={statusBusy() !== null || props.status.played}
            onClick={markPlayed}
          >
            {props.status.played ? "Played" : "Mark played"}
          </button>
          <button
            type="button"
            class="border border-border bg-card px-2 py-1 text-[0.68rem] font-semibold text-card-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
            aria-pressed={props.isFavorite}
            disabled={favoriteBusy()}
            onClick={toggleFavorite}
          >
            {props.favoritesView || props.isFavorite ? "Remove favorite" : "Favorite"}
          </button>
        </div>
      </Show>
    </div>
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
