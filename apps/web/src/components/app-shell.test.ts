import { expect, test } from "bun:test";
import type { CatalogContentSource, CatalogFeed, RefreshFeedResult, RefreshRun, RefreshRunReport, UserSetting } from "@FeedElity/api";
import type { LeftPaneTab, MiddlePanePanel, ViewerMode } from "./app-shell.contract";

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
  defaultLeftFraction,
  defaultMiddleFraction,
  desktopShellGridClass,
  feedListLimit,
  firstPageOffset,
  formatRefreshReportSummary,
  formatRefreshRunSummary,
  formatSettingValue,
  hidePlayedLocalStorageKey,
  parseRefreshErrorSummaries,
  getShellColumnCount,
  hasInternalAppHeader,
  joinFeedResultsWithFeeds,
  leftPaneTabLabels,
  minLeftFraction,
  minMiddleFraction,
  minRightFraction,
  paneWidthsLocalStorageKey,
  clampLeftFraction,
  clampMiddleFraction,
  playlistDescriptionInputId,
  playlistNameInputId,
  playlistSortInputId,
  collectionNameInputId,
  collectionDescriptionInputId,
  collectionMemberSearchInputId,
  readerDensityInputId,
  readerDensitySettingKey,
  readerDensityValues,
  refreshStatusRegionId,
  settingKeyInputId,
  settingKeyPattern,
  settingValueInputId,
  shellGridClass,
  shellColumns,
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
  toDesktopColumnTemplate,
  toFeedListInput,
  toPlayableSources,
  toReaderDensityFromSettings,
  toSafePlaybackUrl,
  toShellContentSelectionState,
  toCreatorListInput,
  toShellSelectionState,
  viewerColumnClass,
  viewerScrollRegionClass,
} from "./app-shell.contract";

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

  expect(source).toContain("const [appSession] = createResource(appSessionResourceInput, () => client.session.current())");
  expect(source).toContain("appSession.latest !== null && appSession.latest !== undefined");
  expect(source).toContain('props.isAuthenticated() && props.mode === "library"');
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
  expect(toCreatorListInput("   ")).toEqual({ limit: creatorListLimit, offset: firstPageOffset });
  expect(toCreatorListInput("   ", "youtube")).toEqual({ sourceType: "youtube", limit: creatorListLimit, offset: firstPageOffset });
  expect(toCreatorListInput("  alpha creator  ")).toEqual({ search: "alpha creator", limit: creatorListLimit, offset: firstPageOffset });
  expect(toCreatorListInput("  alpha creator  ", "peertube")).toEqual({
    search: "alpha creator",
    sourceType: "peertube",
    limit: creatorListLimit,
    offset: firstPageOffset,
  });
  expect(toCreatorListInput("next", null, 50)).toEqual({ search: "next", limit: creatorListLimit, offset: 50 });
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

  expect(source).toContain("const [sourceType, setSourceType] = createSignal<SourceType | null>(null)");
  expect(source).toContain("() => toCreatorListInput(search(), sourceType())");
  expect(source).toContain(`id={creatorSourceFilterId}`);
  expect(source).toContain(`aria-label="Creator source-type filter"`);
  expect(source).toContain(`title="Filters creator rows by catalog source type. Select a creator to inspect all feeds."`);
  expect(source).toContain("creator.sourceType === sourceType()");
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
  expect(source).toContain("onChange={(event) => setSourceType(toSourceFilterValue(event.currentTarget.value))}");
  expect(source).toContain("selected={() => props.selectedContentItemId() === contentItem.id}");
  expect(source).toContain("data-selected-content-item-id={selectedContentItemId() ?? \"\"}");
});

test("content filters are Solid state backed and avoid class-name filtering", async () => {
  const source = await readAppShellSource();
  const forbiddenDomFilteringSnippets = [
    "querySelector",
    "getElementsByClassName",
    "classList",
    "dataset.sourceType",
    "data-source-type",
    "hidden =",
  ];

  expect(source).toContain("const [search, setSearch] = createSignal(\"\")");
  expect(source).toContain("const [sourceType, setSourceType] = createSignal<SourceType | null>(null)");
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
  expect(source).toContain("<ContentDetailBody detail={detail()} />");
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
  const bodyIndex = source.indexOf("<ContentDetailBody detail={detail()} />");

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
  ]);
});

test("selected viewer supports source switching and real playback render contracts", async () => {
  const source = await readAppShellSource();

  expect(source).toContain("id=\"viewer-source-switcher\"");
  expect(source).toContain("onClick={() => setSelectedSourceId(source.id)}");
  expect(source).toContain("<iframe");
  expect(source).toContain("src={props.source?.url ?? \"\"}");
  expect(source).toContain("<video class=\"h-full w-full\" src={props.source?.url ?? \"\"} controls preload=\"metadata\" onPlay={props.onNativePlay}>");
});

test("native video playback marks selected content played after authenticated guard", async () => {
  const source = await readAppShellSource();

  expect(source).toContain("onNativePlay={autoMarkSelectedContentPlayed}");
  expect(source).toContain("readonly onNativePlay: () => Promise<void>;");
  expect(source).toContain("onPlay={props.onNativePlay}");
  expect(source).toContain("const autoMarkSelectedContentPlayed = async () => {");
  expect(source).toContain("if (!props.isAuthenticated() || contentItemId === null) {\n      return;\n    }\n\n    setStatusActionError(null);\n    try {");
  expect(source).toContain("await props.onAutoMarkContentPlayed(contentItemId);");
  expect(source).toContain("const autoMarkContentPlayed = async (contentItemId: string) => {");
  expect(source).toContain("const result = await client.overlays.markContentPlayed({ contentItemId });");
  expect(source).toContain("if (result.status !== null) {\n      patchContentStatus(result.status);\n      setStatusReloadKey((key) => key + 1);\n    }");
});

test("iframe playback has explicit real mark played workflow", async () => {
  const source = await readAppShellSource();

  expect(source).toContain("<iframe");
  expect(source).toContain("aria-label={selectedContentStatus().played ? \"Unmark played\" : \"Mark played\"}");
  expect(source).toContain("await props.onMarkContentPlayed(contentItemId);");
  expect(source).toContain("await client.overlays.toggleContentPlayed({ contentItemId });");
  expect(source).toContain("onClick={toggleSelectedContentPlayed}");
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
  expect(source).toContain("appSession.latest !== null && appSession.latest !== undefined");
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
  expect(source).toContain("const readerDensity = createMemo(() => toReaderDensityFromSettings(settings() ?? emptyUserSettings));");
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

test("favorites view is an authenticated content-pane filter using protected procedures", async () => {
  const source = await readAppShellSource();

  expect(contentViewModeAllId).toBe("content-view-all");
  expect(contentViewModeFavoritesId).toBe("content-view-favorites");
  expect(contentViewModeHistoryId).toBe("content-view-history");
  expect(contentViewModePlayedId).toBe("content-view-played");
  expect(source).toContain("const [viewMode, setViewMode] = createSignal<ContentViewMode>(props.mode === \"library\" ? \"subscribed\" : \"catalog\")");
  expect(source).toContain("<Show when={props.isAuthenticated()}>\n            <div class=\"mt-2 grid grid-cols-4 gap-2\" aria-label=\"Content view\">");  expect(source).toContain("return client.overlays.favoriteContentItems()");
  expect(source).toContain("return client.catalog.contentItems(input)");
  expect(source).toContain("setViewMode(\"favorites\")");
  expect(source).toContain("setViewMode(\"history-opened\")");
  expect(source).toContain("setViewMode(\"played\")");
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
  expect(source).toContain("<For each={displayedContentItems()}>");
  expect(source).not.toContain("querySelector");
  expect(source).not.toContain("classList");
  expect(source).not.toContain("hidden =");
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
  expect(source).toContain("const [statusReloadKey, setStatusReloadKey] = createSignal(0);");
  expect(source).toContain("statusReloadKey={statusReloadKey}");
  expect(source).toContain("return `${contentItemId}\\u001f${props.favoritesReloadKey().toString()}`;");
  expect(source).not.toContain("statusReloadKey={() => 0}");
  expect(source).not.toContain("return { mode: \"catalog\", input: contentListInput(), reloadKey: props.catalogReloadKey() }");
  expect(source).not.toContain("return { mode: \"subscribed\", input: contentListInput(), reloadKey: props.catalogReloadKey() }");
  expect(source).not.toContain("return { contentItemId, reloadKey: props.favoritesReloadKey() }");
  expect(source).not.toContain("return { reloadKey: statusReloadKey() };");
});

test("mobile navigation adds no timers observers or unstable resource source objects", async () => {
  const source = await readAppShellSource();

  expect(source).not.toContain("IntersectionObserver");
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
  expect(source).toContain("settings={() => settings() ?? emptyUserSettings}");
  expect(source).toContain("contentStatuses={() => contentStatuses() ?? emptyUserContentStatuses}");
  expect(source).toContain("playlists() ?? emptyPlaylists");
  expect(source).toContain("contentDetail.latest?.sources ?? emptyCatalogContentSources");
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
  const indexRoute = await Bun.file(new URL("../routes/index.tsx", import.meta.url)).text();
  const dashboardRoute = await Bun.file(new URL("../routes/dashboard.tsx", import.meta.url)).text();
  const headerSource = await Bun.file(new URL("./header.tsx", import.meta.url)).text();

  expect(indexRoute).toContain('<AppShell mode="catalog" />');
  expect(dashboardRoute).toContain('<AppShell mode="library" />');
  expect(dashboardRoute).toContain('createFileRoute("/dashboard")');
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
  expect(source).toContain("if (mode === \"library\") {\n              await client.overlays.subscribeToCreator({ creatorId: value.creator.id });\n            }");
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

test("viewer source switcher uses button group with SourceTypeIcon instead of select", async () => {
  const source = await readAppShellSource();
  const sourceIndicator = await Bun.file(new URL("./source-indicator.tsx", import.meta.url)).text();

  expect(source).toContain("<SourceTypeIcon sourceType={source.sourceType} />");
  expect(sourceIndicator).toContain("export function SourceTypeIcon");
  expect(source).toContain("role=\"group\"");
  expect(source).toContain("aria-pressed={isActive()}");
  expect(source).toContain("aria-label={source.label}");
});
