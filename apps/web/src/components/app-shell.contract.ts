import type {
  CatalogContentListItem,
  CatalogContentSource,
  CatalogCreator,
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

export interface CreatorListInput {
  readonly search?: string;
  readonly sourceType?: SourceType;
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
  readonly sourceType?: SourceType;
  readonly limit: number;
  readonly offset: number;
}

export type ShellMode = "catalog" | "library";

export type ReaderDensity = "comfortable" | "compact";

export type BrowsableCreator = CatalogCreator | UserSubscriptionWithCreator["creator"];

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

export const creatorListLimit = 50;

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

export const settingKeyInputId = "setting-key";

export const settingValueInputId = "setting-value";

export const readerDensityInputId = "reader-density";

export const readerDensitySettingKey = "reader.density";

export const readerDensityValues: readonly ReaderDensity[] = ["comfortable", "compact"];

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

export const desktopShellGridClass = "lg:grid-cols-[1fr_3fr_8fr]";

export const shellRootClass = "h-full w-dvw overflow-x-hidden bg-background text-foreground lg:min-h-0";

export const shellGridClass = `flex min-h-full w-full flex-col lg:grid lg:h-full lg:min-h-0 ${desktopShellGridClass} lg:overflow-hidden`;

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

export const contentScrollRegionClass = "px-3 py-2 lg:min-h-0 lg:flex-1 lg:overflow-y-auto";

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

const sourceLabels: Record<CatalogCreator["sourceType"], string> = {
  youtube: "YouTube",
  odysee: "Odysee",
  peertube: "PeerTube",
};

export function getShellColumnCount() {
  return shellColumns.length;
}

export function toCreatorListInput(search: string, sourceType: SourceType | null = null, offset = firstPageOffset): CreatorListInput {
  const trimmedSearch = search.trim();

  return {
    ...(trimmedSearch.length === 0 ? {} : { search: trimmedSearch }),
    ...(sourceType === null ? {} : { sourceType }),
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
  sourceType: SourceType | null,
  offset = firstPageOffset,
): ContentListInput {
  const trimmedSearch = search.trim();
  return {
    ...(trimmedSearch.length === 0 ? {} : { search: trimmedSearch }),
    ...(creatorId === null ? {} : { creatorId }),
    ...(feedId === null ? {} : { feedId }),
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

export function formatContentPublishedAt(publishedAt: Date | null): string {
  if (publishedAt === null) {
    return "Undated";
  }

  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(publishedAt);
}

export function formatContentDuration(durationSeconds: number | null): string {
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

export function formatSourceLabel(sourceType: CatalogCreator["sourceType"]): string {
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

      if (source.sourceType !== "youtube" && source.sourceType !== "peertube") {
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
