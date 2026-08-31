import { expect, test } from "bun:test";
import type { CatalogContentSource, CatalogCreator, CatalogCreatorSummary, CatalogFeed, FeedHealthEntry, RefreshFeedResult, RefreshRun, RefreshRunReport, UserContentStatus, UserSetting } from "@FeedElity/api";
import type { LeftPaneTab, MiddlePanePanel, PlayableSource, ViewerMode } from "./app-shell.contract";

import {
  addSourceHelpId,
  addSourceInputId,
  bindMediaQueryMatches,
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
  creatorListLimit,
  creatorListSortInputId,
  creatorListSortSettingKey,
  creatorListSortValues,
  creatorSearchInputId,
  creatorSourceFilterId,
  creatorSourceFilterLocalStorageKey,
  defaultLeftFraction,
  defaultMiddleFraction,
  desktopShellGridClass,
  feedListLimit,
  firstPageOffset,
  formatFeedHealthLastSuccess,
  formatPlaybackPosition,
  formatPlaybackResumeLabel,
  formatRefreshReportSummary,
  formatRefreshRunSummary,
  formatSettingValue,
  hidePlayedLocalStorageKey,
  isResumablePlaybackPosition,
  isYouTubeEmbedUrl,
  parseRefreshErrorSummaries,
  getShellColumnCount,
  hasInternalAppHeader,
  joinFeedResultsWithFeeds,
  leftPaneTabLabels,
  leftPaneTabLocalStorageKey,
  minLeftFraction,
  minMiddleFraction,
  minRightFraction,
  paneWidthsLocalStorageKey,
  persistLocalValue,
  readPersistedLocalValue,
  clampLeftFraction,
  clampMiddleFraction,
  playlistDescriptionInputId,
  playlistNameInputId,
  playlistSortInputId,
  collectionNameInputId,
  collectionDescriptionInputId,
  collectionMemberSearchInputId,
  desktopMediaQuery,
  estimateContentItemRowHeight,
  readerDensityInputId,
  readerDensitySettingKey,
  readerDensityValues,
  refreshStatusRegionId,
  settingKeyInputId,
  settingKeyPattern,
  settingValueInputId,
  shellGridClass,
  shellColumns,
  shellModeLocalStorageKey,
  shellPaneIds,
  shellRootClass,
  showsCatalogFilters,
  shouldFlushPlaybackPosition,
  sortFeedHealthEntries,
  sourceActionsRegionClass,
  sourceCatalogRegionClass,
  sourceColumnClass,
  sourceCreatorListRegionClass,
  sourceFeedListRegionClass,
  sourceHeaderRegionClass,
  sourceTypeFilterValues,
  toContentListInput,
  toCopyableStreamLink,
  toDesktopColumnTemplate,
  toEmbedUrlWithApi,
  toFeedListInput,
  toPlaybackPosition,
  toPlaybackPositionsByItemId,
  toPlayableSources,
  toCreatorListSortFromSettings,
  toCreatorSourceTypes,
  toContentViewModeDefault,
  toPersistedContentViewMode,
  toPersistedLeftPaneTab,
  toPersistedShellMode,
  toPersistedSourceTypeFilter,
  toReaderDensityFromSettings,
  toSafePlaybackUrl,
  toShellContentSelectionState,
  toCreatorListInput,
  toShellSelectionState,
  toYoutubeNoCookieFromSettings,
  youtubePrivacySettingKey,
  viewerColumnClass,
  viewerScrollRegionClass,
} from "./app-shell.contract";
import {
  maxUserDataImportFileBytes,
  parseUserDataImportText,
  toUserDataExportFilename,
  toUserDataExportJson,
  triggerUserDataDownload,
} from "./app-shell-source-sections";

const changedUiSourceFiles = [
  "./app-shell.contract.ts",
  "./app-shell.tsx",
  "./app-shell-content-column.tsx",
  "./app-shell-rows.tsx",
  "./app-shell-source-sections.tsx",
  "./app-shell-viewer.tsx",
  "./source-indicator.tsx",
  "./pane-resizer.tsx",
  "./header.tsx",
  "./user-menu.tsx",
  "./sign-in-form.tsx",
  "./sign-up-form.tsx",
  "../styles.css",
] as const;

async function readChangedUiSource() {
  const sources = await Promise.all(
    changedUiSourceFiles.map(async (filePath) => Bun.file(new URL(filePath, import.meta.url)).text()),
  );

  return sources.join("\n");
}

async function readAppShellSource() {
  const sources = await Promise.all(
    ["./app-shell.tsx", "./app-shell-rows.tsx", "./app-shell-source-sections.tsx", "./app-shell-content-column.tsx", "./app-shell-viewer.tsx", "./refresh-status-dialog.tsx"].map(async (filePath) => Bun.file(new URL(filePath, import.meta.url)).text()),
  );

  return sources.join("\n");
}

/**
 * A complete Storage implementation backed by a Map so the guarded
 * `readPersistedLocalValue`/`persistLocalValue` pair can be exercised through
 * real localStorage semantics (bun:test has no Web Storage global).
 */
function toStorageStub(store: Map<string, string>): Storage {
  return {
    get length() {
      return store.size;
    },
    clear: () => {
      store.clear();
    },
    key: (index: number) => {
      return [...store.keys()][index] ?? null;
    },
    getItem: (key: string) => {
      const value = store.get(key);
      return value === undefined ? null : value;
    },
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  };
}

test("shell exposes the required three-pane RSS reader contract", () => {
  expect(getShellColumnCount()).toBe(3);
  expect(shellColumns.map((column) => column.id)).toEqual([...shellPaneIds]);
  expect(shellColumns.map((column) => column.title)).toEqual(["Sources", "Feed", "Viewer"]);
  expect(desktopShellGridClass).toBe("lg:grid lg:h-full lg:min-h-0 lg:overflow-hidden");
  expect(shellGridClass).not.toContain("grid-cols-[");
});

test("shell renders exactly three top-level pane sections", async () => {
  const source = await readAppShellSource();
  const paneMatches = source.match(/data-shell-column=/g) ?? [];

  expect(paneMatches).toHaveLength(3);
  expect(source).toContain('data-shell-column="creators"');
  expect(source).toContain('data-shell-column="content"');
  expect(source).toContain('data-shell-column="viewer"');
  expect(shellGridClass).not.toContain("grid-cols-[");
});

test("shell panes use the base responsive column classes without mobile pane state", async () => {
  const source = await readAppShellSource();

  expect(shellPaneIds).toEqual(["creators", "content", "viewer"]);
  expect(shellColumns.map((column) => `${column.id}:${column.title}`)).toEqual([
    "creators:Sources",
    "content:Feed",
    "viewer:Viewer",
  ]);
  expect(source).toContain("class={sourceColumnClass}");
  expect(source).toContain("class={contentColumnClass}");
  expect(source).toContain("class={viewerColumnClass}");
  expect(source).not.toContain("data-mobile-pane-navigation");
  expect(source).not.toContain("activeMobilePaneId");
  expect(source).not.toContain("mobilePaneClass");
  expect(source).not.toContain("reader-pane-");
});

test("desktop shell panes keep viewport height and hide outer overflow", () => {
  expect(desktopShellGridClass).toBe("lg:grid lg:h-full lg:min-h-0 lg:overflow-hidden");
  expect(shellGridClass).toContain("lg:h-full");
  expect(shellGridClass).toContain("lg:min-h-0");
  expect(shellGridClass).toContain("lg:overflow-hidden");
  expect(sourceColumnClass).toContain("lg:h-full");
  expect(sourceColumnClass).toContain("lg:min-h-0");
  expect(sourceColumnClass).toContain("lg:overflow-hidden");
  expect(contentColumnClass).toContain("lg:h-full");
  expect(contentColumnClass).toContain("lg:min-h-0");
  expect(contentColumnClass).toContain("lg:overflow-hidden");
  expect(viewerColumnClass).toContain("lg:h-full");
  expect(viewerColumnClass).toContain("lg:min-h-0");
  expect(viewerColumnClass).toContain("lg:overflow-hidden");
});

test("source and content panes expose stable headers and scroll bodies", async () => {
  const source = await readAppShellSource();

  expect(sourceHeaderRegionClass).toContain("lg:shrink-0");
  expect(sourceCatalogRegionClass).toContain("min-h-0");
  expect(sourceCatalogRegionClass).toContain("lg:overflow-hidden");
  expect(sourceCreatorListRegionClass).toContain("lg:flex-1");
  expect(sourceCreatorListRegionClass).toContain("lg:overflow-y-auto");
  expect(sourceFeedListRegionClass).toContain("lg:max-h-[32dvh]");
  expect(sourceFeedListRegionClass).toContain("lg:overflow-y-auto");
  expect(sourceActionsRegionClass).toContain("lg:max-h-[42dvh]");
  expect(sourceActionsRegionClass).toContain("lg:overflow-y-auto");
  expect(contentHeaderRegionClass).toContain("lg:shrink-0");
  expect(contentScrollRegionClass).toContain("lg:flex-1");
  expect(contentScrollRegionClass).toContain("lg:overflow-y-auto");
  expect(viewerScrollRegionClass).toContain("lg:flex-1");
  expect(viewerScrollRegionClass).toContain("lg:overflow-y-auto");
  expect(source).toContain("data-source-header-region");
  expect(source).toContain("data-source-scroll-region");
  expect(source).toContain("data-source-feed-scroll-region");
  expect(source).toContain("data-source-actions-region");
  expect(source).toContain("data-content-header-region");
  expect(source).toContain("data-content-scroll-region");
  expect(source).toContain("data-viewer-scroll-region");
});

test("phase 1 layout repair keeps no fourth pane dialogs or fake source actions", async () => {
  const source = await readAppShellSource();
  const paneMatches = source.match(/data-shell-column=/g) ?? [];
  const forbiddenControls = [
    "data-shell-column=\"settings\"",
    "data-shell-column=\"playlists\"",
    "data-shell-column=\"actions\"",
    "data-shell-column=\"sources-actions\"",
    "Add subscription",
    "Batch add",
    "topics",
    "external-content",
  ];

  // The shell stays exactly three panes; a refresh-status modal is allowed
  // because it is not a pane and carries no data-shell-column.
  expect(paneMatches).toHaveLength(3);
  expect((source.match(/<dialog/g) ?? []).length).toBe(1);
  for (const snippet of forbiddenControls) {
    expect(source).not.toContain(snippet);
  }
});

test("primary navigation preserves anonymous catalog access and authenticated workspace entry", async () => {
  const source = await Bun.file(new URL("./header.tsx", import.meta.url)).text();

  expect(source).toContain('{ to: "/", label: "Catalog", helper: "Browse" }');
  expect(source).toContain('{ to: "/dashboard", label: "Library", helper: "Saved" }');
});

test("anonymous shell state gates protected overlays behind app session state", async () => {
  const source = await readAppShellSource();

  expect(source).toContain("const isAuthenticated = createMemo(() => !session().isPending && session().data !== null);");
  expect(source).not.toContain("client.session.current");
  expect(source).toContain('props.isAuthenticated() && props.mode === "library"');
});

test("creator catalog holds its first fetch until the persisted sort is known (D11)", async () => {
  const source = await readAppShellSource();

  expect(source).toContain("const creatorsResourceInput = createMemo(() => {\n    if (props.creatorSortPending()) {\n      return null;\n    }\n\n    return creatorListResourceKey();\n  });");
  expect(source).toContain('return settings.state === "unresolved" || settings.state === "pending";');
  expect(source).toContain("creatorSortPending={creatorListFetchPending}");
  expect(source).toContain('props.mode === "catalog" && (creators.loading || props.creatorSortPending()) && creatorsValue() === undefined');
});

test("app shell keeps a single compact global header", () => {
  expect(hasInternalAppHeader).toBe(false);
});

test("shell uses the full viewport width without outer gutters or centered frame", () => {
  expect(shellRootClass).toContain("w-dvw");
  expect(shellRootClass).not.toContain("max-w");
  expect(shellRootClass).not.toContain("mx-auto");
  expect(shellRootClass).not.toContain(" px-");
  expect(shellRootClass).not.toContain(" p-");
  expect(shellGridClass).toContain(desktopShellGridClass);
  expect(shellGridClass).toContain("w-full");
  expect(shellGridClass).not.toContain("max-w");
  expect(shellGridClass).not.toContain("mx-auto");
});

test("creator search builds bounded public catalog input", () => {
  expect(creatorSearchInputId).toBe("creator-source-search");
  expect(creatorSourceFilterId).toBe("creator-source-type-filter");
  expect(firstPageOffset).toBe(0);
  expect(toCreatorListInput("   ")).toEqual({ sort: "name", limit: creatorListLimit, offset: firstPageOffset });
  expect(toCreatorListInput("   ", "youtube")).toEqual({ sort: "name", sourceType: "youtube", limit: creatorListLimit, offset: firstPageOffset });
  expect(toCreatorListInput("  alpha creator  ")).toEqual({ search: "alpha creator", sort: "name", limit: creatorListLimit, offset: firstPageOffset });
  expect(toCreatorListInput("  alpha creator  ", "peertube")).toEqual({
    search: "alpha creator",
    sourceType: "peertube",
    sort: "name",
    limit: creatorListLimit,
    offset: firstPageOffset,
  });
  expect(toCreatorListInput("next", null, "name", 50)).toEqual({ search: "next", sort: "name", limit: creatorListLimit, offset: 50 });
  expect(toCreatorListInput("next", null, "lastUpdate")).toEqual({ search: "next", sort: "lastUpdate", limit: creatorListLimit, offset: firstPageOffset });
});

test("selected creator feed list builds bounded paginated input", () => {
  expect(feedListLimit).toBe(25);
  expect(toFeedListInput(null)).toBeNull();
  expect(toFeedListInput("creator-1")).toEqual({ creatorId: "creator-1", limit: feedListLimit, offset: firstPageOffset });
  expect(toFeedListInput("creator-1", "youtube", 25)).toEqual({
    creatorId: "creator-1",
    sourceType: "youtube",
    limit: feedListLimit,
    offset: 25,
  });
});

test("creator selection exposes middle-pane filtering state", () => {
  expect(toShellSelectionState(null)).toEqual({ selectedCreatorId: null });
  expect(toShellSelectionState("creator-1")).toEqual({ selectedCreatorId: "creator-1" });
});

test("content list builds bounded public catalog input", () => {
  expect(contentCatalogFiltersLabel).toBe("Catalog filters");
  expect(contentSearchInputId).toBe("content-list-search");
  expect(contentSourceFilterId).toBe("content-source-filter");
  expect(toContentListInput("   ", null, null, null, null)).toEqual({ limit: contentListLimit, offset: firstPageOffset });
  expect(toContentListInput("   ", null, "feed-1", null, null)).toEqual({ feedId: "feed-1", limit: contentListLimit, offset: firstPageOffset });
  expect(toContentListInput(" livestream ", null, null, null, "peertube")).toEqual({
    search: "livestream",
    sourceType: "peertube",
    limit: contentListLimit,
    offset: firstPageOffset,
  });
  expect(toContentListInput(" documentary ", "creator-2", null, null, null)).toEqual({
    search: "documentary",
    creatorId: "creator-2",
    limit: contentListLimit,
    offset: firstPageOffset,
  });
  expect(toContentListInput("  matrix  ", "creator-1", "feed-2", null, "youtube")).toEqual({
    search: "matrix",
    creatorId: "creator-1",
    feedId: "feed-2",
    sourceType: "youtube",
    limit: contentListLimit,
    offset: firstPageOffset,
  });
  expect(toContentListInput("collection-scoped", null, null, "collection-1", null)).toEqual({
    search: "collection-scoped",
    collectionId: "collection-1",
    limit: contentListLimit,
    offset: firstPageOffset,
  });
  expect(toContentListInput("more", null, null, null, null, 100)).toEqual({ search: "more", limit: contentListLimit, offset: 100 });
});

test("content selection updates shell state contract", () => {
  expect(toShellContentSelectionState(null, null)).toEqual({ selectedCreatorId: null, selectedContentItemId: null });
  expect(toShellContentSelectionState("creator-1", "content-1")).toEqual({
    selectedCreatorId: "creator-1",
    selectedContentItemId: "content-1",
  });
});

test("creator pane is wired to anonymous catalog creators and feeds", async () => {
  const source = await readAppShellSource();

  expect(source).toContain("client.catalog.creators(untrack(creatorListInput))");
  expect(source).toContain("return input === null ? emptyCatalogFeeds : client.catalog.feeds(input);");
  expect(source).toContain("type=\"search\"");
  expect(source).toContain("isSelected={props.selectedCreatorId() === creator.id}");
  expect(source).toContain("aria-pressed={props.isSelected}");
  expect(source).toContain("data-selected-creator-id={props.selectedCreator()?.id ?? \"\"}");
});

test("creator source-type filter scopes the creator list without changing playback source switching", async () => {
  const source = await readAppShellSource();

  expect(source).toContain("toPersistedSourceTypeFilter(readPersistedLocalValue(creatorSourceFilterLocalStorageKey))");
  // Catalog search is debounced: the list input reads the 300 ms debounced
  // mirror of the search signal, not the raw keystroke value.
  expect(source).toContain("() => toCreatorListInput(debouncedSearch(), sourceType(), props.creatorSort())");
  // The filter is a compact native details/summary popover: the id moved onto
  // the summary trigger so selectors stay meaningful.
  expect(source).toContain(`id={creatorSourceFilterId}`);
  expect(source).toContain(`<details class="relative shrink-0">`);
  // The trigger aria-label states the active filter ("All" or a source label).
  expect(source).toContain("aria-label={`Filter creators by source: ${activeCreatorSourceTypeLabel()}`}");
  expect(source).toContain(`title="Filters creator rows by catalog source type. Select a creator to inspect all feeds."`);
  expect(source).toContain("const activeCreatorSourceTypeLabel = createMemo(() => {");
  // The trigger icon is the neutral grid for "All" and the source icon otherwise.
  expect(source).toContain('fallback={<LayoutGrid size={14} aria-hidden="true" />}');
  expect(source).toContain("(activeSourceType: SourceType) => <SourceTypeIcon sourceType={activeSourceType} />");
  // Options are pressed-state buttons (All + one per source) that close the
  // popover and apply the filter through the shared handler.
  expect(source).toContain("aria-pressed={sourceType() === null}");
  expect(source).toContain("const isActive = createMemo(() => sourceType() === source);");
  expect(source).toContain("aria-pressed={isActive()}");
  expect(source).toContain("const applyCreatorSourceType = (nextSourceType: SourceType | null) => {");
  // Three popover close sites exist: the force-refresh action plus the All and
  // per-source filter options — every selection closes its popover.
  expect((source.match(/removeAttribute\("open"\)/g) ?? [])).toHaveLength(3);
  // Multi-source creators belong to every source they publish on, so the
  // filter checks membership in sourceTypes (a creator must stay visible for
  // each of its sources, not a single legacy sourceType field).
  expect(source).toContain("creator.sourceTypes.includes(sourceType()");
  expect(source).toContain("id=\"viewer-source-switcher\"");
  expect(source).toContain("onClick={() => setSelectedSourceId(source.id)}");
});

test("selected feed is explicit and shapes catalog content input", async () => {
  const source = await readAppShellSource();

  expect(source).toContain("const [selectedFeed, setSelectedFeed] = createSignal<CatalogFeed | null>(null)");
  expect(source).toContain("const selectFeed = (feed: CatalogFeed | null) => {");
  expect(source).toContain("setSelectedFeed(feed);");
  expect(source).toContain("data-selected-feed-id={selected() ? props.feed.id : \"\"}");
  expect(source).toContain("data-selected-feed-id={props.selectedFeed()?.id ?? \"\"}");
  expect(source).toContain("props.selectedFeed()?.id ?? null");
  expect(source).toContain("Selected feed");
  expect(source).toContain("Filter feed");
});

test("header refresh exposes normal click and force dropdown actions", async () => {
  const source = await readAppShellSource();

  expect(source).toContain("const runHeaderRefresh = async (force: boolean) => {");
  expect(source).toContain("client.refresh.startAll({ force })");
  expect(source).toContain("client.refresh.status({ runId, limit: 1, feedResultsLimit: 10 })");
  expect(source).toContain("props.onContentListLiveReload();");
  expect(source).toContain("aria-label=\"Refresh due feeds\"");
  expect(source).toContain("onClick={async () => runHeaderRefresh(false)}");
  expect(source).toContain("aria-label=\"Open force refresh action\"");
  expect(source).toContain("aria-label=\"Force refresh all feeds\"");
  expect(source).toContain("await runHeaderRefresh(true);");
  expect(source).toContain("<Show\n                when={refreshBusy()}");
  expect(source).toContain("{refreshProgressText()}");
  expect(source).toContain("return `${completedFeeds}/${run.feedsRequestedCount}`;");
});

test("scoped single-creator refresh is wired to the synchronous runCreator procedure", async () => {
  const source = await readAppShellSource();

  // Force-only single-creator refresh, no normal/force dropdown.
  expect(source).toContain("const runCreatorRefresh = async (creatorId: string) => {");
  expect(source).toContain("const result = await client.refresh.runCreator({ creatorId, force: true });");
  expect(source).toContain("const joined = joinFeedResultsWithFeeds(result.feedResults, result.selectedFeeds);");
  // Scoped failures feed the SAME snapshot/dialog surface as the global refresh.
  expect(source).toContain("setLastCompletedStatus({ run: result.run, results: joined });");
  // The scoped path must NOT bump catalogReloadKey (tears down the creator list,
  // content list, and viewer). It bumps only the surgical feed-list reload key so
  // the selected creator's feed-row metadata refreshes in place.
  expect(source).toContain("setFeedListReloadKey((key) => key + 1);");
  expect(source).not.toContain("props.onRefreshCompleted();");
  // Guards: auth + no in-flight scoped or global refresh.
  expect(source).toContain("if (refreshBusy() !== null || scopedRefreshBusy() !== null) {");
  expect(source).toContain("setScopedRefreshBusy(creatorId);");
});

test("scoped refresh exposes a force-refresh button on the selected-creator feeds header", async () => {
  const source = await readAppShellSource();

  expect(source).toContain("data-refresh-creator={creator().id}");
  expect(source).toContain('aria-label={`Force refresh ${creator().displayName}`}');
  expect(source).toContain('title="Force refresh this source"');
  expect(source).toContain("disabled={scopedRefreshBusy() !== null || refreshBusy() !== null}");
  expect(source).toContain("await runCreatorRefresh(creator().id)");
});

test("feed rows expose selected state icon source metadata and real creator images only", async () => {
  const source = await readAppShellSource();

  expect(source).toContain("function formatFeedRefreshMetadata(feed: CatalogFeed): string");
  expect(source).toContain("Last refresh: Never");
  expect(source).toContain("function formatFeedNextRefreshMetadata(feed: CatalogFeed): string");
  expect(source).toContain("Next normal refresh: Not scheduled");
  expect(source).toContain("creatorImageUrl={creator().imageUrl}");
  expect(source).toContain("data-feed-image=\"creator\"");
  expect(source).toContain("data-feed-source-chip");
  expect(source).toContain("<SourceIconBadge sourceType={props.feed.sourceType} context=\"feed\" />");
  expect(source).toContain("data-feed-refresh-metadata");
  expect(source).toContain("data-feed-next-refresh-metadata");
  expect(source).toContain("data-selected={selected() ? \"true\" : \"false\"}");
  expect(source).not.toContain("feed.thumbnail");
  expect(source).not.toContain("feedPlaceholder");
});

test("content pane is wired to anonymous catalog content items", async () => {
  const source = await readAppShellSource();

  expect(showsCatalogFilters("catalog")).toBe(true);
  expect(showsCatalogFilters("subscribed")).toBe(true);
  expect(showsCatalogFilters("favorites")).toBe(false);
  expect(showsCatalogFilters("history-opened")).toBe(false);
  expect(showsCatalogFilters("played")).toBe(false);
  expect(source).toContain("return client.catalog.contentItems(input)");
  expect(source).toContain("toContentListInput(\n      search(),\n      props.selectedCreator()?.id ?? null,\n      props.selectedFeed()?.id ?? null,\n      props.selectedCollectionId(),\n      sourceType(),\n    ),");
  expect(source).toContain("type=\"search\"");
  expect(source).toContain("id={contentSourceFilterId}");
  expect(source).toContain("<Show when={showsCatalogFilters(viewMode()) || (props.isAuthenticated() && (viewMode() === \"favorites\" || viewMode() === \"history-opened\" || viewMode() === \"played\"))}>");
  expect(source).toContain("aria-label={visibleFiltersLabel()}");
  expect(source).toContain("onInput={(event) => setSearch(event.currentTarget.value)}");
  expect(source).toContain("onChange={(event) => changeSourceType(toSourceFilterValue(event.currentTarget.value))}");
  expect(source).toContain("selected={() => props.selectedContentItemId() === contentItem.id}");
  expect(source).toContain("data-selected-content-item-id={selectedContentItemId() ?? \"\"}");
});

test("content filters are Solid state backed and avoid class-name filtering", async () => {
  const source = await readAppShellSource();
  // Filtering must stay Solid-state driven: no DOM class/tag sniffing, no
  // attribute-styled filtering, no hidden-element toggling. A bare
  // querySelector is not banned outright because the selected-creator row
  // lookup (scrollIntoView targeting, a static [data-creator-id] query) is a
  // legitimate imperative DOM read that filters nothing.
  const forbiddenDomFilteringSnippets = [
    "getElementsByClassName",
    "classList",
    "dataset.sourceType",
    "data-source-type",
    "hidden =",
  ];

  expect(source).toContain("const [search, setSearch] = createSignal(\"\")");
  expect(source).toContain("toPersistedSourceTypeFilter(readPersistedLocalValue(contentSourceFilterLocalStorageKey))");
  expect(source).toContain("props.selectedCollectionId(),");

  for (const snippet of forbiddenDomFilteringSnippets) {
    expect(source).not.toContain(snippet);
  }
});

test("content list exposes no no-op filter controls", async () => {
  const source = await readAppShellSource();
  const filtersIndex = source.indexOf("aria-label={visibleFiltersLabel()}");
  const favoritesBranchIndex = source.indexOf("return client.overlays.favoriteContentItems()");
  const historyBranchIndex = source.indexOf("return listOpenedHistoryContentItems()");
  const playedBranchIndex = source.indexOf("return listPlayedHistoryContentItems()");

  expect(filtersIndex).toBeGreaterThan(-1);
  expect(favoritesBranchIndex).toBeGreaterThan(-1);
  expect(historyBranchIndex).toBeGreaterThan(-1);
  expect(playedBranchIndex).toBeGreaterThan(-1);
  expect(contentHidePlayedInputId).toBe("content-hide-played");
  expect(source).toContain("Hide played");
  expect(source).toContain("setHidePlayed(next)");
  expect(source).toContain("persistHidePlayed(next)");
  expect(source).not.toContain(`${"played"} only`);
});

test("refresh UI is wired to real API procedures without background polling", async () => {
  const source = await readAppShellSource();

  expect(refreshStatusRegionId).toBe("refresh-status-history");
  expect(source).not.toContain("props.results.slice");
  expect(source).toContain("client.refresh.startAll({ force })");
  expect(source).toContain("client.refresh.status({ runId, limit: 1, feedResultsLimit: 10 })");
  expect(source).toContain("props.onContentListLiveReload();");
  // Failures surface through the dedicated status dialog, not a collapsed
  // single-message memo.
  expect(source).toContain("RefreshStatusDialog");
  expect(source).toContain("data-refresh-status-trigger");
  expect(source).toContain("setRefreshStatusOpen(true)");
  expect(source).toContain("parseRefreshErrorSummaries");
  expect(source).toContain("Refresh due feeds");
  expect(source).toContain("Force refresh all feeds");
  expect(source).not.toContain("globalThis.confirm");
  expect(source).not.toContain("window.confirm");
  expect(source).not.toContain("confirm(");
  expect(source).not.toContain("Open normal and force refresh controls");
  expect(source).not.toContain("data-middle-pane-panel=\"refresh\"");
  expect(source).toContain("refreshPollTimer = setTimeout(() => {");
  expect(source).not.toContain("setInterval");
});

test("refresh results expose feed labels errors and skipped reasons", async () => {
  const source = await readAppShellSource();
  const report: RefreshRunReport = {
    runId: "refresh-run-1",
    scope: "all",
    force: false,
    status: "partial",
    selectedFeedCount: 1,
    skippedFeedCount: 1,
    feedsSucceededCount: 0,
    feedsFailedCount: 1,
    itemsDiscoveredCount: 0,
    itemsCreatedCount: 0,
    itemsUpdatedCount: 0,
    startedAt: new Date("2026-01-01T00:00:00.000Z"),
    completedAt: new Date("2026-01-01T00:01:00.000Z"),
    feeds: [
      {
        feedId: "feed-1",
        feedTitle: "Creator Uploads",
        feedUrl: "https://feeds.example.test/creator.xml",
        sourceType: "youtube",
        status: "failed",
        skipReason: null,
        itemsDiscoveredCount: 0,
        itemsCreatedCount: 0,
        itemsUpdatedCount: 0,
        error: { feedId: "feed-1", code: "adapter-failed", message: "Remote feed unavailable." },
        startedAt: new Date("2026-01-01T00:00:00.000Z"),
        completedAt: new Date("2026-01-01T00:01:00.000Z"),
      },
      {
        feedId: "feed-2",
        feedTitle: null,
        feedUrl: "https://feeds.example.test/skipped.xml",
        sourceType: "peertube",
        status: "skipped",
        skipReason: "not-due",
        itemsDiscoveredCount: 0,
        itemsCreatedCount: 0,
        itemsUpdatedCount: 0,
        error: null,
        startedAt: null,
        completedAt: null,
      },
    ],
  };

  expect(formatRefreshReportSummary(report)).toBe("partial: 0/1 feeds refreshed, 1 skipped, 0 new items");
  // Feed-level failure labels are surfaced per-feed inside the status dialog.
  expect(source).toContain("<RefreshStatusDialog");
  expect(source).toContain("data-refresh-status-feed-title");
  expect(source).toContain("data-refresh-status-feed-error");
  expect(source).toContain("formatRefreshErrorCodeLabel");
  expect(source).toContain("parseRefreshErrorSummaries");
  expect(source).toContain("SourceIconBadge");
});

test("parseRefreshErrorSummaries reads all feed failures and tolerates bad input", () => {
  const valid = JSON.stringify([
    { feedId: "feed-1", code: "provider-refresh-paused", message: "YouTube returned HTTP 429 (Too Many Requests) for \"Creator Uploads\" (https://www.youtube.com/feeds/videos.xml?channel_id=UC123). The adapter error was: YouTube feed fetch failed with status 429 from https://www.youtube.com/feeds/videos.xml?channel_id=UC123. Further YouTube feeds were skipped for this run; retry later." },
    { feedId: "feed-2", code: "adapter-failed", message: "Remote feed unavailable." },
  ]);

  expect(parseRefreshErrorSummaries(valid)).toEqual([
    { feedId: "feed-1", code: "provider-refresh-paused", message: "YouTube returned HTTP 429 (Too Many Requests) for \"Creator Uploads\" (https://www.youtube.com/feeds/videos.xml?channel_id=UC123). The adapter error was: YouTube feed fetch failed with status 429 from https://www.youtube.com/feeds/videos.xml?channel_id=UC123. Further YouTube feeds were skipped for this run; retry later." },
    { feedId: "feed-2", code: "adapter-failed", message: "Remote feed unavailable." },
  ]);

  // The catalog persists a SINGLE error-summary object per failed feed (not an
  // array). The parser must accept that shape — this is the real prod form.
  const single = JSON.stringify({ feedId: "feed-1", code: "remote-fetch-failed", message: "YouTube feed fetch failed with status 404 from https://www.youtube.com/feeds/videos.xml?channel_id=UC123." });
  expect(parseRefreshErrorSummaries(single)).toEqual([
    { feedId: "feed-1", code: "remote-fetch-failed", message: "YouTube feed fetch failed with status 404 from https://www.youtube.com/feeds/videos.xml?channel_id=UC123." },
  ]);

  // Null (no error summary) yields nothing.
  expect(parseRefreshErrorSummaries(null)).toEqual([]);

  // Malformed JSON never throws.
  expect(parseRefreshErrorSummaries("not json")).toEqual([]);

  // An object missing required string fields yields nothing.
  expect(parseRefreshErrorSummaries("{}")).toEqual([]);

  // Entries missing required string fields are dropped, valid ones kept.
  const partial = JSON.stringify([
    { feedId: "feed-1", code: "adapter-failed", message: "Remote feed unavailable." },
    { feedId: "feed-2", code: "missing-message" },
    "garbage",
    null,
  ]);
  expect(parseRefreshErrorSummaries(partial)).toEqual([
    { feedId: "feed-1", code: "adapter-failed", message: "Remote feed unavailable." },
  ]);
});

const baseFeedResult: RefreshFeedResult = {
  id: "result-1",
  refreshRunId: "run-1",
  feedId: "feed-1",
  status: "failed",
  itemsDiscoveredCount: 0,
  itemsCreatedCount: 0,
  itemsUpdatedCount: 0,
  startedAt: new Date("2026-01-01T00:00:00.000Z"),
  completedAt: new Date("2026-01-01T00:01:00.000Z"),
  errorSummaryJson: null,
};

const baseFeed: CatalogFeed = {
  id: "feed-1",
  creatorId: "creator-1",
  sourceType: "youtube",
  sourceExternalId: "yt-channel-1",
  url: "https://feeds.example.test/creator.xml",
  title: "Creator Uploads",
  description: null,
  refreshCadenceSeconds: null,
  lastNormalRefreshAt: null,
  nextRefreshAfter: null,
  adapterMetadataJson: null,
};

test("joinFeedResultsWithFeeds pairs results with their selected feed and drops orphans", () => {
  const orphanResult: RefreshFeedResult = { ...baseFeedResult, id: "result-2", feedId: "feed-missing" };
  const otherFeed: CatalogFeed = { ...baseFeed, id: "feed-2", title: "Second feed" };

  // Happy path: each result is paired with its matching feed, order preserved.
  expect(joinFeedResultsWithFeeds([baseFeedResult], [baseFeed])).toEqual([
    { ...baseFeedResult, feed: baseFeed },
  ]);

  // A result whose feedId is not in selectedFeeds (feed removed mid-run) is
  // dropped rather than rendered without a label.
  expect(joinFeedResultsWithFeeds([baseFeedResult, orphanResult], [baseFeed, otherFeed])).toEqual([
    { ...baseFeedResult, feed: baseFeed },
  ]);

  // No selected feeds at all yields nothing — never an unlabelled entry.
  expect(joinFeedResultsWithFeeds([baseFeedResult], [])).toEqual([]);
  expect(joinFeedResultsWithFeeds([], [baseFeed])).toEqual([]);
});

test("refresh heartbeat refetches the content list only when new items are ingested", async () => {
  const source = await readAppShellSource();

  // The heartbeat tracks CREATED items, not completed feeds and not discovered
  // items. The content list refetches ONLY when itemsCreatedCount strictly
  // increases, so feeds that discover only already-known items do not trigger a
  // re-render — a force-refresh-all must not peg the CPU re-rendering on every
  // 2.5s poll for the whole run. itemsDiscoveredCount is wrong because it counts
  // every remote item fetched, including duplicates.
  expect(source).toContain("const createdItems = run.itemsCreatedCount;");
  expect(source).toContain("if (createdItems > refreshItemsSeen()) {");
  expect(source).toContain("setRefreshItemsSeen(createdItems);");
  expect(source).toContain("props.onContentListLiveReload();");
  expect(source).not.toContain("run.itemsDiscoveredCount;");
  // The old per-feed-completion heartbeat is gone.
  expect(source).not.toContain("refreshCompletedFeedsSeen");
  // List-only reload signal, never the catalog key (which would nuke the viewer).
  expect(source).toContain("setListLiveReloadKey((key) => key + 1)");
  expect(source).toContain("reloadKey + props.listLiveReloadKey()");

  // A catalog refresh ends by bumping only the catalog key (source pane).
  expect(source).toContain("setCatalogReloadKey((key) => key + 1);");
});

test("refresh completion bumps the subscriptions channel once so unread counts refetch", async () => {
  const source = await readAppShellSource();

  // Run-completion branch of the poll effect: a finished run reloads the
  // content list AND bumps the shared subscriptions channel exactly once, so
  // the unreadCounts resource (keyed on subscriptionsReloadKey in AppShell)
  // refetches after manual/force refresh ingests new items.
  const completionStart = source.indexOf('if (run.status !== "running") {');
  const completionEnd = source.indexOf("const createdItems = run.itemsCreatedCount;");
  expect(completionStart).toBeGreaterThan(-1);
  expect(completionEnd).toBeGreaterThan(completionStart);
  const completionBranch = source.slice(completionStart, completionEnd);
  expect(completionBranch).toContain("props.onContentListLiveReload();");
  expect(completionBranch).toContain("props.onSubscriptionsChanged();");

  // The mid-poll items-created path stays content-only: no per-poll
  // subscription refetches while the run is still going.
  const midPollStart = completionEnd;
  const midPollEnd = source.indexOf("refreshPollTimer = setTimeout(() => {", midPollStart);
  expect(midPollEnd).toBeGreaterThan(midPollStart);
  const midPollBranch = source.slice(midPollStart, midPollEnd);
  expect(midPollBranch).toContain("props.onContentListLiveReload();");
  expect(midPollBranch).not.toContain("props.onSubscriptionsChanged();");

  // Scoped single-creator refresh success path: the same bump sits next to the
  // surgical feed-list reload key so its run also refreshes unread badges.
  const scopedStart = source.indexOf("const result = await client.refresh.runCreator({ creatorId, force: true });");
  const scopedEnd = source.indexOf("} catch (error) {", scopedStart);
  expect(scopedStart).toBeGreaterThan(-1);
  expect(scopedEnd).toBeGreaterThan(scopedStart);
  const scopedSuccess = source.slice(scopedStart, scopedEnd);
  expect(scopedSuccess).toContain("props.onContentListLiveReload();");
  expect(scopedSuccess).toContain("props.onSubscriptionsChanged();");
  expect(scopedSuccess).toContain("setFeedListReloadKey((key) => key + 1);");
});

test("refresh run summary labels all supported refresh scopes", () => {
  const baseRun: RefreshRun = {
    id: "refresh-run-1",
    scope: "all",
    force: false,
    status: "succeeded",
    requestedCreatorId: null,
    requestedFeedId: null,
    feedsRequestedCount: 3,
    feedsSkippedCount: 1,
    feedsSucceededCount: 2,
    feedsFailedCount: 0,
    itemsDiscoveredCount: 5,
    itemsCreatedCount: 4,
    itemsUpdatedCount: 1,
    startedAt: new Date("2026-01-01T00:00:00.000Z"),
    completedAt: new Date("2026-01-01T00:01:00.000Z"),
    errorSummaryJson: null,
  };

  expect(formatRefreshRunSummary(baseRun)).toBe("Normal all sources: succeeded, 2/3 feeds, 1 skipped");
  expect(formatRefreshRunSummary({ ...baseRun, scope: "creator" })).toBe("Normal creator: succeeded, 2/3 feeds, 1 skipped");
  expect(formatRefreshRunSummary({ ...baseRun, scope: "feed", force: true })).toBe("Force feed: succeeded, 2/3 feeds, 1 skipped");
});

test("add source UI is authenticated and wired to the real ingestion procedure", async () => {
  const source = await readAppShellSource();

  expect(addSourceInputId).toBe("creator-source-add-input");
  expect(addSourceHelpId).toBe("creator-source-add-help");
  expect(source).toContain("<AddSourceSection");
  expect(source).toContain("data-add-source-region");
  expect(source).toContain("client.ingestion.addSource({ sourceInput: trimmedSourceInput })");
  expect(source).toContain("const result: AddSourceResult = await client.ingestion.addSource");
  expect(source).toContain("await props.onSourceAdded(result.value)");
  expect(source).toContain("setSelectedCreator(value.creator)");
  expect(source).toContain("setCatalogReloadKey((key) => key + 1)");
  expect(source).toContain("Paste a creator, channel, feed, or video URL supported by the YouTube, Odysee, or PeerTube adapters.");
  expect(source).toContain("Sign in to add or subscribe to sources. Public catalog browsing stays available.");
  expect(source).not.toContain("client.ingestion.batchAddSources");
  expect(source).not.toContain("postFromFeedUrl");
  expect(source).not.toContain("document.dispatchEvent");
});

test("add source UI reports real ingestion success and failure shapes", async () => {
  const source = await readAppShellSource();

  expect(source).toContain("function formatIngestionCounts(value: AddSourceValue): string");
  expect(source).toContain("Creators: ${value.created.creators} created, ${reusedCreators} reused");
  expect(source).toContain("Feeds: ${value.created.feeds} created, ${reusedFeeds} reused");
  expect(source).toContain("Content: ${value.created.contentItems} created, ${reusedContentItems} reused");
  expect(source).toContain("function formatIngestionError(error: IngestionError): string");
  expect(source).toContain("`${error.code}: ${error.message}`");
  expect(source).toContain("if (!result.ok) {");
  expect(source).toContain("setFailureMessage(formatIngestionError(result.error))");
  expect(source).toContain("setSourceInput(\"\")");
  expect(source).not.toContain("fake success");
});

test("selected viewer is wired to anonymous catalog content detail", async () => {
  const source = await readAppShellSource();

  expect(source).toContain("client.catalog.contentDetail({ id })");
  expect(source).toContain("const selectedContentItemId = createMemo(() => props.selectedContent()?.id ?? null)");
  expect(source).toContain("data-selected-content-item-id={selectedContentItemId() ?? \"\"}");
  // The creator name in the detail body is a real button wired to the shell's
  // select-only viewer filter: it never toggles off and never keeps a feed —
  // it clears the feed filter even when the creator is already selected.
  expect(source).toContain("<ContentDetailBody detail={detail()} onCreatorClick={props.onSelectCreator} />");
  expect(source).toContain("readonly onSelectCreator: (creator: CatalogCreatorSummary) => void;");
  expect(source).toContain("readonly onCreatorClick: (creator: CatalogCreatorSummary) => void;");
  expect(source).toContain("onClick={() => props.onCreatorClick(props.detail.creator)}");
  expect(source).toContain("const selectCreatorFromViewer = (creator: CatalogCreatorSummary) => {");
  expect(source).toContain(
    "setSelectedFeed(null);\n    if (selectedCreator()?.id === creator.id) {\n      return;\n    }\n\n    setSelectedCreator(creator);",
  );
  expect(source).toContain("onSelectCreator={selectCreatorFromViewer}");
});

test("viewer has no internal metadata aside or rejected selection bar copy", async () => {
  const source = await readAppShellSource();

  expect(source).not.toContain("function ContentDetailAside");
  expect(source).not.toContain("<ContentDetailAside");
  expect(source).not.toContain("xl:grid-cols-[minmax(0,2fr)_minmax(16rem,1fr)]");
  expect(source).not.toContain("Select a video");
  expect(source).not.toContain("Choose a public catalog item");
});

test("selected viewer places playback before body in source order", async () => {
  const source = await readAppShellSource();
  const playbackIndex = source.indexOf("<PlaybackSurface\n                  source={selectedPlayableSource()}");
  const bodyIndex = source.indexOf("<ContentDetailBody detail={detail()} onCreatorClick={props.onSelectCreator} />");

  expect(playbackIndex).toBeGreaterThan(-1);
  expect(bodyIndex).toBeGreaterThan(playbackIndex);
});

test("selected viewer derives playable sources only from safe API source URLs", () => {
  const sources: readonly CatalogContentSource[] = [
    {
      id: "native-1",
      contentItemId: "content-1",
      sourceType: "peertube",
      sourceExternalId: "video-1",
      embedUrl: "https://peertube.example.test/videos/embed/video-1",
      nativeMediaUrl: "https://media.example.test/video-1.mp4",
      canonicalUrl: "https://peertube.example.test/w/video-1",
      priority: 2,
      metadataJson: null,
    },
    {
      id: "youtube-1",
      contentItemId: "content-1",
      sourceType: "youtube",
      sourceExternalId: "yt-video-1",
      embedUrl: "https://www.youtube-nocookie.com/embed/yt-video-1",
      nativeMediaUrl: null,
      canonicalUrl: "https://www.youtube.com/watch?v=yt-video-1",
      priority: 1,
      metadataJson: null,
    },
    {
      id: "odysee-1",
      contentItemId: "content-1",
      sourceType: "odysee",
      sourceExternalId: "odysee-video-1",
      embedUrl: "https://odysee.example.test/$/embed/odysee-video-1",
      nativeMediaUrl: null,
      canonicalUrl: "https://odysee.example.test/odysee-video-1",
      priority: 3,
      metadataJson: null,
    },
    {
      id: "unsafe-1",
      contentItemId: "content-1",
      sourceType: "youtube",
      sourceExternalId: "unsafe-video-1",
      embedUrl: "javascript:alert(1)",
      nativeMediaUrl: null,
      canonicalUrl: "https://www.youtube.com/watch?v=unsafe-video-1",
      priority: 4,
      metadataJson: null,
    },
  ];

  expect(toSafePlaybackUrl("https://media.example.test/video.mp4")).toBe("https://media.example.test/video.mp4");
  expect(toSafePlaybackUrl("http://media.example.test/video.mp4")).toBeNull();
  expect(toSafePlaybackUrl("not a url")).toBeNull();
  expect(toPlayableSources(sources)).toEqual([
    {
      id: "youtube-1",
      sourceType: "youtube",
      label: "YouTube embed",
      kind: "embed",
      url: "https://www.youtube-nocookie.com/embed/yt-video-1",
      canonicalUrl: "https://www.youtube.com/watch?v=yt-video-1",
      priority: 1,
    },
    {
      id: "native-1",
      sourceType: "peertube",
      label: "PeerTube media",
      kind: "native",
      url: "https://media.example.test/video-1.mp4",
      canonicalUrl: "https://peertube.example.test/w/video-1",
      priority: 2,
    },
    {
      id: "odysee-1",
      sourceType: "odysee",
      label: "Odysee embed",
      kind: "embed",
      url: "https://odysee.example.test/$/embed/odysee-video-1",
      canonicalUrl: "https://odysee.example.test/odysee-video-1",
      priority: 3,
    },
  ]);
});

test("odysee embed sources are playable while odysee sources without any URL stay dropped", () => {
  const odyseeEmbed: readonly CatalogContentSource[] = [
    {
      id: "odysee-embed-1",
      contentItemId: "content-1",
      sourceType: "odysee",
      sourceExternalId: null,
      embedUrl: "https://odysee.com/$/embed/@creator/video",
      nativeMediaUrl: null,
      canonicalUrl: "https://odysee.com/@creator/video",
      priority: 1,
      metadataJson: null,
    },
  ];

  expect(toPlayableSources(odyseeEmbed)).toEqual([
    {
      id: "odysee-embed-1",
      sourceType: "odysee",
      label: "Odysee embed",
      kind: "embed",
      url: "https://odysee.com/$/embed/@creator/video",
      canonicalUrl: "https://odysee.com/@creator/video",
      priority: 1,
    },
  ]);

  // Without an enclosure and without a safe embed URL there is nothing to play.
  const odyseeUnplayable: readonly CatalogContentSource[] = [
    {
      id: "odysee-bare-1",
      contentItemId: "content-1",
      sourceType: "odysee",
      sourceExternalId: null,
      embedUrl: null,
      nativeMediaUrl: null,
      canonicalUrl: "https://odysee.com/@creator/video",
      priority: 1,
      metadataJson: null,
    },
    {
      id: "odysee-unsafe-1",
      contentItemId: "content-1",
      sourceType: "odysee",
      sourceExternalId: null,
      embedUrl: "javascript:alert(1)",
      nativeMediaUrl: null,
      canonicalUrl: "https://odysee.com/@creator/video",
      priority: 2,
      metadataJson: null,
    },
  ];

  expect(toPlayableSources(odyseeUnplayable)).toEqual([]);
});

test("toCopyableStreamLink picks the native media URL or the canonical page link", () => {
  expect(toCopyableStreamLink(null)).toBeNull();

  const nativeSource: PlayableSource = {
    id: "native-1",
    sourceType: "peertube",
    label: "PeerTube media",
    kind: "native",
    url: "https://media.example.test/video-1.mp4",
    canonicalUrl: "https://peertube.example.test/w/video-1",
    priority: 1,
  };
  expect(toCopyableStreamLink(nativeSource)).toEqual({
    label: "Copy stream URL",
    url: "https://media.example.test/video-1.mp4",
  });

  const embedSource: PlayableSource = {
    id: "embed-1",
    sourceType: "odysee",
    label: "Odysee embed",
    kind: "embed",
    url: "https://odysee.example.test/$/embed/video-1",
    canonicalUrl: "https://odysee.example.test/video-1",
    priority: 1,
  };
  expect(toCopyableStreamLink(embedSource)).toEqual({
    label: "Copy page link",
    url: "https://odysee.example.test/video-1",
  });

  // An embed-only source without any canonical URL has nothing safe to copy.
  expect(toCopyableStreamLink({ ...embedSource, canonicalUrl: "" })).toBeNull();
});

test("toPlaybackPosition parses the opened-row playback metadata narrowly", () => {
  expect(toPlaybackPosition(null)).toBeNull();
  expect(toPlaybackPosition("not json")).toBeNull();
  expect(toPlaybackPosition("{}")).toBeNull();
  expect(toPlaybackPosition(JSON.stringify({ playback: null }))).toBeNull();
  expect(toPlaybackPosition(JSON.stringify({ playback: "fast" }))).toBeNull();
  expect(toPlaybackPosition(JSON.stringify({ playback: {} }))).toBeNull();
  expect(toPlaybackPosition(JSON.stringify({ playback: { positionSeconds: "12" } }))).toBeNull();
  expect(toPlaybackPosition(JSON.stringify({ playback: { positionSeconds: -1 } }))).toBeNull();
  // 1e999 overflows to Infinity during JSON.parse and must be rejected.
  expect(toPlaybackPosition('{"playback":{"positionSeconds":1e999}}')).toBeNull();
  expect(toPlaybackPosition(JSON.stringify({ playback: { positionSeconds: 754, durationSeconds: -5 } }))).toBeNull();
  expect(toPlaybackPosition(JSON.stringify({ playback: { positionSeconds: 754, durationSeconds: "45:00" } }))).toBeNull();
  expect(toPlaybackPosition(JSON.stringify("754"))).toBeNull();

  expect(
    toPlaybackPosition(JSON.stringify({ playback: { positionSeconds: 754, durationSeconds: 2700, updatedAt: "2026-08-30T00:00:00.000Z" } })),
  ).toEqual({ positionSeconds: 754, durationSeconds: 2700 });
  // Phase 2 persists durationSeconds: null when the duration is unknown.
  expect(
    toPlaybackPosition(JSON.stringify({ playback: { positionSeconds: 754, durationSeconds: null, updatedAt: "2026-08-30T00:00:00.000Z" } })),
  ).toEqual({ positionSeconds: 754, durationSeconds: null });
  expect(toPlaybackPosition(JSON.stringify({ playback: { positionSeconds: 0, durationSeconds: 0 } }))).toEqual({
    positionSeconds: 0,
    durationSeconds: 0,
  });
});

test("toEmbedUrlWithApi rewrites only allowlisted YouTube embed URLs", () => {
  const appOrigin = "https://app.example.test";

  // Existing params are preserved; enablejsapi and origin are set.
  expect(toEmbedUrlWithApi("https://www.youtube-nocookie.com/embed/yt-video-1?rel=0", appOrigin)).toBe(
    "https://www.youtube-nocookie.com/embed/yt-video-1?rel=0&enablejsapi=1&origin=https%3A%2F%2Fapp.example.test",
  );
  // The standard youtube.com host is allowlisted too (standard-embed mode).
  expect(toEmbedUrlWithApi("https://www.youtube.com/embed/yt-video-1", appOrigin)).toBe(
    "https://www.youtube.com/embed/yt-video-1?enablejsapi=1&origin=https%3A%2F%2Fapp.example.test",
  );
  // start is floored and only added for a resume position >= 10s.
  expect(toEmbedUrlWithApi("https://www.youtube-nocookie.com/embed/v", appOrigin, 754.9)).toBe(
    "https://www.youtube-nocookie.com/embed/v?enablejsapi=1&origin=https%3A%2F%2Fapp.example.test&start=754",
  );
  expect(toEmbedUrlWithApi("https://www.youtube-nocookie.com/embed/v", appOrigin, 9.9)).not.toContain("start=");
  expect(toEmbedUrlWithApi("https://www.youtube-nocookie.com/embed/v", appOrigin, 0)).toBe(
    "https://www.youtube-nocookie.com/embed/v?enablejsapi=1&origin=https%3A%2F%2Fapp.example.test",
  );
  // Negative or non-finite start values reject the whole rewrite.
  expect(toEmbedUrlWithApi("https://www.youtube-nocookie.com/embed/v", appOrigin, -1)).toBeNull();
  expect(toEmbedUrlWithApi("https://www.youtube-nocookie.com/embed/v", appOrigin, Number.NaN)).toBeNull();

  // Non-YouTube embeds, insecure URLs, and garbage are rejected.
  expect(toEmbedUrlWithApi("https://odysee.com/$/embed/@c/v", appOrigin)).toBeNull();
  expect(toEmbedUrlWithApi("https://peertube.example.test/videos/embed/v", appOrigin)).toBeNull();
  expect(toEmbedUrlWithApi("http://www.youtube-nocookie.com/embed/v", appOrigin)).toBeNull();
  expect(toEmbedUrlWithApi("javascript:alert(1)", appOrigin)).toBeNull();
  expect(toEmbedUrlWithApi("not a url", appOrigin)).toBeNull();
});

test("isYouTubeEmbedUrl gates the tracked-embed decision on the same allowlist", () => {
  expect(isYouTubeEmbedUrl("https://www.youtube-nocookie.com/embed/v")).toBe(true);
  expect(isYouTubeEmbedUrl("https://www.youtube.com/embed/v")).toBe(true);
  expect(isYouTubeEmbedUrl("http://www.youtube-nocookie.com/embed/v")).toBe(false);
  expect(isYouTubeEmbedUrl("https://odysee.com/$/embed/@c/v")).toBe(false);
  expect(isYouTubeEmbedUrl("https://peertube.example.test/videos/embed/v")).toBe(false);
  expect(isYouTubeEmbedUrl("not a url")).toBe(false);
});

test("formatPlaybackPosition renders a clock pair consistent with formatContentDuration", () => {
  expect(formatPlaybackPosition({ positionSeconds: 754, durationSeconds: 2700 })).toBe("12:34 / 45:00");
  expect(formatPlaybackPosition({ positionSeconds: 0, durationSeconds: 0 })).toBe("0:00 / 0:00");
  // Hour-long formatting follows the same rules as the duration badge.
  expect(formatPlaybackPosition({ positionSeconds: 3600, durationSeconds: 5400 })).toBe("1:00:00 / 1:30:00");
  // Without a known duration only the current position is rendered.
  expect(formatPlaybackPosition({ positionSeconds: 754, durationSeconds: null })).toBe("12:34");
});

test("formatPlaybackResumeLabel announces position and known duration", () => {
  expect(formatPlaybackResumeLabel({ positionSeconds: 754, durationSeconds: 2700 })).toBe("Resume at 12:34 of 45:00");
  expect(formatPlaybackResumeLabel({ positionSeconds: 754, durationSeconds: null })).toBe("Resume at 12:34");
  expect(formatPlaybackResumeLabel({ positionSeconds: 3600, durationSeconds: 5400 })).toBe("Resume at 1:00:00 of 1:30:00");
});

test("isResumablePlaybackPosition suppresses resume near a known end", () => {
  // Unknown saved duration stays resumable; the surfaces' live-duration guards
  // still apply at seek time.
  expect(isResumablePlaybackPosition({ positionSeconds: 754, durationSeconds: null })).toBe(true);
  // More than 10s of video remains.
  expect(isResumablePlaybackPosition({ positionSeconds: 754, durationSeconds: 2700 })).toBe(true);
  // Exactly 10s remaining matches the native live guard: not resumable.
  expect(isResumablePlaybackPosition({ positionSeconds: 2690, durationSeconds: 2700 })).toBe(false);
  // Watched to (or past) the end.
  expect(isResumablePlaybackPosition({ positionSeconds: 2700, durationSeconds: 2700 })).toBe(false);
  expect(isResumablePlaybackPosition({ positionSeconds: 2710, durationSeconds: 2700 })).toBe(false);
  // A short video entirely inside the tail window is never resumed.
  expect(isResumablePlaybackPosition({ positionSeconds: 5, durationSeconds: 8 })).toBe(false);
});

test("toPlaybackPositionsByItemId derives list progress from opened rows only", () => {
  const statuses: readonly UserContentStatus[] = [
    {
      id: "status-1",
      userId: "user-1",
      contentItemId: "content-1",
      status: "opened",
      metadataJson: JSON.stringify({ playback: { positionSeconds: 754, durationSeconds: 2700, updatedAt: "2026-08-30T00:00:00.000Z" } }),
    },
    {
      id: "status-2",
      userId: "user-1",
      contentItemId: "content-2",
      status: "opened",
      metadataJson: JSON.stringify({ playback: { positionSeconds: 30, durationSeconds: null, updatedAt: "2026-08-30T00:00:00.000Z" } }),
    },
    // A played row carries no list progress even with a stale playback payload.
    {
      id: "status-3",
      userId: "user-1",
      contentItemId: "content-3",
      status: "played",
      metadataJson: JSON.stringify({ playback: { positionSeconds: 100, durationSeconds: 200, updatedAt: "2026-08-30T00:00:00.000Z" } }),
    },
    // Opened without playback metadata (opened before any playback) adds nothing.
    {
      id: "status-4",
      userId: "user-1",
      contentItemId: "content-4",
      status: "opened",
      metadataJson: null,
    },
    // Malformed playback metadata is skipped, never thrown.
    {
      id: "status-5",
      userId: "user-1",
      contentItemId: "content-5",
      status: "opened",
      metadataJson: "not json",
    },
  ];

  const positions = toPlaybackPositionsByItemId(statuses);
  expect(positions.size).toBe(2);
  expect(positions.get("content-1")).toEqual({ positionSeconds: 754, durationSeconds: 2700 });
  expect(positions.get("content-2")).toEqual({ positionSeconds: 30, durationSeconds: null });
  expect(positions.has("content-3")).toBe(false);
  expect(positions.has("content-4")).toBe(false);
  expect(positions.has("content-5")).toBe(false);
  expect(toPlaybackPositionsByItemId([]).size).toBe(0);
});

test("shouldFlushPlaybackPosition implements the pure save throttle", () => {
  const base = { lastSavedSeconds: 100, nextSeconds: 102, lastSavedAtMs: 1_000, nowMs: 5_000, force: false };

  // A fresh session (never saved) always flushes.
  expect(shouldFlushPlaybackPosition({ ...base, lastSavedSeconds: null, lastSavedAtMs: null })).toBe(true);
  // Forced flushes bypass the throttle.
  expect(shouldFlushPlaybackPosition({ ...base, force: true })).toBe(true);
  // >= 10s since the last save flushes; a younger save with a small delta does not.
  expect(shouldFlushPlaybackPosition({ ...base, nowMs: 11_000 })).toBe(true);
  expect(shouldFlushPlaybackPosition(base)).toBe(false);
  // >= 5s position delta flushes even inside the time window.
  expect(shouldFlushPlaybackPosition({ ...base, nextSeconds: 105 })).toBe(true);
  expect(shouldFlushPlaybackPosition({ ...base, nextSeconds: 104.9 })).toBe(false);
});

test("creator source badges read sourceTypes from summaries and stay empty without them", () => {
  const summary: CatalogCreatorSummary = {
    id: "creator-1",
    displayName: "Scott Manley",
    imageUrl: null,
    canonicalUrl: null,
    sourceTypes: ["youtube", "odysee"],
  };
  const plainCreator: CatalogCreator = {
    id: "creator-2",
    nameKey: "scottmanley",
    displayName: "Scott Manley",
    description: null,
    imageUrl: null,
    canonicalUrl: null,
    metadataJson: null,
  };

  expect(toCreatorSourceTypes(summary)).toEqual(["youtube", "odysee"]);
  expect(toCreatorSourceTypes(plainCreator)).toEqual([]);
});

test("youtube privacy setting key satisfies the setting key pattern and round-trips", () => {
  const privacySetting: UserSetting = {
    id: "setting-3",
    userId: "user-1",
    key: youtubePrivacySettingKey,
    valueJson: JSON.stringify("true"),
  };

  expect(youtubePrivacySettingKey).toBe("playback.youtube.nocookie");
  expect(new RegExp(settingKeyPattern).test(youtubePrivacySettingKey)).toBe(true);
  // No stored preference defaults to privacy-enhanced embeds.
  expect(toYoutubeNoCookieFromSettings([])).toBe(true);
  // The save path stores JSON.stringify("true"/"false"); the parse round-trips.
  expect(toYoutubeNoCookieFromSettings([privacySetting])).toBe(true);
  expect(toYoutubeNoCookieFromSettings([{ ...privacySetting, valueJson: JSON.stringify("false") }])).toBe(false);
  // A bare JSON boolean is tolerated as an alternative encoding.
  expect(toYoutubeNoCookieFromSettings([{ ...privacySetting, valueJson: "false" }])).toBe(false);
  expect(toYoutubeNoCookieFromSettings([{ ...privacySetting, valueJson: "true" }])).toBe(true);
  // Non-boolean and malformed values fall back to the safe default.
  expect(toYoutubeNoCookieFromSettings([{ ...privacySetting, valueJson: JSON.stringify("standard") }])).toBe(true);
  expect(toYoutubeNoCookieFromSettings([{ ...privacySetting, valueJson: "not json" }])).toBe(true);
  // Other settings never leak into the preference.
  expect(toYoutubeNoCookieFromSettings([{ ...privacySetting, key: readerDensitySettingKey, valueJson: JSON.stringify("false") }])).toBe(true);
});

test("multi-source rows badges mirror chip and persisted privacy toggle are wired", async () => {
  const source = await readAppShellSource();

  // Creator rows: per-source icons next to the display name, hidden when empty.
  expect(source).toContain("const sourceTypes = createMemo(() => toCreatorSourceTypes(props.creator));");
  expect(source).toContain("data-creator-source-badges");
  expect(source).toContain("<For each={sourceTypes()}>{(sourceType) => <SourceTypeIcon sourceType={sourceType} />}</For>");
  // Content rows: +N mirror chip beside the source indicator, pure display.
  expect(source).toContain("data-content-mirror-count");
  expect(source).toContain("This video also appears on ${count} other source${count === 1 ? \"\" : \"s\"}; open it to switch.");
  // Viewer: "Also on" switcher drives the existing selection flow.
  expect(source).toContain("readonly onSelectContent: (contentItem: CatalogContentListItem) => Promise<void>;");
  expect(source).toContain("data-viewer-mirror-switcher");
  expect(source).toContain("void props.onSelectContent(mirror)");
  expect(source).toContain("const selectContent = async (contentItem: CatalogContentListItem) => {");
  // Privacy preference: seeds and re-converges from the settings overlay,
  // persists only for authenticated users, and surfaces save failures.
  expect(source).toContain("const [useNoCookieEmbed, setUseNoCookieEmbed] = createSignal(toYoutubeNoCookieFromSettings(props.settings()))");
  expect(source).toContain("setUseNoCookieEmbed(toYoutubeNoCookieFromSettings(props.settings()))");
  expect(source).toContain("await client.overlays.saveSetting({ key: youtubePrivacySettingKey, value: next ? \"true\" : \"false\" });");
  expect(source).toContain("await props.onSettingsChanged();");
  expect(source).toContain("setNoCookieActionError(formatError(error))");
  expect(source).toContain("onClick={toggleNoCookieEmbed}");
});

test("selected viewer supports source switching and real playback render contracts", async () => {
  const source = await readAppShellSource();

  expect(source).toContain("id=\"viewer-source-switcher\"");
  expect(source).toContain("onClick={() => setSelectedSourceId(source.id)}");
  // YouTube embeds render through the IFrame API URL builder; every other
  // embed keeps its bare provider URL with no tracker.
  expect(source).toContain("<iframe");
  expect(source).toContain("src={embedSrc}");
  expect(source).toContain("src={source().url}");
  // Native video keeps real controls without any play-start auto-mark.
  expect(source).toContain("src={props.source.url}\n      controls\n      preload=\"metadata\"");
});

test("near-end and ended playback auto-mark played exactly once per selection (D2)", async () => {
  const source = await readAppShellSource();

  // D2: the onPlay auto-mark is gone; near-end and ended playback trigger the
  // existing auto-mark flow instead, for BOTH native and bridge surfaces.
  expect(source).not.toContain("onNativePlay");
  expect(source).not.toContain("onPlay=");
  expect(source).toContain("onNearEnd={autoMarkSelectedContentPlayed}");
  expect(source).toContain("onExplicitEnded={autoMarkSelectedContentPlayed}");
  expect(source).toContain("const autoMarkSelectedContentPlayed = async () => {");
  expect(source).toContain("if (autoMarkPlayedHandled) {\n      return;\n    }\n\n    autoMarkPlayedHandled = true;");
  // The guard re-arms whenever the selection changes.
  expect(source).toContain("on(selectedContentItemId, () => {\n      flushLastKnownPlaybackPosition();\n      autoMarkPlayedHandled = false;\n    }, { defer: true })");
  // Native near-end detection: within 30s of the end or past 90% when the
  // duration is known; the explicit ended event is guarded separately.
  expect(source).toContain("!nearEndReported && (position >= duration - 30 || position >= duration * 0.9)");
  expect(source).toContain("nearEndReported = true;\n          props.onNearEnd();");
  expect(source).toContain("explicitEndedReported = true;\n        props.onExplicitEnded();");
  // Bridge surface (tracked YouTube embed) carries the same contract: the
  // tracked embed declares and receives the shared onNearEnd flow, and its
  // IFrame-bridge position path runs the identical once-per-session check.
  expect(source).toContain("interface TrackedEmbedPlayerProps {\n  readonly source: PlayableSource;\n  readonly title: string;\n  readonly contentItemId: string;\n  readonly resumePosition: () => PlaybackPosition | null;\n  readonly onPositionUpdate: (positionSeconds: number, durationSeconds: number | null) => void;\n  readonly onNearEnd: () => void;");
  expect(source).toContain("<TrackedEmbedPlayer\n              source={source()}\n              title={props.title}\n              contentItemId={props.contentItemId}\n              resumePosition={props.resumePosition}\n              onPositionUpdate={props.onPositionUpdate}\n              onNearEnd={props.onNearEnd}");
  expect(source).toContain("!nearEndReported &&\n          (position.positionSeconds >= position.durationSeconds - 30 || position.positionSeconds >= position.durationSeconds * 0.9)\n        ) {\n          nearEndReported = true;\n          props.onNearEnd();\n        }");
  // Bridge duration inputs require a positive value: YouTube reports 0 until
  // the video's metadata loads, and a 0 duration would trivially satisfy the
  // near-end check (position >= 0 - 30) and auto-mark the item on open.
  const bridgeSource = await Bun.file(new URL("../lib/youtube-player-bridge.ts", import.meta.url)).text();
  expect(bridgeSource).toContain("if (duration !== null && duration > 0) {");
  expect(bridgeSource).toContain('command === "getDuration" && numericReply > 0');
  expect(bridgeSource).not.toContain("duration !== null && duration >= 0");
  expect(bridgeSource).not.toContain('command === "getDuration" && numericReply >= 0');
  // The flow still lands on the real protected procedure with in-place patching.
  expect(source).toContain("await props.onAutoMarkContentPlayed(contentItemId);");
  expect(source).toContain("const autoMarkContentPlayed = async (contentItemId: string) => {");
  expect(source).toContain("const result = await client.overlays.markContentPlayed({ contentItemId });");
  expect(source).toContain("if (result.status !== null) {\n      patchContentStatus(result.status);\n    }");
});

test("iframe playback has explicit real mark played workflow", async () => {
  const source = await readAppShellSource();

  expect(source).toContain("<iframe");
  expect(source).toContain("aria-label={selectedContentStatus().played ? \"Unmark played\" : \"Mark played\"}");
  expect(source).toContain("await props.onMarkContentPlayed(contentItemId);");
  expect(source).toContain("await client.overlays.toggleContentPlayed({ contentItemId });");
  expect(source).toContain("onClick={toggleSelectedContentPlayed}");
});

test("playback tracking wires the bridge, resume position, and saved-status patching", async () => {
  const viewerSource = await Bun.file(new URL("./app-shell-viewer.tsx", import.meta.url)).text();
  const shellSource = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();

  // The viewer creates the YouTube bridge tracker and disposes it per session.
  expect(viewerSource).toContain('import { createYouTubePlaybackTracker, type YouTubePlaybackTracker } from "@/lib/youtube-player-bridge";');
  expect(viewerSource).toContain("tracker = createYouTubePlaybackTracker({");
  expect(viewerSource).toContain("tracker?.dispose();");
  // Resume position derives from the opened row's playback metadata and feeds
  // both the embed start param (frozen at mount) and the native metadata seek.
  expect(viewerSource).toContain("const selectedResumePosition = createMemo(() => {");
  expect(viewerSource).toContain("toPlaybackPosition(openedStatus.metadataJson)");
  expect(viewerSource).toContain("resumePosition={selectedResumePosition}");
  expect(viewerSource).toContain("contentItemId={selectedContentItemId() ?? \"\"}");
  expect(viewerSource).toContain(
    "toEmbedUrlWithApi(props.source.url, window.location.origin, props.resumePosition()?.positionSeconds) ?? props.source.url",
  );
  expect(viewerSource).toContain("if (duration !== null && resume.positionSeconds < duration - 10) {\n          video.currentTime = resume.positionSeconds;\n        }");
  // Throttled position reports flow into the real protected save procedure and
  // land as an in-place status patch in the shell (no refetch).
  expect(viewerSource).toContain("shouldFlushPlaybackPosition({ lastSavedSeconds, nextSeconds: positionSeconds, lastSavedAtMs, nowMs: Date.now(), force: false })");
  expect(viewerSource).toContain("shouldFlushPlaybackPosition({ lastSavedSeconds, nextSeconds: position, lastSavedAtMs, nowMs: Date.now(), force: false })");
  expect(viewerSource).toContain("await client.overlays.savePlaybackPosition({");
  expect(viewerSource).toContain("props.onPlaybackPositionSaved(result.status);");
  expect(shellSource).toContain("onPlaybackPositionSaved={patchContentStatus}");
  // Last-chance flushes on page hide and hidden tabs, listeners cleaned up.
  expect(viewerSource).toContain('window.addEventListener("pagehide", handlePageHide);');
  expect(viewerSource).toContain('document.addEventListener("visibilitychange", handleVisibilityChange);');
  expect(viewerSource).toContain('if (document.visibilityState === "hidden") {');
  expect(viewerSource).toContain('window.removeEventListener("pagehide", handlePageHide);');
  expect(viewerSource).toContain('document.removeEventListener("visibilitychange", handleVisibilityChange);');
  // Both tracked surfaces flush their session position on cleanup.
  expect(viewerSource).toContain("props.onPositionUpdate(lastKnownPositionSeconds, lastKnownDurationSeconds);");
  expect(viewerSource).toContain("props.onPositionUpdate(position, toNativeDuration(video));");
});

test("anonymous users never save playback positions", async () => {
  const viewerSource = await Bun.file(new URL("./app-shell-viewer.tsx", import.meta.url)).text();

  expect(viewerSource).toContain("if (!props.isAuthenticated() || contentItemId === null) {\n      return;\n    }\n\n    lastKnownPlayback = { contentItemId, positionSeconds, durationSeconds };");
  expect(viewerSource).toContain("if (known === null || !props.isAuthenticated()) {\n      return;\n    }");
});

test("playback flushes are tagged by content id and never mis-attribute across switches", async () => {
  const viewerSource = await Bun.file(new URL("./app-shell-viewer.tsx", import.meta.url)).text();

  // The selection-change flush uses the tagged id, so the previous item's tail
  // is saved for the item it belongs to.
  expect(viewerSource).toContain("on(selectedContentItemId, () => {\n      flushLastKnownPlaybackPosition();\n      autoMarkPlayedHandled = false;\n    }, { defer: true })");
  // Each surface captures its session content id once and skips its cleanup
  // flush when the selection already moved on (avoids saving the old video's
  // position under the new item's id).
  expect(viewerSource).toContain("const sessionContentItemId = props.contentItemId;");
  expect((viewerSource.match(/props\.contentItemId !== sessionContentItemId/g) ?? [])).toHaveLength(2);
});

test("content list rows surface resume progress in the duration slot (F1c)", async () => {
  const source = await readAppShellSource();

  // The column derives the per-item position map from the opened statuses and
  // threads an accessor into every row.
  expect(source).toContain("const playbackPositionByItemId = createMemo(() => toPlaybackPositionsByItemId(props.contentStatuses()));");
  expect(source).toContain("playbackPosition={() => playbackPositionByItemId().get(contentItem.id) ?? null}");
  expect(source).toContain("readonly playbackPosition: () => PlaybackPosition | null;");
  // The row swaps the duration slot for the progress badge when a position
  // exists, keeps the duration-only rendering as the fallback, and renders the
  // pair with a resume label.
  expect(source).toContain("when={playbackPosition()}");
  expect(source).toContain("data-content-playback-progress");
  expect(source).toContain("aria-label={formatPlaybackResumeLabel(position())}");
  expect(source).toContain("{formatPlaybackPosition(position())}");
});

test("near-finished saved positions are not resumed on either surface", async () => {
  const viewerSource = await Bun.file(new URL("./app-shell-viewer.tsx", import.meta.url)).text();

  // The viewer-level gate feeds BOTH surfaces: a position within 10s of a
  // known saved duration resolves to null, so the YouTube embed gets no start
  // param and the native video never seeks (its own live-duration guard stays
  // in place for saved durations that are unknown or stale).
  expect(viewerSource).toContain("return position !== null && isResumablePlaybackPosition(position) ? position : null;");
});

test("viewer copy affordance copies the selected stream URL with feedback and visible failure (F5)", async () => {
  const viewerSource = await Bun.file(new URL("./app-shell-viewer.tsx", import.meta.url)).text();

  // The affordance derives from the same selected playable source the player
  // uses: native copies the media URL, embed-only copies the canonical page
  // link (labels come from toCopyableStreamLink, unit-tested above).
  expect(viewerSource).toContain("const copyStreamLink = createMemo(() => toCopyableStreamLink(selectedPlayableSource()));");
  expect(viewerSource).toContain("data-copy-stream-url");
  expect(viewerSource).toContain("aria-label={copyControlTitle()}");
  expect(viewerSource).toContain("title={copyControlTitle()}");
  expect(viewerSource).toContain("Stream URL for mpv/yt-dlp");
  expect(viewerSource).toContain("Page link for mpv/yt-dlp");
  expect(viewerSource).toContain("onClick={copyStreamUrl}");
  expect(viewerSource).toContain("{streamUrlCopied() ? \"Copied\" : link().label}");
  expect(viewerSource).toContain("await navigator.clipboard.writeText(link.url);");
  // Clipboard failure is surfaced as visible text, never swallowed.
  expect(viewerSource).toContain("setCopyStreamError(`Copy failed: ${formatError(error)}`);");
  expect(viewerSource).toContain("<Show when={copyStreamError()}>");
  // The Copied flash resets after two seconds and the timer never leaks.
  expect(viewerSource).toContain("copyFeedbackTimerId = setTimeout(() => {");
  expect(viewerSource).toContain("clearTimeout(copyFeedbackTimerId);");
  expect(viewerSource).toContain("onCleanup(clearCopyFeedbackTimer);");
});

test("postMessage and message listeners stay confined to the YouTube bridge module", async () => {
  const componentFiles = [
    "./app-shell.tsx",
    "./app-shell-content-column.tsx",
    "./app-shell-rows.tsx",
    "./app-shell-source-sections.tsx",
    "./app-shell-viewer.tsx",
    "./app-shell.contract.ts",
    "./refresh-status-dialog.tsx",
    "./user-menu.tsx",
  ];
  const sources = await Promise.all(
    componentFiles.map(async (filePath) => Bun.file(new URL(filePath, import.meta.url)).text()),
  );
  const combined = sources.join("\n");

  expect(combined).not.toContain("postMessage");
  expect(combined).not.toContain('addEventListener("message"');
  expect(combined).not.toContain('removeEventListener("message"');

  const bridgeSource = await Bun.file(new URL("../lib/youtube-player-bridge.ts", import.meta.url)).text();
  expect(bridgeSource).toContain('window.addEventListener("message", handleMessage);');
  expect(bridgeSource).toContain("contentWindow.postMessage(JSON.stringify(payload), targetOrigin);");
});

test("anonymous users never call protected played procedure from viewer or playback", async () => {
  const source = await readAppShellSource();

  expect(source).toContain("<Show when={props.isAuthenticated()}>\n                  <div class=\"mt-2 flex flex-wrap items-center gap-1.5\">");
  expect(source).toContain("if (!props.isAuthenticated() || contentItemId === null) {\n      return;\n    }");
  expect(source).toContain("const markContentPlayed = async (contentItemId: string) => {");
  expect(source).toContain("const result = await client.overlays.toggleContentPlayed({ contentItemId });");
  expect(source).toContain("const autoMarkContentPlayed = async (contentItemId: string) => {");
  expect(source).toContain("const result = await client.overlays.markContentPlayed({ contentItemId });");
  expect(source).not.toContain("Sign in to mark played");
  expect(source).not.toContain("Login to mark played");
});

test("playlist controls are protected behind authenticated session state", async () => {
  const source = await readAppShellSource();

  expect(source).toContain("const session = authClient.useSession()");
  expect(source).toContain("const isAuthenticated = createMemo(() => !session().isPending && session().data !== null);");
  expect(source).toContain("<Show when={props.isAuthenticated()}>");
  expect(source).not.toContain("Sign in to create playlists");
  expect(source).not.toContain("Login to save playlists");
});

test("playlist UI uses real protected API procedures for full playlist flow", async () => {
  const source = await readAppShellSource();

  expect(playlistNameInputId).toBe("playlist-name");
  expect(playlistDescriptionInputId).toBe("playlist-description");
  expect(playlistSortInputId).toBe("playlist-sort");
  expect(source).toContain("client.overlays.playlists()");
  expect(source).toContain("client.overlays.createPlaylist({");
  expect(source).toContain("client.overlays.updatePlaylist({");
  expect(source).toContain("client.overlays.deletePlaylist({ playlistId })");
  expect(source).toContain("client.overlays.playlistItems({ playlistId })");
  expect(source).toContain("client.overlays.addPlaylistItem({ playlistId, contentItemId })");
  expect(source).toContain("client.overlays.removePlaylistItem({ playlistId: item.playlistId, playlistItemId: item.id })");
  expect(source).toContain("client.overlays.reorderPlaylistItems({ playlistId: item.playlistId, playlistItemIds: orderedItemIds })");
});

test("playlist management is compact and collapsible inside existing panes", async () => {
  const source = await readAppShellSource();

  expect(source).toContain("data-compact-playlist-selector");
  expect(source).toContain("data-playlist-management-panel");
  expect(source).toContain("Manage playlists");
  expect(source).toContain("source-playlist-selector");
  expect(source).not.toContain("open data-playlist-management-panel");
  expect(source).not.toContain('data-shell-column="playlists"');
  // Playlists render inside a pane, not a dialog; the only <dialog> in the shell
  // is the refresh-status modal, which is unrelated to playlists.
  expect((source.match(/<dialog/g) ?? []).length).toBe(1);
});

test("add-to-playlist is discoverable from content rows and viewer with real API calls", async () => {
  const source = await readAppShellSource();

  expect(source).toContain("data-content-row-add-playlist");
  expect(source).toContain("Add to playlist");
  expect(source).toContain("const addContentToPlaylist = async (contentItemId: string) => {");
  expect(source).toContain("await client.overlays.addPlaylistItem({ playlistId, contentItemId });");
  expect(source).toContain("viewer-playlist-target");
  expect(source).not.toContain("alert(\"playlist");
});

test("manual reorder controls render only for manual playlist order", async () => {
  const source = await readAppShellSource();

  expect(source).toContain("const selectedPlaylistUsesManualOrder = createMemo(() => selectedPlaylist()?.sortMode === \"manual\")");
  expect(source).toContain("showManualControls={selectedPlaylistUsesManualOrder()}");
  expect(source).toContain("readonly showManualControls: boolean;");
  expect(source).toContain("data-manual-reorder={props.showManualControls ? \"true\" : \"false\"}");
  expect(source).toContain("<Show when={props.showManualControls}>");
  expect(source).toContain("await client.overlays.reorderPlaylistItems({ playlistId: item.playlistId, playlistItemIds: orderedItemIds })");
});

test("playlist items reload through resource key without effect refetch loop", async () => {
  const source = await readAppShellSource();
  const playlistItemsInputStart = source.indexOf("const selectedPlaylistItemsInput = createMemo(() => {");
  const playlistItemsResourceEnd = source.indexOf("const selectedPlaylist = createMemo(", playlistItemsInputStart);
  const playlistItemsResourceSource = source.slice(playlistItemsInputStart, playlistItemsResourceEnd);
  const playlistSectionEnd = source.indexOf("interface ContentListColumnProps", playlistItemsInputStart);
  const playlistSectionSource = source.slice(playlistItemsInputStart, playlistSectionEnd);
  const refetchEffectPattern = /createEffect\(\(\) => \{[\s\S]*props\.playlistItemsReloadKey\(\)[\s\S]*refetchSelectedPlaylistItems\(/;

  expect(playlistItemsResourceSource).toContain("const playlistId = props.selectedPlaylistId();");
  expect(playlistItemsResourceSource).toContain("return `${playlistId}\\u001f${props.playlistItemsReloadKey().toString()}`;");
  expect(playlistItemsResourceSource).toContain("createResource(\n    selectedPlaylistItemsInput,");
  expect(playlistItemsResourceSource).toContain("return client.overlays.playlistItems({ playlistId });");
  expect(playlistSectionSource).not.toMatch(refetchEffectPattern);
});

test("playlist and collection rows are owner-filtered so stale .latest rows never render", async () => {
  const source = await readAppShellSource();

  // .latest keeps the PREVIOUS playlist/collection's rows while the fetch for a
  // newly selected owner is pending; visible rows must match the current owner
  // so stale rows (and their remove/move actions) never render.
  expect(source).toContain("const visiblePlaylistItems = createMemo(() =>");
  expect(source).toContain("(item) => item.playlistId === props.selectedPlaylistId()");
  expect(source).toContain("const visibleCollectionMembers = createMemo(() =>");
  expect(source).toContain("(member) => member.collectionId === props.selectedCollectionId()");
  // Row lists, reorder input, and member "Added" markers derive from visible rows.
  expect(source).toContain("<For each={visiblePlaylistItems()}>");
  expect(source).toContain("<For each={visibleCollectionMembers()}>");
  expect(source).toContain("const items = visiblePlaylistItems();");
  expect(source).toContain("new Set(visibleCollectionMembers().map((member) => member.creatorId))");
  // A stale-owner pending state renders the new selection's loading state.
  expect(source).toContain("selectedPlaylistItems.loading && visiblePlaylistItems().length === 0");
  expect(source).toContain("selectedCollectionMembers.loading && visibleCollectionMembers().length === 0");
});

test("playlist edit form changes only through explicit playlist selection", async () => {
  const source = await readAppShellSource();

  expect(source).toContain("const editPlaylist = (playlist: Playlist | null) => {");
  expect(source).toContain("props.onSelectPlaylist(playlist?.id ?? null);");
  expect(source).toContain("setEditingPlaylist(playlist);");
  expect(source).not.toContain("lastFormPlaylistId");
});

test("playlist UI remains inside the approved three-pane shell", async () => {
  const source = await readAppShellSource();

  expect(source).toContain("<PlaylistColumnSection");
  expect(source).not.toContain("data-shell-column=\"playlists\"");
  expect(source).not.toContain("grid-cols-[1fr_3fr_8fr_");
  // The only permitted <dialog> is the refresh-status modal; no playlist pane
  // is rendered as a dialog.
  expect((source.match(/<dialog/g) ?? []).length).toBe(1);
});

test("collection UI uses real protected API procedures for full collection flow", async () => {
  const source = await readAppShellSource();

  expect(collectionNameInputId).toBe("collection-name");
  expect(collectionDescriptionInputId).toBe("collection-description");
  expect(collectionMemberSearchInputId).toBe("collection-member-search");
  expect(source).toContain("client.overlays.collections()");
  expect(source).toContain("client.overlays.createCollection({");
  expect(source).toContain("client.overlays.updateCollection({");
  expect(source).toContain("client.overlays.deleteCollection({ collectionId })");
  expect(source).toContain("client.overlays.collectionMembers({ collectionId })");
  expect(source).toContain("client.overlays.addCollectionMember({ collectionId, creatorId })");
  expect(source).toContain("client.overlays.removeCollectionMember({ collectionId: member.collectionId, memberId: member.id })");
});

test("collection management is compact and collapsible and groups creators", async () => {
  const source = await readAppShellSource();

  expect(source).toContain("data-compact-collection-selector");
  expect(source).toContain("data-collection-management-panel");
  expect(source).toContain("data-collection-section");
  expect(source).toContain("Manage collections");
  expect(source).toContain("source-collection-selector");
  expect(source).toContain("<CollectionColumnSection");
  // A creator can be added by searching the public catalog from within the section.
  expect(source).toContain("client.catalog.creators({ search, limit: creatorSearchLimit })");
});

test("collection selection scopes the content list via a collectionId filter", async () => {
  const source = await readAppShellSource();

  // The content column threads the selected collection into the list input.
  expect(source).toContain("readonly selectedCollectionId: () => string | null;");
  expect(source).toContain("props.selectedCollectionId(),");
  // Collection id participates in the resource key so the list refetches on change.
  expect(source).toContain("input.collectionId ?? \"\",");
  // A clear affordance resets the collection filter from the content header.
  expect(source).toContain("data-collection-filter-active");
  expect(source).toContain("onClearCollection");
});

test("settings UI uses real protected API procedures for list save and delete", async () => {
  const source = await readAppShellSource();

  expect(settingKeyInputId).toBe("setting-key");
  expect(settingValueInputId).toBe("setting-value");
  expect(settingKeyPattern).toBe("^[a-z][a-z0-9._-]*$");
  expect(source).toContain("client.overlays.settings()");
  expect(source).toContain("client.overlays.saveSetting({ key, value: settingValue() })");
  expect(source).toContain("client.overlays.deleteSetting({ key })");
  expect(source).toContain("await refetchSettings()");
});

test("typed settings expose bounded known reader density controls", async () => {
  const source = await readAppShellSource();
  const compactSetting: UserSetting = {
    id: "setting-1",
    userId: "user-1",
    key: readerDensitySettingKey,
    valueJson: JSON.stringify("compact"),
  };

  expect(readerDensityInputId).toBe("reader-density");
  expect(readerDensitySettingKey).toBe("reader.density");
  expect(readerDensityValues).toEqual(["comfortable", "compact"]);
  expect(toReaderDensityFromSettings([])).toBe("comfortable");
  expect(toReaderDensityFromSettings([compactSetting])).toBe("compact");
  expect(toReaderDensityFromSettings([{ ...compactSetting, valueJson: JSON.stringify("wide") }])).toBe("comfortable");
  expect(source).toContain("<section class=\"mt-2 border-t border-border p-2\" aria-labelledby=\"reader-density-title\" data-typed-settings>");
  expect(source).toContain("id={readerDensityInputId}");
  expect(source).toContain("const nextReaderDensity = readerDensityValues.find((value) => value === event.currentTarget.value)");
  expect(source).toContain("await client.overlays.saveSetting({ key: readerDensitySettingKey, value: nextReaderDensity });");
  expect(source).toContain("await client.overlays.deleteSetting({ key: readerDensitySettingKey });");
  expect(source).not.toContain("player.autoplay");
  expect(source).not.toContain("playback preference");
});

test("reader density setting is applied to real row spacing", async () => {
  const source = await readAppShellSource();

  expect(source).toContain("const emptyUserSettings: readonly UserSetting[] = [];");
  expect(source).toContain("const settingsValue = createMemo(() => settings.latest);");
  expect(source).toContain("const readerDensity = createMemo(() => toReaderDensityFromSettings(settingsValue() ?? emptyUserSettings));");
  expect(source).toContain("data-reader-density={readerDensity()}");
  expect(source).toContain("function readerDensityPaddingClass(readerDensity: ReaderDensity): string");
  expect(source).toContain("readerDensityPaddingClass(props.readerDensity)");
  expect(source).toContain("readerDensityPaddingClass(props.readerDensity ?? \"comfortable\")");
  expect(source).toContain("readerDensity={props.readerDensity}");
});

test("raw settings editor is retained only as collapsed advanced settings", async () => {
  const source = await readAppShellSource();
  const typedSettingsIndex = source.indexOf("data-typed-settings");
  const advancedSettingsIndex = source.indexOf("data-advanced-settings");
  const rawKeyInputIndex = source.indexOf("id={settingKeyInputId}");

  expect(typedSettingsIndex).toBeGreaterThan(-1);
  expect(advancedSettingsIndex).toBeGreaterThan(typedSettingsIndex);
  expect(rawKeyInputIndex).toBeGreaterThan(advancedSettingsIndex);
  expect(source).toContain("<details class=\"mt-2 border-t border-border p-2\" data-advanced-settings>");
  expect(source).toContain("<summary class=\"cursor-pointer text-[0.72rem] font-semibold text-foreground\">Advanced settings</summary>");
  expect(source).not.toContain("open data-advanced-settings");
});

test("settings UI is authenticated-only and renders in the viewer settings takeover", async () => {
  const source = await readAppShellSource();

  expect(source).toContain("data-settings-viewer");
  expect(source).toContain("<SettingsColumnSection");
  expect(source).not.toContain('data-shell-column="settings"');
  expect(source).not.toContain("grid-cols-[1fr_3fr_8fr_");
  expect(source).not.toContain("Sign in to manage settings");
  expect(source).not.toContain("Login to manage settings");
  // Settings render in the viewer takeover, not a dialog; the only <dialog> in
  // the shell is the refresh-status modal.
  expect((source.match(/<dialog/g) ?? []).length).toBe(1);
});

test("settings UI has no fake defaults and displays only stored API values", async () => {
  const source = await readAppShellSource();

  expect(formatSettingValue(JSON.stringify("compact"))).toBe("compact");
  expect(formatSettingValue("not-json")).toBe("not-json");
  expect(source).toContain("No settings have been saved.");
  expect(source).toContain("formatSettingValue(setting.valueJson)");
  expect(source).not.toContain("reader.layout");
  expect(source).not.toContain("player.autoplay");
  expect(source).not.toContain("defaultSettings");
});

test("user data export builds a dated filename and pretty-printed JSON with a trailing newline", () => {
  expect(toUserDataExportFilename("2026-08-30T12:34:56.789Z")).toBe("feedelity-user-data-2026-08-30.json");

  const exportJson = toUserDataExportJson({ format: "feedelity.user-data", version: 1 });
  expect(exportJson.endsWith("\n")).toBe(true);
  expect(exportJson).toContain('\n  "format": "feedelity.user-data"');
  expect(JSON.parse(exportJson)).toEqual({ format: "feedelity.user-data", version: 1 });

  // Mirrors the plan's ~8 MB client-side pre-check bound.
  expect(maxUserDataImportFileBytes).toBe(8 * 1024 * 1024);
});

test("user data import parse guard rejects malformed files before any client call", () => {
  const malformed = parseUserDataImportText("{ not-json");
  expect(malformed.ok).toBe(false);
  if (!malformed.ok) {
    expect(malformed.message).toContain("not valid JSON");
  }

  const valid = parseUserDataImportText('{"format":"feedelity.user-data","version":1}');
  expect(valid.ok).toBe(true);
  if (valid.ok) {
    expect(valid.exportData).toEqual({ format: "feedelity.user-data", version: 1 });
  }
});

test("user data download helper names the file, triggers the anchor click, and revokes the object URL", () => {
  const anchors: { href: string; download: string; clicks: number }[] = [];
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      createElement: (_tagName: string) => {
        const anchor = {
          href: "",
          download: "",
          clicks: 0,
          click: () => {
            anchor.clicks += 1;
          },
        };
        anchors.push(anchor);
        return anchor;
      },
    },
  });
  const createdObjectUrls: string[] = [];
  const revokedObjectUrls: string[] = [];
  const originalCreateObjectUrl = URL.createObjectURL;
  const originalRevokeObjectUrl = URL.revokeObjectURL;
  URL.createObjectURL = (blob: Blob) => {
    const objectUrl = originalCreateObjectUrl(blob);
    createdObjectUrls.push(objectUrl);
    return objectUrl;
  };
  URL.revokeObjectURL = (objectUrl: string) => {
    revokedObjectUrls.push(objectUrl);
    originalRevokeObjectUrl(objectUrl);
  };

  try {
    const blob = new Blob(['{"format":"feedelity.user-data"}'], { type: "application/json" });
    triggerUserDataDownload(blob, "feedelity-user-data-2026-08-30.json");
  } finally {
    URL.createObjectURL = originalCreateObjectUrl;
    URL.revokeObjectURL = originalRevokeObjectUrl;
    Object.defineProperty(globalThis, "document", { configurable: true, value: undefined });
  }

  expect(anchors.length).toBe(1);
  const anchor = anchors[0];
  expect(anchor.href.startsWith("blob:")).toBe(true);
  expect(anchor.download).toBe("feedelity-user-data-2026-08-30.json");
  expect(anchor.clicks).toBe(1);
  // The object URL is revoked exactly once, and for the URL that was handed
  // to the anchor.
  expect(revokedObjectUrls).toEqual(createdObjectUrls);
  expect(revokedObjectUrls.length).toBe(1);
});

test("settings Data block wires export download and guarded import through protected procedures", async () => {
  const source = await readChangedUiSource();

  // JSON-only per decision D6: no OPML affordance in markup or code (the D6
  // rationale comment itself is the only allowed mention, so line comments
  // are stripped before this check).
  const sourceWithoutComments = source.replace(/\/\/[^\n]*/g, "");
  expect(sourceWithoutComments).not.toMatch(/opml/i);

  // Export: pretty-printed blob, programmatic download through the protected
  // procedure, busy state, and the object URL is always revoked.
  expect(source).toContain("data-export-user-data");
  expect(source).toContain("await client.overlays.exportUserData();");
  expect(source).toContain("new Blob([toUserDataExportJson(exportData)], { type: \"application/json\" })");
  expect(source).toContain("triggerUserDataDownload(blob, toUserDataExportFilename(exportData.exportedAt));");
  expect(source).toContain("disabled={exportUserDataBusy()}");
  const createObjectUrlIndex = source.indexOf("const objectUrl = URL.createObjectURL(blob);");
  const anchorDownloadIndex = source.indexOf("anchor.download = filename;");
  const anchorClickIndex = source.indexOf("anchor.click();");
  const revokeObjectUrlIndex = source.indexOf("URL.revokeObjectURL(objectUrl);");
  expect(createObjectUrlIndex).toBeGreaterThan(-1);
  expect(anchorDownloadIndex).toBeGreaterThan(createObjectUrlIndex);
  expect(anchorClickIndex).toBeGreaterThan(anchorDownloadIndex);
  expect(revokeObjectUrlIndex).toBeGreaterThan(anchorClickIndex);

  // Import: bounded JSON file input; the size pre-check and the JSON parse
  // guard both early-return before the client call can fire, so a rejected
  // file produces an error and no call.
  expect(source).toContain("data-import-user-data-input");
  expect(source).toContain('accept=".json,application/json"');
  expect(source).toContain("disabled={importUserDataBusy()}");
  // Two occurrences total: the outcome type alias and the single live call.
  expect(source.split("client.overlays.importUserData")).toHaveLength(3);
  const handlerStart = source.indexOf("const importUserDataFromFile = async (file: File) => {");
  const handlerCallIndex = source.indexOf("client.overlays.importUserData({ exportData: parsed.exportData, sourceFilename: file.name });");
  expect(handlerStart).toBeGreaterThan(-1);
  expect(handlerCallIndex).toBeGreaterThan(handlerStart);
  const handler = source.slice(handlerStart, handlerCallIndex);
  const sizeGuardIndex = handler.indexOf("file.size > maxUserDataImportFileBytes");
  const busyStartIndex = handler.indexOf("setImportUserDataBusy(true)");
  const parseGuardIndex = handler.indexOf("if (!parsed.ok)");
  expect(handler).toContain("parseUserDataImportText(await file.text())");
  expect(sizeGuardIndex).toBeGreaterThan(-1);
  expect(busyStartIndex).toBeGreaterThan(sizeGuardIndex);
  expect(handler.slice(sizeGuardIndex, busyStartIndex)).toContain("return;");
  expect(parseGuardIndex).toBeGreaterThan(busyStartIndex);
  expect(handler.slice(parseGuardIndex)).toContain("return;");

  // The report renders inline: skipped notice, per-entity counts, warnings,
  // and failures in the destructive text style.
  expect(source).toContain("data-import-user-data-report");
  expect(source).toContain("data-import-user-data-skipped");
  expect(source).toContain("data-import-user-data-count={entry.key}");
  expect(source).toContain("{entry.label}: {result().report.counts[entry.key]}");
  expect(source).toContain("<For each={result().report.warnings}>");
  expect(source).toContain("data-import-user-data-warning");
  expect(source).toContain("<For each={result().report.failures}>");
  const failuresListStart = source.indexOf("<For each={result().report.failures}>");
  expect(failuresListStart).toBeGreaterThan(-1);
  expect(source.slice(failuresListStart, failuresListStart + 600)).toContain("text-destructive");
});

test("favorites view is an authenticated content-pane filter using protected procedures", async () => {
  const source = await readAppShellSource();

  expect(contentViewModeAllId).toBe("content-view-all");
  expect(contentViewModeFavoritesId).toBe("content-view-favorites");
  expect(contentViewModeHistoryId).toBe("content-view-history");
  expect(contentViewModePlayedId).toBe("content-view-played");
  expect(source).toContain("toPersistedContentViewMode(readPersistedLocalValue(contentViewModeLocalStorageKey), props.isAuthenticated(), props.mode)");
  // The anonymous reset effect stays the enforcer for the auth gate.
  expect(source).toContain('setViewMode(props.mode === "library" ? "subscribed" : "catalog")');
  expect(source).toContain("<Show when={props.isAuthenticated()}>\n            <div class=\"mt-2 grid grid-cols-4 gap-2\" aria-label=\"Content view\">");  expect(source).toContain("return client.overlays.favoriteContentItems()");
  expect(source).toContain("return client.catalog.contentItems(input)");
  expect(source).toContain('changeViewMode("favorites")');
  expect(source).toContain('changeViewMode("history-opened")');
  expect(source).toContain('changeViewMode("played")');
  expect(source).not.toContain('data-shell-column="favorites"');
});

test("history and played views use protected contentHistory procedures", async () => {
  const source = await readAppShellSource();

  expect(source).toContain("async function listOpenedHistoryContentItems(): Promise<readonly CatalogContentListItem[]>");
  expect(source).toContain("client.overlays.contentHistory({ status: \"opened\", limit: 100 })");
  expect(source).toContain("async function listPlayedHistoryContentItems(): Promise<readonly CatalogContentListItem[]>");
  expect(source).toContain("client.overlays.contentHistory({ status: \"played\", limit: 100 })");
  expect(source).toContain("return listOpenedHistoryContentItems()");
  expect(source).toContain("return listPlayedHistoryContentItems()");
  expect(source).toContain("Filters applied locally to loaded videos.");
});

test("anonymous users do not call protected status or history procedures", async () => {
  const source = await readAppShellSource();

  expect(source).toContain("if (props.isAuthenticated() && viewMode() === \"history-opened\")");
  expect(source).toContain("if (props.isAuthenticated() && viewMode() === \"played\")");
  expect(source).toContain("if (!isAuthenticated()) {\n      return null;\n    }\n\n    return \"content-statuses\";");
  expect(source).not.toContain("if (!props.isAuthenticated() && (viewMode() === \"history-opened\" || viewMode() === \"played\"))");
  expect(source).not.toContain("if (!props.isAuthenticated() && hidePlayed())");
  expect(source).not.toContain("Sign in to view history");
  expect(source).not.toContain("Login to view history");
});

test("hide played is state filtering and not DOM filtering", async () => {
  const source = await readAppShellSource();

  expect(source).toContain("const [hidePlayed, setHidePlayed] = createSignal<boolean>(readPersistedHidePlayed() ?? false)");
  expect(source).toContain("locallyFilteredItems.filter((contentItem) => !toContentStatusFlags(statuses, contentItem.id).played)");
  // The plain <For> is the below-lg branch; the lg branch renders the same
  // items through the virtualizer (asserted in the virtualization test).
  expect(source).toContain("<For each={displayedContentItems()}>");
  // The selected-creator scrollIntoView lookup reads the DOM with a static
  // [data-creator-id] query; hide-played itself never touches the DOM
  // (no class/tag sniffing, no hidden-element toggling).
  expect(source).not.toContain("getElementsByClassName");
  expect(source).not.toContain("classList");
  expect(source).not.toContain("hidden =");
});

test("content list virtualizes on lg only with stable keys and variable row heights", async () => {
  const source = await readAppShellSource();

  // Decision D10: the virtualized branch is gated on the shared desktop
  // signal, and the virtualizer itself is disabled below lg.
  expect(source).toContain("const isDesktopViewport = createDesktopMediaQuerySignal();");
  expect(source).toContain("get enabled() {\n      return isDesktopViewport();\n    }");
  // The existing scroll region doubles as the virtualizer scroll element.
  expect(source).toContain("let contentScrollRegionEl: HTMLDivElement | undefined;");
  expect(source).toContain("getScrollElement: () => contentScrollRegionEl ?? null");
  expect(source).toContain("contentScrollRegionEl = el;");
  // Virtualizer options: reactive item count, density-aware estimates,
  // overscan 5, stable item identity by id.
  expect(source).toContain("const contentVirtualizer = createVirtualizer({");
  expect(source).toContain("get count() {\n      return displayedContentItems().length;\n    }");
  expect(source).toContain("estimateSize: () => estimateContentItemRowHeight(props.readerDensity())");
  expect(source).toContain("overscan: 5");
  expect(source).toContain("getItemKey: (index) => displayedContentItems()[index]?.id ?? index");
  // Virtual rows: absolutely positioned inside a total-size container, keyed
  // for the later j/k row lookup, measured for real variable heights.
  expect(source).toContain("<For each={contentVirtualizer.getVirtualItems()}>");
  expect(source).toContain("data-content-item-id={displayedContentItems()[virtualItem.index]?.id ?? \"\"}");
  expect(source).toContain("ref={(el) => contentVirtualizer.measureElement(el)}");
  expect(source).toContain('style={{ position: "relative", height: `${contentVirtualizer.getTotalSize()}px` }}');
  expect(source).toContain('position: "absolute"');
  expect(source).toContain("transform: `translateY(${virtualItem.start}px)`");
  // The virtual row's <Show> is KEYED on the displayed item: the virtual
  // store reconciles by "index" in place, so when hide-played removes the
  // marked item and the list shifts, a non-keyed Show would keep stale
  // pre-shift rows mounted (the marked video never disappears).
  expect(source).toContain("<Show when={displayedContentItems()[virtualItem.index]} keyed>");
  expect(source).toContain("{(contentItem) => renderContentItemRow(contentItem)}");
  expect(source).not.toContain("renderContentItemRow(contentItem())");
  // A density switch invalidates cached row sizes so the new estimates apply
  // and measureElement re-locks the real heights.
  expect(source).toContain("createEffect(on(() => props.readerDensity(), () => contentVirtualizer.measure(), { defer: true }));");
  // Both branches share one row renderer; pagination stays explicit.
  expect(source).toContain("const renderContentItemRow = (contentItem: CatalogContentListItem) => (");
  expect(source).toContain("<ContentLoadMoreControl");
});

test("keyboard shortcuts bind one guarded window keydown listener and route every action", async () => {
  const source = await readAppShellSource();

  // ONE listener for the whole shell, registered on mount and removed on
  // dispose (the user-menu.tsx listener pattern).
  expect(source).toContain("window.addEventListener(\"keydown\", handleShellKeyDown);");
  expect(source).toContain("onCleanup(() => window.removeEventListener(\"keydown\", handleShellKeyDown));");
  // Guards: text-entry targets and open native dialogs short-circuit first.
  expect(source).toContain("if (isShortcutTargetBlocked(event.target) || isDialogOpen()) {");
  // The g prefix resolves through the pure keymap and its lifecycle updates
  // on every non-guarded keydown.
  expect(source).toContain("const action = resolveShortcut(event, goPrefixActive);");
  expect(source).toContain("goPrefixActive = nextGoPrefixActive(event, goPrefixActive);");
  // Enter keeps native activation on interactive elements.
  expect(source).toContain("if (action === \"open-active\" && isActivationTarget(event.target)) {");
  // Action routing: "/" focuses the creator search, Escape clears the
  // selection AND both column searches through the shared counter, g l / g c
  // navigate through the router (the dashboard guard handles anonymous users).
  expect(source).toContain("document.getElementById(creatorSearchInputId)?.focus();");
  expect(source).toContain("const [searchClearKey, setSearchClearKey] = createSignal(0);");
  expect(source).toContain("case \"clear-selection\":\n        clearSelectedCreator();\n        setSearchClearKey((key) => key + 1);");
  expect(source).toContain("void navigate({ to: \"/dashboard\" });");
  expect(source).toContain("void navigate({ to: \"/\" });");
  // j/k/Enter/f are delegated to the content column as typed commands.
  expect(source).toContain("const [contentShortcutCommand, setContentShortcutCommand] = createSignal<ContentShortcutCommand | null>(null);");
  expect(source).toContain("setContentShortcutCommand({ kind: \"move\", delta: 1 });");
  expect(source).toContain("setContentShortcutCommand({ kind: \"move\", delta: -1 });");
  expect(source).toContain("setContentShortcutCommand({ kind: \"open\" });");
  expect(source).toContain("setContentShortcutCommand({ kind: \"toggle-favorite\" });");
  // Both columns observe the search-clear counter; the content column also
  // receives the command stream.
  expect((source.match(/searchClearKey=\{searchClearKey\}/g) ?? [])).toHaveLength(2);
  expect(source).toContain("contentShortcutCommand={contentShortcutCommand}");
  expect((source.match(/createEffect\(on\(\(\) => props\.searchClearKey\(\), \(\) => setSearch\(\"\"\), \{ defer: true \}\)\);/g) ?? [])).toHaveLength(2);
});

test("content column owns the keyboard-active row with clamped moves and both scroll paths", async () => {
  const source = await Bun.file(new URL("./app-shell-content-column.tsx", import.meta.url)).text();

  // The active row state lives in the column that renders the list: the raw
  // signal is clamped through the pure keymap helper against the displayed
  // list length, and resets when the list identity changes.
  expect(source).toContain("const [requestedActiveIndex, setRequestedActiveIndex] = createSignal(0);");
  expect(source).toContain("const activeIndex = createMemo(() => clampActiveIndex(requestedActiveIndex(), displayedContentItems().length));");
  expect(source).toContain("const activeContentItemId = createMemo(() => displayedContentItems()[activeIndex()]?.id ?? null);");
  expect(source).toContain("createEffect(on(contentItemsResourceKey, () => setRequestedActiveIndex(0), { defer: true }));");
  // Commands execute against the active row: moves clamp the WRITTEN index (so
  // repeated boundary moves cannot walk the raw signal out of range and leave
  // the opposite-direction command unresponsive) then scroll, Enter opens
  // through onSelectContent, f reuses the column's toggleFavorite path.
  expect(source).toContain("if (command.kind === \"move\") {");
  expect(source).toContain("setRequestedActiveIndex(clampActiveIndex(requestedActiveIndex() + command.delta, displayedContentItems().length));");
  expect(source).not.toContain("setRequestedActiveIndex(requestedActiveIndex() + command.delta);");
  expect(source).toContain("scrollActiveRowIntoView(activeIndex());");
  expect(source).toContain("await props.onSelectContent(activeItem);");
  expect(source).toContain("await toggleFavorite(activeItem.id);");
  // f is an authenticated overlay action: anonymous presses stay no-ops.
  expect(source).toContain("if (!props.isAuthenticated()) {\n      return;\n    }");
  // Scroll: virtualizer.scrollToIndex on lg, row lookup below lg. The
  // below-lg <li> must carry the lookup attribute on BOTH branches.
  expect(source).toContain("if (isDesktopViewport()) {\n      contentVirtualizer.scrollToIndex(index);");
  expect(source).toContain("const rows = region.querySelectorAll<HTMLElement>(\"[data-content-item-id]\");");
  expect(source).toContain("row.scrollIntoView({ block: \"nearest\" });");
  expect(source).toContain("<li data-content-item-id={contentItem.id}>");
  expect(source).toContain("data-content-item-id={displayedContentItems()[virtualItem.index]?.id ?? \"\"}");
  // The active row is highlighted through the shared row renderer.
  expect(source).toContain("active={() => activeContentItemId() === contentItem.id}");
  // Shortcut failures surface in the column instead of being swallowed.
  expect(source).toContain("data-content-command-error");
  expect(source).toContain("setContentCommandError(formatError(error));");
});

test("content rows expose keyboard-active state without claiming selection semantics", async () => {
  const source = await readAppShellSource();

  expect(source).toContain("readonly active: () => boolean;");
  // bg-selected stays STRICTLY for selected(); active-only rows get a
  // distinct weaker bg-accent highlight so an index shift after a list
  // change can never dress the next row in the selection highlight.
  expect(source).toContain("selected() ? \"bg-selected text-selected-foreground hover:bg-selected hover:text-selected-foreground\" : active() ? \"bg-accent text-accent-foreground\"");
  expect(source).not.toContain("selected() || active() ? \"bg-selected");
  // ...but is marked data-active; aria-current stays reserved for selection.
  expect(source).toContain("data-active={active() ? \"true\" : \"false\"}");
  expect(source).toContain("data-selected={selected() ? \"true\" : \"false\"}");
  expect((source.match(/aria-current=/g) ?? [])).toHaveLength(1);
});

test("desktop media query binding pushes current state forwards changes and unsubscribes", () => {
  expect(desktopMediaQuery).toBe("(min-width: 1024px)");

  const listeners: Array<(event: { readonly matches: boolean }) => void> = [];
  let matches = false;
  const query = {
    get matches() {
      return matches;
    },
    addEventListener: (_type: "change", listener: (event: { readonly matches: boolean }) => void) => {
      listeners.push(listener);
    },
    removeEventListener: (_type: "change", listener: (event: { readonly matches: boolean }) => void) => {
      const index = listeners.indexOf(listener);
      if (index >= 0) {
        listeners.splice(index, 1);
      }
    },
  };

  const updates: boolean[] = [];
  const unsubscribe = bindMediaQueryMatches(query, (next) => updates.push(next));

  // Current state is pushed immediately on bind, matching the initial sync in
  // createDesktopMediaQuerySignal's mount step.
  expect(updates).toEqual([false]);

  matches = true;
  for (const listener of listeners) {
    listener({ matches });
  }
  expect(updates).toEqual([false, true]);

  unsubscribe();
  expect(listeners).toHaveLength(0);
});

test("content list row height estimates are density-aware", () => {
  expect(readerDensityValues).toEqual(["comfortable", "compact"]);
  expect(estimateContentItemRowHeight("compact")).toBe(72);
  expect(estimateContentItemRowHeight("comfortable")).toBe(76);
  expect(estimateContentItemRowHeight("compact")).toBeLessThan(estimateContentItemRowHeight("comfortable"));
});

test("hide played defaults to on when connected unless an explicit preference exists", async () => {
  const source = await readAppShellSource();

  // No stored preference -> default to true once authenticated.
  expect(source).toContain("if (props.isAuthenticated() && readPersistedHidePlayed() === null)");
  expect(source).toContain("setHidePlayed(true)");
  // The seed value: an explicit preference wins, otherwise start false (the
  // authenticated default is applied by the effect above, not the seed).
  expect(source).toContain("createSignal<boolean>(readPersistedHidePlayed() ?? false)");
});

test("hide played preference is persisted via localStorage helpers", () => {
  expect(hidePlayedLocalStorageKey).toBe("feedelity.hide-played");
});

test("persisted UI state keys use stable localStorage names (F7)", () => {
  expect(shellModeLocalStorageKey).toBe("feedelity.shell.mode");
  expect(leftPaneTabLocalStorageKey).toBe("feedelity.shell.left-tab");
  expect(creatorSourceFilterLocalStorageKey).toBe("feedelity.creators.source-filter");
  expect(contentViewModeLocalStorageKey).toBe("feedelity.content.view-mode");
  expect(contentSourceFilterLocalStorageKey).toBe("feedelity.content.source-filter");
});

test("persistLocalValue and readPersistedLocalValue round-trip through localStorage", () => {
  const store = new Map<string, string>();
  const originalStorage = globalThis.localStorage;
  globalThis.localStorage = toStorageStub(store);
  try {
    expect(readPersistedLocalValue(shellModeLocalStorageKey)).toBeNull();

    persistLocalValue(shellModeLocalStorageKey, "library");
    expect(readPersistedLocalValue(shellModeLocalStorageKey)).toBe("library");
    expect(store.get(shellModeLocalStorageKey)).toBe("library");
  } finally {
    globalThis.localStorage = originalStorage;
  }
});

test("persisted shell mode narrows to catalog for missing or invalid values", () => {
  expect(toPersistedShellMode(null)).toBe("catalog");
  expect(toPersistedShellMode("")).toBe("catalog");
  expect(toPersistedShellMode("bogus")).toBe("catalog");
  expect(toPersistedShellMode("catalog")).toBe("catalog");
  expect(toPersistedShellMode("library")).toBe("library");
});

test("persisted left-pane tab coerces auth-only tabs for anonymous users", () => {
  expect(toPersistedLeftPaneTab(null, false)).toBe("library");
  expect(toPersistedLeftPaneTab(null, true)).toBe("library");
  expect(toPersistedLeftPaneTab("bogus", true)).toBe("library");
  expect(toPersistedLeftPaneTab("library", false)).toBe("library");
  // Feeds works for anonymous browsing, so it applies as-is either way.
  expect(toPersistedLeftPaneTab("feeds", false)).toBe("feeds");
  expect(toPersistedLeftPaneTab("feeds", true)).toBe("feeds");
  // Playlists and collections render only for signed-in users (the app-shell
  // tab bar gates them behind isAuthenticated), so an anonymous application of
  // the persisted tab falls back to the default.
  expect(toPersistedLeftPaneTab("playlists", false)).toBe("library");
  expect(toPersistedLeftPaneTab("collections", false)).toBe("library");
  expect(toPersistedLeftPaneTab("playlists", true)).toBe("playlists");
  expect(toPersistedLeftPaneTab("collections", true)).toBe("collections");
});

test("persisted source-type filter narrows to null (All) for missing or invalid values", () => {
  expect(toPersistedSourceTypeFilter(null)).toBeNull();
  expect(toPersistedSourceTypeFilter("")).toBeNull();
  expect(toPersistedSourceTypeFilter("all")).toBeNull();
  expect(toPersistedSourceTypeFilter("bogus")).toBeNull();
  expect(sourceTypeFilterValues).toEqual(["youtube", "odysee", "peertube"]);
  for (const sourceType of sourceTypeFilterValues) {
    expect(toPersistedSourceTypeFilter(sourceType)).toBe(sourceType);
  }
});

test("persisted content view mode coerces auth-only modes to the shell-mode default", () => {
  expect(toContentViewModeDefault("library")).toBe("subscribed");
  expect(toContentViewModeDefault("catalog")).toBe("catalog");

  // Missing or invalid values fall back to the mode default.
  expect(toPersistedContentViewMode(null, true, "library")).toBe("subscribed");
  expect(toPersistedContentViewMode(null, true, "catalog")).toBe("catalog");
  expect(toPersistedContentViewMode("bogus", true, "library")).toBe("subscribed");

  // Auth-only modes (their buttons render only for signed-in users) fall back
  // to the mode default when applied anonymously...
  expect(toPersistedContentViewMode("favorites", false, "library")).toBe("subscribed");
  expect(toPersistedContentViewMode("history-opened", false, "library")).toBe("subscribed");
  expect(toPersistedContentViewMode("played", false, "catalog")).toBe("catalog");

  // ...and apply as-is for signed-in users.
  expect(toPersistedContentViewMode("favorites", true, "library")).toBe("favorites");
  expect(toPersistedContentViewMode("history-opened", true, "catalog")).toBe("history-opened");
  expect(toPersistedContentViewMode("played", true, "library")).toBe("played");

  // Non-gated modes apply regardless of the auth state.
  expect(toPersistedContentViewMode("catalog", false, "catalog")).toBe("catalog");
  expect(toPersistedContentViewMode("subscribed", false, "library")).toBe("subscribed");
});

test("favorite toggles are real authenticated actions in list rows and viewer", async () => {
  const source = await readAppShellSource();

  expect(source).toContain("client.overlays.toggleContentFavorite({ contentItemId })");
  expect(source).toContain("<ContentListItemRow");
  expect(source).toContain("onFavoriteChanged={() => setFavoritesReloadKey((key) => key + 1)}");
  expect(source).toContain("props.onFavoriteChanged()");
});

test("favorite-only row actions reconcile favorites without refetching catalog content", async () => {
  const source = await readAppShellSource();
  const toggleFavoriteStart = source.indexOf("const toggleFavorite = async (contentItemId: string) => {");
  const markOpenedStart = source.indexOf("const markOpened = async (contentItemId: string) => {");
  const favoriteActionSource = source.slice(toggleFavoriteStart, markOpenedStart);

  expect(toggleFavoriteStart).toBeGreaterThanOrEqual(0);
  expect(markOpenedStart).toBeGreaterThan(toggleFavoriteStart);
  expect(favoriteActionSource).toContain("await client.overlays.toggleContentFavorite({ contentItemId });");
  expect(favoriteActionSource).toContain("props.onFavoriteChanged();");
  expect(favoriteActionSource).toContain("await refetchFavoriteItems();");
  expect(favoriteActionSource).not.toContain("refetchContentItems");
});

test("anonymous users do not see favorite controls or protected favorite calls", async () => {
  const source = await readAppShellSource();

  expect(source).toContain("if (props.isAuthenticated() && viewMode() === \"favorites\")");
  expect(source).toContain("if (!props.isAuthenticated()) {\n      return null;\n    }");
  expect(source).not.toContain("if (!props.isAuthenticated() && viewMode() === \"favorites\")");
  // The authenticated action cluster is a floating overlay: absolute, no layout
  // gap, pointer-disabled until hover/focus. It must NOT be the old normal-flow
  // `mt-1 flex items-center justify-end gap-1` block that reserved a blank line
  // on every row even when the buttons were invisible.
  expect(source).toContain("data-content-row-actions");
  expect(source).toContain("pointer-events-none absolute bottom-1 right-1");
  expect(source).toContain("group-hover:pointer-events-auto group-hover:opacity-100");
  expect(source).not.toContain("mt-1 flex items-center justify-end gap-1");
  expect(source).not.toContain("Sign in to favorite");
  expect(source).not.toContain("Login to favorite");
});

test("content statuses load only for authenticated users", async () => {
  const source = await readAppShellSource();
  const statusProcedureMatches = source.match(/client\.overlays\.contentStatuses\(\)/g) ?? [];

  expect(source).toContain("client.overlays.contentStatuses()");
  expect(statusProcedureMatches).toHaveLength(1);
  expect(source).toContain("if (!isAuthenticated()) {\n      return null;\n    }\n\n    return \"content-statuses\";");
  expect(source).toContain("createResource(contentStatusesResourceInput, () =>");
  expect(source).toContain("const emptyUserContentStatuses: readonly UserContentStatus[] = [];");
  expect(source).toContain("contentStatuses={() => contentStatuses() ?? emptyUserContentStatuses}");
  expect(source).toContain("const statuses = props.contentStatuses();");
  expect(source).toContain("return toContentStatusFlags(props.contentStatuses(), contentItemId);");
});

test("resource reload dependencies use stable primitive source keys", async () => {
  const source = await readAppShellSource();

  expect(source).toContain("function toCreatorListResourceKey(input: CreatorListInput, reloadKey: number): string");
  expect(source).toContain("function toFeedListResourceKey(input: FeedListInput | null): string | null");
  expect(source).toContain("function toContentItemsResourceKey(mode: ContentItemsResourceMode, input: ContentListInput, reloadKey: number): string");
  expect(source).toContain("creatorListResourceKey = createMemo(() => toCreatorListResourceKey(creatorListInput(), props.catalogReloadKey()))");
  expect(source).toContain("catalogReloadKey={catalogReloadKey}");
  expect(source).toContain("subscriptionsReloadKey={subscriptionsReloadKey}");
  expect(source).toContain("mode === \"subscribed\"\n      ? props.subscriptionsReloadKey()");
  expect(source).toContain("input.offset.toString()");
  expect(source).toContain("createResource(contentItemsResourceKey, () =>");
  expect(source).toContain('return "content-statuses";');
  // History views are snapshots: opened/played markers propagate through local
  // status patches (patchContentStatus/removeContentStatus), so no status
  // reload key may exist anywhere — it would refetch and reorder the history
  // list on every video selection. (The identifier is split so this grep-style
  // assertion does not itself contain the forbidden symbol.)
  expect(source).not.toContain(`status${"ReloadKey"}`);
  // The viewer's favoriteItems source must NOT embed favoritesReloadKey: doing
  // so re-suspends the viewer's resource and tears down the playing video on
  // every favorite toggle. The viewer refetches in place instead.
  expect(source).toContain("return contentItemId;");
  expect(source).not.toContain("props.favoritesReloadKey().toString()");
  expect(source).not.toContain("return { mode: \"catalog\", input: contentListInput(), reloadKey: props.catalogReloadKey() }");
  expect(source).not.toContain("return { mode: \"subscribed\", input: contentListInput(), reloadKey: props.catalogReloadKey() }");
  expect(source).not.toContain("return { contentItemId, reloadKey: props.favoritesReloadKey() }");
});

test("mobile navigation adds no timers observers or unstable resource source objects", async () => {
  const source = await readAppShellSource();

  expect(source).not.toContain("IntersectionObserver");
  // The lg-only content-list virtualizer keeps its ResizeObserver encapsulated
  // inside @tanstack/solid-virtual (and disabled below lg); the shell source
  // itself never touches observer APIs.
  expect(source).not.toContain("ResizeObserver");
  expect(source).not.toContain("MutationObserver");
  expect(source).not.toContain("setInterval");
  expect(source).toContain("refreshPollTimer = setTimeout(() => {");
  expect(source).not.toMatch(/createResource\(\s*\(\) => \(\{/);
  expect(source).not.toMatch(/createResource\(\s*\(\) => \{/);
});

test("load-more controls page creators feeds and content without timers or observers", async () => {
  const source = await readAppShellSource();

  expect(source).toContain("function LoadMoreControl(props: LoadMoreControlProps)");
  expect(source).toContain("data-load-more-control");
  expect(source).toContain("data-loaded-count");
  expect(source).toContain("{props.shownCount} loaded");
  expect(source).toContain("Load more creators");
  expect(source).toContain("Load more feeds");
  expect(source).toContain("Load more videos");
  expect(source).toContain("interface PaginationOffsetState");
  expect(source).toContain("function nextOffsetForKey(state: PaginationOffsetState, key: string, firstPageLength: number): number");
  expect(source).toContain("const nextOffset = nextOffsetForKey(catalogCreatorOffset(), key, (creators() ?? emptyBrowsableCreators).length);");
  expect(source).toContain("const nextCreators = await client.catalog.creators({ ...creatorListInput(), offset: nextOffset });");
  expect(source).toContain("const nextOffset = nextOffsetForKey(feedOffset(), key, (feedsValue() ?? emptyCatalogFeeds).length);");
  expect(source).toContain("const nextFeeds = await client.catalog.feeds({ ...input, offset: nextOffset });");
  expect(source).toContain("const nextOffset = nextOffsetForKey(contentOffset(), queryKey, (contentItemsValue() ?? emptyCatalogContentItems).length);");
  expect(source).toContain("const input = { ...contentListInput(), offset: nextOffset };");
  expect(source).toContain("setAppendedCatalogCreatorPage((currentPage) => ({");
  expect(source).toContain("setAppendedFeedPage((currentPage) => ({");
  expect(source).toContain("setAppendedContentPage((currentPage) => ({");
  expect(source).toContain("hasMore: nextCreators.length === creatorListLimit");
  expect(source).toContain("hasMore: nextFeeds.length === feedListLimit");
  expect(source).toContain("hasMore: nextContentItems.length === contentListLimit");
  expect(source).toContain("setCatalogCreatorOffset({ key, nextOffset: nextOffset + nextCreators.length });");
  expect(source).toContain("setFeedOffset({ key, nextOffset: nextOffset + nextFeeds.length });");
  expect(source).toContain("setContentOffset({ key: queryKey, nextOffset: nextOffset + nextContentItems.length });");
  // Content load-more keys its appended page and offset on QUERY identity
  // (mode + filters), NOT the resource key — so a refresh live-reload tick
  // (which changes the resource key) no longer wipes load-more pages.
  expect(source).toContain("key: queryKey,");
  expect(source).toContain("function toContentItemsQueryKey(mode: ContentItemsResourceMode, input: ContentListInput): string");
  expect(source).not.toContain("offset: loadedCreators.length");
  expect(source).not.toContain("offset: visibleFeeds().length");
  expect(source).not.toContain("offset: loadedContentItems().length");
  expect(source).not.toContain("setCatalogCreators");
  expect(source).not.toContain("setLoadedFeeds");
  expect(source).not.toContain("setLoadedContentItems");
  expect(source).toContain("data-content-loaded-count");
  expect(source).not.toContain("IntersectionObserver");
  expect(source).not.toContain("setInterval");
});

test("app shell uses stable module-level empty arrays for fallback accessors", async () => {
  const source = await readAppShellSource();

  expect(source).toContain("const emptyUserSettings: readonly UserSetting[] = [];");
  expect(source).toContain("const emptyUserContentStatuses: readonly UserContentStatus[] = [];");
  expect(source).toContain("const emptyPlaylists: readonly Playlist[] = [];");
  expect(source).toContain("const emptyCatalogContentSources: readonly CatalogContentSource[] = [];");
  expect(source).toContain("settings={() => settingsValue() ?? emptyUserSettings}");
  expect(source).toContain("contentStatuses={() => contentStatuses.latest ?? emptyUserContentStatuses}");
  expect(source).toContain("playlistsValue() ?? emptyPlaylists");
  expect(source).toContain("const playlistsValue = createMemo(() => playlists.latest);");
  expect(source).toContain("contentDetail.latest?.sources ?? emptyCatalogContentSources");
  // Plain resource reads would suspend on refetch and blank the app (no
  // column-level <Suspense> fallbacks); the shell and the viewer read only
  // .latest-backed memos. Scoped to these two files: the content column and
  // the left-pane panels convert their own reads in later phases.
  const shellSource = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();
  const viewerSource = await Bun.file(new URL("./app-shell-viewer.tsx", import.meta.url)).text();
  expect(shellSource).not.toContain("settings() ?? emptyUserSettings");
  expect(viewerSource).not.toContain("playlists() ?? emptyPlaylists");
  expect(source).not.toContain("settings() ?? []");
  expect(source).not.toContain("contentStatuses() ?? []");
  expect(source).not.toContain("playlists() ?? []");
});

test("selecting content marks opened only after authenticated guard", async () => {
  const source = await readAppShellSource();

  expect(source).toContain("const selectContent = async (contentItem: CatalogContentListItem) => {");
  expect(source).toContain("setSelectedContent(contentItem);\n    setStatusSelectionError(null);");
  expect(source).toContain("await autoMarkContentOpened(contentItem.id);");
  expect(source).toContain("Opened status update failed: ${formatError(error)}");
  expect(source).toContain("const markContentOpened = async (contentItemId: string) => {");
  expect(source).toContain("const result = await client.overlays.toggleContentOpened({ contentItemId });");
});

test("opened and played actions patch local status state without refetching", async () => {
  const source = await readAppShellSource();
  const markOpenedStart = source.indexOf("const markContentOpened = async (contentItemId: string) => {");
  const markPlayedEnd = source.indexOf("const autoMarkContentOpened = async (contentItemId: string) => {");
  const statusMutationSource = source.slice(markOpenedStart, markPlayedEnd);

  expect(source).toContain("await client.overlays.markContentOpened({ contentItemId });");
  expect(source).toContain("const [contentStatuses, { mutate: mutateContentStatuses }] = createResource(contentStatusesResourceInput, () =>");
  expect(source).toContain("const patchContentStatus = (status: UserContentStatus) => {");
  expect(source).toContain("const removeContentStatus = (contentItemId: string, status: UserContentStatus[\"status\"]) => {");
  expect(statusMutationSource).toContain("const result = await client.overlays.toggleContentOpened({ contentItemId });");
  expect(statusMutationSource).toContain("const result = await client.overlays.toggleContentPlayed({ contentItemId });");
  expect(statusMutationSource).toContain("const result = await client.overlays.markContentPlayed({ contentItemId });");
  expect(statusMutationSource).not.toContain("setCatalogReloadKey");
  expect(statusMutationSource).not.toContain("refetchContentStatuses");
  expect(source).toContain("await props.onMarkContentOpened(contentItemId);");
  expect(source).toContain("await props.onMarkContentPlayed(contentItemId);");
  expect(source).toContain("await props.onAutoMarkContentPlayed(contentItemId);");
});

test("status-only row actions do not manually refetch catalog content", async () => {
  const source = await readAppShellSource();
  const markOpenedStart = source.indexOf("const markOpened = async (contentItemId: string) => {");
  const markPlayedEnd = source.indexOf("const addContentToPlaylist = async (contentItemId: string) => {");
  const statusActionSource = source.slice(markOpenedStart, markPlayedEnd);

  expect(statusActionSource).toContain("await props.onMarkContentOpened(contentItemId);");
  expect(statusActionSource).toContain("await props.onMarkContentPlayed(contentItemId);");
  expect(statusActionSource).not.toContain("refetchContentItems");
});

test("content rows expose opened and played state with semantic attributes", async () => {
  const source = await readAppShellSource();

  expect(source).toContain("data-opened={status().opened ? \"true\" : \"false\"}");
  expect(source).toContain("data-played={status().played ? \"true\" : \"false\"}");
  expect(source).toContain('data-content-status="opened"');
  expect(source).toContain('data-content-status="played"');
  expect(source).toContain('data-content-status="selected"');
  expect(source).toContain('data-content-status="favorite"');
  expect(source).toContain("data-favorite={isFavorite() ? \"true\" : \"false\"}");
  expect(source).toContain("status().played ? \"bg-muted\" : status().opened ? \"bg-card\" : \"bg-background\"");
  expect(source).toContain("{status().opened ? \"Unmark opened\" : \"Mark opened\"}");
  expect(source).toContain("{status().played ? \"Unmark played\" : \"Mark played\"}");
});

test("content rows expose concise icon source indicators and avoid fake thumbnails", async () => {
  const source = await readAppShellSource();
  const sourceIndicator = await Bun.file(new URL("./source-indicator.tsx", import.meta.url)).text();

  expect(source).toContain("const rowImageUrl = createMemo(() => props.contentItem.thumbnailUrl ?? props.contentItem.creator.imageUrl)");
  expect(source).toContain("data-thumbnail-source={rowImageSource() ?? \"\"}");
  expect(sourceIndicator).toContain("function SourceIconBadge(props: { readonly sourceType: SourceType; readonly context: SourceIndicatorContext; readonly sourceCount?: number })");
  expect(sourceIndicator).toContain("formatSourceIndicatorLabel(props.sourceType, props.context, props.sourceCount)");
  expect(source).toContain("<SourceIconBadge sourceType={props.contentItem.sourceType} context=\"content\" sourceCount={props.contentItem.sourceCount} />");
  expect(sourceIndicator).toContain("source records available");
  expect(sourceIndicator).toContain("×{props.sourceCount}");
  expect(source).toContain("data-content-source-chip");
  expect(source).toContain("data-content-source-indicator");
  expect(source).toContain("id=\"viewer-source-switcher\"");
  expect(source).toContain("Playback source");
  expect(source).not.toContain("Listed from");
  expect(source).not.toContain("listed from");
  expect(source).not.toContain(" exists");
  expect(source).not.toContain("exists ");
  expect(source).not.toContain("blablabla");
  expect(source).not.toContain("playback source switching is in the viewer");
  expect(source).not.toContain("fake thumbnail");
  expect(source).not.toContain("thumbnailPlaceholder");
});

test("row-level source affordances use icons instead of visible source-name chips", async () => {
  const source = await readAppShellSource();
  const sourceIndicator = await Bun.file(new URL("./source-indicator.tsx", import.meta.url)).text();

  expect(sourceIndicator).toContain('import CirclePlay from "lucide-solid/icons/circle-play";');
  expect(sourceIndicator).toContain('import RadioTower from "lucide-solid/icons/radio-tower";');
  expect(sourceIndicator).toContain('import SquarePlay from "lucide-solid/icons/square-play";');
  expect(source).not.toContain('from "lucide-solid";');
  expect(sourceIndicator).not.toContain('from "lucide-solid";');
  expect(source).not.toContain("<SourceIconBadge sourceType={props.creator.sourceType}");
  expect(source).toContain("<SourceIconBadge sourceType={props.feed.sourceType} context=\"feed\" />");
  expect(source).toContain("<SourceIconBadge sourceType={props.contentItem.sourceType} context=\"content\" sourceCount={props.contentItem.sourceCount} />");
  expect(sourceIndicator).toContain("aria-label={label()}");
  expect(sourceIndicator).toContain("title={label()}");
  expect(source).not.toContain("<span class=\"truncate\">{formatSourceLabel(props.creator.sourceType)}</span>");
  expect(source).not.toContain("{formatSourceLabel(props.feed.sourceType)}\n          </span>");
  expect(source).not.toContain("{formatSourceLabel(props.contentItem.sourceType)}\n            </span>");
});

test("creator rows avoid single-source claims while selected feed list shows feed sources", async () => {
  const source = await readAppShellSource();

  expect(source).toContain("aria-label=\"Feeds for selected creator\"");
  expect(source).toContain("<For each={selectedCreatorFeeds()}>");
  expect(source).toContain("<FeedRow");
  expect(source).toContain("<SourceIconBadge sourceType={props.feed.sourceType} context=\"feed\" />");
  expect(source).not.toContain("Catalog source");
});

test("viewer playback source selector stays accessible for multiple playable sources", async () => {
  const source = await readAppShellSource();

  expect(source).toContain("<Show when={playableSources().length > 1}>");
  expect(source).toContain("const playbackSourceSwitcherLabel = createMemo(() => `Playback source, ${playableSources().length} options`);");
  expect(source).toContain("aria-label={playbackSourceSwitcherLabel()}");
  expect(source).toContain("onClick={() => setSelectedSourceId(source.id)}");
  expect(source).toContain("<For each={playableSources()}>");
});

test("subscription UI is authenticated and wired to real protected procedures", async () => {
  const source = await readAppShellSource();

  expect(source).toContain("client.overlays.subscriptions()");
  expect(source).toContain("client.overlays.subscribeToCreator({ creatorId })");
  expect(source).toContain("client.overlays.unsubscribeFromCreator({ creatorId })");
  expect(source).toContain("props.onSubscriptionsChanged();");
  expect(source).toContain("onSubscriptionsChanged={() => setSubscriptionsReloadKey((key) => key + 1)}");
  expect(source).toContain('if (props.mode === "library" && action === "unsubscribe" && props.selectedCreatorId() === creatorId)');
  expect(source).toContain("props.onClearCreator()");
  expect(source).toContain("<SubscriptionActionButton");
  // The hover-revealed action cluster gates on authentication; the subscription
  // control inside it additionally gates on showSubscriptionControl (catalog only).
  expect(source).toContain("<Show when={props.isAuthenticated}>");
  expect(source).toContain("<Show when={props.showSubscriptionControl}>");
  expect(source).toContain("{props.isSubscribed ? \"Unsubscribe\" : \"Subscribe\"}");
  expect(source).not.toContain("Add subscription");
});

test("creator rows expose a hover-revealed floating force-refresh button without a layout gap", async () => {
  const source = await readAppShellSource();

  // The per-row refresh button lives in the same floating cluster as the
  // subscription control: pointer-events-none until hover/focus, so it adds no
  // layout gap and invisible buttons can't steal clicks.
  expect(source).toContain("onForceRefreshCreator: (creatorId: string) => Promise<void>;");
  expect(source).toContain("readonly refreshBusy: boolean;");
  expect(source).toContain("data-refresh-creator={props.creator.id}");
  expect(source).toContain('aria-label={`Force refresh ${props.creator.displayName}`}');
  expect(source).toContain("void props.onForceRefreshCreator(props.creator.id)");
  expect(source).toContain("disabled={props.refreshBusy}");
  // Hover/focus reveal is pointer-gated, mirroring the content-row action cluster.
  expect(source).toContain("group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100");
});

test("creator pane keeps header refresh action beside subscription actions", async () => {
  const source = await readAppShellSource();

  expect(source).toContain("client.refresh.startAll({ force })");
  expect(source).toContain("Refresh");
});

test("catalog and library routes deliberately select distinct shell modes", async () => {
  const shellLayoutRoute = await Bun.file(new URL("../routes/_shell.tsx", import.meta.url)).text();
  const indexRoute = await Bun.file(new URL("../routes/_shell.index.tsx", import.meta.url)).text();
  const dashboardRoute = await Bun.file(new URL("../routes/_shell.dashboard.tsx", import.meta.url)).text();
  const headerSource = await Bun.file(new URL("./header.tsx", import.meta.url)).text();

  expect(shellLayoutRoute).toContain('<AppShell mode={mode()} />');
  expect(shellLayoutRoute).toContain('location().pathname.startsWith("/dashboard") ? "library" : "catalog"');
  expect(indexRoute).toContain('createFileRoute("/_shell/")');
  expect(dashboardRoute).toContain('createFileRoute("/_shell/dashboard")');
  expect(dashboardRoute).toContain('to: "/login"');
  expect(dashboardRoute).toContain("authClient.getSession()");
  expect(headerSource).toContain('{ to: "/", label: "Catalog", helper: "Browse" }');
  expect(headerSource).toContain('{ to: "/dashboard", label: "Library", helper: "Saved" }');
  expect(headerSource).not.toContain("Dashboard");
});

test("library mode uses subscribed state without changing anonymous catalog reads", async () => {
  const source = await readAppShellSource();

  expect(contentViewModeSubscribedId).toBe("content-view-subscribed");
  expect(contentViewModeHistoryId).toBe("content-view-history");
  expect(contentLibraryFiltersLabel).toBe("Library filters");
  expect(source).toContain('props.mode === "library" ? "Library" : "Catalog"');
  expect(source).toContain('props.mode === "library" ? "subscribed" : "catalog"');
  expect(source).toContain("return \"catalog\";");
  expect(source).toContain("return listSubscribedLibraryContentItems(input)");
  expect(source).toContain("return client.overlays.subscribedContentItems(input)");
  expect(source).toContain("client.overlays.contentHistory({ status: \"opened\", limit: 100 })");
  expect(source).toContain("client.overlays.contentHistory({ status: \"played\", limit: 100 })");
  expect(source).toContain("Your subscribed Library has no videos yet. Subscribe from the Catalog or refresh your sources.");
  expect(source).toContain("Open videos to build your Library history, or clear local filters to see loaded history.");
  expect(source).toContain("Play videos to build your played Library, or clear local filters to see loaded played history.");
  expect(source).toContain("aria-label={`${visibleContentCollectionLabel()} videos, ${contentCount()} shown`}");
  expect(source).toContain("Subscribed creators appear in your Library after you subscribe from the Catalog.");
});

test("subscribed library content uses one protected endpoint without client fan-out", async () => {
  const source = await readAppShellSource();

  expect(source).toContain("async function listSubscribedLibraryContentItems(input: ContentListInput): Promise<readonly CatalogContentListItem[]> {");
  expect(source).toContain("return client.overlays.subscribedContentItems(input);");
  expect(source).not.toContain("subscriptions.flatMap");
  expect(source).not.toContain("toSubscribedCreatorContentListInputs");
  expect(source).toContain("if (mode() === \"library\") {\n              await client.overlays.subscribeToCreator({ creatorId: value.creator.id });\n            }");
});

test("viewer empty state uses neutral video copy", async () => {
  const source = await readAppShellSource();

  expect(source).toContain("Pick a video to open the viewer.");
  expect(source).not.toContain("Pick a catalog video to open the viewer.");
});

test("visible shell copy avoids rejected product jargon", async () => {
  const source = await readAppShellSource();
  const headerSource = await Bun.file(new URL("./header.tsx", import.meta.url)).text();
  const combinedSource = `${source}\n${headerSource}`.toLowerCase();
  const forbiddenProductJargon = [`private ${"overlay"}`, "cock" + "pit", "archi" + "tecture"];

  for (const phrase of forbiddenProductJargon) {
    expect(combinedSource).not.toContain(phrase);
  }
});

test("primary navigation declares deliberate keyboard focus styling", async () => {
  const source = await Bun.file(new URL("./header.tsx", import.meta.url)).text();

  expect(source).toContain('export const focusVisibleClass = "focus-visible:outline');
  expect(source).toContain("${focusVisibleClass}");
});

test("phase 7A chrome does not show the rejected auth status block", async () => {
  const source = await readChangedUiSource();
  const rejectedStatusTitle = `Reading ${"state"}`;
  const rejectedStatusCopy = `Sign in when ${"save"} ${"actions"} are available for favorites, played videos, and playlists.`;

  expect(source).not.toContain(rejectedStatusTitle);
  expect(source).not.toContain(rejectedStatusCopy);
});

test("content list omits unauthenticated overlay controls and stale phase copy", async () => {
  const source = await readAppShellSource();
  const forbiddenContentListCopy = [
    `${"played"} only`,
    "Video rows will appear here when the content list is wired in the next phase.",
    "Ready to filter videos for the selected source.",
    `Reading ${"state"}`,
  ];

  for (const phrase of forbiddenContentListCopy) {
    expect(source).not.toContain(phrase);
  }
});

test("component UI files use semantic color tokens only", async () => {
  const componentSource = await Promise.all(
    changedUiSourceFiles
      .filter((filePath) => filePath.endsWith(".tsx"))
      .map(async (filePath) => Bun.file(new URL(filePath, import.meta.url)).text()),
  );
  const source = componentSource.join("\n");
  const hexColorPattern = /#[0-9a-fA-F]{3,8}/;
  const arbitraryColorClassPattern = /(?:bg|text|border|shadow|from|via|to|outline|ring)-\[[^\]]*(?:#|color:|rgb|hsl|oklch)[^\]]*\]/;
  const paletteClassPattern = /\b(?:bg|text|border|outline|ring|from|via|to|decoration|divide|shadow)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black|sage)(?:-\d{2,3})?\b/;
  const forbiddenVisualEffectsPattern = new RegExp(`\\b(?:from|via|to)-|${"grad"}ient|${"gl"}ow`);

  expect(source).not.toMatch(hexColorPattern);
  expect(source).not.toMatch(arbitraryColorClassPattern);
  expect(source).not.toMatch(paletteClassPattern);
  expect(source).not.toMatch(forbiddenVisualEffectsPattern);
});

test("theme file owns the semantic palette", async () => {
  const source = await Bun.file(new URL("../styles.css", import.meta.url)).text();

  expect(source).toContain("--color-background: var(--background);");
  expect(source).toContain("--color-card: var(--card);");
  expect(source).toContain("--color-muted-foreground: var(--muted-foreground);");
});

test("pane resizer exposes separator role with aria orientation and keyboard step", async () => {
  const resizerSource = await Bun.file(new URL("./pane-resizer.tsx", import.meta.url)).text();

  expect(resizerSource).toContain('role="separator"');
  expect(resizerSource).toContain('aria-orientation="vertical"');
  expect(resizerSource).toContain("aria-label={props.ariaLabel ?? \"Resize pane\"}");
  expect(resizerSource).toContain("aria-valuenow={props.ariaValueNow}");
  expect(resizerSource).toContain("aria-valuemin={props.ariaValueMin}");
  expect(resizerSource).toContain("aria-valuemax={props.ariaValueMax}");
  expect(resizerSource).toContain("tabindex=\"0\"");
  expect(resizerSource).toContain("onKeyDown");
  expect(resizerSource).toContain("event.key === \"ArrowLeft\"");
  expect(resizerSource).toContain("event.key === \"ArrowRight\"");
  expect(resizerSource).toContain("const keyboardStep = 20");
  expect(resizerSource).toContain("onMouseDown={onMouseDown}");
  expect(resizerSource).toContain("onTouchStart={onTouchStart}");
});

test("left pane tabs use role tablist and role tab with aria-selected", async () => {
  const source = await readAppShellSource();

  expect(source).toContain("role=\"tablist\"");
  expect(source).toContain("data-left-pane-tab-bar");
  expect(source).toContain("role=\"tab\"");
  expect(source).toContain("aria-selected={props.activeTab() === \"library\"}");
  expect(source).toContain("aria-selected={props.activeTab() === \"feeds\"}");
  expect(source).toContain("aria-selected={props.activeTab() === \"playlists\"}");
  expect(source).toContain("aria-selected={props.activeTab() === \"collections\"}");
  expect(source).toContain("{leftPaneTabLabels.feeds}");
  expect(source).toContain("{leftPaneTabLabels.playlists}");
  expect(source).toContain("{leftPaneTabLabels.collections}");
});

test("LeftPaneTab type covers library feeds playlists and collections", () => {
  const tabs: readonly LeftPaneTab[] = ["library", "feeds", "playlists", "collections"];

  expect(tabs).toHaveLength(4);
  expect(leftPaneTabLabels.library).toBe("Library");
  expect(leftPaneTabLabels.feeds).toBe("Feeds");
  expect(leftPaneTabLabels.playlists).toBe("Playlists");
  expect(leftPaneTabLabels.collections).toBe("Collections");
});

test("MiddlePanePanel type covers add-source panel", () => {
  const panels: readonly MiddlePanePanel[] = ["add-source"];

  expect(panels).toHaveLength(1);
});

test("ViewerMode type covers content and settings", () => {
  const modes: readonly ViewerMode[] = ["content", "settings"];

  expect(modes).toHaveLength(2);
});

test("free-drag clamp bounds and toDesktopColumnTemplate produce valid grid templates", () => {
  expect(defaultLeftFraction).toBe(0.16);
  expect(defaultMiddleFraction).toBe(0.30);
  expect(minLeftFraction).toBe(0.10);
  expect(minMiddleFraction).toBe(0.18);
  expect(minRightFraction).toBe(0.36);

  // clampLeftFraction floors at minLeftFraction and ceilings at 1 - middle - minRightFraction
  expect(clampLeftFraction(0.05, 0.30)).toBe(minLeftFraction);
  expect(clampLeftFraction(0.60, 0.30)).toBe(1 - 0.30 - minRightFraction);
  expect(clampLeftFraction(0.16, 0.30)).toBe(0.16);

  // clampMiddleFraction floors at minMiddleFraction and ceilings at 1 - left - minRightFraction
  expect(clampMiddleFraction(0.10, 0.16)).toBe(minMiddleFraction);
  expect(clampMiddleFraction(0.60, 0.16)).toBe(1 - 0.16 - minRightFraction);
  expect(clampMiddleFraction(0.30, 0.16)).toBe(0.30);

  expect(toDesktopColumnTemplate(1, 3, 8)).toBe("1fr 3fr 8fr");
  expect(toDesktopColumnTemplate(0.08, 0.24, 0.68)).toBe("0.08fr 0.24fr 0.68fr");
});

test("pane resize is pure free-drag with no snap points and persists on drag end", async () => {
  const source = await readAppShellSource();

  expect(source).not.toContain("findNearestSnap");
  expect(source).not.toContain("leftPaneSnapFractions");
  expect(source).not.toContain("middlePaneSnapFractions");
  expect(source).toContain("const commitLeftResize = () => {");
  expect(source).toContain("const commitMiddleResize = () => {");
  expect(source).toContain("clampLeftFraction(leftFraction(), middleFraction())");
  expect(source).toContain("clampMiddleFraction(middleFraction(), leftFraction())");
  expect(source).toContain("onDragEnd={commitLeftResize}");
  expect(source).toContain("onDragEnd={commitMiddleResize}");
  expect(source).toContain("persistPaneWidths(clamped, middleFraction())");
  expect(source).toContain("persistPaneWidths(leftFraction(), clamped)");
});

test("collapsible content controls use aria-expanded and auto-collapse on middle pane panel", async () => {
  const source = await readAppShellSource();

  expect(source).toContain("const [controlsExpanded, setControlsExpanded] = createSignal(false)");
  expect(source).toContain("aria-expanded={controlsExpanded() ? \"true\" : \"false\"}");
  expect(source).toContain("if (props.middlePanePanel() !== null) {\n      setControlsExpanded(false);\n    }");
});

test("middle pane panels render add-source without refresh panel", async () => {
  const source = await readAppShellSource();

  expect(source).toContain("data-middle-pane-panel=\"add-source\"");
  expect(source).not.toContain("data-middle-pane-panel=\"refresh\"");
  expect(source).toContain("<AddSourceSection");
  expect(source).not.toContain("<RefreshStatusSection");
});

test("settings viewer takeover has back button and data-settings-viewer attribute", async () => {
  const source = await readAppShellSource();

  expect(source).toContain("data-settings-viewer");
  expect(source).toContain("aria-label=\"Close settings\"");
  expect(source).toContain("props.onCloseSettings");
  expect(source).toContain("() => setViewerMode(\"settings\")");
  expect(source).toContain("() => setViewerMode(\"content\")");
});

test("pane widths are persisted to localStorage with stable key", () => {
  expect(paneWidthsLocalStorageKey).toBe("feedelity.pane-widths");
});

test("shell layout persists the last mode and reopens it once on mount without trapping the catalog (F7)", async () => {
  const shellRouteSource = await Bun.file(new URL("../routes/_shell.tsx", import.meta.url)).text();
  const indexRouteSource = await Bun.file(new URL("../routes/_shell.index.tsx", import.meta.url)).text();
  const dashboardRouteSource = await Bun.file(new URL("../routes/_shell.dashboard.tsx", import.meta.url)).text();

  // The layout records the pathname-derived mode on every change.
  expect(shellRouteSource).toContain("createEffect(() => {");
  expect(shellRouteSource).toContain("persistLocalValue(shellModeLocalStorageKey, mode());");
  // "/" is the catalog and must always be reachable (header Catalog link,
  // logo, `g c` shortcut): the index route carries no redirect of its own.
  expect(indexRouteSource).toContain('createFileRoute("/_shell/")');
  expect(indexRouteSource).not.toContain("beforeLoad");
  // The one-time "reopen the last section" redirect lives in the shell layout,
  // which stays mounted across child navigations, and runs at most once per
  // app mount: gated on a resolved session AND a persisted library mode AND
  // not already being on a /dashboard route, with replace so Back leaves the
  // pre-redirect history entry instead of re-entering the redirect.
  expect(shellRouteSource).toContain("let didInitialSectionRedirect = false;");
  expect(shellRouteSource).toContain("const session = await authClient.getSession();");
  // The redirect reads a synchronous setup-time snapshot of the persisted
  // mode, not storage: the persistence effect writes the pathname-derived
  // mode (at "/" that is "catalog") at mount, long before the redirect's
  // async session check resolves, so re-reading storage inside the redirect
  // would always observe the clobbered value and reopen-last-section would
  // never fire for users who open the app on "/".
  const snapshotDeclaration = 'const persistedInitialMode = toPersistedShellMode(readPersistedLocalValue(shellModeLocalStorageKey));';
  expect(shellRouteSource).toContain(snapshotDeclaration);
  expect(shellRouteSource).toContain('persistedInitialMode === "library"');
  const snapshotIndex = shellRouteSource.indexOf(snapshotDeclaration);
  const persistenceEffectIndex = shellRouteSource.indexOf("createEffect(() => {");
  expect(snapshotIndex).toBeGreaterThanOrEqual(0);
  expect(persistenceEffectIndex).toBeGreaterThan(snapshotIndex);
  // The guard tolerates any /dashboard route (not just the exact path) so
  // future nested dashboard routes stay intact.
  expect(shellRouteSource).toContain('!location().pathname.startsWith("/dashboard")');
  expect(shellRouteSource).toContain('navigate({ to: "/dashboard", replace: true });');
  // The dashboard guard is unchanged: anonymous users go to login.
  expect(dashboardRouteSource).toContain('to: "/login",');
});

test("left-pane tab and creator source filter persist through single mutations (F7)", async () => {
  const source = await readAppShellSource();

  // Tab: the seed evaluates the persisted value against the current auth gate,
  // every tab button routes through the persisting changeActiveTab helper, and
  // a session-resolve effect realigns the tab with the resolved auth state.
  expect(source).toContain("toPersistedLeftPaneTab(readPersistedLocalValue(leftPaneTabLocalStorageKey), isAuthenticated())");
  expect(source).toContain("setActiveTab={changeActiveTab}");
  expect(source).not.toContain("setActiveTab={setActiveTab}");
  expect(source).toContain("setActiveTab(toPersistedLeftPaneTab(readPersistedLocalValue(leftPaneTabLocalStorageKey), true));");
  expect(source).toContain("setActiveTab((current) => toPersistedLeftPaneTab(current, false));");
  // Creator filter: persisted seed and persisted shared mutation (the empty
  // string encodes "All").
  expect(source).toContain("toPersistedSourceTypeFilter(readPersistedLocalValue(creatorSourceFilterLocalStorageKey))");
  const applyFilterStart = source.indexOf("const applyCreatorSourceType = (nextSourceType: SourceType | null) => {");
  expect(applyFilterStart).toBeGreaterThanOrEqual(0);
  expect(source.slice(applyFilterStart, applyFilterStart + 300)).toContain('persistLocalValue(creatorSourceFilterLocalStorageKey, nextSourceType ?? "");');
});

test("content view mode and source filter persist through single mutations (F7)", async () => {
  const source = await readAppShellSource();

  // Persisted seeds with the auth gate applied by the parser.
  expect(source).toContain("toPersistedSourceTypeFilter(readPersistedLocalValue(contentSourceFilterLocalStorageKey))");
  expect(source).toContain("toPersistedContentViewMode(readPersistedLocalValue(contentViewModeLocalStorageKey), props.isAuthenticated(), props.mode)");
  // Persist-on-change helpers used by the view-mode buttons and the filter select.
  expect(source).toContain("persistLocalValue(contentViewModeLocalStorageKey, nextViewMode);");
  expect(source).toContain('persistLocalValue(contentSourceFilterLocalStorageKey, nextSourceType ?? "");');
  expect(source).toContain("onChange={(event) => changeSourceType(toSourceFilterValue(event.currentTarget.value))}");
  // The restore effect re-applies the persisted view mode once the session
  // resolves as authenticated; the anonymous reset stays the enforcer.
  expect(source).toContain("createEffect(on(props.isAuthenticated, (isAuthenticated) => {");
  expect(source).toContain('setViewMode(props.mode === "library" ? "subscribed" : "catalog")');
});

test("persisted UI state stays limited to the five F7 keys and search text stays ephemeral", async () => {
  const combined = await readChangedUiSource();
  const persistedKeyMatches = combined.match(/"feedelity\.[a-z.-]+"/g) ?? [];

  expect([...new Set(persistedKeyMatches)].sort()).toEqual(
    [
      "feedelity.content.source-filter",
      "feedelity.content.view-mode",
      "feedelity.creators.source-filter",
      "feedelity.hide-played",
      "feedelity.pane-widths",
      "feedelity.shell.left-tab",
      "feedelity.shell.mode",
    ].map((key) => `"${key}"`).sort(),
  );
});

test("viewer source switcher uses button group with SourceTypeIcon instead of select", async () => {
  const source = await readAppShellSource();
  const sourceIndicator = await Bun.file(new URL("./source-indicator.tsx", import.meta.url)).text();

  expect(source).toContain("<SourceTypeIcon sourceType={source.sourceType} />");
  expect(sourceIndicator).toContain("export function SourceTypeIcon");
  expect(source).toContain("role=\"group\"");
  expect(source).toContain("aria-pressed={isActive()}");
  expect(source).toContain("aria-label={source.label}");
});

test("creator list sort toggle persists a typed setting and refetches the list", async () => {
  const source = await readAppShellSource();
  const lastUpdateSetting: UserSetting = {
    id: "setting-2",
    userId: "user-1",
    key: creatorListSortSettingKey,
    valueJson: JSON.stringify("lastUpdate"),
  };

  expect(creatorListSortInputId).toBe("creator-list-sort");
  expect(creatorListSortSettingKey).toBe("creator.list.sort");
  expect(creatorListSortValues).toEqual(["name", "lastUpdate"]);
  expect(toCreatorListSortFromSettings([])).toBe("name");
  expect(toCreatorListSortFromSettings([lastUpdateSetting])).toBe("lastUpdate");
  // Invalid stored values fall back to "name" safely.
  expect(toCreatorListSortFromSettings([{ ...lastUpdateSetting, valueJson: JSON.stringify("bogus") }])).toBe("name");
  expect(toCreatorListSortFromSettings([{ ...lastUpdateSetting, valueJson: "not json" }])).toBe("name");
  // The sort control is a compact icon button that cycles exactly the two
  // approved orders; the id moved onto the trigger so selectors stay meaningful.
  expect(source).toContain("id={creatorListSortInputId}");
  expect(source).toContain('import ArrowDownAZ from "lucide-solid/icons/arrow-down-a-z";');
  expect(source).toContain('import ClockArrowDown from "lucide-solid/icons/clock-arrow-down";');
  expect(source).toContain("aria-label={creatorSortToggleLabel()}");
  expect(source).toContain("title={creatorSortToggleLabel()}");
  expect(source).toContain('"Sorted by name. Activate to sort by last video update."');
  expect(source).toContain('"Sorted by last video update. Activate to sort by name."');
  expect(source).toContain("creatorListSortValues[(creatorListSortValues.indexOf(props.creatorSort()) + 1) % creatorListSortValues.length]");
  // Anonymous browsing stays usable: the persisted control is gated on auth.
  expect(source).toContain("disabled={!props.isAuthenticated()}");
  // Changes flow through the typed settings overlay, then back into the list input.
  expect(source).toContain("const saveCreatorSortSetting = async (sort: CreatorListSort) => {");
  expect(source).toContain("await client.overlays.saveSetting({ key: creatorListSortSettingKey, value: sort });");
  expect(source).toContain("const creatorSort = createMemo(() => toCreatorListSortFromSettings(settingsValue() ?? emptyUserSettings));");
  expect(source).toContain("creatorSort={creatorSort}");
  // Sort participates in the resource key so changing it refetches the list.
  expect(source).toContain("input.sort,");
  // Sort persistence failures surface explicitly instead of being swallowed.
  expect(source).toContain("setCreatorSortError(formatError(error));");
});

test("settings expose a guarded force-refresh creator metadata action with real polling", async () => {
  const source = await readAppShellSource();

  expect(source).toContain("data-creator-metadata-refresh");
  expect(source).toContain("Force refresh creator metadata");
  expect(source).toContain("await client.creatorMetadata.start();");
  expect(source).toContain("await client.creatorMetadata.status();");
  // Mirrors the header-refresh polling pattern: setTimeout (~2.5s), no setInterval.
  expect(source).toContain("metadataPollTimer = setTimeout(() => {");
  // A concurrent run (started:false with a running status) switches straight into polling.
  expect(source).toContain("if (started.status.status === \"running\") {");
  // The button is disabled while a run is in progress.
  expect(source).toContain("disabled={metadataRefreshBusy()}");
  // Progress/result counts come from the status shape.
  expect(source).toContain("run.feedsProcessed}/${run.feedsTotal} feeds processed");
  expect(source).toContain("run.creatorsUpdatedCount} creators updated, ${run.creatorsUnchangedCount} unchanged, ${run.feedsFailedCount} feeds failed");
  // Errors surface explicitly.
  expect(source).toContain("setMetadataRefreshError(formatError(error));");
});

test("creator rows render an initials fallback avatar when no icon exists", async () => {
  const source = await readAppShellSource();

  expect(source).toContain("function creatorInitials(displayName: string): string");
  expect(source).toContain("data-creator-avatar-fallback");
  expect(source).toContain("flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-muted");
});

test("unread counts load behind an authenticated reload-keyed resource and map by creator", async () => {
  const source = await readAppShellSource();
  const unreadStart = source.indexOf("const unreadCountsResourceInput = createMemo(() => {");
  const unreadEnd = source.indexOf("const selectedCreatorId = createMemo(() => selectedCreator()?.id ?? null);");
  const unreadWiring = source.slice(unreadStart, unreadEnd);

  expect(source).toContain("client.overlays.unreadCounts()");
  // Same gating as the other overlay resources: anonymous users never fetch.
  expect(unreadWiring).toContain("if (!isAuthenticated()) {\n      return null;\n    }");
  // Keyed by subscriptionsReloadKey so subscribe/unsubscribe/refresh and both
  // mark-as-read actions (which bump it) refetch the counts.
  expect(unreadWiring).toContain("return subscriptionsReloadKey().toString();");
  expect(unreadWiring).toContain("createResource(unreadCountsResourceInput, () => client.overlays.unreadCounts())");
  // No plain resource reads on render paths: the shell only exposes a
  // .latest-backed memo and a creatorId-keyed map.
  expect(unreadWiring).toContain("const unreadCountsValue = createMemo(() => unreadCounts.latest);");
  expect(unreadWiring).toContain("unreadCountsByCreatorId.set(summary.creatorId, summary);");
  expect(unreadWiring).toContain("unreadCountsValue() ?? emptyCreatorUnreadSummaries");
  expect(source).toContain("const emptyCreatorUnreadSummaries: readonly CreatorUnreadSummary[] = [];");
  expect(source).toContain("unreadByCreatorId={unreadByCreatorId}");
});

test("creator rows show a compact unread badge only with a positive library count", async () => {
  const source = await readAppShellSource();

  expect(source).toContain("readonly unreadCount?: () => number | null;");
  expect(source).toContain("const unreadCount = createMemo(() => props.unreadCount?.() ?? null);");
  // Hidden when 0 or null: the badge render is gated on the positive-count memo.
  expect(source).toContain("const showUnreadBadge = createMemo(() => {");
  expect(source).toContain("return count !== null && count > 0;");
  expect(source).toContain("<Show when={showUnreadBadge()}>");
  expect(source).toContain("data-creator-unread-count");
  expect(source).toContain("rounded-full border border-border bg-muted px-1.5 py-0.5 text-[0.62rem] font-semibold tabular-nums text-muted-foreground");
  // The badge sits after the display name and before the source icons row.
  const badgeIndex = source.indexOf("data-creator-unread-count");
  const nameIndex = source.indexOf('{props.creator.displayName}');
  const iconsIndex = source.indexOf('data-creator-source-badges');
  expect(badgeIndex).toBeGreaterThan(nameIndex);
  expect(badgeIndex).toBeLessThan(iconsIndex);
  // The column passes a live accessor only in library mode for authenticated
  // users; catalog and anonymous rows always read a null count.
  expect(source).toContain('const libraryUnreadEnabled = createMemo(() => props.mode === "library" && props.isAuthenticated());');
  expect(source).toContain("unreadCount={() => (libraryUnreadEnabled() ? unreadCountForCreator(creator.id) : null)}");
});

test("mark-as-read affordances call protected overlay procedures and reload counts", async () => {
  const source = await readAppShellSource();
  const markCreatorStart = source.indexOf("const markCreatorRead = async (creatorId: string) => {");
  const markAllEnd = source.indexOf("const refreshProgressText = createMemo(() => {");
  const markActions = source.slice(markCreatorStart, markAllEnd);

  expect(markActions).toContain("await client.overlays.markCreatorContentOpened({ creatorId });");
  expect(markActions).toContain("await client.overlays.markAllContentOpened();");
  // Both actions refetch counts through the shared reload-key bump (the same
  // onSubscriptionsChanged channel the subscription actions use).
  expect(markActions).toContain("props.onSubscriptionsChanged();");
  expect(markActions).toContain("setMarkReadError(formatError(error));");
  expect(markActions).toContain("if (!props.isAuthenticated() || markReadBusyCreatorId() !== null || markAllReadBusy()) {");
  expect(markActions).toContain("if (!props.isAuthenticated() || markAllReadBusy() || markReadBusyCreatorId() !== null) {");
  // Per-creator hover action: rendered only for unread rows, disabled in flight.
  expect(source).toContain('<Show when={showUnreadBadge() && props.onMarkCreatorRead !== undefined}>');
  expect(source).toContain("data-mark-creator-read={props.creator.id}");
  expect(source).toContain('aria-label={`Mark ${props.creator.displayName} as read`}');
  expect(source).toContain("disabled={props.markReadBusy}");
  expect(source).toContain("markReadBusy={markReadBusyCreatorId() === creator.id || markAllReadBusy()}");
  // Global control: authenticated + library + any-unread gated, disabled in flight.
  expect(source).toContain('<Show when={props.mode === "library" && hasAnyUnread()}>');
  expect(source).toContain("data-mark-all-read");
  expect(source).toContain('aria-label="Mark all sources as read"');
  expect(source).toContain("disabled={markAllReadBusy()}");
  // Errors surface through the column's destructive text pattern, not swallowed.
  expect(source).toContain('data-mark-read-error');
});

test("anonymous users and catalog mode render no unread badge or mark-all control", async () => {
  const source = await readAppShellSource();

  // Anonymous: the unread resource never fetches, so the row accessor reads a
  // null count and neither the badge nor the hover mark button can mount.
  expect(source).toContain("if (!isAuthenticated()) {\n      return null;\n    }\n\n    return subscriptionsReloadKey().toString();");
  // Catalog mode never receives a non-null unread accessor even when signed in.
  expect(source).toContain("unreadCount={() => (libraryUnreadEnabled() ? unreadCountForCreator(creator.id) : null)}");
  expect(source).toContain('props.mode === "library" && props.isAuthenticated()');
  // The global control additionally requires at least one positive count.
  expect(source).toContain('props.mode === "library" && hasAnyUnread()');
  expect(source).toContain('<Show when={showUnreadBadge() && props.onMarkCreatorRead !== undefined}>');
});

// ---------------------------------------------------------------------------
// Phase 8.2: feed health dashboard, confirm dialog, bulk unsubscribe
// ---------------------------------------------------------------------------

function healthEntry(feedId: string, overrides: Partial<FeedHealthEntry> = {}): FeedHealthEntry {
  return {
    feedId,
    feedTitle: `Feed ${feedId}`,
    feedUrl: `https://example.test/${feedId}`,
    sourceType: "youtube",
    creatorId: `creator-${feedId}`,
    creatorDisplayName: `Creator ${feedId}`,
    nextRefreshAfter: null,
    lastAttemptAt: null,
    lastSuccessAt: null,
    consecutiveFailureCount: 0,
    lastErrorSummaryJson: null,
    itemsCreatedTotal: 0,
    ...overrides,
  };
}

async function readFeedHealthDialogSource() {
  return Bun.file(new URL("./feed-health-dialog.tsx", import.meta.url)).text();
}

async function readConfirmDialogSource() {
  return Bun.file(new URL("./confirm-dialog.tsx", import.meta.url)).text();
}

test("feed health rows sort by failure streak then stalest last success (never first)", () => {
  const entries = [
    healthEntry("one-blip", { consecutiveFailureCount: 1, lastSuccessAt: new Date("2026-01-04T00:00:00.000Z") }),
    healthEntry("healthy", { consecutiveFailureCount: 0, lastSuccessAt: new Date("2026-01-04T00:00:00.000Z") }),
    healthEntry("fresh-success", { consecutiveFailureCount: 2, lastSuccessAt: new Date("2026-01-04T00:00:00.000Z") }),
    healthEntry("never-succeeded", { consecutiveFailureCount: 2 }),
    healthEntry("stale-success", { consecutiveFailureCount: 2, lastSuccessAt: new Date("2025-12-01T00:00:00.000Z") }),
  ];

  const sorted = sortFeedHealthEntries(entries);

  expect(sorted.map((entry) => entry.feedId)).toEqual([
    // 2 failures: never succeeded is the stalest, then oldest success first.
    "never-succeeded",
    "stale-success",
    "fresh-success",
    // Fewer failures rank later.
    "one-blip",
    "healthy",
  ]);
});

test("sortFeedHealthEntries breaks ties deterministically and never mutates its input", () => {
  const sameMoment = new Date("2026-01-04T00:00:00.000Z");
  const entries = [
    healthEntry("zeta", { consecutiveFailureCount: 3, lastSuccessAt: sameMoment }),
    healthEntry("alpha", { consecutiveFailureCount: 3, lastSuccessAt: sameMoment }),
  ];

  const sorted = sortFeedHealthEntries(entries);

  // Equal failure count and equal last success falls back to feed URL order.
  expect(sorted.map((entry) => entry.feedId)).toEqual(["alpha", "zeta"]);
  expect(sortFeedHealthEntries([])).toEqual([]);

  const inputOrder = ["zeta", "alpha"];
  expect(entries.map((entry) => entry.feedId)).toEqual(inputOrder);
});

test("formatFeedHealthLastSuccess reads never, today, and whole-day ages", () => {
  const now = new Date("2026-08-30T12:00:00.000Z");

  expect(formatFeedHealthLastSuccess(null, now)).toBe("never");
  expect(formatFeedHealthLastSuccess(new Date("2026-08-30T06:00:00.000Z"), now)).toBe("today");
  expect(formatFeedHealthLastSuccess(new Date("2026-08-28T12:00:00.000Z"), now)).toBe("2d ago");
  expect(formatFeedHealthLastSuccess(new Date("2026-08-23T00:00:00.000Z"), now)).toBe("7d ago");
});

test("feed health dialog renders sorted rows from the fetched health payload", async () => {
  const source = await readFeedHealthDialogSource();
  const shellSource = await readAppShellSource();

  // Data arrives via props from the parent resource and is sorted in-dialog.
  expect(source).toContain("const sortedEntries = createMemo(() => sortFeedHealthEntries(props.entries));");
  expect(source).toContain("<For each={sortedEntries()}>");
  // Row contract: identity, creator, feed link, source chip, status pill.
  expect(source).toContain('data-feed-health-row={entry.feedId}');
  expect(source).toContain('data-feed-health-row-state={isFailing ? "failing" : "healthy"}');
  expect(source).toContain('data-feed-health-row-creator');
  expect(source).toContain('<SourceIconBadge sourceType={entry.sourceType} context="feed" />');
  expect(source).toContain('data-feed-health-row-title');
  expect(source).toContain('data-feed-health-row-url');
  expect(source).toContain('target="_blank"');
  // Health facts: last-success age, failure streak, parsed last error.
  expect(source).toContain("formatFeedHealthLastSuccess(entry.lastSuccessAt, healthNow())");
  expect(source).toContain('data-feed-health-row-last-success');
  expect(source).toContain('data-feed-health-row-failure-count');
  expect(source).toContain("<TriangleAlert");
  expect(source).toContain("parseRefreshErrorSummaries(entry.lastErrorSummaryJson)");
  expect(source).toContain('data-feed-health-row-error');
  expect(source).toContain("{formatRefreshErrorCodeLabel(error.code)}.");
  // Native dialog modeled on RefreshStatusDialog.
  expect(source).toContain("<dialog");
  expect(source).toContain('aria-label="Feed health"');

  // The shell fetches health only while the dialog is open, authenticated.
  expect(shellSource).toContain("const [feedHealth] = createResource(feedHealthResourceInput, () => client.overlays.feedHealth({}));");
  expect(shellSource).toContain("if (!props.isAuthenticated() || !feedHealthOpen()) {");
  expect(shellSource).toContain("entries={feedHealthEntries()}");
  expect(shellSource).toContain("loading={feedHealth.loading}");
  expect(shellSource).toContain("onClose={() => setFeedHealthOpen(false)}");
});

test("destructive unsubscribe actions require the confirm dialog before any client call", async () => {
  const source = await readFeedHealthDialogSource();
  const confirmSource = await readConfirmDialogSource();
  const shellSource = await readAppShellSource();

  // Confirm dialog contract: open/onConfirm/onCancel props, destructive confirm
  // button, cancel button, data attributes.
  expect(confirmSource).toContain("data-confirm-dialog");
  expect(confirmSource).toContain('data-confirm-dialog-title');
  expect(confirmSource).toContain('data-confirm-dialog-body');
  expect(confirmSource).toContain("data-confirm-dialog-cancel");
  expect(confirmSource).toContain("data-confirm-dialog-confirm");
  expect(confirmSource).toContain("onClick={() => props.onCancel()}");
  expect(confirmSource).toContain("onClick={() => props.onConfirm()}");
  expect(confirmSource).toContain("bg-destructive");

  // Row + bulk buttons only STAGE the confirm intent.
  expect(source).toContain("onClick={() => stageCreatorUnsubscribe(entry)}");
  expect(source).toContain("onClick={() => stageFailedCreatorsUnsubscribe()}");
  const stageCreatorStart = source.indexOf("const stageCreatorUnsubscribe =");
  const stageBulkStart = source.indexOf("const stageFailedCreatorsUnsubscribe =");
  const confirmHandlerStart = source.indexOf("const confirmPendingUnsubscribe =");
  expect(source.slice(stageCreatorStart, stageBulkStart)).not.toContain("props.onUnsubscribeCreators");
  expect(source.slice(stageBulkStart, confirmHandlerStart)).not.toContain("props.onUnsubscribeCreators");

  // The ONLY path to the destructive call consumes the pending intent first.
  const forwardCallIndex = source.indexOf("props.onUnsubscribeCreators(pending.creatorIds);");
  const pendingClearIndex = source.indexOf("setPendingUnsubscribe(null);", confirmHandlerStart);
  expect(confirmHandlerStart).toBeGreaterThan(-1);
  expect(pendingClearIndex).toBeGreaterThan(-1);
  expect(forwardCallIndex).toBeGreaterThan(pendingClearIndex);

  // Cancel fires nothing: it only clears the pending intent.
  expect(source).toContain("onCancel={() => setPendingUnsubscribe(null)}");
  expect(source).toContain("open={pendingUnsubscribe() !== null}");

  // The shell performs the bulkUnsubscribe call exactly once, inside the
  // handler the dialog can only reach post-confirm, and reloads overlays plus
  // health rows on success.
  expect(shellSource.split("client.overlays.bulkUnsubscribe")).toHaveLength(2);
  const shellHandlerStart = shellSource.indexOf("const unsubscribeHealthCreators = async (creatorIds: readonly string[]) => {");
  const shellHandlerEnd = shellSource.indexOf("const feedListInput = createMemo", shellHandlerStart);
  const shellHandler = shellSource.slice(shellHandlerStart, shellHandlerEnd);
  expect(shellHandler).toContain("await client.overlays.bulkUnsubscribe({ creatorIds: [...creatorIds] });");
  expect(shellHandler).toContain("props.onSubscriptionsChanged();");
  expect(shellHandler).toContain("setFeedHealthReloadKey((key) => key + 1);");
  expect(shellHandler).toContain("setFeedHealthActionError(formatError(error));");
  expect(shellSource).toContain("onUnsubscribeCreators={unsubscribeHealthCreators}");

  // No native window.confirm escape hatch anywhere in the UI sources.
  const uiSources = await readChangedUiSource();
  expect(uiSources).not.toContain("window.confirm");
});

test("feed health trigger is authenticated-only beside the refresh status dialog mount", async () => {
  const source = await readAppShellSource();

  const regionStart = source.indexOf('class={sourceActionsRegionClass} data-source-actions-region');
  const regionEnd = source.indexOf("</section>", regionStart);
  expect(regionStart).toBeGreaterThan(-1);
  const actionsRegion = source.slice(regionStart, regionEnd);

  expect(actionsRegion).toContain("<RefreshStatusDialog");
  expect(source.indexOf("<FeedHealthDialog")).toBeGreaterThan(source.indexOf("<RefreshStatusDialog"));
  // Trigger: authenticated-only, opens the health dialog.
  expect(actionsRegion).toContain("<Show when={props.isAuthenticated()}>");
  expect(actionsRegion).toContain("data-feed-health-trigger");
  expect(actionsRegion).toContain("onClick={() => setFeedHealthOpen(true)}");
  expect(actionsRegion).toContain("<FeedHealthDialog");
});
