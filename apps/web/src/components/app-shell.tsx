import type {
  CatalogContentListItem,
  CatalogCreatorSummary,
  CatalogFeed,
  RefreshFeedResultWithFeed,
  RefreshRun,
  SourceType,
  UserContentStatus,
  UserSetting,
  UserSubscriptionWithCreator,
} from "@FeedElity/api";
import { For, Match, Show, Suspense, Switch, createEffect, createMemo, createResource, createSignal, on, onCleanup, onMount, untrack } from "solid-js";
import ArrowDownAZ from "lucide-solid/icons/arrow-down-a-z";
import ClockArrowDown from "lucide-solid/icons/clock-arrow-down";
import LayoutGrid from "lucide-solid/icons/layout-grid";
import TriangleAlert from "lucide-solid/icons/triangle-alert";
import ChevronDown from "lucide-solid/icons/chevron-down";
import Plus from "lucide-solid/icons/plus";
import RefreshCw from "lucide-solid/icons/refresh-cw";
import Settings from "lucide-solid/icons/settings";
import X from "lucide-solid/icons/x";
import Zap from "lucide-solid/icons/zap";

import { authClient } from "@/lib/auth-client";
import { createDebouncedValue } from "@/utils/debounce";
import { client } from "@/utils/orpc";

import { ContentListColumn } from "./app-shell-content-column";
import { PaneResizer } from "./pane-resizer";
import { CreatorSourceRow, FeedRow } from "./app-shell-rows";
import { RefreshStatusDialog } from "./refresh-status-dialog";
import {
  PlaylistColumnSection,
  CollectionColumnSection,
  SubscriptionActionButton,
} from "./app-shell-source-sections";
import {
  creatorListLimit,
  creatorListSortInputId,
  creatorListSortSettingKey,
  creatorListSortValues,
  creatorSearchInputId,
  creatorSourceFilterId,
  defaultLeftFraction,
  defaultMiddleFraction,
  emptyAppendedPageState,
  feedListLimit,
  formatError,
  formatSourceLabel,
  joinFeedResultsWithFeeds,
  leftPaneTabLabels,
  minLeftFraction,
  minMiddleFraction,
  minRightFraction,
  clampLeftFraction,
  clampMiddleFraction,
  pageHasMoreForKey,
  pageItemsForKey,
  paneWidthsLocalStorageKey,
  shellGridClass,
  shellRootClass,
  sourceActionsRegionClass,
  sourceCatalogRegionClass,
  sourceColumnClass,
  sourceCreatorListRegionClass,
  sourceFeedListRegionClass,
  sourceHeaderRegionClass,
  toDesktopColumnTemplate,
  toFeedListInput,
  toCreatorListInput,
  toCreatorListSortFromSettings,
  toReaderDensityFromSettings,
  type AppendedPageState,
  type BrowsableCreator,
  type CreatorListInput,
  type CreatorListSort,
  type FeedListInput,
  type LeftPaneTab,
  type MiddlePanePanel,
  type PersistedPaneWidths,
  type ReaderDensity,
  type ShellMode,
  type ViewerMode,
} from "./app-shell.contract";
import { SelectedContentViewer } from "./app-shell-viewer";
import { SourceTypeIcon } from "./source-indicator";

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
  creatorListSortInputId,
  creatorListSortSettingKey,
  creatorListSortValues,
  creatorSearchInputId,
  creatorSourceFilterId,
  desktopShellGridClass,
  formatRefreshReportSummary,
  formatRefreshRunSummary,
  formatSettingValue,
  getShellColumnCount,
  hasInternalAppHeader,
  leftPaneTabLabels,
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
  toCreatorListSortFromSettings,
  toReaderDensityFromSettings,
  toRefreshStatusResourceKey,
  toPlayableSources,
  toSafePlaybackUrl,
  toShellContentSelectionState,
  toShellSelectionState,
  viewerColumnClass,
  viewerScrollRegionClass,
  type ContentViewMode,
  type CreatorListSort,
  type LeftPaneTab,
  type MiddlePanePanel,
  type PlayableSource,
  type ReaderDensity,
  type ShellMode,
  type ShellColumnDefinition,
  type ShellContentSelectionState,
  type ShellSelectionState,
  type ViewerMode,
} from "./app-shell.contract";

const sourceFilterOptions: readonly SourceType[] = ["youtube", "odysee", "peertube"];

type SubscriptionAction = "subscribe" | "unsubscribe";

const emptyCatalogFeeds: readonly CatalogFeed[] = [];

const emptyBrowsableCreators: readonly BrowsableCreator[] = [];

const emptySubscriptions: readonly UserSubscriptionWithCreator[] = [];

const emptyUserContentStatuses: readonly UserContentStatus[] = [];

const emptyUserSettings: readonly UserSetting[] = [];

function toCreatorListResourceKey(input: CreatorListInput, reloadKey: number): string {
  return [
    reloadKey.toString(),
    input.search ?? "",
    input.sourceType ?? "",
    input.sort,
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

// Moves the currently selected creator to index 0 of the display list so the
// selection stays findable regardless of the dynamic lastUpdate sort, while
// preserving the relative order of every other row. Pure derivation over the
// merged display array only — pagination state and the underlying pages are
// untouched.
function pinSelectedCreatorFirst(
  creators: readonly BrowsableCreator[],
  selectedCreatorId: string | null,
): readonly BrowsableCreator[] {
  if (selectedCreatorId === null) {
    return creators;
  }

  const selected = creators.find((creator) => creator.id === selectedCreatorId);
  if (selected === undefined) {
    return creators;
  }

  return [selected, ...creators.filter((creator) => creator.id !== selectedCreatorId)];
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
  readonly activeTab: () => LeftPaneTab;
  readonly setActiveTab: (tab: LeftPaneTab) => void;
  readonly readerDensity: () => ReaderDensity;
  readonly creatorSort: () => CreatorListSort;
  readonly onCreatorSortChange: (sort: CreatorListSort) => Promise<void>;
  readonly selectedCreatorId: () => string | null;
  readonly selectedCreator: () => BrowsableCreator | null;
  readonly selectedFeed: () => CatalogFeed | null;
  readonly selectedPlaylistId: () => string | null;
  readonly selectedCollectionId: () => string | null;
  readonly catalogReloadKey: () => number;
  readonly subscriptionsReloadKey: () => number;
  readonly playlistItemsReloadKey: () => number;
  readonly collectionsReloadKey: () => number;
  readonly onCollectionsChanged: () => void;
  readonly middlePanePanel: () => MiddlePanePanel | null;
  readonly onContentListLiveReload: () => void;
  readonly onSubscriptionsChanged: () => void;
  readonly onClearCreator: () => void;
  readonly onSelectCreator: (creator: BrowsableCreator) => void;
  readonly onSelectFeed: (feed: CatalogFeed | null) => void;
  readonly onSelectPlaylist: (playlistId: string | null) => void;
  readonly onSelectCollection: (collectionId: string | null) => void;
  readonly onSelectContent: (contentItem: CatalogContentListItem) => Promise<void>;
  readonly onOpenMiddlePanePanel: (panel: MiddlePanePanel) => void;
  readonly onOpenSettings: () => void;
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

interface PaginationOffsetState {
  readonly key: string;
  readonly nextOffset: number;
}

function nextOffsetForKey(state: PaginationOffsetState, key: string, firstPageLength: number): number {
  return state.key === key ? state.nextOffset : firstPageLength;
}

function LoadMoreControl(props: LoadMoreControlProps) {
  return (
    <div class="mt-1 border-t border-border px-2 py-1.5" data-load-more-control>
      <div class="flex items-center justify-between gap-2">
        <span class="text-xs text-muted-foreground" data-loaded-count>
          {props.shownCount} loaded
        </span>
        <Show when={props.hasMore}>
          <button
            type="button"
            class="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs font-semibold text-card-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
            disabled={props.busy}
            aria-label={props.label}
            title={props.label}
            onClick={async () => {
              await props.onLoadMore();
            }}
          >
            <ChevronDown size={14} />
            {props.busy ? "Loading" : "More"}
          </button>
        </Show>
      </div>
      <Show when={props.errorMessage}>
        {(message) => <p class="mt-1 text-xs text-destructive">{message()}</p>}
      </Show>
    </div>
  );
}

function CreatorSourceColumn(props: CreatorSourceColumnProps) {
  const [search, setSearch] = createSignal("");
  // User-typed input debounce: the creator list (the catalog fetch input and
  // the client-side library filter) follows the search field only after typing
  // has settled for 300 ms, so catalog search no longer refetches per
  // keystroke. The input itself stays controlled by the immediate signal. This
  // reacts only to typed input — it is not a background refresh.
  const debouncedSearch = createDebouncedValue(search, 300);
  const [sourceType, setSourceType] = createSignal<SourceType | null>(null);
  const [appendedCatalogCreatorPage, setAppendedCatalogCreatorPage] = createSignal<AppendedPageState<BrowsableCreator>>(emptyAppendedPageState());
  const [catalogCreatorOffset, setCatalogCreatorOffset] = createSignal<PaginationOffsetState>({ key: "", nextOffset: 0 });
  const [creatorPageBusy, setCreatorPageBusy] = createSignal(false);
  const [creatorPageError, setCreatorPageError] = createSignal<string | null>(null);
  const [appendedFeedPage, setAppendedFeedPage] = createSignal<AppendedPageState<CatalogFeed>>(emptyAppendedPageState());
  const [feedPageBusy, setFeedPageBusy] = createSignal(false);
  const [feedOffset, setFeedOffset] = createSignal<PaginationOffsetState>({ key: "", nextOffset: 0 });
  const [feedPageError, setFeedPageError] = createSignal<string | null>(null);
  const [refreshBusy, setRefreshBusy] = createSignal<"normal" | "force" | null>(null);
  const [scopedRefreshBusy, setScopedRefreshBusy] = createSignal<string | null>(null);
  const [refreshError, setRefreshError] = createSignal<string | null>(null);
  const [creatorSortError, setCreatorSortError] = createSignal<string | null>(null);
  const [activeRefreshRunId, setActiveRefreshRunId] = createSignal<string | null>(null);
  const [refreshPollKey, setRefreshPollKey] = createSignal(0);
  // High-water mark of CREATED items seen during the current run. The content
  // list refetches ONLY when itemsCreatedCount strictly increases — i.e. when
  // the run actually persisted NEW content rows. itemsDiscoveredCount is the
  // wrong counter: it tracks every remote item fetched, including duplicates,
  // so feeds that return only already-known items would bump it and trigger a
  // refetch on every 2.5s poll — re-rendering the whole list for the entire
  // force-refresh-all run and pegging the CPU.
  const [refreshItemsSeen, setRefreshItemsSeen] = createSignal(0);
  // Snapshot of the last completed run so its full per-feed failure list stays
  // viewable after the run finishes — the status resource is nulled on
  // completion, which previously destroyed the failure data immediately.
  const [refreshStatusOpen, setRefreshStatusOpen] = createSignal(false);
  const [lastCompletedStatus, setLastCompletedStatus] = createSignal<{
    readonly run: RefreshRun;
    readonly results: readonly RefreshFeedResultWithFeed[];
  } | null>(null);
  const [libraryCreatorLimit, setLibraryCreatorLimit] = createSignal(creatorListLimit);
  const creatorListInput = createMemo(() => toCreatorListInput(debouncedSearch(), sourceType(), props.creatorSort()));
  const creatorListResourceKey = createMemo(() => toCreatorListResourceKey(creatorListInput(), props.catalogReloadKey()));
  const [creators] = createResource(
    creatorListResourceKey,
    () => client.catalog.creators(untrack(creatorListInput)),
  );
  const creatorsValue = createMemo(() => creators.latest);
  const subscriptionsResourceInput = createMemo(() => {
    if (!props.isAuthenticated()) {
      return null;
    }

    return `${props.mode}\u001f${props.subscriptionsReloadKey().toString()}`;
  });
  const [subscriptions] = createResource(subscriptionsResourceInput, () =>
    client.overlays.subscriptions(),
  );
  const subscriptionsValue = createMemo(() => subscriptions.latest);
  const feedListInput = createMemo(() => toFeedListInput(props.selectedCreatorId()));
  // Surgical reload signal scoped to the selected creator's feed rows only.
  // Bumped after a single-creator refresh so the feed metadata
  // (lastNormalRefreshAt / nextRefreshAfter) updates — WITHOUT bumping
  // catalogReloadKey, which would tear down the creator list, content list,
  // and video viewer.
  const [feedListReloadKey, setFeedListReloadKey] = createSignal(0);
  const feedListResourceKey = createMemo(() => `${toFeedListResourceKey(feedListInput())}${feedListReloadKey().toString()}`);
  const [feeds] = createResource(
    feedListResourceKey,
    () => {
      const input = untrack(feedListInput);
      return input === null ? emptyCatalogFeeds : client.catalog.feeds(input);
    },
  );
  const feedsValue = createMemo(() => feeds.latest);
  const activeRefreshStatusResourceKey = createMemo(() => {
    const runId = activeRefreshRunId();
    if (runId === null) {
      return null;
    }

    return `${runId}\u001f${refreshPollKey().toString()}`;
  });
  const [activeRefreshStatus] = createResource(activeRefreshStatusResourceKey, () => {
    const runId = untrack(activeRefreshRunId);
    return runId === null ? null : client.refresh.status({ runId, limit: 1, feedResultsLimit: 10 });
  });
  const activeRefreshStatusValue = createMemo(() => activeRefreshStatus.latest);
  const subscriptionCreatorIds = createMemo(() => new Set((subscriptionsValue() ?? emptySubscriptions).map((subscription) => subscription.creator.id)));
  const listedCreators = createMemo<readonly BrowsableCreator[]>(() => {
    if (props.mode === "library") {
      const trimmedSearch = debouncedSearch().trim().toLowerCase();
      const subscribedCreators = (subscriptionsValue() ?? emptySubscriptions).map((subscription) => subscription.creator);
      return pinSelectedCreatorFirst(subscribedCreators.filter((creator) => {
        const matchesSearch = trimmedSearch.length === 0 || creator.displayName.toLowerCase().includes(trimmedSearch);
        const matchesSourceType = sourceType() === null || creator.sourceTypes.includes(sourceType() as SourceType);
        return matchesSearch && matchesSourceType;
      }).slice(0, libraryCreatorLimit()), props.selectedCreatorId());
    }

    return pinSelectedCreatorFirst(appendUniqueCreators(creatorsValue() ?? emptyBrowsableCreators, pageItemsForKey(appendedCatalogCreatorPage(), creatorListResourceKey())), props.selectedCreatorId());
  });
  const creatorCount = createMemo(() => listedCreators().length);
  const catalogCreatorHasMore = createMemo(() =>
    pageHasMoreForKey(
      appendedCatalogCreatorPage(),
      creatorListResourceKey(),
      (creatorsValue() ?? emptyBrowsableCreators).length,
      creatorListLimit,
    ),
  );
  const libraryCreatorHasMore = createMemo(() => {
    if (props.mode !== "library") {
      return false;
    }

    const trimmedSearch = debouncedSearch().trim().toLowerCase();
    const matchingCreators = (subscriptionsValue() ?? emptySubscriptions).filter((subscription) => {
      const creator = subscription.creator;
      const matchesSearch = trimmedSearch.length === 0 || creator.displayName.toLowerCase().includes(trimmedSearch);
      const matchesSourceType = sourceType() === null || creator.sourceTypes.includes(sourceType() as SourceType);
      return matchesSearch && matchesSourceType;
    });

    return matchingCreators.length > libraryCreatorLimit();
  });

  const visibleFeeds = createMemo(() => appendUniqueFeeds(feedsValue() ?? emptyCatalogFeeds, pageItemsForKey(appendedFeedPage(), feedListResourceKey() ?? "")));
  const feedPageHasMore = createMemo(() => {
    const key = feedListResourceKey();
    if (key === null) {
      return false;
    }

    return pageHasMoreForKey(appendedFeedPage(), key, (feedsValue() ?? emptyCatalogFeeds).length, feedListLimit);
  });

  // Keep the selected creator row visible: scroll it into view whenever the
  // selection changes. The lookup iterates the row elements and compares
  // data-creator-id, so the creator id never gets interpolated into a CSS
  // selector. The element lookups are guarded — the region or the row may not
  // exist mid-render.
  let creatorListRegionEl: HTMLDivElement | undefined;
  createEffect(
    on(props.selectedCreatorId, (creatorId) => {
      if (creatorId === null) {
        return;
      }

      const region = creatorListRegionEl;
      if (region === undefined) {
        return;
      }

      const rows = region.querySelectorAll<HTMLElement>("[data-creator-id]");
      for (const row of rows) {
        if (row.dataset.creatorId === creatorId) {
          row.scrollIntoView({ block: "nearest" });
          return;
        }
      }
    }),
  );

  const loadMoreCreators = async () => {
    if (props.mode === "library") {
      setLibraryCreatorLimit((limit) => limit + creatorListLimit);
      return;
    }

    setCreatorPageBusy(true);
    setCreatorPageError(null);
    try {
      const key = creatorListResourceKey();
      const nextOffset = nextOffsetForKey(catalogCreatorOffset(), key, (creators() ?? emptyBrowsableCreators).length);
      const nextCreators = await client.catalog.creators({ ...creatorListInput(), offset: nextOffset });
      if (creatorListResourceKey() !== key) {
        return;
      }
      setAppendedCatalogCreatorPage((currentPage) => ({
        key,
        items: appendUniqueCreators(pageItemsForKey(currentPage, key), nextCreators),
        hasMore: nextCreators.length === creatorListLimit,
      }));
      setCatalogCreatorOffset({ key, nextOffset: nextOffset + nextCreators.length });
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

      const nextOffset = nextOffsetForKey(feedOffset(), key, (feedsValue() ?? emptyCatalogFeeds).length);
      const nextFeeds = await client.catalog.feeds({ ...input, offset: nextOffset });
      if (feedListResourceKey() !== key) {
        return;
      }
      setAppendedFeedPage((currentPage) => ({
        key,
        items: appendUniqueFeeds(pageItemsForKey(currentPage, key), nextFeeds),
        hasMore: nextFeeds.length === feedListLimit,
      }));
      setFeedOffset({ key, nextOffset: nextOffset + nextFeeds.length });
    } catch (error) {
      setFeedPageError(formatError(error));
    } finally {
      setFeedPageBusy(false);
    }
  };

  // Sort changes persist through the authenticated settings overlay; the list
  // refetches when the refreshed setting flows back through props.creatorSort().
  const changeCreatorSort = async (nextSort: CreatorListSort) => {
    setCreatorSortError(null);
    setLibraryCreatorLimit(creatorListLimit);
    try {
      await props.onCreatorSortChange(nextSort);
    } catch (error) {
      setCreatorSortError(formatError(error));
    }
  };

  const updateSubscription = async (creatorId: string, action: SubscriptionAction) => {
    if (action === "subscribe") {
      await client.overlays.subscribeToCreator({ creatorId });
    } else {
      await client.overlays.unsubscribeFromCreator({ creatorId });
    }

    props.onSubscriptionsChanged();
    if (props.mode === "library" && action === "unsubscribe" && props.selectedCreatorId() === creatorId) {
      props.onClearCreator();
    }
  };

  let refreshPollTimer: ReturnType<typeof setTimeout> | null = null;
  onCleanup(() => {
    if (refreshPollTimer !== null) {
      clearTimeout(refreshPollTimer);
    }
  });

  createEffect(() => {
    const loadedStatus = activeRefreshStatusValue();
    if (loadedStatus === undefined || loadedStatus === null) {
      return;
    }

    const run = loadedStatus.latestRun;
    if (run === null) {
      setRefreshBusy(null);
      setActiveRefreshRunId(null);
      setRefreshError("Refresh run could not be found.");
      return;
    }

    if (run.status !== "running") {
      // Persist the full per-feed result list before the status resource is
      // torn down, so failures remain viewable in the status dialog. Only
      // snapshot when something actually failed — a clean run clears any
      // prior failure indicator.
      if (run.feedsFailedCount > 0) {
        setLastCompletedStatus({ run, results: loadedStatus.latestFeedResults });
      } else {
        setLastCompletedStatus(null);
      }
      setRefreshBusy(null);
      setActiveRefreshRunId(null);
      props.onContentListLiveReload();
      return;
    }

    // Refetch the content list ONLY when the run has CREATED new content since
    // the last poll — i.e. itemsCreatedCount strictly increased. A feed that
    // completes having only discovered already-known items must NOT trigger a
    // refetch; otherwise a force-refresh-all re-renders the whole content list
    // on every 2.5s poll for the entire run, pegging the CPU.
    const createdItems = run.itemsCreatedCount;
    if (createdItems > refreshItemsSeen()) {
      setRefreshItemsSeen(createdItems);
      props.onContentListLiveReload();
    }

    if (refreshPollTimer !== null) {
      clearTimeout(refreshPollTimer);
    }
    refreshPollTimer = setTimeout(() => {
      setRefreshPollKey((key) => key + 1);
    }, 2_500);
  });

  const runHeaderRefresh = async (force: boolean) => {
    setRefreshBusy(force ? "force" : "normal");
    setRefreshError(null);
    setRefreshItemsSeen(0);
    setLastCompletedStatus(null);
    try {
      const started = await client.refresh.startAll({ force });
      setActiveRefreshRunId(started.run.id);
      setRefreshPollKey((key) => key + 1);
    } catch (error) {
      setRefreshError(formatError(error));
      setRefreshBusy(null);
    }
  };

  // Scoped (single-creator) force refresh. Unlike the header refresh, this runs
  // synchronously on the server and returns the full result inline, so there is
  // no polling loop. Failures feed the same lastCompletedStatus snapshot and
  // refresh-status dialog as the global refresh — one error surface.
  const runCreatorRefresh = async (creatorId: string) => {
    if (!props.isAuthenticated()) {
      return;
    }
    if (refreshBusy() !== null || scopedRefreshBusy() !== null) {
      return;
    }

    setScopedRefreshBusy(creatorId);
    setRefreshError(null);
    setLastCompletedStatus(null);
    try {
      const result = await client.refresh.runCreator({ creatorId, force: true });
      const joined = joinFeedResultsWithFeeds(result.feedResults, result.selectedFeeds);
      if (result.run.feedsFailedCount > 0) {
        setLastCompletedStatus({ run: result.run, results: joined });
      } else {
        setLastCompletedStatus(null);
      }
      props.onContentListLiveReload();
      // Bump ONLY the selected creator's feed-list resource so the feed-row
      // metadata refreshes. Never bump catalogReloadKey here — that would tear
      // down the creator list, content list, and video viewer.
      setFeedListReloadKey((key) => key + 1);
    } catch (error) {
      setRefreshError(formatError(error));
    } finally {
      setScopedRefreshBusy(null);
    }
  };

  const refreshProgressText = createMemo(() => {
    const run = activeRefreshStatusValue()?.latestRun ?? null;
    if (run === null) {
      return "0/...";
    }

    const completedFeeds = run.feedsSucceededCount + run.feedsFailedCount;
    return `${completedFeeds}/${run.feedsRequestedCount}`;
  });
  const failedFeedCount = createMemo(() => lastCompletedStatus()?.results.filter((result) => result.status === "failed").length ?? 0);
  const lastRunHadFailures = createMemo(() => (lastCompletedStatus()?.run.feedsFailedCount ?? 0) > 0);
  const creatorSortToggleLabel = createMemo(() =>
    props.creatorSort() === "name"
      ? "Sorted by name. Activate to sort by last video update."
      : "Sorted by last video update. Activate to sort by name.",
  );
  const activeCreatorSourceTypeLabel = createMemo(() => {
    const activeSourceType = sourceType();
    return activeSourceType === null ? "All" : formatSourceLabel(activeSourceType);
  });

  // Shared source-filter mutation for the popover options: every selection
  // resets the library paging limit exactly like the previous select's
  // onChange did.
  const applyCreatorSourceType = (nextSourceType: SourceType | null) => {
    setSourceType(nextSourceType);
    setLibraryCreatorLimit(creatorListLimit);
  };

  return (
    <section
      aria-label="Creator sources"
      class={sourceColumnClass}
      data-shell-column="creators"
    >
      <div class={sourceHeaderRegionClass} data-source-header-region>
        <div role="tablist" class="flex" data-left-pane-tab-bar>
          <button
            role="tab"
            type="button"
            aria-selected={props.activeTab() === "library"}
            class={`flex-1 border-b-2 px-2 py-1.5 text-xs font-semibold transition ${props.activeTab() === "library" ? "border-b-ring text-foreground" : "border-b-transparent text-muted-foreground hover:text-foreground"}`}
            onClick={() => props.setActiveTab("library")}
          >
            {props.mode === "library" ? "Library" : "Catalog"}
          </button>
          <button
            role="tab"
            type="button"
            aria-selected={props.activeTab() === "feeds"}
            class={`flex-1 border-b-2 px-2 py-1.5 text-xs font-semibold transition ${props.activeTab() === "feeds" ? "border-b-ring text-foreground" : "border-b-transparent text-muted-foreground hover:text-foreground"}`}
            onClick={() => props.setActiveTab("feeds")}
          >
            {leftPaneTabLabels.feeds}
          </button>
          <Show when={props.isAuthenticated()}>
            <button
              role="tab"
              type="button"
              aria-selected={props.activeTab() === "playlists"}
              class={`flex-1 border-b-2 px-2 py-1.5 text-xs font-semibold transition ${props.activeTab() === "playlists" ? "border-b-ring text-foreground" : "border-b-transparent text-muted-foreground hover:text-foreground"}`}
              onClick={() => props.setActiveTab("playlists")}
            >
              {leftPaneTabLabels.playlists}
            </button>
          </Show>
          <Show when={props.isAuthenticated()}>
            <button
              role="tab"
              type="button"
              aria-selected={props.activeTab() === "collections"}
              class={`flex-1 border-b-2 px-2 py-1.5 text-xs font-semibold transition ${props.activeTab() === "collections" ? "border-b-ring text-foreground" : "border-b-transparent text-muted-foreground hover:text-foreground"}`}
              onClick={() => props.setActiveTab("collections")}
            >
              {leftPaneTabLabels.collections}
            </button>
          </Show>
        </div>
        <div class="flex items-center gap-1.5">
          <button
            type="button"
            class="shrink-0 rounded-md border border-border bg-background p-1.5 text-muted-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
            aria-label="Add source"
            title="Add source"
            onClick={() => props.onOpenMiddlePanePanel("add-source")}
          >
            <Plus size={14} />
          </button>
          <Show when={props.isAuthenticated()}>
            <Show
                when={refreshBusy()}
                fallback={(
                  <div class="relative inline-flex">
                    <button
                      type="button"
                      class="shrink-0 rounded-md border border-border bg-background p-1.5 text-muted-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
                      aria-label="Refresh due feeds"
                      title="Refresh due feeds"
                      onClick={async () => runHeaderRefresh(false)}
                    >
                      <RefreshCw size={14} />
                    </button>
                    <details class="relative">
                      <summary
                        class="flex h-full cursor-pointer list-none items-center rounded-r-md border border-l-0 border-border bg-background px-1 text-muted-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                        aria-label="Open force refresh action"
                        title="Force refresh"
                      >
                        <ChevronDown size={12} />
                      </summary>
                      <div class="absolute left-0 z-20 mt-1 min-w-40 rounded-md border border-border bg-popover p-1 shadow-lg">
                        <button
                          type="button"
                          class="flex w-full items-center gap-1 rounded-sm px-2 py-1.5 text-left text-xs font-semibold text-popover-foreground transition hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-60"
                          aria-label="Force refresh all feeds"
                          title="Force refresh all feeds"
                          onClick={async (event) => {
                            event.currentTarget.closest("details")?.removeAttribute("open");
                            await runHeaderRefresh(true);
                          }}
                        >
                          <Zap size={14} /> Force refresh
                        </button>
                      </div>
                    </details>
                  </div>
                )}
              >
                <span class="rounded-md border border-border bg-muted px-2 py-1 text-xs font-semibold text-muted-foreground" role="status">
                  {refreshProgressText()}
                </span>
              </Show>
            <button
              type="button"
              class="shrink-0 rounded-md border border-border bg-background p-1.5 text-muted-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
              aria-label="Settings"
              title="Settings"
              onClick={() => props.onOpenSettings()}
            >
              <Settings size={14} />
            </button>
          </Show>
          <span class="ml-auto text-xs text-muted-foreground" data-creator-count>
            {creatorCount()} loaded
          </span>
        </div>
        <Show when={refreshError()}>
          {(message) => <p class="mt-1 text-xs text-destructive" data-refresh-status-error>{message()}</p>}
        </Show>
        <Show when={lastRunHadFailures()}>
          <button
            type="button"
            class="mt-1 inline-flex items-center gap-1 rounded-md border border-destructive bg-destructive/10 px-2 py-1 text-xs font-semibold text-destructive transition hover:bg-destructive/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            aria-label={`Refresh completed with ${failedFeedCount()} failed feed${failedFeedCount() === 1 ? "" : "s"}. View refresh status.`}
            title="View refresh status"
            data-refresh-status-trigger
            onClick={() => setRefreshStatusOpen(true)}
          >
            <TriangleAlert class="h-3.5 w-3.5" aria-hidden="true" />
            {failedFeedCount()} failed
          </button>
        </Show>
        <div class="flex items-center gap-1.5">
          <label class="sr-only" for={creatorSearchInputId}>
            Search creators
          </label>
          <input
            id={creatorSearchInputId}
            class="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-xs text-foreground outline-none transition focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
            type="search"
            value={search()}
            placeholder="Search creators"
            autocomplete="off"
            onInput={(event) => {
              setSearch(event.currentTarget.value);
              setLibraryCreatorLimit(creatorListLimit);
            }}
          />
          <button
            type="button"
            id={creatorListSortInputId}
            class="shrink-0 rounded-md border border-input bg-background p-1.5 text-muted-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
            aria-label={creatorSortToggleLabel()}
            title={creatorSortToggleLabel()}
            disabled={!props.isAuthenticated()}
            onClick={() => {
              const nextSort = creatorListSortValues[(creatorListSortValues.indexOf(props.creatorSort()) + 1) % creatorListSortValues.length];
              void changeCreatorSort(nextSort);
            }}
          >
            <Show when={props.creatorSort() === "name"} fallback={<ClockArrowDown size={14} aria-hidden="true" />}>
              <ArrowDownAZ size={14} aria-hidden="true" />
            </Show>
          </button>
          <details class="relative shrink-0">
            <summary
              id={creatorSourceFilterId}
              class="flex cursor-pointer list-none items-center justify-center rounded-md border border-input bg-background p-1.5 text-muted-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              aria-label={`Filter creators by source: ${activeCreatorSourceTypeLabel()}`}
              title="Filters creator rows by catalog source type. Select a creator to inspect all feeds."
            >
              <Show when={sourceType()} keyed fallback={<LayoutGrid size={14} aria-hidden="true" />}>
                {(activeSourceType: SourceType) => <SourceTypeIcon sourceType={activeSourceType} />}
              </Show>
            </summary>
            <div class="absolute right-0 z-20 mt-1 min-w-28 rounded-md border border-border bg-popover p-1 shadow-lg">
              <button
                type="button"
                class={`flex w-full items-center gap-1 rounded-sm px-2 py-1.5 text-left text-xs font-semibold text-popover-foreground transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${sourceType() === null ? "bg-accent text-accent-foreground" : "hover:bg-accent hover:text-accent-foreground"}`}
                aria-pressed={sourceType() === null}
                onClick={(event) => {
                  event.currentTarget.closest("details")?.removeAttribute("open");
                  applyCreatorSourceType(null);
                }}
              >
                <LayoutGrid size={14} aria-hidden="true" /> All
              </button>
              <For each={sourceFilterOptions}>
                {(source) => {
                  const isActive = createMemo(() => sourceType() === source);
                  return (
                    <button
                      type="button"
                      class={`flex w-full items-center gap-1 rounded-sm px-2 py-1.5 text-left text-xs font-semibold text-popover-foreground transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${isActive() ? "bg-accent text-accent-foreground" : "hover:bg-accent hover:text-accent-foreground"}`}
                      aria-pressed={isActive()}
                      onClick={(event) => {
                        event.currentTarget.closest("details")?.removeAttribute("open");
                        applyCreatorSourceType(source);
                      }}
                    >
                      <SourceTypeIcon sourceType={source} /> {formatSourceLabel(source)}
                    </button>
                  );
                }}
              </For>
            </div>
          </details>
        </div>
        <Show when={creatorSortError()}>
          {(message) => <p class="mt-1 text-xs text-destructive" data-creator-sort-error>{message()}</p>}
        </Show>
      </div>
      <div class={sourceCatalogRegionClass} data-source-catalog-region>
        <Show when={props.activeTab() === "library"}>
        <div class={sourceCreatorListRegionClass} data-source-scroll-region ref={(el) => { creatorListRegionEl = el; }}>
          <Switch>
            <Match when={props.mode === "library" && subscriptions.loading && subscriptionsValue() === undefined}>
              <p class="text-xs font-semibold text-foreground">Loading Library</p>
              <p class="mt-2 text-xs leading-5 text-muted-foreground">Loading your subscribed sources.</p>
            </Match>
            <Match when={props.mode === "catalog" && creators.loading && creatorsValue() === undefined}>
              <p class="text-xs font-semibold text-foreground">Loading sources</p>
              <p class="mt-2 text-xs leading-5 text-muted-foreground">Loading the public catalog.</p>
            </Match>
            <Match when={props.mode === "library" && subscriptions.error !== undefined}>
              <p class="text-xs font-semibold text-destructive">Library unavailable</p>
              <p class="mt-2 text-xs leading-5 text-muted-foreground">{formatError(subscriptions.error)}</p>
            </Match>
            <Match when={props.mode === "catalog" && creators.error !== undefined}>
              <p class="text-xs font-semibold text-destructive">Sources unavailable</p>
              <p class="mt-2 text-xs leading-5 text-muted-foreground">{formatError(creators.error)}</p>
            </Match>
            <Match when={listedCreators().length === 0}>
              <p class="text-xs font-semibold text-foreground">No sources found</p>
              <p class="mt-2 text-xs leading-5 text-muted-foreground">
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
                <ol aria-label="Creator sources">
                  <For each={loadedCreators()}>
                    {(creator) => (
                      <li data-creator-id={creator.id}>
                        <CreatorSourceRow
                          creator={creator}
                          isAuthenticated={props.isAuthenticated()}
                          isSelected={props.selectedCreatorId() === creator.id}
                          isSubscribed={subscriptionCreatorIds().has(creator.id)}
                          showSubscriptionControl={props.mode === "catalog"}
                          refreshBusy={scopedRefreshBusy() === creator.id || (scopedRefreshBusy() === null && refreshBusy() !== null)}
                          readerDensity={props.readerDensity()}
                          onSelectCreator={props.onSelectCreator}
                          onForceRefreshCreator={runCreatorRefresh}
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
        </Show>
        <Show when={props.activeTab() === "feeds"}>
        <Show when={props.selectedCreator()} fallback={<div class={sourceFeedListRegionClass} aria-label="Selected source feeds"><p class="text-xs leading-5 text-muted-foreground">Select a source to see its feeds.</p></div>}>
          {(creator) => (
            <aside class={sourceFeedListRegionClass} aria-label="Selected source feeds" data-source-feed-scroll-region>
              <div class="flex items-center justify-between gap-2">
                <p class="min-w-0 truncate text-xs font-semibold text-foreground">{creator().displayName}</p>
                <div class="flex items-center gap-1">
                  <button
                    type="button"
                    class="shrink-0 rounded-md border border-border bg-background p-1 text-muted-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    aria-label={`Clear selected creator ${creator().displayName}`}
                    title="Clear selected creator"
                    data-clear-selected-creator
                    onClick={() => props.onClearCreator()}
                  >
                    <X size={12} />
                  </button>
                  <Show when={props.isAuthenticated()}>
                    <button
                      type="button"
                      class="shrink-0 rounded-md border border-border bg-background p-1.5 text-muted-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
                      aria-label={`Force refresh ${creator().displayName}`}
                      title="Force refresh this source"
                      data-refresh-creator={creator().id}
                      disabled={scopedRefreshBusy() !== null || refreshBusy() !== null}
                      onClick={async () => {
                        await runCreatorRefresh(creator().id);
                      }}
                    >
                      <RefreshCw size={14} class={scopedRefreshBusy() === creator().id ? "animate-spin" : ""} />
                    </button>
                    <SubscriptionActionButton
                      creatorId={creator().id}
                      isSubscribed={subscriptionCreatorIds().has(creator().id)}
                      onUpdateSubscription={updateSubscription}
                    />
                  </Show>
                </div>
              </div>
              <Switch>
                <Match when={feeds.loading}>
                  <p class="mt-2 text-xs leading-5 text-muted-foreground">Loading feeds.</p>
                </Match>
                <Match when={feeds.error !== undefined}>
                  <p class="mt-2 text-xs leading-5 text-destructive">Feeds unavailable.</p>
                </Match>
                <Match when={(feedsValue()?.length ?? 0) === 0}>
                  <p class="mt-2 text-xs leading-5 text-muted-foreground">No feeds are attached to this creator.</p>
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
        </Show>
        <Show when={props.activeTab() === "playlists" && props.isAuthenticated()}>
          <div class={sourceCreatorListRegionClass} data-source-scroll-region>
            <PlaylistColumnSection
              selectedPlaylistId={props.selectedPlaylistId}
              playlistItemsReloadKey={props.playlistItemsReloadKey}
              onSelectPlaylist={props.onSelectPlaylist}
              onSelectContent={props.onSelectContent}
            />
          </div>
        </Show>
        <Show when={props.activeTab() === "collections" && props.isAuthenticated()}>
          <div class={sourceCreatorListRegionClass} data-source-scroll-region>
            <CollectionColumnSection
              selectedCollectionId={props.selectedCollectionId}
              collectionsReloadKey={props.collectionsReloadKey}
              onSelectCollection={props.onSelectCollection}
              onCollectionsChanged={props.onCollectionsChanged}
            />
          </div>
        </Show>
      </div>
      <div class={sourceActionsRegionClass} data-source-actions-region>
        <RefreshStatusDialog
          open={refreshStatusOpen()}
          run={lastCompletedStatus()?.run ?? null}
          feedResults={lastCompletedStatus()?.results ?? []}
          onClose={() => setRefreshStatusOpen(false)}
        />
      </div>
    </section>
  );
}

export interface AppShellProps {
  readonly mode?: ShellMode;
}

export default function AppShell(props: AppShellProps) {
  const mode = () => props.mode ?? "catalog";
  const session = authClient.useSession();
  const appSessionResourceInput = createMemo(() => session().data?.user.id ?? null);
  const [appSession] = createResource(appSessionResourceInput, () => client.session.current());
  const isAuthenticated = createMemo(() => appSession.latest !== null && appSession.latest !== undefined);
  const [selectedCreator, setSelectedCreator] = createSignal<BrowsableCreator | null>(null);
  const [selectedFeed, setSelectedFeed] = createSignal<CatalogFeed | null>(null);
  const [selectedContent, setSelectedContent] = createSignal<CatalogContentListItem | null>(null);
  const [selectedPlaylistId, setSelectedPlaylistId] = createSignal<string | null>(null);
  const [selectedCollectionId, setSelectedCollectionId] = createSignal<string | null>(null);
  const [playlistItemsReloadKey, setPlaylistItemsReloadKey] = createSignal(0);
  const [collectionsReloadKey, setCollectionsReloadKey] = createSignal(0);
  const [catalogReloadKey, setCatalogReloadKey] = createSignal(0);
  const [subscriptionsReloadKey, setSubscriptionsReloadKey] = createSignal(0);
  const [favoritesReloadKey, setFavoritesReloadKey] = createSignal(0);
  const [listLiveReloadKey, setListLiveReloadKey] = createSignal(0);
  const [statusSelectionError, setStatusSelectionError] = createSignal<string | null>(null);
  const [activeTab, setActiveTab] = createSignal<LeftPaneTab>("library");
  const [middlePanePanel, setMiddlePanePanel] = createSignal<MiddlePanePanel | null>(null);
  const [viewerMode, setViewerMode] = createSignal<ViewerMode>("content");
  const settingsResourceInput = createMemo(() => {
    if (!isAuthenticated()) {
      return null;
    }

    return "settings";
  });
  const [settings, { refetch: refetchSettings }] = createResource(settingsResourceInput, () => client.overlays.settings());
  // Read settings via .latest so a refetch (reader-density change, raw setting
  // save/delete, creator sort change) never re-suspends: the shell root grid
  // consumes readerDensity outside every column <Suspense>, so a plain read
  // would bubble to the route-level boundary and blank the whole app.
  const settingsValue = createMemo(() => settings.latest);
  const readerDensity = createMemo(() => toReaderDensityFromSettings(settingsValue() ?? emptyUserSettings));
  const creatorSort = createMemo(() => toCreatorListSortFromSettings(settingsValue() ?? emptyUserSettings));

  const saveCreatorSortSetting = async (sort: CreatorListSort) => {
    await client.overlays.saveSetting({ key: creatorListSortSettingKey, value: sort });
    await refetchSettings();
  };
  const contentStatusesResourceInput = createMemo(() => {
    if (!isAuthenticated()) {
      return null;
    }

    return "content-statuses";
  });
  const [contentStatuses, { mutate: mutateContentStatuses }] = createResource(contentStatusesResourceInput, () =>
    client.overlays.contentStatuses(),
  );
  const selectedCreatorId = createMemo(() => selectedCreator()?.id ?? null);
  const selectedContentItemId = createMemo(() => selectedContent()?.id ?? null);

  const selectCreator = (creator: BrowsableCreator) => {
    if (selectedCreator()?.id === creator.id) {
      setSelectedCreator(null);
      setSelectedFeed(null);
      return;
    }

    setSelectedCreator(creator);
    setSelectedFeed(null);
  };

  const selectFeed = (feed: CatalogFeed | null) => {
    setSelectedFeed(feed);
  };

  // Viewer-side creator filter: SELECT-ONLY, unlike the creator-row toggle.
  // Clicking the creator name in the viewer narrows the content list to that
  // creator; it never clears an already-selected creator and never touches the
  // viewer's own content. It only re-keys the content-list resource (via
  // selectedCreator -> toContentListInput), so the viewer detail (keyed on the
  // content id) and the creator column stay mounted.
  const selectCreatorFromViewer = (creator: CatalogCreatorSummary) => {
    if (selectedCreator()?.id === creator.id) {
      return;
    }

    setSelectedCreator(creator);
    setSelectedFeed(null);
  };

  // Shared unselect affordance (creator-column rows, subscription-triggered
  // clears, and the content-column filter chip): clears creator + feed + viewer
  // content in one place so every entry point behaves identically.
  const clearSelectedCreator = () => {
    setSelectedCreator(null);
    setSelectedFeed(null);
    setSelectedContent(null);
  };

  const patchContentStatus = (status: UserContentStatus) => {
    mutateContentStatuses((currentStatuses = emptyUserContentStatuses) => [
      ...currentStatuses.filter((item) => item.contentItemId !== status.contentItemId || item.status !== status.status),
      status,
    ]);
  };

  const removeContentStatus = (contentItemId: string, status: UserContentStatus["status"]) => {
    mutateContentStatuses((currentStatuses = emptyUserContentStatuses) =>
      currentStatuses.filter((item) => item.contentItemId !== contentItemId || item.status !== status),
    );
  };

  // Opened/played markers propagate through local status patches only. History
  // views are snapshots: refetching the list on every open/played would reorder
  // it under the user's cursor (and vanish the clicked row with "hide played"),
  // so there is deliberately no reload key here. New entries join history
  // views on the next fetch (mode switch, filter change, revisit).
  const markContentOpened = async (contentItemId: string) => {
    if (!isAuthenticated()) {
      return;
    }

    const result = await client.overlays.toggleContentOpened({ contentItemId });
    if (result.status === null) {
      removeContentStatus(contentItemId, "opened");
      return;
    }
    patchContentStatus(result.status);
  };

  const markContentPlayed = async (contentItemId: string) => {
    if (!isAuthenticated()) {
      return;
    }

    const result = await client.overlays.toggleContentPlayed({ contentItemId });
    if (result.status === null) {
      removeContentStatus(contentItemId, "played");
      return;
    }
    patchContentStatus(result.status);
  };

  const autoMarkContentPlayed = async (contentItemId: string) => {
    if (!isAuthenticated()) {
      return;
    }

    const result = await client.overlays.markContentPlayed({ contentItemId });
    if (result.status !== null) {
      patchContentStatus(result.status);
    }
  };

  const autoMarkContentOpened = async (contentItemId: string) => {
    if (!isAuthenticated()) {
      return;
    }

    const result = await client.overlays.markContentOpened({ contentItemId });
    patchContentStatus(result.status);
  };

  const selectContent = async (contentItem: CatalogContentListItem) => {
    setSelectedContent(contentItem);
    setStatusSelectionError(null);
    try {
      await autoMarkContentOpened(contentItem.id);
    } catch (error) {
      setStatusSelectionError(`Opened status update failed: ${formatError(error)}`);
    }
  };

  let containerEl: HTMLDivElement | undefined;

  const [leftFraction, setLeftFraction] = createSignal(defaultLeftFraction);
  const [middleFraction, setMiddleFraction] = createSignal(defaultMiddleFraction);
  const [isDesktop, setIsDesktop] = createSignal(false);

  const rightFraction = createMemo(() => Math.max(0, 1 - leftFraction() - middleFraction()));

  const gridStyle = createMemo(() => ({
    "grid-template-columns": toDesktopColumnTemplate(leftFraction(), middleFraction(), rightFraction()),
  }));

  const persistPaneWidths = (left: number, middle: number) => {
    try {
      localStorage.setItem(paneWidthsLocalStorageKey, JSON.stringify({ left, middle }));
    } catch {
      // localStorage may be unavailable
    }
  };

  const handleLeftResize = (deltaX: number) => {
    const width = containerEl?.clientWidth;
    if (width === undefined || width === 0) {
      return;
    }
    const delta = deltaX / width;
    const candidateLeft = leftFraction() + delta;
    const clampedLeft = Math.max(minLeftFraction, Math.min(candidateLeft, 1 - middleFraction() - minRightFraction));
    setLeftFraction(clampedLeft);
  };

  const handleMiddleResize = (deltaX: number) => {
    const width = containerEl?.clientWidth;
    if (width === undefined || width === 0) {
      return;
    }
    const delta = deltaX / width;
    const candidateMiddle = middleFraction() + delta;
    const clampedMiddle = Math.max(minMiddleFraction, Math.min(candidateMiddle, 1 - leftFraction() - minRightFraction));
    setMiddleFraction(clampedMiddle);
  };

  const commitLeftResize = () => {
    const clamped = clampLeftFraction(leftFraction(), middleFraction());
    setLeftFraction(clamped);
    persistPaneWidths(clamped, middleFraction());
  };

  const commitMiddleResize = () => {
    const clamped = clampMiddleFraction(middleFraction(), leftFraction());
    setMiddleFraction(clamped);
    persistPaneWidths(leftFraction(), clamped);
  };

  onMount(() => {
    try {
      const stored = localStorage.getItem(paneWidthsLocalStorageKey);
      if (stored !== null) {
        const parsed: unknown = JSON.parse(stored);
        if (typeof parsed === "object" && parsed !== null && "left" in parsed && "middle" in parsed) {
          const candidate = parsed as PersistedPaneWidths;
          if (typeof candidate.left === "number" && typeof candidate.middle === "number") {
            const right = 1 - candidate.left - candidate.middle;
            if (candidate.left >= minLeftFraction && candidate.middle >= minMiddleFraction && right >= minRightFraction) {
              setLeftFraction(candidate.left);
              setMiddleFraction(candidate.middle);
            }
          }
        }
      }
    } catch {
      // Ignore malformed localStorage data
    }

    const query = window.matchMedia("(min-width: 1024px)");
    setIsDesktop(query.matches);
    const handler = (event: MediaQueryListEvent) => setIsDesktop(event.matches);
    query.addEventListener("change", handler);
    onCleanup(() => query.removeEventListener("change", handler));
  });

  return (
    <main class={shellRootClass}>
      <div class={shellGridClass} ref={(el) => { containerEl = el; }} style={gridStyle()} data-reader-density={readerDensity()}>
        <Suspense>
        <CreatorSourceColumn
          isAuthenticated={isAuthenticated}
          mode={mode()}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          readerDensity={readerDensity}
          creatorSort={creatorSort}
          onCreatorSortChange={saveCreatorSortSetting}
          selectedCreatorId={selectedCreatorId}
          selectedCreator={selectedCreator}
          selectedFeed={selectedFeed}
          selectedPlaylistId={selectedPlaylistId}
          selectedCollectionId={selectedCollectionId}
          catalogReloadKey={catalogReloadKey}
          subscriptionsReloadKey={subscriptionsReloadKey}
          playlistItemsReloadKey={playlistItemsReloadKey}
          collectionsReloadKey={collectionsReloadKey}
          onCollectionsChanged={() => setCollectionsReloadKey((key) => key + 1)}
          middlePanePanel={middlePanePanel}
          onContentListLiveReload={() => setListLiveReloadKey((key) => key + 1)}
          onSubscriptionsChanged={() => setSubscriptionsReloadKey((key) => key + 1)}
          onClearCreator={clearSelectedCreator}
          onSelectCreator={selectCreator}
          onSelectFeed={selectFeed}
          onSelectPlaylist={setSelectedPlaylistId}
          onSelectCollection={setSelectedCollectionId}
          onSelectContent={selectContent}
          onOpenMiddlePanePanel={setMiddlePanePanel}
          onOpenSettings={() => setViewerMode("settings")}
        />
        </Suspense>
        <Suspense>
        <ContentListColumn
          isAuthenticated={isAuthenticated}
          mode={mode()}
          selectedCreator={selectedCreator}
          selectedFeed={selectedFeed}
          selectedPlaylistId={selectedPlaylistId}
          selectedCollectionId={selectedCollectionId}
          onClearCollection={() => setSelectedCollectionId(null)}
          onClearCreator={clearSelectedCreator}
          collectionsReloadKey={collectionsReloadKey}
          selectedContentItemId={selectedContentItemId}
          catalogReloadKey={catalogReloadKey}
          subscriptionsReloadKey={subscriptionsReloadKey}
          favoritesReloadKey={favoritesReloadKey}
          readerDensity={readerDensity}
          contentStatuses={() => contentStatuses() ?? emptyUserContentStatuses}
          listLiveReloadKey={listLiveReloadKey}
          middlePanePanel={middlePanePanel}
          onCloseMiddlePanePanel={() => setMiddlePanePanel(null)}
          onAddSource={async (value) => {
            if (mode() === "library") {
              await client.overlays.subscribeToCreator({ creatorId: value.creator.id });
            }

            setSelectedCreator(value.creator);
            setCatalogReloadKey((key) => key + 1);
            setSubscriptionsReloadKey((key) => key + 1);
            setMiddlePanePanel(null);
          }}
          onSelectContent={selectContent}
          onFavoriteChanged={() => setFavoritesReloadKey((key) => key + 1)}
          onMarkContentOpened={markContentOpened}
          onMarkContentPlayed={markContentPlayed}
          onSelectPlaylist={setSelectedPlaylistId}
          onPlaylistItemAdded={() => setPlaylistItemsReloadKey((key) => key + 1)}
        />
        </Suspense>
        <SelectedContentViewer
          isAuthenticated={isAuthenticated}
          selectedContent={selectedContent}
          selectedPlaylistId={selectedPlaylistId}
          contentStatuses={() => contentStatuses.latest ?? emptyUserContentStatuses}
          contentStatusesLoading={() => contentStatuses.loading}
          statusSelectionError={statusSelectionError}
          viewerMode={viewerMode}
          settings={() => settingsValue() ?? emptyUserSettings}
          settingsUnavailable={() => settings.error !== undefined}
          onCloseSettings={() => setViewerMode("content")}
          onSettingsChanged={async () => {
            await refetchSettings();
          }}
          onSelectPlaylist={setSelectedPlaylistId}
          onPlaylistItemAdded={() => setPlaylistItemsReloadKey((key) => key + 1)}
          onFavoriteChanged={() => setFavoritesReloadKey((key) => key + 1)}
          onSelectCreator={selectCreatorFromViewer}
          onMarkContentOpened={markContentOpened}
          onMarkContentPlayed={markContentPlayed}
          onAutoMarkContentPlayed={autoMarkContentPlayed}
        />
        <Show when={isDesktop()}>
          <div
            class="absolute inset-y-0 z-10"
            style={{ left: `calc(${leftFraction() * 100}% - 4px)`, width: "8px" }}
          >
            <PaneResizer
              onResize={handleLeftResize}
              onDragEnd={commitLeftResize}
              ariaLabel="Resize source pane"
              ariaValueNow={Math.round(leftFraction() * 100)}
              ariaValueMin={Math.round(minLeftFraction * 100)}
              ariaValueMax={Math.round((1 - minMiddleFraction - minRightFraction) * 100)}
            />
          </div>
          <div
            class="absolute inset-y-0 z-10"
            style={{ left: `calc(${(leftFraction() + middleFraction()) * 100}% - 4px)`, width: "8px" }}
          >
            <PaneResizer
              onResize={handleMiddleResize}
              onDragEnd={commitMiddleResize}
              ariaLabel="Resize feed pane"
              ariaValueNow={Math.round(middleFraction() * 100)}
              ariaValueMin={Math.round(minMiddleFraction * 100)}
              ariaValueMax={Math.round((1 - minLeftFraction - minRightFraction) * 100)}
            />
          </div>
        </Show>
      </div>
    </main>
  );
}
