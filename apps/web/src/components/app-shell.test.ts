import { expect, test } from "bun:test";
import type { CatalogContentSource, RefreshRun, RefreshRunReport, UserSetting } from "@FeedElity/api";

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
  desktopShellGridClass,
  feedListLimit,
  firstPageOffset,
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
  toFeedListInput,
  toPlayableSources,
  toReaderDensityFromSettings,
  toRefreshStatusResourceKey,
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

test("shell exposes the required three-pane RSS reader contract", () => {
  expect(getShellColumnCount()).toBe(3);
  expect(shellColumns.map((column) => column.id)).toEqual([...shellPaneIds]);
  expect(shellColumns.map((column) => column.title)).toEqual(["Sources", "Feed", "Viewer"]);
  expect(desktopShellGridClass).toBe("lg:grid-cols-[1fr_3fr_8fr]");
});

test("shell renders exactly three top-level pane sections", async () => {
  const source = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();
  const paneMatches = source.match(/data-shell-column=/g) ?? [];

  expect(paneMatches).toHaveLength(3);
  expect(source).toContain('data-shell-column="creators"');
  expect(source).toContain('data-shell-column="content"');
  expect(source).toContain('data-shell-column="viewer"');
  expect(shellGridClass).toContain("lg:grid-cols-[1fr_3fr_8fr]");
});

test("shell panes use the base responsive column classes without mobile pane state", async () => {
  const source = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();

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
  expect(desktopShellGridClass).toBe("lg:grid-cols-[1fr_3fr_8fr]");
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
  const source = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();

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
  const source = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();
  const paneMatches = source.match(/data-shell-column=/g) ?? [];
  const forbiddenControls = [
    "data-shell-column=\"settings\"",
    "data-shell-column=\"playlists\"",
    "data-shell-column=\"actions\"",
    "data-shell-column=\"sources-actions\"",
    "<dialog",
    "role=\"dialog\"",
    "Add subscription",
    "Batch add",
    "topics",
    "external-content",
  ];

  expect(paneMatches).toHaveLength(3);
  for (const snippet of forbiddenControls) {
    expect(source).not.toContain(snippet);
  }
});

test("primary navigation preserves anonymous catalog access and authenticated workspace entry", async () => {
  const source = await Bun.file(new URL("./header.tsx", import.meta.url)).text();

  expect(source).toContain('{ to: "/", label: "Catalog", helper: "Browse" }');
  expect(source).toContain('{ to: "/dashboard", label: "Library", helper: "Saved" }');
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
  expect(toContentListInput("   ", null, null, null)).toEqual({ limit: contentListLimit, offset: firstPageOffset });
  expect(toContentListInput("   ", null, "feed-1", null)).toEqual({ feedId: "feed-1", limit: contentListLimit, offset: firstPageOffset });
  expect(toContentListInput(" livestream ", null, null, "peertube")).toEqual({
    search: "livestream",
    sourceType: "peertube",
    limit: contentListLimit,
    offset: firstPageOffset,
  });
  expect(toContentListInput(" documentary ", "creator-2", null, null)).toEqual({
    search: "documentary",
    creatorId: "creator-2",
    limit: contentListLimit,
    offset: firstPageOffset,
  });
  expect(toContentListInput("  matrix  ", "creator-1", "feed-2", "youtube")).toEqual({
    search: "matrix",
    creatorId: "creator-1",
    feedId: "feed-2",
    sourceType: "youtube",
    limit: contentListLimit,
    offset: firstPageOffset,
  });
  expect(toContentListInput("more", null, null, null, 100)).toEqual({ search: "more", limit: contentListLimit, offset: 100 });
});

test("content selection updates shell state contract", () => {
  expect(toShellContentSelectionState(null, null)).toEqual({ selectedCreatorId: null, selectedContentItemId: null });
  expect(toShellContentSelectionState("creator-1", "content-1")).toEqual({
    selectedCreatorId: "creator-1",
    selectedContentItemId: "content-1",
  });
});

test("creator pane is wired to anonymous catalog creators and feeds", async () => {
  const source = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();

  expect(source).toContain("client.catalog.creators(untrack(creatorListInput))");
  expect(source).toContain("return input === null ? emptyCatalogFeeds : client.catalog.feeds(input);");
  expect(source).toContain("type=\"search\"");
  expect(source).toContain("isSelected={props.selectedCreatorId() === creator.id}");
  expect(source).toContain("aria-pressed={props.isSelected}");
  expect(source).toContain("data-selected-creator-id={props.selectedCreator()?.id ?? \"\"}");
});

test("creator source-type filter scopes the creator list without changing playback source switching", async () => {
  const source = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();

  expect(source).toContain("const [sourceType, setSourceType] = createSignal<SourceType | null>(null)");
  expect(source).toContain("() => toCreatorListInput(search(), sourceType())");
  expect(source).toContain(`id={creatorSourceFilterId}`);
  expect(source).toContain(`aria-label="Creator source-type filter"`);
  expect(source).toContain(`title="Filters creator rows by catalog source type. Select a creator to inspect all feeds."`);
  expect(source).toContain("creator.sourceType === sourceType()");
  expect(source).toContain("id=\"viewer-source-switcher\"");
  expect(source).toContain("onChange={(event) => setSelectedSourceId(event.currentTarget.value)}");
});

test("selected feed is explicit and shapes catalog content input", async () => {
  const source = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();

  expect(source).toContain("const [selectedFeed, setSelectedFeed] = createSignal<CatalogFeed | null>(null)");
  expect(source).toContain("const selectFeed = (feed: CatalogFeed | null) => {");
  expect(source).toContain("setSelectedFeed(feed);");
  expect(source).toContain("data-selected-feed-id={selected() ? props.feed.id : \"\"}");
  expect(source).toContain("data-selected-feed-id={props.selectedFeed()?.id ?? \"\"}");
  expect(source).toContain("props.selectedFeed()?.id ?? null");
  expect(source).toContain("Selected feed");
  expect(source).toContain("Filter feed");
});

test("feed selection exposes real protected feed refresh controls", async () => {
  const source = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();

  expect(toRefreshStatusResourceKey(false, 0)).toBeNull();
  expect(toRefreshStatusResourceKey(true, 0)).toBe(0);
  expect(toRefreshStatusResourceKey(true, 3)).toBe(3);
  expect(source).toContain("selectedFeed={props.selectedFeed}");
  expect(source).toContain("onRefreshCompleted={async () => {");
  expect(source).toContain("const statusResourceKey = createMemo(() => toRefreshStatusResourceKey(props.isAuthenticated(), reloadKey()))");
  expect(source).toContain("createResource(\n    statusResourceKey,");
  expect(source).toContain("const runFeedRefresh = async (force: boolean) => {");
  expect(source).toContain("client.refresh.runFeed({ feedId: feed.id, force })");
  expect(source).toContain("disabled={busyAction() !== null || props.selectedFeed() === null}");
  expect(source).toContain("Normal feed");
  expect(source).toContain("Force feed");
  expect(source).toContain("Force refresh the selected feed now?");
});

test("feed rows expose selected state icon source metadata and real creator images only", async () => {
  const source = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();

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
  const source = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();

  expect(showsCatalogFilters("catalog")).toBe(true);
  expect(showsCatalogFilters("subscribed")).toBe(true);
  expect(showsCatalogFilters("favorites")).toBe(false);
  expect(showsCatalogFilters("history-opened")).toBe(false);
  expect(showsCatalogFilters("played")).toBe(false);
  expect(source).toContain("return client.catalog.contentItems(input)");
  expect(source).toContain("toContentListInput(search(), props.selectedCreator()?.id ?? null, props.selectedFeed()?.id ?? null, sourceType())");
  expect(source).toContain("type=\"search\"");
  expect(source).toContain("id={contentSourceFilterId}");
  expect(source).toContain("<Show when={showsCatalogFilters(viewMode()) || (props.isAuthenticated() && (viewMode() === \"favorites\" || viewMode() === \"history-opened\" || viewMode() === \"played\"))}>");
  expect(source).toContain("aria-label={visibleFiltersLabel()}");
  expect(source).toContain("onInput={(event) => setSearch(event.currentTarget.value)}");
  expect(source).toContain("onChange={(event) => setSourceType(toSourceFilterValue(event.currentTarget.value))}");
  expect(source).toContain("selected={props.selectedContentItemId() === contentItem.id}");
  expect(source).toContain("data-selected-content-item-id={selectedContentItemId() ?? \"\"}");
});

test("content filters are Solid state backed and avoid class-name filtering", async () => {
  const source = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();
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
  expect(source).toContain("toContentListInput(search(), props.selectedCreator()?.id ?? null, props.selectedFeed()?.id ?? null, sourceType())");

  for (const snippet of forbiddenDomFilteringSnippets) {
    expect(source).not.toContain(snippet);
  }
});

test("content list exposes no no-op filter controls", async () => {
  const source = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();
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
  expect(source).toContain("setHidePlayed(event.currentTarget.checked)");
  expect(source).not.toContain(`${"played"} only`);
});

test("refresh UI is wired to real API procedures without background polling", async () => {
  const source = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();

  expect(refreshStatusRegionId).toBe("refresh-status-history");
  expect(source).toContain("client.refresh.status({ limit: 5, feedResultsLimit: 3 })");
  expect(source).not.toContain("props.results.slice");
  expect(source).toContain("client.refresh.runAll({ force })");
  expect(source).toContain("client.refresh.runCreator({ creatorId: creator.id, force })");
  expect(source).toContain("client.refresh.runFeed({ feedId: feed.id, force })");
  expect(source).toContain('globalThis.confirm("Force refresh all sources now?")');
  expect(source).toContain("globalThis.confirm(`Force refresh ${creator.displayName} now?`)");
  expect(source).toContain('globalThis.confirm("Force refresh the selected feed now?")');
  expect(source).toContain("Manual refresh in progress: {action().replace(\"-\", \" \")}.");
  expect(source).toContain("Manual only");
  expect(source).toContain("Sign in to run manual refreshes.");
  expect(source).toContain("disabled={busyAction() !== null || props.selectedCreator() === null}");
  expect(source).toContain("disabled={busyAction() !== null || props.selectedFeed() === null}");
  expect(source).not.toContain("setInterval");
  expect(source).not.toContain("setTimeout");
  expect(source).not.toContain("poll");
});

test("refresh results expose feed labels errors and skipped reasons", async () => {
  const source = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();
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
  expect(source).toContain("function formatFeedLabel(feed: Pick<CatalogFeed, \"title\" | \"url\">): string");
  expect(source).toContain("<RefreshReportFeedList feeds={report().feeds} />");
  expect(source).toContain("formatRefreshSkipReason(feed.skipReason)");
  expect(source).toContain("{error().message}");
  expect(source).toContain("parseRefreshFeedResultError(result.errorSummaryJson)");
  expect(source).toContain("{formatFeedLabel(result.feed)}");
});

test("refresh completion invalidates source pane resources and catalog content", async () => {
  const source = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();

  expect(source).toContain("onRefreshCompleted={async () => {");
  expect(source).toContain("await refreshSourcePaneResources();");
  expect(source).toContain("props.onCatalogChanged();");
  expect(source).toContain("return \"catalog\";");
  expect(source).toContain("return \"subscribed\";");
  expect(source).toContain("toContentItemsResourceKey(mode, contentListInput(), reloadKey)");
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
  const source = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();

  expect(addSourceInputId).toBe("creator-source-add-input");
  expect(addSourceHelpId).toBe("creator-source-add-help");
  expect(source).toContain("<AddSourceSection");
  expect(source).toContain("data-add-source-region");
  expect(source).toContain("client.ingestion.addSource({ sourceInput: trimmedSourceInput })");
  expect(source).toContain("const result: AddSourceResult = await client.ingestion.addSource");
  expect(source).toContain("await props.onSourceAdded(result.value)");
  expect(source).toContain("props.onSelectCreator(value.creator)");
  expect(source).toContain("props.onCatalogChanged()");
  expect(source).toContain("catalogReloadKey={catalogReloadKey}");
  expect(source).toContain("await refetchCreators()");
  expect(source).toContain("await refetchFeeds()");
  expect(source).toContain("Paste a creator, channel, feed, or video URL supported by the YouTube, Odysee, or PeerTube adapters.");
  expect(source).toContain("Sign in to add or subscribe to sources. Public catalog browsing stays available.");
  expect(source).not.toContain("client.ingestion.batchAddSources");
  expect(source).not.toContain("postFromFeedUrl");
  expect(source).not.toContain("document.dispatchEvent");
});

test("add source UI reports real ingestion success and failure shapes", async () => {
  const source = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();

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
  const source = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();

  expect(source).toContain("client.catalog.contentDetail({ id })");
  expect(source).toContain("const selectedContentItemId = createMemo(() => props.selectedContent()?.id ?? null)");
  expect(source).toContain("data-selected-content-item-id={selectedContentItemId() ?? \"\"}");
  expect(source).toContain("<ContentDetailBody detail={detail()} />");
  expect(source).toContain("<ContentDetailMetadata detail={detail()} playableSources={playableSources()} />");
});

test("viewer has no internal metadata aside or rejected selection bar copy", async () => {
  const source = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();

  expect(source).not.toContain("function ContentDetailAside");
  expect(source).not.toContain("<ContentDetailAside");
  expect(source).not.toContain("xl:grid-cols-[minmax(0,2fr)_minmax(16rem,1fr)]");
  expect(source).not.toContain("Select a video");
  expect(source).not.toContain("Choose a public catalog item");
});

test("selected viewer places playback before metadata in source order", async () => {
  const source = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();
  const playbackIndex = source.indexOf("<PlaybackSurface\n                  source={selectedPlayableSource()}");
  const bodyIndex = source.indexOf("<ContentDetailBody detail={detail()} />");
  const metadataIndex = source.indexOf("<ContentDetailMetadata detail={detail()} playableSources={playableSources()} />");

  expect(playbackIndex).toBeGreaterThan(-1);
  expect(bodyIndex).toBeGreaterThan(playbackIndex);
  expect(metadataIndex).toBeGreaterThan(bodyIndex);
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
  const source = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();

  expect(source).toContain("id=\"viewer-source-switcher\"");
  expect(source).toContain("onChange={(event) => setSelectedSourceId(event.currentTarget.value)}");
  expect(source).toContain("<iframe");
  expect(source).toContain("src={props.source?.url ?? \"\"}");
  expect(source).toContain("<video class=\"h-full w-full\" src={props.source?.url ?? \"\"} controls preload=\"metadata\" onPlay={props.onNativePlay}>");
});

test("native video playback marks selected content played after authenticated guard", async () => {
  const source = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();

  expect(source).toContain("onNativePlay={markSelectedContentPlayed}");
  expect(source).toContain("readonly onNativePlay: () => Promise<void>;");
  expect(source).toContain("onPlay={props.onNativePlay}");
  expect(source).toContain("const markSelectedContentPlayed = async () => {");
  expect(source).toContain("if (!props.isAuthenticated() || contentItemId === null) {\n      return;\n    }\n\n    setStatusActionBusy(\"played\");");
  expect(source).toContain("await props.onMarkContentPlayed(contentItemId);");
  expect(source).toContain("setStatusActionError(formatError(error));");
  expect(source).toContain("const markContentPlayed = async (contentItemId: string) => {");
  expect(source).toContain("if (!isAuthenticated()) {\n      return;\n    }\n\n    await client.overlays.markContentPlayed({ contentItemId });");
});

test("iframe playback has explicit real mark played workflow", async () => {
  const source = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();

  expect(source).toContain("<iframe");
  expect(source).toContain("<ContentStatusActionControls");
  expect(source).toContain("aria-label=\"Opened and played actions for selected video\"");
  expect(source).toContain("onMarkPlayed={markSelectedContentPlayed}");
  expect(source).toContain("{props.status.played ? \"Played\" : \"Mark played\"}");
  expect(source).toContain("await props.onMarkContentPlayed(contentItemId);");
  expect(source).toContain("await client.overlays.markContentPlayed({ contentItemId });");
});

test("anonymous users never call protected played procedure from viewer or playback", async () => {
  const source = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();

  expect(source).toContain("<Show when={props.isAuthenticated()}>\n                  <Show when={props.statusSelectionError()}");
  expect(source).toContain("if (!props.isAuthenticated() || contentItemId === null) {\n      return null;\n    }");
  expect(source).toContain("const markContentPlayed = async (contentItemId: string) => {");
  expect(source).toContain("if (!isAuthenticated()) {\n      return;\n    }\n\n    await client.overlays.markContentPlayed({ contentItemId });");
  expect(source).not.toContain("Sign in to mark played");
  expect(source).not.toContain("Login to mark played");
});

test("playlist controls are protected behind authenticated session state", async () => {
  const source = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();

  expect(source).toContain("const session = authClient.useSession()");
  expect(source).toContain("const isAuthenticated = createMemo(() => !session().isPending && session().data !== null)");
  expect(source).toContain("<Show when={props.isAuthenticated()}>");
  expect(source).not.toContain("Sign in to create playlists");
  expect(source).not.toContain("Login to save playlists");
});

test("playlist UI uses real protected API procedures for full playlist flow", async () => {
  const source = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();

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
  const source = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();

  expect(source).toContain("data-compact-playlist-selector");
  expect(source).toContain("data-playlist-management-panel");
  expect(source).toContain("Manage playlists");
  expect(source).toContain("source-playlist-selector");
  expect(source).not.toContain("open data-playlist-management-panel");
  expect(source).not.toContain('data-shell-column="playlists"');
  expect(source).not.toContain("<dialog");
  expect(source).not.toContain("role=\"dialog\"");
});

test("add-to-playlist is discoverable from content rows and viewer with real API calls", async () => {
  const source = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();

  expect(source).toContain("data-content-playlist-actions");
  expect(source).toContain("content-list-playlist-target");
  expect(source).toContain("data-content-row-add-playlist");
  expect(source).toContain("Add to playlist");
  expect(source).toContain("const addContentToPlaylist = async (contentItemId: string) => {");
  expect(source).toContain("await client.overlays.addPlaylistItem({ playlistId, contentItemId });");
  expect(source).toContain("<PlaylistAddControls");
  expect(source).not.toContain("alert(\"playlist");
});

test("manual reorder controls render only for manual playlist order", async () => {
  const source = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();

  expect(source).toContain("const selectedPlaylistUsesManualOrder = createMemo(() => selectedPlaylist()?.sortMode === \"manual\")");
  expect(source).toContain("showManualControls={selectedPlaylistUsesManualOrder()}");
  expect(source).toContain("readonly showManualControls: boolean;");
  expect(source).toContain("data-manual-reorder={props.showManualControls ? \"true\" : \"false\"}");
  expect(source).toContain("<Show when={props.showManualControls}>");
  expect(source).toContain("await client.overlays.reorderPlaylistItems({ playlistId: item.playlistId, playlistItemIds: orderedItemIds })");
});

test("playlist items reload through resource key without effect refetch loop", async () => {
  const source = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();
  const playlistItemsInputStart = source.indexOf("const selectedPlaylistItemsInput = createMemo(() => {");
  const playlistItemsResourceEnd = source.indexOf("const selectedPlaylist = createMemo(", playlistItemsInputStart);
  const playlistItemsResourceSource = source.slice(playlistItemsInputStart, playlistItemsResourceEnd);
  const playlistSectionEnd = source.indexOf("interface PlaylistItemRowProps", playlistItemsInputStart);
  const playlistSectionSource = source.slice(playlistItemsInputStart, playlistSectionEnd);
  const refetchEffectPattern = /createEffect\(\(\) => \{[\s\S]*props\.playlistItemsReloadKey\(\)[\s\S]*refetchSelectedPlaylistItems\(/;

  expect(playlistItemsResourceSource).toContain("const playlistId = props.selectedPlaylistId();");
  expect(playlistItemsResourceSource).toContain("return `${playlistId}\\u001f${props.playlistItemsReloadKey().toString()}`;");
  expect(playlistItemsResourceSource).toContain("createResource(\n    selectedPlaylistItemsInput,");
  expect(playlistItemsResourceSource).toContain("return client.overlays.playlistItems({ playlistId });");
  expect(playlistSectionSource).not.toMatch(refetchEffectPattern);
});

test("playlist edit form changes only through explicit playlist selection", async () => {
  const source = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();

  expect(source).toContain("const editPlaylist = (playlist: Playlist | null) => {");
  expect(source).toContain("props.onSelectPlaylist(playlist?.id ?? null);");
  expect(source).toContain("setEditingPlaylist(playlist);");
  expect(source).not.toContain("lastFormPlaylistId");
});

test("playlist UI remains inside the approved three-pane shell", async () => {
  const source = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();

  expect(source).toContain("<PlaylistColumnSection");
  expect(source).toContain("<PlaylistAddControls");
  expect(source).not.toContain("data-shell-column=\"playlists\"");
  expect(source).not.toContain("grid-cols-[1fr_3fr_8fr_");
  expect(source).not.toContain("<dialog");
  expect(source).not.toContain("role=\"dialog\"");
});

test("settings UI uses real protected API procedures for list save and delete", async () => {
  const source = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();

  expect(settingKeyInputId).toBe("setting-key");
  expect(settingValueInputId).toBe("setting-value");
  expect(settingKeyPattern).toBe("^[a-z][a-z0-9._-]*$");
  expect(source).toContain("client.overlays.settings()");
  expect(source).toContain("client.overlays.saveSetting({ key, value: settingValue() })");
  expect(source).toContain("client.overlays.deleteSetting({ key })");
  expect(source).toContain("await refetchSettings()");
});

test("typed settings expose bounded known reader density controls", async () => {
  const source = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();
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
  expect(source).toContain("<section class=\"mt-2 border border-border bg-background p-2\" aria-labelledby=\"reader-density-title\" data-typed-settings>");
  expect(source).toContain("id={readerDensityInputId}");
  expect(source).toContain("const nextReaderDensity = readerDensityValues.find((value) => value === event.currentTarget.value)");
  expect(source).toContain("await client.overlays.saveSetting({ key: readerDensitySettingKey, value: nextReaderDensity });");
  expect(source).toContain("await client.overlays.deleteSetting({ key: readerDensitySettingKey });");
  expect(source).not.toContain("player.autoplay");
  expect(source).not.toContain("playback preference");
});

test("reader density setting is applied to real row spacing", async () => {
  const source = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();

  expect(source).toContain("const emptyUserSettings: readonly UserSetting[] = [];");
  expect(source).toContain("const readerDensity = createMemo(() => toReaderDensityFromSettings(settings() ?? emptyUserSettings));");
  expect(source).toContain("data-reader-density={readerDensity()}");
  expect(source).toContain("function readerDensityPaddingClass(readerDensity: ReaderDensity): string");
  expect(source).toContain("readerDensityPaddingClass(props.readerDensity)");
  expect(source).toContain("readerDensityPaddingClass(props.readerDensity ?? \"comfortable\")");
  expect(source).toContain("readerDensity={props.readerDensity()}");
});

test("raw settings editor is retained only as collapsed advanced settings", async () => {
  const source = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();
  const typedSettingsIndex = source.indexOf("data-typed-settings");
  const advancedSettingsIndex = source.indexOf("data-advanced-settings");
  const rawKeyInputIndex = source.indexOf("id={settingKeyInputId}");

  expect(typedSettingsIndex).toBeGreaterThan(-1);
  expect(advancedSettingsIndex).toBeGreaterThan(typedSettingsIndex);
  expect(rawKeyInputIndex).toBeGreaterThan(advancedSettingsIndex);
  expect(source).toContain("<details class=\"mt-2 border border-border bg-background p-2\" data-advanced-settings>");
  expect(source).toContain("<summary class=\"cursor-pointer text-[0.72rem] font-semibold text-foreground\">Advanced settings</summary>");
  expect(source).not.toContain("open data-advanced-settings");
});

test("settings UI is authenticated-only and remains in the source column", async () => {
  const source = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();

  expect(source).toContain("data-source-actions-region");
  expect(source).toContain("<SettingsColumnSection");
  expect(source).not.toContain('data-shell-column="settings"');
  expect(source).not.toContain("grid-cols-[1fr_3fr_8fr_");
  expect(source).not.toContain("Sign in to manage settings");
  expect(source).not.toContain("Login to manage settings");
  expect(source).not.toContain("<dialog");
  expect(source).not.toContain("role=\"dialog\"");
});

test("settings UI has no fake defaults and displays only stored API values", async () => {
  const source = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();

  expect(formatSettingValue(JSON.stringify("compact"))).toBe("compact");
  expect(formatSettingValue("not-json")).toBe("not-json");
  expect(source).toContain("No settings have been saved.");
  expect(source).toContain("formatSettingValue(setting.valueJson)");
  expect(source).not.toContain("reader.layout");
  expect(source).not.toContain("player.autoplay");
  expect(source).not.toContain("defaultSettings");
});

test("favorites view is an authenticated content-pane filter using protected procedures", async () => {
  const source = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();

  expect(contentViewModeAllId).toBe("content-view-all");
  expect(contentViewModeFavoritesId).toBe("content-view-favorites");
  expect(contentViewModeHistoryId).toBe("content-view-history");
  expect(contentViewModePlayedId).toBe("content-view-played");
  expect(source).toContain("const [viewMode, setViewMode] = createSignal<ContentViewMode>(props.mode === \"library\" ? \"subscribed\" : \"catalog\")");
  expect(source).toContain("<Show when={props.isAuthenticated()}>\n          <div class=\"mt-2 grid grid-cols-4 gap-2\" aria-label=\"Content view\">");
  expect(source).toContain("return client.overlays.favoriteContentItems()");
  expect(source).toContain("return client.catalog.contentItems(input)");
  expect(source).toContain("setViewMode(\"favorites\")");
  expect(source).toContain("setViewMode(\"history-opened\")");
  expect(source).toContain("setViewMode(\"played\")");
  expect(source).not.toContain('data-shell-column="favorites"');
});

test("history and played views use protected contentHistory procedures", async () => {
  const source = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();

  expect(source).toContain("async function listOpenedHistoryContentItems(): Promise<readonly CatalogContentListItem[]>");
  expect(source).toContain("client.overlays.contentHistory({ status: \"opened\" })");
  expect(source).toContain("async function listPlayedHistoryContentItems(): Promise<readonly CatalogContentListItem[]>");
  expect(source).toContain("client.overlays.contentHistory({ status: \"played\" })");
  expect(source).toContain("return listOpenedHistoryContentItems()");
  expect(source).toContain("return listPlayedHistoryContentItems()");
  expect(source).toContain("Favorites and history are loaded from your Library, then search, source, creator, and Hide played are applied locally to the loaded videos.");
});

test("anonymous users do not call protected status or history procedures", async () => {
  const source = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();

  expect(source).toContain("if (props.isAuthenticated() && viewMode() === \"history-opened\")");
  expect(source).toContain("if (props.isAuthenticated() && viewMode() === \"played\")");
  expect(source).toContain("if (!isAuthenticated()) {\n      return null;\n    }\n\n    return statusReloadKey();");
  expect(source).not.toContain("if (!props.isAuthenticated() && (viewMode() === \"history-opened\" || viewMode() === \"played\"))");
  expect(source).not.toContain("if (!props.isAuthenticated() && hidePlayed())");
  expect(source).not.toContain("Sign in to view history");
  expect(source).not.toContain("Login to view history");
});

test("hide played is state filtering and not DOM filtering", async () => {
  const source = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();

  expect(source).toContain("const [hidePlayed, setHidePlayed] = createSignal(false)");
  expect(source).toContain("return locallyFilteredItems.filter((contentItem) => !toContentStatusFlags(statuses, contentItem.id).played)");
  expect(source).toContain("<For each={displayedContentItems()}>");
  expect(source).not.toContain("querySelector");
  expect(source).not.toContain("classList");
  expect(source).not.toContain("hidden =");
});

test("favorite toggles are real authenticated actions in list rows and viewer", async () => {
  const source = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();

  expect(source).toContain("client.overlays.toggleContentFavorite({ contentItemId })");
  expect(source).toContain("<ContentListItemRow");
  expect(source).toContain("<FavoriteActionControls");
  expect(source).toContain("Favorite action for selected video");
  expect(source).toContain("onFavoriteChanged={() => setFavoritesReloadKey((key) => key + 1)}");
  expect(source).toContain("props.onFavoriteChanged()");
});

test("favorite-only row actions reconcile favorites without refetching catalog content", async () => {
  const source = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();
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
  const source = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();

  expect(source).toContain("if (props.isAuthenticated() && viewMode() === \"favorites\")");
  expect(source).toContain("if (!props.isAuthenticated()) {\n      return null;\n    }");
  expect(source).not.toContain("if (!props.isAuthenticated() && viewMode() === \"favorites\")");
  expect(source).toContain("<Show when={props.isAuthenticated}>\n        <div class=\"mt-2 flex items-center justify-end gap-2\">");
  expect(source).not.toContain("Sign in to favorite");
  expect(source).not.toContain("Login to favorite");
});

test("content statuses load only for authenticated users", async () => {
  const source = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();
  const statusProcedureMatches = source.match(/client\.overlays\.contentStatuses\(\)/g) ?? [];

  expect(source).toContain("client.overlays.contentStatuses()");
  expect(statusProcedureMatches).toHaveLength(1);
  expect(source).toContain("if (!isAuthenticated()) {\n      return null;\n    }\n\n    return statusReloadKey();");
  expect(source).toContain("createResource(contentStatusesResourceInput, () =>");
  expect(source).toContain("const emptyUserContentStatuses: readonly UserContentStatus[] = [];");
  expect(source).toContain("contentStatuses={() => contentStatuses() ?? emptyUserContentStatuses}");
  expect(source).toContain("const statuses = props.contentStatuses();");
  expect(source).toContain("return toContentStatusFlags(props.contentStatuses(), contentItemId);");
});

test("resource reload dependencies use stable primitive source keys", async () => {
  const source = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();

  expect(source).toContain("function toCreatorListResourceKey(input: CreatorListInput): string");
  expect(source).toContain("function toFeedListResourceKey(input: FeedListInput | null): string | null");
  expect(source).toContain("function toContentItemsResourceKey(mode: ContentItemsResourceMode, input: ContentListInput, reloadKey: number): string");
  expect(source).toContain("input.offset.toString()");
  expect(source).toContain("createResource(contentItemsResourceKey, () =>");
  expect(source).toContain("return statusReloadKey();");
  expect(source).toContain("return `${contentItemId}\\u001f${props.favoritesReloadKey().toString()}`;");
  expect(source).not.toContain("return { mode: \"catalog\", input: contentListInput(), reloadKey: props.catalogReloadKey() }");
  expect(source).not.toContain("return { mode: \"subscribed\", input: contentListInput(), reloadKey: props.catalogReloadKey() }");
  expect(source).not.toContain("return { contentItemId, reloadKey: props.favoritesReloadKey() }");
  expect(source).not.toContain("return { reloadKey: statusReloadKey() };");
});

test("mobile navigation adds no timers observers or unstable resource source objects", async () => {
  const source = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();

  expect(source).not.toContain("IntersectionObserver");
  expect(source).not.toContain("ResizeObserver");
  expect(source).not.toContain("MutationObserver");
  expect(source).not.toContain("setInterval");
  expect(source).not.toContain("setTimeout");
  expect(source).not.toMatch(/createResource\(\s*\(\) => \(\{/);
  expect(source).not.toMatch(/createResource\(\s*\(\) => \{/);
});

test("load-more controls page creators feeds and content without timers or observers", async () => {
  const source = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();

  expect(source).toContain("function LoadMoreControl(props: LoadMoreControlProps)");
  expect(source).toContain("data-load-more-control");
  expect(source).toContain("data-loaded-count");
  expect(source).toContain("{props.shownCount} loaded");
  expect(source).toContain("Load more creators");
  expect(source).toContain("Load more feeds");
  expect(source).toContain("Load more videos");
  expect(source).toContain("const nextCreators = await client.catalog.creators({ ...creatorListInput(), offset: loadedCreators.length });");
  expect(source).toContain("const nextFeeds = await client.catalog.feeds({ ...input, offset: visibleFeeds().length });");
  expect(source).toContain("const input = { ...contentListInput(), offset: loadedContentItems().length };");
  expect(source).toContain("setAppendedCatalogCreatorPage((currentPage) => ({");
  expect(source).toContain("setAppendedFeedPage((currentPage) => ({");
  expect(source).toContain("setAppendedContentPage((currentPage) => ({");
  expect(source).toContain("hasMore: nextCreators.length === creatorListLimit");
  expect(source).toContain("hasMore: nextFeeds.length === feedListLimit");
  expect(source).toContain("hasMore: nextContentItems.length === contentListLimit");
  expect(source).not.toContain("setCatalogCreators");
  expect(source).not.toContain("setLoadedFeeds");
  expect(source).not.toContain("setLoadedContentItems");
  expect(source).not.toContain("createEffect");
  expect(source).toContain("data-content-loaded-count");
  expect(source).not.toContain("IntersectionObserver");
  expect(source).not.toContain("setInterval");
  expect(source).not.toContain("setTimeout");
});

test("app shell uses stable module-level empty arrays for fallback accessors", async () => {
  const source = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();

  expect(source).toContain("const emptyUserSettings: readonly UserSetting[] = [];");
  expect(source).toContain("const emptyUserContentStatuses: readonly UserContentStatus[] = [];");
  expect(source).toContain("const emptyPlaylists: readonly Playlist[] = [];");
  expect(source).toContain("const emptyCatalogContentSources: readonly CatalogContentSource[] = [];");
  expect(source).toContain("settings={() => settings() ?? emptyUserSettings}");
  expect(source).toContain("contentStatuses={() => contentStatuses() ?? emptyUserContentStatuses}");
  expect(source).toContain("playlists={playlists() ?? emptyPlaylists}");
  expect(source).toContain("toPlayableSources(contentDetail()?.sources ?? emptyCatalogContentSources)");
  expect(source).not.toContain("settings() ?? []");
  expect(source).not.toContain("contentStatuses() ?? []");
  expect(source).not.toContain("playlists() ?? []");
});

test("selecting content marks opened only after authenticated guard", async () => {
  const source = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();

  expect(source).toContain("const selectContent = async (contentItem: CatalogContentListItem) => {");
  expect(source).toContain("setSelectedContent(contentItem);\n    setStatusSelectionError(null);");
  expect(source).toContain("await markContentOpened(contentItem.id);");
  expect(source).toContain("Opened status update failed: ${formatError(error)}");
  expect(source).toContain("const markContentOpened = async (contentItemId: string) => {");
  expect(source).toContain("if (!isAuthenticated()) {\n      return;\n    }\n\n    await client.overlays.markContentOpened({ contentItemId });");
});

test("opened and played actions reconcile status state", async () => {
  const source = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();
  const reconcileStatusStart = source.indexOf("const reconcileStatusState = async () => {");
  const markOpenedStart = source.indexOf("const markContentOpened = async (contentItemId: string) => {");
  const reconcileStatusSource = source.slice(reconcileStatusStart, markOpenedStart);

  expect(source).toContain("await client.overlays.markContentOpened({ contentItemId });");
  expect(source).toContain("await client.overlays.markContentPlayed({ contentItemId });");
  expect(source).toContain("const reconcileStatusState = async () => {");
  expect(reconcileStatusSource).toContain("setStatusReloadKey((key) => key + 1);");
  expect(reconcileStatusSource).not.toContain("setCatalogReloadKey");
  expect(reconcileStatusSource).toContain("await refetchContentStatuses();");
  expect(source).toContain("await props.onMarkContentOpened(contentItemId);");
  expect(source).toContain("await props.onMarkContentPlayed(contentItemId);");
});

test("status-only row actions do not manually refetch catalog content", async () => {
  const source = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();
  const markOpenedStart = source.indexOf("const markOpened = async (contentItemId: string) => {");
  const markPlayedEnd = source.indexOf("const addContentToPlaylist = async (contentItemId: string) => {");
  const statusActionSource = source.slice(markOpenedStart, markPlayedEnd);

  expect(statusActionSource).toContain("await props.onMarkContentOpened(contentItemId);");
  expect(statusActionSource).toContain("await props.onMarkContentPlayed(contentItemId);");
  expect(statusActionSource).not.toContain("refetchContentItems");
});

test("content rows expose opened and played state with semantic attributes", async () => {
  const source = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();

  expect(source).toContain("data-opened={props.status.opened ? \"true\" : \"false\"}");
  expect(source).toContain("data-played={props.status.played ? \"true\" : \"false\"}");
  expect(source).toContain('data-content-status="opened"');
  expect(source).toContain('data-content-status="played"');
  expect(source).toContain('data-content-status="selected"');
  expect(source).toContain('data-content-status="favorite"');
  expect(source).toContain("data-favorite={props.isFavorite ? \"true\" : \"false\"}");
  expect(source).toContain("props.status.played ? \"bg-muted\" : props.status.opened ? \"bg-card\" : \"bg-background\"");
  expect(source).toContain("{props.status.opened ? \"Opened\" : \"Mark opened\"}");
  expect(source).toContain("{props.status.played ? \"Played\" : \"Mark played\"}");
  expect(source).toContain("Opened and played actions for selected video");
});

test("content rows expose concise icon source indicators and avoid fake thumbnails", async () => {
  const source = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();

  expect(source).toContain("const rowImageUrl = createMemo(() => props.contentItem.thumbnailUrl ?? props.contentItem.creator.imageUrl)");
  expect(source).toContain("data-thumbnail-source={rowImageSource() ?? \"\"}");
  expect(source).toContain("function SourceIconBadge(props: { readonly sourceType: SourceType; readonly context: SourceIndicatorContext; readonly sourceCount?: number })");
  expect(source).toContain("formatSourceIndicatorLabel(props.sourceType, props.context, props.sourceCount)");
  expect(source).toContain("<SourceIconBadge sourceType={props.contentItem.sourceType} context=\"content\" sourceCount={props.contentItem.sourceCount} />");
  expect(source).toContain("source records available");
  expect(source).toContain("×{props.sourceCount}");
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
  const source = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();

  expect(source).toContain('import { CirclePlay, RadioTower, SquarePlay } from "lucide-solid";');
  expect(source).not.toContain("<SourceIconBadge sourceType={props.creator.sourceType}");
  expect(source).toContain("<SourceIconBadge sourceType={props.feed.sourceType} context=\"feed\" />");
  expect(source).toContain("<SourceIconBadge sourceType={props.contentItem.sourceType} context=\"content\" sourceCount={props.contentItem.sourceCount} />");
  expect(source).toContain("aria-label={label()}");
  expect(source).toContain("title={label()}");
  expect(source).not.toContain("<span class=\"truncate\">{formatSourceLabel(props.creator.sourceType)}</span>");
  expect(source).not.toContain("{formatSourceLabel(props.feed.sourceType)}\n          </span>");
  expect(source).not.toContain("{formatSourceLabel(props.contentItem.sourceType)}\n            </span>");
});

test("creator rows avoid single-source claims while selected feed list shows feed sources", async () => {
  const source = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();

  expect(source).toContain("title=\"Use the filter above to scope creator rows by catalog source type; select a creator to inspect its feeds.\"");
  expect(source).toContain("Feeds");
  expect(source).toContain("Catalog creator");
  expect(source).toContain("aria-label=\"Feeds for selected creator\"");
  expect(source).toContain("<For each={selectedCreatorFeeds()}>");
  expect(source).toContain("<FeedRow");
  expect(source).toContain("<SourceIconBadge sourceType={props.feed.sourceType} context=\"feed\" />");
  expect(source).not.toContain("Catalog source");
});

test("viewer playback source selector stays accessible for multiple playable sources", async () => {
  const source = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();

  expect(source).toContain("<Show when={playableSources().length > 1}>");
  expect(source).toContain("const playbackSourceSwitcherLabel = createMemo(() => `Playback source, ${playableSources().length} options`);");
  expect(source).toContain("aria-label={playbackSourceSwitcherLabel()}");
  expect(source).toContain("title={playbackSourceSwitcherLabel()}");
  expect(source).toContain("onChange={(event) => setSelectedSourceId(event.currentTarget.value)}");
  expect(source).toContain("<For each={playableSources()}>");
});

test("subscription UI is authenticated and wired to real protected procedures", async () => {
  const source = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();

  expect(source).toContain("client.overlays.subscriptions()");
  expect(source).toContain("client.overlays.subscribeToCreator({ creatorId })");
  expect(source).toContain("client.overlays.unsubscribeFromCreator({ creatorId })");
  expect(source).toContain('if (props.mode === "library" && action === "unsubscribe" && props.selectedCreatorId() === creatorId)');
  expect(source).toContain("props.onClearCreator()");
  expect(source).toContain("<SubscriptionActionButton");
  expect(source).toContain("<Show when={props.isAuthenticated && props.showSubscriptionControl}>");
  expect(source).toContain("<Show when={props.isAuthenticated()}>\n                  <SubscriptionActionButton");
  expect(source).toContain("{props.isSubscribed ? \"Unsubscribe\" : \"Subscribe\"}");
  expect(source).toContain("Subscribed");
  expect(source).not.toContain("Add subscription");
});

test("creator pane keeps refresh API actions beside subscription actions", async () => {
  const source = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();

  expect(source).toContain("client.refresh.runCreator({ creatorId: creator.id, force })");
  expect(source).toContain("client.refresh.runAll({ force })");
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
  const source = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();

  expect(contentViewModeSubscribedId).toBe("content-view-subscribed");
  expect(contentViewModeHistoryId).toBe("content-view-history");
  expect(contentLibraryFiltersLabel).toBe("Library filters");
  expect(source).toContain('props.mode === "library" ? "Library" : "Catalog"');
  expect(source).toContain('props.mode === "library" ? "subscribed" : "catalog"');
  expect(source).toContain("return \"catalog\";");
  expect(source).toContain("return listSubscribedLibraryContentItems(input)");
  expect(source).toContain("return client.overlays.subscribedContentItems(input)");
  expect(source).toContain("client.overlays.contentHistory({ status: \"opened\" })");
  expect(source).toContain("client.overlays.contentHistory({ status: \"played\" })");
  expect(source).toContain("Your subscribed Library has no videos yet. Subscribe from the Catalog or refresh your sources.");
  expect(source).toContain("Open videos to build your Library history, or clear local filters to see loaded history.");
  expect(source).toContain("Play videos to build your played Library, or clear local filters to see loaded played history.");
  expect(source).toContain("aria-label={`${visibleContentCollectionLabel()} videos, ${contentCount()} shown`}");
  expect(source).toContain("Subscribed creators appear in your Library after you subscribe from the Catalog.");
});

test("subscribed library content uses one protected endpoint without client fan-out", async () => {
  const source = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();

  expect(source).toContain("async function listSubscribedLibraryContentItems(input: ContentListInput): Promise<readonly CatalogContentListItem[]> {");
  expect(source).toContain("return client.overlays.subscribedContentItems(input);");
  expect(source).not.toContain("subscriptions.flatMap");
  expect(source).not.toContain("toSubscribedCreatorContentListInputs");
  expect(source).toContain("if (props.mode === \"library\") {\n              await client.overlays.subscribeToCreator({ creatorId: value.creator.id });\n            }");
});

test("viewer empty state uses neutral video copy", async () => {
  const source = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();

  expect(source).toContain("Pick a video to open the viewer.");
  expect(source).not.toContain("Pick a catalog video to open the viewer.");
});

test("visible shell copy avoids rejected product jargon", async () => {
  const source = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();
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
  const source = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();
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
