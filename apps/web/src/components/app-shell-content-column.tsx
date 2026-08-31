import type {
  AddSourceValue,
  CatalogContentListItem,
  CatalogFeed,
  CollectionMemberWithCreator,
  Playlist,
  SourceType,
  UserContentStatus,
} from "@FeedElity/api";
import { For, Match, Show, Switch, createEffect, createMemo, createResource, createSignal, on, untrack } from "solid-js";
import { createVirtualizer } from "@tanstack/solid-virtual";
import CheckCircle from "lucide-solid/icons/circle-check";
import ChevronDown from "lucide-solid/icons/chevron-down";
import ChevronUp from "lucide-solid/icons/chevron-up";
import Clock from "lucide-solid/icons/clock";
import Heart from "lucide-solid/icons/heart";
import LayoutGrid from "lucide-solid/icons/layout-grid";
import X from "lucide-solid/icons/x";

import { clampActiveIndex } from "@/lib/keyboard-shortcuts";
import { client } from "@/utils/orpc";

import { ContentListItemRow } from "./app-shell-rows";
import { AddSourceSection } from "./app-shell-source-sections";
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
  contentSourceFilterLocalStorageKey,
  contentViewModeAllId,
  contentViewModeFavoritesId,
  contentViewModeHistoryId,
  contentViewModePlayedId,
  contentViewModeSubscribedId,
  contentViewModeLocalStorageKey,
  createDesktopMediaQuerySignal,
  emptyAppendedPageState,
  estimateContentItemRowHeight,
  formatError,
  formatContentDuration,
  formatContentPublishedAt,
  formatSourceLabel,
  mergeUniqueContentItemsForDisplay,
  pageHasMoreForKey,
  pageItemsForKey,
  persistHidePlayed,
  persistLocalValue,
  readPersistedHidePlayed,
  readPersistedLocalValue,
  showsCatalogFilters,
  sourceTypeFilterValues,
  toContentListInput,
  toContentStatusFlags,
  toPersistedContentViewMode,
  toPersistedSourceTypeFilter,
  toPlaybackPositionsByItemId,
  type AppendedPageState,
  type BrowsableCreator,
  type ContentListInput,
  type ContentViewMode,
  type MiddlePanePanel,
  type ReaderDensity,
  type ShellMode,
} from "./app-shell.contract";

type ContentItemsResourceMode = "catalog" | "subscribed" | "favorites" | "history-opened" | "played";

const allContentSourceFilterValue = "all";

const emptyCatalogContentItems: readonly CatalogContentListItem[] = [];

const emptyPlaylists: readonly Playlist[] = [];

const emptyCollectionMembers: readonly CollectionMemberWithCreator[] = [];

function toSourceFilterValue(value: string): SourceType | null {
  return sourceTypeFilterValues.find((sourceType) => sourceType === value) ?? null;
}

function toContentItemsResourceKey(mode: ContentItemsResourceMode, input: ContentListInput, reloadKey: number): string {
  return [
    mode,
    reloadKey.toString(),
    input.search ?? "",
    input.creatorId ?? "",
    input.feedId ?? "",
    input.collectionId ?? "",
    input.sourceType ?? "",
    input.limit.toString(),
    input.offset.toString(),
  ].join("\u001f");
}

/**
 * Query identity for the content list: mode + filter input, EXCLUDING reload
 * ticks (catalogReloadKey / listLiveReloadKey / etc). The appended "load more"
 * pages and the paging offset are keyed against THIS, not against the resource
 * key. So a refresh live-reload ticks page 1 in place while preserving the
 * deeper pages the user already loaded — previously the live-reload bump
 * changed the resource key, which made pageItemsForKey() return [] for the
 * appended page, so every load-more item vanished on the next refresh tick.
 */
function toContentItemsQueryKey(mode: ContentItemsResourceMode, input: ContentListInput): string {
  return [
    mode,
    input.search ?? "",
    input.creatorId ?? "",
    input.feedId ?? "",
    input.collectionId ?? "",
    input.sourceType ?? "",
  ].join("\u001f");
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

/**
 * Merge a freshly-fetched item page with the previously-rendered items,
 * REUSING the previous object reference for any id that already existed.
 *
 * Solid `<For>` keys by reference: if a refresh returns brand-new objects for
 * unchanged items, `<For>` treats every item as new and recreates the whole
 * list (reloading every thumbnail `<img>`, relayout, repaint) — a sustained
 * renderer-CPU peg during a force-refresh that live-reloads repeatedly.
 * Preserving references for unchanged ids lets `<For>` reuse the existing DOM
 * nodes, so a refresh only adds/removes the rows that actually changed.
 */
function mergeStableItemReferences(
  nextItems: readonly CatalogContentListItem[],
  previousById: ReadonlyMap<string, CatalogContentListItem>,
): readonly CatalogContentListItem[] {
  return nextItems.map((item) => previousById.get(item.id) ?? item);
}

async function listSubscribedLibraryContentItems(input: ContentListInput): Promise<readonly CatalogContentListItem[]> {
  return client.overlays.subscribedContentItems(input);
}

async function listOpenedHistoryContentItems(): Promise<readonly CatalogContentListItem[]> {
  const historyEntries = await client.overlays.contentHistory({ status: "opened", limit: 100 });

  return mergeUniqueContentItemsForDisplay(historyEntries.map((entry) => entry.content));
}

async function listPlayedHistoryContentItems(): Promise<readonly CatalogContentListItem[]> {
  const historyEntries = await client.overlays.contentHistory({ status: "played", limit: 100 });

  return mergeUniqueContentItemsForDisplay(historyEntries.map((entry) => entry.content));
}

async function readContentItems(mode: ContentItemsResourceMode, input: ContentListInput): Promise<readonly CatalogContentListItem[]> {
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
}

function contentItemMatchesLocalFilters(
  contentItem: CatalogContentListItem,
  input: ContentListInput,
  collectionMemberCreatorIds: ReadonlySet<string>,
): boolean {
  if (input.creatorId !== undefined && contentItem.creatorId !== input.creatorId) {
    return false;
  }

  if (input.collectionId !== undefined && !collectionMemberCreatorIds.has(contentItem.creatorId)) {
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

interface ContentLoadMoreControlProps {
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

function ContentLoadMoreControl(props: ContentLoadMoreControlProps) {
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

/**
 * One keyboard-shortcut command issued by AppShell's single window keydown
 * listener (qol-features-plan.md F3). AppShell sends a fresh object per
 * keypress and the column executes it against its own active-row state —
 * declarative prop data flow instead of an imperative handle, so the column
 * keeps ownership of activeIndex and of the two scroll mechanisms.
 */
export type ContentShortcutCommand =
  | { readonly kind: "move"; readonly delta: 1 | -1 }
  | { readonly kind: "open" }
  | { readonly kind: "toggle-favorite" };

export interface ContentListColumnProps {
  readonly isAuthenticated: () => boolean;
  readonly mode: ShellMode;
  readonly readerDensity: () => ReaderDensity;
  readonly selectedPlaylistId: () => string | null;
  readonly selectedCollectionId: () => string | null;
  readonly onClearCollection: () => void;
  readonly onClearCreator: () => void;
  readonly collectionsReloadKey: () => number;
  readonly selectedCreator: () => BrowsableCreator | null;
  readonly selectedFeed: () => CatalogFeed | null;
  readonly selectedContentItemId: () => string | null;
  readonly catalogReloadKey: () => number;
  readonly subscriptionsReloadKey: () => number;
  readonly favoritesReloadKey: () => number;
  readonly contentStatuses: () => readonly UserContentStatus[];
  readonly listLiveReloadKey: () => number;
  readonly middlePanePanel: () => MiddlePanePanel | null;
  readonly searchClearKey: () => number;
  readonly contentShortcutCommand: () => ContentShortcutCommand | null;
  readonly onCloseMiddlePanePanel: () => void;
  readonly onAddSource: (value: AddSourceValue) => Promise<void>;
  readonly onSelectContent: (contentItem: CatalogContentListItem) => Promise<void>;
  readonly onFavoriteChanged: () => void;
  readonly onMarkContentOpened: (contentItemId: string) => Promise<void>;
  readonly onMarkContentPlayed: (contentItemId: string) => Promise<void>;
  readonly onSelectPlaylist: (playlistId: string | null) => void;
  readonly onPlaylistItemAdded: () => void;
}

export function ContentListColumn(props: ContentListColumnProps) {
  const [search, setSearch] = createSignal("");
  // The content source filter is device-persisted (F7, decision D9) and works
  // for anonymous browsing too, so the seed needs no auth gate.
  const [sourceType, setSourceType] = createSignal<SourceType | null>(
    toPersistedSourceTypeFilter(readPersistedLocalValue(contentSourceFilterLocalStorageKey)),
  );
  // The persisted view mode is auth-gated at parse time (favorites/history/
  // played coerce to the mode default when applied anonymously). While the
  // session check is pending the anonymous reset effect below still enforces
  // the mode default; the restore effect re-applies the persisted auth-only
  // mode once a signed-in user's session resolves.
  const [viewMode, setViewMode] = createSignal<ContentViewMode>(
    toPersistedContentViewMode(readPersistedLocalValue(contentViewModeLocalStorageKey), props.isAuthenticated(), props.mode),
  );
  const [hidePlayed, setHidePlayed] = createSignal<boolean>(readPersistedHidePlayed() ?? false);
  const [appendedContentPage, setAppendedContentPage] = createSignal<AppendedPageState<CatalogContentListItem>>(emptyAppendedPageState());
  const [contentOffset, setContentOffset] = createSignal<PaginationOffsetState>({ key: "", nextOffset: 0 });
  const [contentPageBusy, setContentPageBusy] = createSignal(false);
  const [contentPageError, setContentPageError] = createSignal<string | null>(null);
  const [controlsExpanded, setControlsExpanded] = createSignal(false);
  // Failure surface for keyboard-shortcut commands (currently the f toggle):
  // shortcut failures must be visible even though the row action cluster they
  // normally report through is hover-only.
  const [contentCommandError, setContentCommandError] = createSignal<string | null>(null);

  createEffect(() => {
    if (props.middlePanePanel() !== null) {
      setControlsExpanded(false);
    }
  });

  createEffect(() => {
    if (!props.isAuthenticated()) {
      setViewMode(props.mode === "library" ? "subscribed" : "catalog");
    }
  });

  // The reset effect above runs while the session check is still pending (the
  // auth state is unknown, hence "not authenticated"), which would keep a
  // persisted auth-only view mode (favorites/history/played) lost for signed-in
  // users; re-apply the persisted choice once the session resolves.
  createEffect(on(props.isAuthenticated, (isAuthenticated) => {
    if (isAuthenticated) {
      setViewMode(toPersistedContentViewMode(readPersistedLocalValue(contentViewModeLocalStorageKey), true, props.mode));
    }
  }, { defer: true }));

  // Single mutation for every view-mode button: renders the mode and persists it.
  const changeViewMode = (nextViewMode: ContentViewMode) => {
    setViewMode(nextViewMode);
    persistLocalValue(contentViewModeLocalStorageKey, nextViewMode);
  };

  // The select's only mutation: renders the filter and persists it (the empty
  // string encodes "All").
  const changeSourceType = (nextSourceType: SourceType | null) => {
    setSourceType(nextSourceType);
    persistLocalValue(contentSourceFilterLocalStorageKey, nextSourceType ?? "");
  };

  // Default "hide played" to on when the user connects, but only until they make
  // an explicit choice — once a preference is persisted it always wins.
  createEffect(() => {
    if (props.isAuthenticated() && readPersistedHidePlayed() === null) {
      setHidePlayed(true);
    }
  });

  const authenticatedPlaylistSource = createMemo(() => (props.isAuthenticated() ? "content-list-playlists" : null));
  const [playlists] = createResource(authenticatedPlaylistSource, () => client.overlays.playlists());
  const playlistsValue = createMemo(() => playlists.latest);
  const selectedCollectionMemberSource = createMemo(() => {
    if (!props.isAuthenticated()) {
      return null;
    }
    const collectionId = props.selectedCollectionId();
    return collectionId === null ? null : collectionId;
  });
  const [selectedCollectionMembers] = createResource(selectedCollectionMemberSource, (collectionId) =>
    client.overlays.collectionMembers({ collectionId }),
  );
  const selectedCollectionMembersValue = createMemo(() => selectedCollectionMembers.latest);
  const collectionMemberCreatorIds = createMemo(
    () => new Set((selectedCollectionMembersValue() ?? emptyCollectionMembers).map((member) => member.creatorId)),
  );
  const collectionsResourceSource = createMemo(() =>
    props.isAuthenticated() ? `content-list-collections-${props.collectionsReloadKey().toString()}` : null,
  );
  const [collections] = createResource(collectionsResourceSource, () => client.overlays.collections());
  const collectionsValue = createMemo(() => collections.latest);
  const selectedCollectionName = createMemo(() => {
    const collectionId = props.selectedCollectionId();
    if (collectionId === null) {
      return null;
    }
    return collectionsValue()?.find((collection) => collection.id === collectionId)?.name ?? null;
  });
  const contentListInput = createMemo(() =>
    toContentListInput(
      search(),
      props.selectedCreator()?.id ?? null,
      props.selectedFeed()?.id ?? null,
      props.selectedCollectionId(),
      sourceType(),
    ),
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

    if (props.isAuthenticated() && props.mode === "library") {
      return "subscribed";
    }

    return "catalog";
  });
  const contentItemsResourceKey = createMemo(() => {
    const mode = contentItemsResourceMode();
    // History views are snapshots: opened/played markers propagate through local
    // status patches (app-shell.tsx patchContentStatus/removeContentStatus)
    // instead of a reload key, so selecting or playing a video never refetches
    // or reorders the history list under the user's cursor.
    const reloadKey = mode === "subscribed"
      ? props.subscriptionsReloadKey()
      : mode === "favorites"
      ? props.favoritesReloadKey()
      : props.catalogReloadKey();
    // listLiveReloadKey ticks per-feed during a refresh so the list refetches on
    // the fly as content is ingested. It is intentionally a separate signal from
    // the per-view reload keys: bumping those would tear down the video viewer
    // (which keys on favoritesReloadKey) and the source pane. This one moves only.
    return toContentItemsResourceKey(mode, contentListInput(), reloadKey + props.listLiveReloadKey());
  });
  const [contentItems] = createResource(contentItemsResourceKey, () => {
    const mode = untrack(contentItemsResourceMode);
    const input = untrack(contentListInput);
    return readContentItems(mode, input);
  });
  const contentItemsValue = createMemo(() => contentItems.latest);
  // Stable query identity used to key the appended "load more" page and the
  // paging offset. It MUST NOT include reload ticks — otherwise a refresh
  // live-reload bumps the key and wipes the user's loaded-more pages. See
  // toContentItemsQueryKey.
  const contentItemsQueryKey = createMemo(() =>
    toContentItemsQueryKey(contentItemsResourceMode(), contentListInput()),
  );
  // The favorites overlay source is deliberately NOT keyed on
  // favoritesReloadKey: re-keying it on every viewer-side toggle would
  // re-suspend the resource read below and blank the whole column. The
  // on-effect after the resource refetches in place on each bump instead.
  const favoriteItemsResourceInput = createMemo(() => (props.isAuthenticated() ? "content-list-favorite-items" : null));
  const [favoriteItems, { refetch: refetchFavoriteItems }] = createResource(favoriteItemsResourceInput, () =>
    client.overlays.favoriteContentItems(),
  );
  const favoriteItemsValue = createMemo(() => favoriteItems.latest);
  // Viewer-side favorite toggles bump favoritesReloadKey from app-shell.tsx.
  // The bump refetches this overlay in place (server reconciliation) while the
  // .latest read keeps the column mounted — no suspense, no blank.
  createEffect(on(() => props.favoritesReloadKey(), () => { void refetchFavoriteItems(); }, { defer: true }));
  const favoriteContentItemIds = createMemo(() => {
    const favoriteSourceItems = contentItemsResourceMode() === "favorites" ? contentItemsValue() : favoriteItemsValue();

    return new Set((favoriteSourceItems ?? emptyCatalogContentItems).map((contentItem) => contentItem.id));
  });
  const listTargetPlaylistId = createMemo(() => {
    const loadedPlaylists = playlistsValue() ?? emptyPlaylists;
    const selectedId = props.selectedPlaylistId();

    if (selectedId !== null && loadedPlaylists.some((playlist) => playlist.id === selectedId)) {
      return selectedId;
    }

    return loadedPlaylists[0]?.id ?? null;
  });
  // Stable-reference cache: maps content-item id -> the object reference we last
  // rendered for it. Preserved across resource refetches so <For> reuses DOM for
  // unchanged rows instead of recreating them (which reloads every thumbnail and
  // pegs the renderer). See mergeStableItemReferences.
  let stableItemById = new Map<string, CatalogContentListItem>();
  const loadedContentItems = createMemo(() => {
    const merged = appendUniqueContentItems(
      mergeStableItemReferences(contentItemsValue() ?? emptyCatalogContentItems, stableItemById),
      pageItemsForKey(appendedContentPage(), contentItemsQueryKey()),
    );
    stableItemById = new Map(merged.map((item) => [item.id, item]));
    return merged;
  });
  const contentPageHasMore = createMemo(() =>
    showsCatalogFilters(viewMode())
      && pageHasMoreForKey(appendedContentPage(), contentItemsQueryKey(), (contentItemsValue() ?? emptyCatalogContentItems).length, contentListLimit),
  );
  const displayedContentItems = createMemo(() => {
    const currentContentItems = loadedContentItems();
    const input = contentListInput();
    const locallyFilteredItems = showsCatalogFilters(viewMode())
      ? currentContentItems
      : currentContentItems.filter((contentItem) =>
        contentItemMatchesLocalFilters(contentItem, input, collectionMemberCreatorIds()),
      );

    const visibleItems = props.isAuthenticated() && hidePlayed()
      ? (() => {
          const statuses = props.contentStatuses();
          return locallyFilteredItems.filter((contentItem) => !toContentStatusFlags(statuses, contentItem.id).played);
        })()
      : locallyFilteredItems;

    return viewMode() === "history-opened" || viewMode() === "played"
      ? visibleItems.slice(0, contentListLimit)
      : visibleItems;
  });
  const contentCount = createMemo(() => displayedContentItems().length);
  // Keyboard-active row for the j/k shortcuts (qol-features-plan.md F3). The
  // raw index lives in the signal; the memo clamps it against the displayed
  // list length so the active row can never point outside the rendered list
  // even when local filters shrink it without a resource-key change.
  const [requestedActiveIndex, setRequestedActiveIndex] = createSignal(0);
  const activeIndex = createMemo(() => clampActiveIndex(requestedActiveIndex(), displayedContentItems().length));
  const activeContentItemId = createMemo(() => displayedContentItems()[activeIndex()]?.id ?? null);
  // j/k restart from the top whenever the list identity (mode, filters, reload
  // tick) changes, per the F3 spec.
  createEffect(on(contentItemsResourceKey, () => setRequestedActiveIndex(0), { defer: true }));
  // Escape clears both column searches through the shared app-shell counter.
  createEffect(on(() => props.searchClearKey(), () => setSearch(""), { defer: true }));
  // List progress for opened rows: contentItemId -> the playback position
  // parsed from the opened row's metadataJson. Played rows and unparseable
  // metadata contribute nothing (toPlaybackPositionsByItemId).
  const playbackPositionByItemId = createMemo(() => toPlaybackPositionsByItemId(props.contentStatuses()));

  // Decision D10: virtualize the content list only from the lg breakpoint up.
  // Below lg the plain <For> branch renders every row unchanged.
  const isDesktopViewport = createDesktopMediaQuerySignal();
  let contentScrollRegionEl: HTMLDivElement | undefined;
  // Option values that change over time are exposed as getters: the Solid
  // adapter re-runs setOptions inside a tracked computation, so count and
  // enabled stay live without recreating the virtualizer.
  const contentVirtualizer = createVirtualizer({
    get count() {
      return displayedContentItems().length;
    },
    getScrollElement: () => contentScrollRegionEl ?? null,
    estimateSize: () => estimateContentItemRowHeight(props.readerDensity()),
    overscan: 5,
    getItemKey: (index) => displayedContentItems()[index]?.id ?? index,
    get enabled() {
      return isDesktopViewport();
    },
  });
  // estimateSize is not part of the virtualizer's own change detection: after a
  // density switch the cached row sizes must be dropped explicitly so rows fall
  // back to the new estimates (measureElement then re-locks real heights).
  createEffect(on(() => props.readerDensity(), () => contentVirtualizer.measure(), { defer: true }));

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
      if (contentItemsResourceMode() !== "favorites") {
        await refetchFavoriteItems();
      }
    } catch (error) {
      throw new Error(`Favorite update failed: ${formatError(error)}`);
    }
  };

  // Scroll follow-up for j/k. On lg the virtualizer scrolls the active index
  // into its window; below lg the plain list is scanned by the same
  // data-content-item-id attribute both branches render on their <li>. The
  // row is always mounted here: the index was just clamped against this same
  // array and the list branch renders from it, so a single immediate lookup
  // is enough.
  const scrollActiveRowIntoView = (index: number): void => {
    if (isDesktopViewport()) {
      contentVirtualizer.scrollToIndex(index);
      return;
    }

    const region = contentScrollRegionEl;
    const activeItem = displayedContentItems()[index];
    if (region === undefined || activeItem === undefined) {
      return;
    }

    const rows = region.querySelectorAll<HTMLElement>("[data-content-item-id]");
    for (const row of rows) {
      if (row.dataset.contentItemId === activeItem.id) {
        row.scrollIntoView({ block: "nearest" });
        return;
      }
    }
  };

  // Executes one command sent by AppShell's keydown listener. on() keeps the
  // effect's only dependency on the command itself, so the activeIndex and
  // list reads below stay untracked.
  const executeContentShortcutCommand = async (command: ContentShortcutCommand) => {
    if (command.kind === "move") {
      setRequestedActiveIndex(requestedActiveIndex() + command.delta);
      scrollActiveRowIntoView(activeIndex());
      return;
    }

    const activeItem = displayedContentItems()[activeIndex()];
    if (activeItem === undefined) {
      return;
    }

    if (command.kind === "open") {
      await props.onSelectContent(activeItem);
      return;
    }

    // The favorite overlay is authenticated-only (the row action cluster
    // renders behind the same gate), so an anonymous f press stays a no-op.
    if (!props.isAuthenticated()) {
      return;
    }

    setContentCommandError(null);
    try {
      await toggleFavorite(activeItem.id);
    } catch (error) {
      setContentCommandError(formatError(error));
    }
  };

  createEffect(
    on(
      () => props.contentShortcutCommand(),
      (command) => {
        if (command !== null) {
          void executeContentShortcutCommand(command);
        }
      },
      { defer: true },
    ),
  );

  const markOpened = async (contentItemId: string) => {
    await props.onMarkContentOpened(contentItemId);
  };

  const markPlayed = async (contentItemId: string) => {
    await props.onMarkContentPlayed(contentItemId);
  };

  const addContentToPlaylist = async (contentItemId: string) => {
    const playlistId = listTargetPlaylistId();
    if (playlistId === null) {
      return;
    }

    await client.overlays.addPlaylistItem({ playlistId, contentItemId });
    props.onSelectPlaylist(playlistId);
    props.onPlaylistItemAdded();
  };

  // One row renderer shared by both list branches (plain <For> below lg,
  // virtualized rows on lg) so the two paths can never drift apart.
  const renderContentItemRow = (contentItem: CatalogContentListItem) => (
    <ContentListItemRow
      contentItem={contentItem}
      isAuthenticated={props.isAuthenticated}
      isFavorite={() => favoriteContentItemIds().has(contentItem.id)}
      status={() => toContentStatusFlags(props.contentStatuses(), contentItem.id)}
      playbackPosition={() => playbackPositionByItemId().get(contentItem.id) ?? null}
      selected={() => props.selectedContentItemId() === contentItem.id}
      active={() => activeContentItemId() === contentItem.id}
      favoritesView={() => viewMode() === "favorites"}
      readerDensity={props.readerDensity}
      targetPlaylistId={listTargetPlaylistId}
      formatError={formatError}
      formatPublishedAt={formatContentPublishedAt}
      formatDuration={formatContentDuration}
      onSelectContent={props.onSelectContent}
      onMarkOpened={markOpened}
      onMarkPlayed={markPlayed}
      onToggleFavorite={toggleFavorite}
      onAddToPlaylist={addContentToPlaylist}
    />
  );

  const loadMoreContentItems = async () => {
    const mode = contentItemsResourceMode();
    if (!showsCatalogFilters(viewMode()) || (mode !== "catalog" && mode !== "subscribed")) {
      return;
    }

    const queryKey = contentItemsQueryKey();
    const nextOffset = nextOffsetForKey(contentOffset(), queryKey, (contentItemsValue() ?? emptyCatalogContentItems).length);
    const input = { ...contentListInput(), offset: nextOffset };
    setContentPageBusy(true);
    setContentPageError(null);
    try {
      const nextContentItems = mode === "subscribed"
        ? await listSubscribedLibraryContentItems(input)
        : await client.catalog.contentItems(input);
      // Stale-load guard keys on QUERY identity, not the resource key: a refresh
      // live-reload bumps the resource key (refetching page 1) but does NOT
      // change the query, so a load-more in flight during a refresh still
      // appends correctly — page 2 of the same query is still page 2. Only a
      // real query change (search/creator/feed/collection/source/mode) drops
      // the result, which is the dangerous case (appending page 2 of a different
      // query onto the current page 1).
      if (contentItemsQueryKey() !== queryKey) {
        return;
      }
      setAppendedContentPage((currentPage) => ({
        key: queryKey,
        items: appendUniqueContentItems(pageItemsForKey(currentPage, queryKey), nextContentItems),
        hasMore: nextContentItems.length === contentListLimit,
      }));
      setContentOffset({ key: queryKey, nextOffset: nextOffset + nextContentItems.length });
    } catch (error) {
      setContentPageError(formatError(error));
    } finally {
      setContentPageBusy(false);
    }
  };

  return (
    <section
      aria-label="Content list"
      class={contentColumnClass}
      data-shell-column="content"
      data-selected-creator-id={props.selectedCreator()?.id ?? ""}
      data-selected-feed-id={props.selectedFeed()?.id ?? ""}
      data-selected-collection-id={props.selectedCollectionId() ?? ""}
    >
      <div class={contentHeaderRegionClass} data-content-header-region>
        <div class="flex items-center gap-2">
          <label class="sr-only" for={contentSearchInputId}>
            Search content
          </label>
          <input
            id={contentSearchInputId}
            class="min-w-0 flex-1 rounded-md rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground outline-none transition focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
            type="search"
            value={search()}
            placeholder="Search videos"
            autocomplete="off"
            onInput={(event) => setSearch(event.currentTarget.value)}
          />
          <Show when={props.isAuthenticated()}>
            <label class="flex items-center gap-1 text-xs text-muted-foreground" for={contentHidePlayedInputId}>
              <input
                id={contentHidePlayedInputId}
                type="checkbox"
                checked={hidePlayed()}
                onChange={(event) => {
                  const next = event.currentTarget.checked;
                  setHidePlayed(next);
                  persistHidePlayed(next);
                }}
              />
              <span>Hide played</span>
            </label>
          </Show>
          <span class="shrink-0 text-xs text-muted-foreground" data-content-loaded-count>
            {contentCount()}
          </span>
          <button
            type="button"
            class="shrink-0 rounded-md border border-border bg-background p-1 text-muted-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            aria-label={controlsExpanded() ? "Collapse filters" : "Expand filters"}
            aria-expanded={controlsExpanded() ? "true" : "false"}
            onClick={() => setControlsExpanded((prev) => !prev)}
          >
            <Show when={controlsExpanded()} fallback={<ChevronUp size={12} />}>
              <ChevronDown size={12} />
            </Show>
          </button>
        </div>
        <Show when={props.isAuthenticated() && selectedCollectionName() !== null}>
          {(name) => (
            <div class="mt-2 flex items-center gap-2" data-collection-filter-active>
              <span class="min-w-0 flex-1 truncate rounded-md border border-border bg-muted px-2 py-1 text-[0.72rem] text-muted-foreground">
                Collection: {name()}
              </span>
              <button
                type="button"
                class="shrink-0 rounded-md border border-border bg-background p-1 text-muted-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                aria-label="Clear collection filter"
                title="Clear collection filter"
                onClick={() => props.onClearCollection()}
              >
                <X size={12} />
              </button>
            </div>
          )}
        </Show>
        <Show when={props.selectedCreator()}>
          {(creator) => (
            <div class="mt-2 flex items-center gap-2" data-creator-filter-active>
              <span class="min-w-0 flex-1 truncate rounded-md border border-border bg-muted px-2 py-1 text-[0.72rem] text-muted-foreground">
                Creator: {creator().displayName}
              </span>
              <button
                type="button"
                class="shrink-0 rounded-md border border-border bg-background p-1 text-muted-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                aria-label="Clear creator filter"
                title="Clear creator filter"
                onClick={() => props.onClearCreator()}
              >
                <X size={12} />
              </button>
            </div>
          )}
        </Show>
        <Show when={contentCommandError()}>
          {(message) => <p class="mt-2 text-xs text-destructive" data-content-command-error>{message()}</p>}
        </Show>
        <Show when={controlsExpanded()}>
          <Show when={props.isAuthenticated()}>
            <div class="mt-2 grid grid-cols-4 gap-2" aria-label="Content view">
              <button
                id={props.mode === "library" ? contentViewModeSubscribedId : contentViewModeAllId}
                type="button"
                class="inline-flex flex-col items-center gap-0.5 rounded-md border border-border bg-background px-2 py-1.5 text-xs font-semibold text-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                aria-pressed={viewMode() === (props.mode === "library" ? "subscribed" : "catalog")}
                aria-label="All"
                title="All"
                onClick={() => changeViewMode(props.mode === "library" ? "subscribed" : "catalog")}
              >
                <LayoutGrid size={14} />
                <span>All</span>
              </button>
              <button
                id={contentViewModeFavoritesId}
                type="button"
                class="inline-flex flex-col items-center gap-0.5 rounded-md border border-border bg-background px-2 py-1.5 text-xs font-semibold text-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                aria-pressed={viewMode() === "favorites"}
                aria-label="Favorites"
                title="Favorites"
                onClick={() => changeViewMode("favorites")}
              >
                <Heart size={14} />
                <span>Favs</span>
              </button>
              <button
                id={contentViewModeHistoryId}
                type="button"
                class="inline-flex flex-col items-center gap-0.5 rounded-md border border-border bg-background px-2 py-1.5 text-xs font-semibold text-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                aria-pressed={viewMode() === "history-opened"}
                aria-label="History/Open"
                title="History/Open"
                onClick={() => changeViewMode("history-opened")}
              >
                <Clock size={14} />
                <span>History</span>
              </button>
              <button
                id={contentViewModePlayedId}
                type="button"
                class="inline-flex flex-col items-center gap-0.5 rounded-md border border-border bg-background px-2 py-1.5 text-xs font-semibold text-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                aria-pressed={viewMode() === "played"}
                aria-label="Played"
                title="Played"
                onClick={() => changeViewMode("played")}
              >
                <CheckCircle size={14} />
                <span>Played</span>
              </button>
            </div>
          </Show>
          <Show when={showsCatalogFilters(viewMode()) || (props.isAuthenticated() && (viewMode() === "favorites" || viewMode() === "history-opened" || viewMode() === "played"))}>
            <div class="mt-2 grid grid-cols-[1fr_auto] gap-2" aria-label={visibleFiltersLabel()}>
              <label class="sr-only" for={contentSourceFilterId}>
                Filter content by source
              </label>
              <select
                id={contentSourceFilterId}
                class="rounded-md border border-input bg-background px-2 py-1 text-xs text-foreground outline-none transition focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
                value={sourceType() ?? allContentSourceFilterValue}
                onChange={(event) => changeSourceType(toSourceFilterValue(event.currentTarget.value))}
              >
                <option value={allContentSourceFilterValue}>All</option>
                <For each={sourceTypeFilterValues}>
                  {(source) => <option value={source}>{formatSourceLabel(source)}</option>}
                </For>
              </select>
            </div>
          </Show>
          <Show when={!showsCatalogFilters(viewMode())}>
            <p class="mt-2 text-xs leading-5 text-muted-foreground">
              Filters applied locally to loaded videos.
            </p>
          </Show>
        </Show>
      </div>
      <Show when={props.middlePanePanel() === "add-source"}>
        <div class="border-b border-border" data-middle-pane-panel="add-source">
          <div class="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5">
            <h3 class="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Add source</h3>
            <button
              type="button"
              class="shrink-0 border border-border bg-background p-1 text-muted-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              aria-label="Close add source panel"
              title="Close"
              onClick={props.onCloseMiddlePanePanel}
            >
              <X size={14} />
            </button>
          </div>
          <AddSourceSection
            isAuthenticated={props.isAuthenticated}
            onSourceAdded={props.onAddSource}
          />
        </div>
      </Show>
      <div
        class={contentScrollRegionClass}
        data-content-scroll-region
        ref={(el) => {
          contentScrollRegionEl = el;
        }}
      >
        <Switch>
          <Match when={contentItems.loading && contentItemsValue() === undefined}>
            <p class="text-xs font-semibold text-card-foreground">Loading videos</p>
            <p class="mt-2 text-xs leading-5 text-muted-foreground">Loading {visibleContentCollectionLabel()} videos.</p>
          </Match>
          <Match when={contentItems.error !== undefined}>
            <p class="text-xs font-semibold text-destructive">Videos unavailable</p>
            <p class="mt-2 text-xs leading-5 text-muted-foreground">{formatError(contentItems.error)}</p>
          </Match>
          <Match when={contentItemsValue() !== undefined && displayedContentItems().length === 0}>
            <p class="text-xs font-semibold text-card-foreground">No videos found</p>
            <p class="mt-2 text-xs leading-5 text-muted-foreground">
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
            <Show
              when={isDesktopViewport()}
              fallback={
                <ol aria-label={`${visibleContentCollectionLabel()} videos, ${contentCount()} shown`}>
                  <For each={displayedContentItems()}>
                    {(contentItem) => (
                      <li data-content-item-id={contentItem.id}>{renderContentItemRow(contentItem)}</li>
                    )}
                  </For>
                </ol>
              }
            >
              <ol
                aria-label={`${visibleContentCollectionLabel()} videos, ${contentCount()} shown`}
                style={{ position: "relative", height: `${contentVirtualizer.getTotalSize()}px` }}
              >
                <For each={contentVirtualizer.getVirtualItems()}>
                  {(virtualItem) => (
                    <li
                      data-index={virtualItem.index}
                      data-content-item-id={displayedContentItems()[virtualItem.index]?.id ?? ""}
                      ref={(el) => contentVirtualizer.measureElement(el)}
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        transform: `translateY(${virtualItem.start}px)`,
                      }}
                    >
                      <Show when={displayedContentItems()[virtualItem.index]}>
                        {(contentItem) => renderContentItemRow(contentItem())}
                      </Show>
                    </li>
                  )}
                </For>
              </ol>
            </Show>
            <ContentLoadMoreControl
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
