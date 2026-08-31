import { createSignal, onCleanup, onMount } from "solid-js";
import type {
  CatalogContentListItem,
  CatalogContentSource,
  CatalogCreator,
  CatalogFeed,
  FeedHealthEntry,
  RefreshFeedErrorSummary,
  RefreshFeedResult,
  RefreshFeedResultWithFeed,
  RefreshRun,
  RefreshRunReport,
  SourceType,
  UserContentStatus,
  UserSetting,
  UserSubscriptionWithCreator,
} from "@FeedElity/api";

export interface ShellColumnDefinition {
  readonly id: "creators" | "content" | "viewer";
  readonly title: string;
  readonly description: string;
}

export type ShellPaneId = ShellColumnDefinition["id"];

export type CreatorListSort = "name" | "lastUpdate";

export interface CreatorListInput {
  readonly search?: string;
  readonly sourceType?: SourceType;
  readonly sort: CreatorListSort;
  readonly limit: number;
  readonly offset: number;
}

export interface FeedListInput {
  readonly creatorId?: string;
  readonly sourceType?: SourceType;
  readonly limit: number;
  readonly offset: number;
}

export interface ContentListInput {
  readonly search?: string;
  readonly creatorId?: string;
  readonly feedId?: string;
  readonly collectionId?: string;
  readonly sourceType?: SourceType;
  readonly limit: number;
  readonly offset: number;
}

export type ShellMode = "catalog" | "library";

export type LeftPaneTab = "library" | "feeds" | "playlists" | "collections";

export type MiddlePanePanel = "add-source";

export type ViewerMode = "content" | "settings";

export const leftPaneTabLabels: Record<LeftPaneTab, string> = {
  library: "Library",
  feeds: "Feeds",
  playlists: "Playlists",
  collections: "Collections",
};

export type ReaderDensity = "comfortable" | "compact";

export type BrowsableCreator = CatalogCreator | UserSubscriptionWithCreator["creator"];

/**
 * Source types a creator row should badge. Catalog and subscription creators
 * arrive as `CatalogCreatorSummary` (which always carries `sourceTypes`), while
 * the ingestion-internal `CatalogCreator` (still used by add-source results)
 * carries none and badges as an empty list.
 */
export function toCreatorSourceTypes(creator: BrowsableCreator): readonly SourceType[] {
  if ("sourceTypes" in creator) {
    return creator.sourceTypes;
  }

  return [];
}

export interface ContentStatusFlags {
  readonly opened: boolean;
  readonly played: boolean;
}

export interface AppendedPageState<TItem> {
  readonly key: string;
  readonly items: readonly TItem[];
  readonly hasMore: boolean;
}

export interface ShellSelectionState {
  readonly selectedCreatorId: string | null;
}

export interface ShellContentSelectionState extends ShellSelectionState {
  readonly selectedContentItemId: string | null;
}

export const creatorSearchInputId = "creator-source-search";

export const creatorSourceFilterId = "creator-source-type-filter";

export const addSourceInputId = "creator-source-add-input";

export const addSourceHelpId = "creator-source-add-help";

export const creatorListLimit = 100;

export const feedListLimit = 25;

export const contentListLimit = 50;

export const firstPageOffset = 0;

export const contentSearchInputId = "content-list-search";

export const contentSourceFilterId = "content-source-filter";

export const contentViewModeAllId = "content-view-all";

export const contentViewModeFavoritesId = "content-view-favorites";

export const contentViewModeSubscribedId = "content-view-subscribed";

export const contentCatalogFiltersLabel = "Catalog filters";

export const contentLibraryFiltersLabel = "Library filters";

export const contentViewModeHistoryId = "content-view-history";

export const contentViewModePlayedId = "content-view-played";

export const contentHidePlayedInputId = "content-hide-played";

export const playlistNameInputId = "playlist-name";

export const playlistDescriptionInputId = "playlist-description";

export const playlistSortInputId = "playlist-sort";

export const collectionNameInputId = "collection-name";

export const collectionDescriptionInputId = "collection-description";

export const collectionMemberSearchInputId = "collection-member-search";

export const settingKeyInputId = "setting-key";

export const settingValueInputId = "setting-value";

export const readerDensityInputId = "reader-density";

export const readerDensitySettingKey = "reader.density";

export const readerDensityValues: readonly ReaderDensity[] = ["comfortable", "compact"];

export const creatorListSortInputId = "creator-list-sort";

export const creatorListSortSettingKey = "creator.list.sort";

export const creatorListSortValues: readonly CreatorListSort[] = ["name", "lastUpdate"];

// YouTube embeds default to the privacy-enhanced youtube-nocookie.com host;
// toggling them off persists this user setting. Lowercase only: the key must
// satisfy settingKeyPattern (the server rejects any other casing).
export const youtubePrivacySettingKey = "playback.youtube.nocookie";

export const refreshStatusRegionId = "refresh-status-history";

export const settingKeyPattern = "^[a-z][a-z0-9._-]*$";

export type ContentViewMode = "catalog" | "subscribed" | "favorites" | "history-opened" | "played";

type PlaybackKind = "embed" | "native";

export interface PlayableSource {
  readonly id: string;
  readonly sourceType: SourceType;
  readonly label: string;
  readonly kind: PlaybackKind;
  readonly url: string;
  readonly canonicalUrl: string;
  readonly priority: number;
}

export const shellPaneIds = ["creators", "content", "viewer"] as const;

export const desktopShellGridClass = "lg:grid lg:h-full lg:min-h-0 lg:overflow-hidden";

export const shellRootClass = "h-full w-dvw overflow-x-hidden bg-background text-foreground lg:min-h-0";

export const shellGridClass = "flex min-h-full w-full flex-col relative lg:grid lg:h-full lg:min-h-0 lg:overflow-hidden";

export const defaultLeftFraction = 0.16;

export const defaultMiddleFraction = 0.30;

export const minLeftFraction = 0.10;

export const minMiddleFraction = 0.18;

export const minRightFraction = 0.36;

export const paneWidthsLocalStorageKey = "feedelity.pane-widths";

export type PersistedPaneWidths = { left: number; middle: number };

export const hidePlayedLocalStorageKey = "feedelity.hide-played";

/**
 * Reads the persisted "hide played" preference.
 * Returns `null` when no preference has been stored (or localStorage is unavailable),
 * so callers can distinguish "no choice yet" from an explicit `false`.
 */
export function readPersistedHidePlayed(): boolean | null {
  try {
    const stored = localStorage.getItem(hidePlayedLocalStorageKey);
    if (stored === "true") return true;
    if (stored === "false") return false;
    return null;
  } catch {
    return null;
  }
}

/**
 * Persists an explicit "hide played" choice. Failures are ignored: localStorage
 * may be unavailable (private mode, sandboxed iframe) and the toggle still works in-memory.
 */
export function persistHidePlayed(value: boolean): void {
  try {
    localStorage.setItem(hidePlayedLocalStorageKey, value ? "true" : "false");
  } catch {
    // localStorage may be unavailable; in-memory state is unaffected
  }
}

export const shellModeLocalStorageKey = "feedelity.shell.mode";

export const leftPaneTabLocalStorageKey = "feedelity.shell.left-tab";

export const creatorSourceFilterLocalStorageKey = "feedelity.creators.source-filter";

export const contentViewModeLocalStorageKey = "feedelity.content.view-mode";

export const contentSourceFilterLocalStorageKey = "feedelity.content.source-filter";

/**
 * Guarded localStorage read shared by the persisted-UI-state keys (F7).
 * Returns `null` when no value is stored or when localStorage is unavailable
 * (private mode, sandboxed iframe, non-browser runtime), so callers can treat
 * "never chosen" and "cannot read" identically.
 */
export function readPersistedLocalValue(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * Guarded localStorage write shared by the persisted-UI-state keys (F7).
 * Failures are ignored: the UI state stays functional in-memory when
 * localStorage is unavailable, exactly like `persistHidePlayed`.
 */
export function persistLocalValue(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // localStorage may be unavailable; in-memory state is unaffected
  }
}

const shellModes: readonly ShellMode[] = ["catalog", "library"];

/**
 * Narrows a persisted shell mode. Anything missing or unrecognized (including
 * values written by other app versions) falls back to "catalog", the mode "/"
 * renders anyway without a redirect.
 */
export function toPersistedShellMode(value: string | null): ShellMode {
  if (value === null) {
    return "catalog";
  }

  return shellModes.find((mode) => mode === value) ?? "catalog";
}

const leftPaneTabs: readonly LeftPaneTab[] = ["library", "feeds", "playlists", "collections"];

// Tabs whose buttons render only for signed-in users (app-shell.tsx tab bar),
// matching the section-level `props.isAuthenticated()` gates.
const authenticatedLeftPaneTabs: readonly LeftPaneTab[] = ["playlists", "collections"];

/**
 * Narrows a persisted left-pane tab. Unrecognized values fall back to
 * "library" (the tab bar default); auth-only tabs fall back to "library" when
 * the persisted choice is applied anonymously.
 */
export function toPersistedLeftPaneTab(value: string | null, isAuthenticated: boolean): LeftPaneTab {
  if (value === null) {
    return "library";
  }

  const tab = leftPaneTabs.find((candidate) => candidate === value);
  if (tab === undefined) {
    return "library";
  }

  if (!isAuthenticated && authenticatedLeftPaneTabs.includes(tab)) {
    return "library";
  }

  return tab;
}

/**
 * Source types offered by the creator and content source filters. Single list
 * shared by both filter UIs and the persisted-filter parser below.
 */
export const sourceTypeFilterValues: readonly SourceType[] = ["youtube", "odysee", "peertube"];

/**
 * Narrows a persisted source-type filter. Anything missing or unrecognized
 * (the empty string written for "All" included) means no filter.
 */
export function toPersistedSourceTypeFilter(value: string | null): SourceType | null {
  if (value === null) {
    return null;
  }

  return sourceTypeFilterValues.find((sourceType) => sourceType === value) ?? null;
}

const contentViewModes: readonly ContentViewMode[] = [
  "catalog",
  "subscribed",
  "favorites",
  "history-opened",
  "played",
];

// Modes whose buttons render only for signed-in users (content-column view
// switcher), matching the anonymous reset effect that enforces the default.
const authenticatedContentViewModes: readonly ContentViewMode[] = ["favorites", "history-opened", "played"];

/**
 * The view mode a shell mode starts in: "subscribed" for the library,
 * "catalog" for the catalog — the same default the content-column seed and
 * anonymous reset effect apply.
 */
export function toContentViewModeDefault(mode: ShellMode): ContentViewMode {
  return mode === "library" ? "subscribed" : "catalog";
}

/**
 * Narrows a persisted content view mode for a shell mode. Unrecognized values
 * fall back to the mode default; auth-only modes (favorites/history/played)
 * fall back to the mode default when applied anonymously.
 */
export function toPersistedContentViewMode(value: string | null, isAuthenticated: boolean, mode: ShellMode): ContentViewMode {
  const fallback = toContentViewModeDefault(mode);
  if (value === null) {
    return fallback;
  }

  const viewMode = contentViewModes.find((candidate) => candidate === value);
  if (viewMode === undefined) {
    return fallback;
  }

  if (!isAuthenticated && authenticatedContentViewModes.includes(viewMode)) {
    return fallback;
  }

  return viewMode;
}

export function clampLeftFraction(left: number, middle: number): number {
  return Math.max(minLeftFraction, Math.min(left, 1 - middle - minRightFraction));
}

export function clampMiddleFraction(middle: number, left: number): number {
  return Math.max(minMiddleFraction, Math.min(middle, 1 - left - minRightFraction));
}

export function toDesktopColumnTemplate(left: number, middle: number, right: number): string {
  return `${left}fr ${middle}fr ${right}fr`;
}

export const sourceColumnClass =
  "min-h-[12rem] border-b border-border bg-muted lg:flex lg:h-full lg:min-h-0 lg:flex-col lg:overflow-hidden lg:border-b-0 lg:border-r";

export const sourceHeaderRegionClass = "space-y-2 border-b border-border px-2 py-2 lg:shrink-0";

export const sourceCatalogRegionClass = "min-h-0 lg:flex lg:flex-1 lg:flex-col lg:overflow-hidden";

export const sourceCreatorListRegionClass = "px-2 py-2 lg:min-h-0 lg:flex-1 lg:overflow-y-auto";

export const sourceFeedListRegionClass = "border-t border-border px-2 py-2 lg:max-h-[32dvh] lg:overflow-y-auto";

export const sourceActionsRegionClass = "lg:max-h-[42dvh] lg:shrink-0 lg:overflow-y-auto";

export const contentColumnClass =
  "min-h-[18rem] border-b border-border bg-card lg:flex lg:h-full lg:min-h-0 lg:flex-col lg:overflow-hidden lg:border-b-0 lg:border-r";

export const contentHeaderRegionClass = "border-b border-border px-3 py-2 lg:shrink-0";

export const contentScrollRegionClass = "lg:min-h-0 lg:flex-1 lg:overflow-y-auto";

export const viewerColumnClass = "min-h-[30rem] bg-background lg:flex lg:h-full lg:min-h-0 lg:flex-col lg:overflow-hidden";

export const viewerScrollRegionClass = "p-3 lg:min-h-0 lg:flex-1 lg:overflow-y-auto";

export const hasInternalAppHeader = false;

export const shellColumns: readonly ShellColumnDefinition[] = [
  {
    id: "creators",
    title: "Sources",
    description: "Compact creator and feed navigation.",
  },
  {
    id: "content",
    title: "Feed",
    description: "Scan list for videos from the selected source.",
  },
  {
    id: "viewer",
    title: "Viewer",
    description: "Large selected-video reading and playback surface.",
  },
] as const;

const sourceLabels: Record<SourceType, string> = {
  youtube: "YouTube",
  odysee: "Odysee",
  peertube: "PeerTube",
};

export function getShellColumnCount() {
  return shellColumns.length;
}

export function toCreatorListInput(
  search: string,
  sourceType: SourceType | null = null,
  sort: CreatorListSort = "name",
  offset = firstPageOffset,
): CreatorListInput {
  const trimmedSearch = search.trim();

  return {
    ...(trimmedSearch.length === 0 ? {} : { search: trimmedSearch }),
    ...(sourceType === null ? {} : { sourceType }),
    sort,
    limit: creatorListLimit,
    offset,
  };
}

export function toFeedListInput(creatorId: string | null, sourceType: SourceType | null = null, offset = firstPageOffset): FeedListInput | null {
  if (creatorId === null) {
    return null;
  }

  return {
    creatorId,
    ...(sourceType === null ? {} : { sourceType }),
    limit: feedListLimit,
    offset,
  };
}

export function toContentListInput(
  search: string,
  creatorId: string | null,
  feedId: string | null,
  collectionId: string | null,
  sourceType: SourceType | null,
  offset = firstPageOffset,
): ContentListInput {
  const trimmedSearch = search.trim();
  return {
    ...(trimmedSearch.length === 0 ? {} : { search: trimmedSearch }),
    ...(creatorId === null ? {} : { creatorId }),
    ...(feedId === null ? {} : { feedId }),
    ...(collectionId === null ? {} : { collectionId }),
    ...(sourceType === null ? {} : { sourceType }),
    limit: contentListLimit,
    offset,
  };
}

export function mergeUniqueContentItemsForDisplay(
  contentItems: readonly CatalogContentListItem[],
): readonly CatalogContentListItem[] {
  const contentById = new Map<string, CatalogContentListItem>();
  for (const contentItem of contentItems) {
    if (!contentById.has(contentItem.id)) {
      contentById.set(contentItem.id, contentItem);
    }
  }

  return [...contentById.values()].sort(compareContentItemsForDisplay);
}

export function emptyAppendedPageState<TItem>(): AppendedPageState<TItem> {
  return { key: "", items: [], hasMore: false };
}

export function pageItemsForKey<TItem>(state: AppendedPageState<TItem>, key: string): readonly TItem[] {
  return state.key === key ? state.items : [];
}

export function pageHasMoreForKey<TItem>(state: AppendedPageState<TItem>, key: string, firstPageLength: number, pageSize: number): boolean {
  return state.key === key ? state.hasMore : firstPageLength === pageSize;
}

export function formatError(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "Catalog request failed.";
}

/**
 * A single feed-level refresh failure parsed from a run/feed error summary.
 * Mirrors {@link RefreshFeedErrorSummary} but as a plain validated value.
 */
export interface ParsedRefreshError {
  readonly feedId: string;
  readonly code: string;
  readonly message: string;
}

function isRefreshFeedErrorSummary(value: unknown): value is RefreshFeedErrorSummary {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.feedId === "string" &&
    typeof candidate.code === "string" &&
    typeof candidate.message === "string"
  );
}

/**
 * Parse a run/feed errorSummaryJson value into typed summaries. Accepts both a
 * single error-summary object and an array of them (the catalog persists a
 * single object per failed feed; runs may carry an array). Returns an empty
 * array for null input, malformed JSON, or entries that do not match the error
 * summary shape. Never throws.
 */
export function parseRefreshErrorSummaries(errorSummaryJson: string | null): readonly ParsedRefreshError[] {
  if (errorSummaryJson === null) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(errorSummaryJson);
  } catch {
    return [];
  }

  const candidates = Array.isArray(parsed) ? parsed : [parsed];

  return candidates.filter(isRefreshFeedErrorSummary).map((summary) => ({
    feedId: summary.feedId,
    code: summary.code,
    message: summary.message,
  }));
}

/**
 * Join a scoped-refresh run's per-feed results with the catalog feeds that were
 * selected for the run, producing the `RefreshFeedResultWithFeed[]` shape the
 * refresh status dialog expects. A result whose feedId no longer maps to a
 * selected feed (e.g. the feed was removed mid-run) is dropped rather than
 * rendered without a label. Deterministic order follows `feedResults`.
 */
export function joinFeedResultsWithFeeds(
  feedResults: readonly RefreshFeedResult[],
  selectedFeeds: readonly CatalogFeed[],
): readonly RefreshFeedResultWithFeed[] {
  const feedById = new Map(selectedFeeds.map((feed) => [feed.id, feed]));
  const joined: RefreshFeedResultWithFeed[] = [];

  for (const result of feedResults) {
    const feed = feedById.get(result.feedId);
    if (feed === undefined) {
      continue;
    }

    joined.push({ ...result, feed });
  }

  return joined;
}

const refreshErrorCodeLabels: Readonly<Record<string, string>> = {
  "provider-refresh-paused": "Provider rate-limited",
  "catalog-persistence-failed": "Catalog write failed",
  "adapter-not-registered": "Source type unsupported",
};

/**
 * Human label for a refresh error code. Falls back to the raw code for unknown
 * (including adapter-passthrough) codes.
 */
export function formatRefreshErrorCodeLabel(code: string): string {
  return refreshErrorCodeLabels[code] ?? code;
}

/**
 * Order the feed-health rows for the health dialog: most consecutive failures
 * first, then the stalest successful refresh first (feeds that have never
 * succeeded sort before feeds that succeeded at some point). Ties fall through
 * to feed URL then feed id so the ordering is deterministic across refetches.
 * The repository returns rows sorted by feed URL; this client-side sort is the
 * presentation contract (see feed-health-dialog).
 */
export function sortFeedHealthEntries(entries: readonly FeedHealthEntry[]): readonly FeedHealthEntry[] {
  return [...entries].sort((left, right) => {
    if (left.consecutiveFailureCount !== right.consecutiveFailureCount) {
      return right.consecutiveFailureCount - left.consecutiveFailureCount;
    }

    if (left.lastSuccessAt === null || right.lastSuccessAt === null) {
      if (left.lastSuccessAt !== right.lastSuccessAt) {
        // Never-succeeded feeds are the stalest possible, so they come first.
        return left.lastSuccessAt === null ? -1 : 1;
      }
    } else if (left.lastSuccessAt.getTime() !== right.lastSuccessAt.getTime()) {
      return left.lastSuccessAt.getTime() - right.lastSuccessAt.getTime();
    }

    if (left.feedUrl !== right.feedUrl) {
      return left.feedUrl < right.feedUrl ? -1 : 1;
    }

    return left.feedId < right.feedId ? -1 : left.feedId > right.feedId ? 1 : 0;
  });
}

const feedHealthDayMs = 86_400_000;

/**
 * Human "last success" age for a feed-health row. Never-succeeded feeds read
 * "never"; successes within the current day read "today"; older ones read
 * whole-day counts ("3d ago"). `now` is injected so callers (and tests) stay
 * deterministic.
 */
export function formatFeedHealthLastSuccess(lastSuccessAt: Date | null, now: Date): string {
  if (lastSuccessAt === null) {
    return "never";
  }

  const dayDifference = Math.floor((now.getTime() - lastSuccessAt.getTime()) / feedHealthDayMs);
  if (dayDifference < 1) {
    return "today";
  }

  return `${dayDifference}d ago`;
}

export function formatContentPublishedAt(publishedAt: Date | null): string {
  if (publishedAt === null) {
    return "Undated";
  }

  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(publishedAt);
}

export function formatContentDuration(durationSeconds: number | null): string {
  if (durationSeconds === null) {
    return "";
  }

  const hours = Math.floor(durationSeconds / 3_600);
  const minutes = Math.floor((durationSeconds % 3_600) / 60);
  const seconds = durationSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }

  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function toContentStatusFlags(statuses: readonly UserContentStatus[], contentItemId: string): ContentStatusFlags {
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

function compareContentItemsForDisplay(first: CatalogContentListItem, second: CatalogContentListItem): number {
  const publishedDifference = getContentItemPublishedTime(second) - getContentItemPublishedTime(first);
  if (publishedDifference !== 0) {
    return publishedDifference;
  }

  return second.id.localeCompare(first.id);
}

function getContentItemPublishedTime(contentItem: CatalogContentListItem): number {
  return contentItem.publishedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
}

export function showsCatalogFilters(viewMode: ContentViewMode): boolean {
  return viewMode === "catalog" || viewMode === "subscribed";
}

export function toRefreshStatusResourceKey(isAuthenticated: boolean, reloadKey: number): number | null {
  return isAuthenticated ? reloadKey : null;
}

export function toShellSelectionState(selectedCreatorId: string | null): ShellSelectionState {
  return { selectedCreatorId };
}

export function toShellContentSelectionState(
  selectedCreatorId: string | null,
  selectedContentItemId: string | null,
): ShellContentSelectionState {
  return { selectedCreatorId, selectedContentItemId };
}

export function formatSourceLabel(sourceType: SourceType): string {
  return sourceLabels[sourceType];
}

export function formatRefreshRunSummary(run: RefreshRun): string {
  const mode = run.force ? "Force" : "Normal";
  const scope = run.scope === "all" ? "all sources" : run.scope;
  return `${mode} ${scope}: ${run.status}, ${run.feedsSucceededCount}/${run.feedsRequestedCount} feeds, ${run.feedsSkippedCount} skipped`;
}

export function formatRefreshReportSummary(report: RefreshRunReport): string {
  return `${report.status}: ${report.feedsSucceededCount}/${report.selectedFeedCount} feeds refreshed, ${report.skippedFeedCount} skipped, ${report.itemsCreatedCount} new items`;
}

export function formatSettingValue(valueJson: string): string {
  try {
    const parsed: unknown = JSON.parse(valueJson);
    if (typeof parsed === "string") {
      return parsed;
    }
  } catch {
    return valueJson;
  }

  return valueJson;
}

export function toReaderDensityFromSettings(settings: readonly UserSetting[]): ReaderDensity {
  const setting = settings.find((candidate) => candidate.key === readerDensitySettingKey);
  if (setting === undefined) {
    return "comfortable";
  }

  try {
    const parsed: unknown = JSON.parse(setting.valueJson);
    if (parsed === "compact" || parsed === "comfortable") {
      return parsed;
    }
  } catch {
    return "comfortable";
  }

  return "comfortable";
}

export const desktopMediaQuery = "(min-width: 1024px)";

/**
 * Minimal structural view of a MediaQueryList so the change-listener wiring is
 * testable without a DOM (tests pass a plain stub with matches + listeners).
 */
interface MediaQueryMatchesSource {
  readonly matches: boolean;
  addEventListener(type: "change", listener: (event: { readonly matches: boolean }) => void): void;
  removeEventListener(type: "change", listener: (event: { readonly matches: boolean }) => void): void;
}

/**
 * Subscribes to a media query on behalf of a setter: pushes the current
 * matches state immediately, forwards every change event, and returns the
 * unsubscribe function so callers can hook it into onCleanup.
 */
export function bindMediaQueryMatches(
  query: MediaQueryMatchesSource,
  onMatchesChange: (matches: boolean) => void,
): () => void {
  onMatchesChange(query.matches);
  const handler = (event: { readonly matches: boolean }) => onMatchesChange(event.matches);
  query.addEventListener("change", handler);
  return () => query.removeEventListener("change", handler);
}

/**
 * Reactive "(min-width: 1024px)" signal used to pick between the virtualized
 * content list (lg and up) and the plain list below lg. Starts `false` so the
 * first render matches the mobile layout, then syncs from the real query on
 * mount; the change listener is removed when the owning scope is disposed.
 *
 * KEPT FOR THE VIRTUALIZATION REWORK: content-list virtualization is currently
 * disabled (TO BE FIXED in app-shell-content-column.tsx) and the plain list is
 * the live path, but this signal still feeds the (inert) virtualizer gate and
 * is required again by the rework.
 */
export function createDesktopMediaQuerySignal(): () => boolean {
  const [isDesktop, setIsDesktop] = createSignal(false);
  onMount(() => {
    onCleanup(bindMediaQueryMatches(window.matchMedia(desktopMediaQuery), setIsDesktop));
  });
  return isDesktop;
}

/**
 * Initial row-height estimate for the virtualized content list, derived from
 * the row layout: the 7rem aspect-video thumbnail column (63px) plus the
 * density vertical padding (compact py-1 = 8px, comfortable py-1.5 = 12px)
 * plus the 1px bottom border. measureElement replaces estimates with real
 * heights as rows mount, so estimates only seed the scroll-thumb size and the
 * first-pass window calculation.
 *
 * KEPT FOR THE VIRTUALIZATION REWORK: content-list virtualization is currently
 * disabled (TO BE FIXED in app-shell-content-column.tsx); only the inert
 * virtualizer still reads this, and the rework needs it again.
 */
export function estimateContentItemRowHeight(readerDensity: ReaderDensity): number {
  return readerDensity === "compact" ? 72 : 76;
}

export function toCreatorListSortFromSettings(settings: readonly UserSetting[]): CreatorListSort {
  const setting = settings.find((candidate) => candidate.key === creatorListSortSettingKey);
  if (setting === undefined) {
    return "name";
  }

  try {
    const parsed: unknown = JSON.parse(setting.valueJson);
    if (parsed === "name" || parsed === "lastUpdate") {
      return parsed;
    }
  } catch {
    return "name";
  }

  return "name";
}

/**
 * Parses the persisted YouTube no-cookie preference, defaulting to `true`
 * (privacy-enhanced embeds). Settings store string values via saveSetting, so
 * the persisted form is `JSON.stringify("true"/"false")` — parsing it yields
 * the strings "true"/"false", which are the round-trip encoding of the save
 * path. A bare JSON boolean is accepted as a tolerated alternative; anything
 * else (or malformed JSON) falls back to the privacy-preserving default.
 */
export function toYoutubeNoCookieFromSettings(settings: readonly UserSetting[]): boolean {
  const setting = settings.find((candidate) => candidate.key === youtubePrivacySettingKey);
  if (setting === undefined) {
    return true;
  }

  try {
    const parsed: unknown = JSON.parse(setting.valueJson);
    if (typeof parsed === "boolean") {
      return parsed;
    }

    if (parsed === "true") {
      return true;
    }

    if (parsed === "false") {
      return false;
    }
  } catch {
    return true;
  }

  return true;
}

/**
 * Playback resume position for the selected content item, narrowed from the
 * `playback` payload stored inside the item's `opened` row metadataJson
 * (packages/api PlaybackPositionMetadata, qol-features-plan.md decision D1).
 */
export interface PlaybackPosition {
  readonly positionSeconds: number;
  readonly durationSeconds: number | null;
}

/**
 * Embed hosts whose players are tracked through the YouTube IFrame API bridge.
 * The single source of truth for the allowlist used by `toEmbedUrlWithApi`,
 * `isYouTubeEmbedUrl`, and the viewer's tracked-source decision.
 */
const youTubeEmbedHosts: readonly string[] = ["www.youtube-nocookie.com", "www.youtube.com"];

/**
 * True when the URL is an https URL hosted on one of the YouTube embed hosts.
 * Anything unparseable, non-https, or from another provider is not tracked.
 */
export function isYouTubeEmbedUrl(embedUrl: string): boolean {
  try {
    const url = new URL(embedUrl);
    return url.protocol === "https:" && youTubeEmbedHosts.includes(url.host);
  } catch {
    return false;
  }
}

/**
 * Parses the playback position stored under the `playback` key of an `opened`
 * content status row's metadataJson. Requires `playback.positionSeconds` to be
 * a finite number >= 0; `durationSeconds` may be absent or null (unknown) and
 * otherwise must be a finite number >= 0. Returns null for null input,
 * malformed JSON, or any shape violation. Never throws.
 */
export function toPlaybackPosition(metadataJson: string | null): PlaybackPosition | null {
  if (metadataJson === null) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(metadataJson);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }

  const metadata = parsed as Record<string, unknown>;
  const playback = metadata.playback;
  if (typeof playback !== "object" || playback === null) {
    return null;
  }

  const candidate = playback as Record<string, unknown>;
  const positionSeconds = candidate.positionSeconds;
  if (typeof positionSeconds !== "number" || !Number.isFinite(positionSeconds) || positionSeconds < 0) {
    return null;
  }

  const durationSeconds = candidate.durationSeconds;
  if (durationSeconds === undefined || durationSeconds === null) {
    return { positionSeconds, durationSeconds: null };
  }

  if (typeof durationSeconds !== "number" || !Number.isFinite(durationSeconds) || durationSeconds < 0) {
    return null;
  }

  return { positionSeconds, durationSeconds };
}

/**
 * True when a saved resume position is worth restoring. Reopening a finished
 * (or nearly finished) video must start fresh instead of jumping to the tail:
 * when the saved duration is known and 10s or less remain, resume is
 * suppressed — the same 10s tail rule the native surface applies against the
 * live duration at seek time (`positionSeconds < duration - 10`). Positions
 * with an unknown duration stay resumable; the surfaces' live-duration guards
 * still apply when an actual player is involved.
 */
export function isResumablePlaybackPosition(position: PlaybackPosition): boolean {
  return position.durationSeconds === null || position.durationSeconds - position.positionSeconds > 10;
}

/**
 * Derives the list-progress lookup from the user's content statuses: only
 * `opened` rows can carry a playback payload (decision D1), and rows whose
 * metadataJson does not parse into a position are skipped. `played` rows are
 * excluded even if a stale playback-shaped payload exists — a finished video
 * has no resume progress to show.
 */
export function toPlaybackPositionsByItemId(statuses: readonly UserContentStatus[]): Map<string, PlaybackPosition> {
  const positionByItemId = new Map<string, PlaybackPosition>();
  for (const status of statuses) {
    if (status.status !== "opened") {
      continue;
    }

    const position = toPlaybackPosition(status.metadataJson);
    if (position !== null) {
      positionByItemId.set(status.contentItemId, position);
    }
  }

  return positionByItemId;
}

/**
 * Rewrites a YouTube embed URL for the IFrame API bridge: only https URLs on
 * the allowlisted YouTube hosts are accepted; `enablejsapi=1` and
 * `origin=<appOrigin>` are set (overwriting any previous values) while all
 * other existing params are preserved. `start=<floor(startSeconds)>` is added
 * only when `startSeconds` is provided and >= 10 (short leftovers are not
 * worth a seek). Callers suppress near-finished positions through
 * `isResumablePlaybackPosition` before passing a start. Returns null for any
 * other host or unsafe URL.
 */
export function toEmbedUrlWithApi(embedUrl: string, appOrigin: string, startSeconds?: number): string | null {
  if (startSeconds !== undefined && (!Number.isFinite(startSeconds) || startSeconds < 0)) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(embedUrl);
  } catch {
    return null;
  }

  if (url.protocol !== "https:" || !youTubeEmbedHosts.includes(url.host)) {
    return null;
  }

  url.searchParams.set("enablejsapi", "1");
  url.searchParams.set("origin", appOrigin);
  if (startSeconds !== undefined && startSeconds >= 10) {
    url.searchParams.set("start", Math.floor(startSeconds).toString());
  }

  return url.toString();
}

/**
 * Formats a playback position as "12:34 / 45:00" using the same clock rules as
 * `formatContentDuration`. When no duration is known only the current position
 * is rendered.
 */
export function formatPlaybackPosition(position: PlaybackPosition): string {
  const current = formatContentDuration(position.positionSeconds);
  if (position.durationSeconds === null) {
    return current;
  }

  return `${current} / ${formatContentDuration(position.durationSeconds)}`;
}

/**
 * Accessible label for the list progress badge, e.g. "Resume at 12:34 of
 * 45:00". Without a known duration only the position is announced.
 */
export function formatPlaybackResumeLabel(position: PlaybackPosition): string {
  if (position.durationSeconds === null) {
    return `Resume at ${formatContentDuration(position.positionSeconds)}`;
  }

  return `Resume at ${formatContentDuration(position.positionSeconds)} of ${formatContentDuration(position.durationSeconds)}`;
}

export interface PlaybackPositionFlushInput {
  readonly lastSavedSeconds: number | null;
  readonly nextSeconds: number;
  readonly lastSavedAtMs: number | null;
  readonly nowMs: number;
  readonly force: boolean;
}

/**
 * Pure throttle decision for playback position saves: flush when never saved,
 * when forced, when at least 10s have passed since the last save, or when the
 * position moved by at least 5s since the last save.
 */
export function shouldFlushPlaybackPosition(input: PlaybackPositionFlushInput): boolean {
  if (input.force) {
    return true;
  }

  if (input.lastSavedSeconds === null || input.lastSavedAtMs === null) {
    return true;
  }

  if (input.nowMs - input.lastSavedAtMs >= 10_000) {
    return true;
  }

  return Math.abs(input.nextSeconds - input.lastSavedSeconds) >= 5;
}

export function toSafePlaybackUrl(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  try {
    const url = new URL(value);
    if (url.protocol !== "https:") {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
}

export function toPlayableSources(sources: readonly CatalogContentSource[]): readonly PlayableSource[] {
  return sources
    .map((source): PlayableSource | null => {
      const nativeMediaUrl = toSafePlaybackUrl(source.nativeMediaUrl);
      if (nativeMediaUrl !== null) {
        return {
          id: source.id,
          sourceType: source.sourceType,
          label: `${formatSourceLabel(source.sourceType)} media`,
          kind: "native",
          url: nativeMediaUrl,
          canonicalUrl: source.canonicalUrl,
          priority: source.priority,
        };
      }

      // Odysee items without a native enclosure are playable through the
      // provider's $/embed page (mirroring the YouTube/PeerTube embed path).
      if (source.sourceType !== "youtube" && source.sourceType !== "peertube" && source.sourceType !== "odysee") {
        return null;
      }

      const embedUrl = toSafePlaybackUrl(source.embedUrl);
      if (embedUrl === null) {
        return null;
      }

      return {
        id: source.id,
        sourceType: source.sourceType,
        label: `${formatSourceLabel(source.sourceType)} embed`,
        kind: "embed",
        url: embedUrl,
        canonicalUrl: source.canonicalUrl,
        priority: source.priority,
      };
    })
    .filter((source): source is PlayableSource => source !== null)
    .sort((left, right) => left.priority - right.priority);
}

/**
 * The link the viewer's "copy stream URL" affordance places on the clipboard
 * for the currently selected playable source. Native sources copy the direct
 * media URL (playable by mpv/yt-dlp as-is); embed-only sources copy the
 * canonical page URL, which yt-dlp (and mpv through it) resolves to a stream.
 * The button text names which kind of link is copied.
 */
export interface CopyableStreamLink {
  readonly label: string;
  readonly url: string;
}

export function toCopyableStreamLink(source: PlayableSource | null): CopyableStreamLink | null {
  if (source === null) {
    return null;
  }

  if (source.kind === "native") {
    return { label: "Copy stream URL", url: source.url };
  }

  if (source.canonicalUrl.length === 0) {
    return null;
  }

  return { label: "Copy page link", url: source.canonicalUrl };
}
