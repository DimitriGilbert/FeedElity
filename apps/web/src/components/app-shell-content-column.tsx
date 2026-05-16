import type {
  CatalogContentListItem,
  CatalogFeed,
  Playlist,
  SourceType,
  UserContentStatus,
} from "@FeedElity/api";
import { For, Match, Show, Switch, createMemo, createResource, createSignal, untrack } from "solid-js";

import { client } from "@/utils/orpc";

import { ContentListItemRow } from "./app-shell-rows";
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
  emptyAppendedPageState,
  formatError,
  formatContentDuration,
  formatContentPublishedAt,
  formatSourceLabel,
  mergeUniqueContentItemsForDisplay,
  pageHasMoreForKey,
  pageItemsForKey,
  showsCatalogFilters,
  toContentListInput,
  toContentStatusFlags,
  type AppendedPageState,
  type BrowsableCreator,
  type ContentListInput,
  type ContentViewMode,
  type ReaderDensity,
  type ShellMode,
} from "./app-shell.contract";

type ContentItemsResourceMode = "catalog" | "subscribed" | "favorites" | "history-opened" | "played";

const allContentSourceFilterValue = "all";

const sourceFilterOptions: readonly SourceType[] = ["youtube", "odysee", "peertube"];

const emptyCatalogContentItems: readonly CatalogContentListItem[] = [];

const emptyPlaylists: readonly Playlist[] = [];

function toSourceFilterValue(value: string): SourceType | null {
  return sourceFilterOptions.find((sourceType) => sourceType === value) ?? null;
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

interface ContentLoadMoreControlProps {
  readonly shownCount: number;
  readonly pageSize: number;
  readonly hasMore: boolean;
  readonly busy: boolean;
  readonly errorMessage: string | null;
  readonly label: string;
  readonly onLoadMore: () => Promise<void>;
}

function ContentLoadMoreControl(props: ContentLoadMoreControlProps) {
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

export interface ContentListColumnProps {
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

export function ContentListColumn(props: ContentListColumnProps) {
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
                        formatPublishedAt={formatContentPublishedAt}
                        formatDuration={formatContentDuration}
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
