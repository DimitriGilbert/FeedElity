import type {
  CatalogContentDetail,
  CatalogContentListItem,
  CatalogContentSource,
  CatalogCreator,
  CatalogFeed,
  Playlist,
  PlaylistItemWithContent,
  PlaylistSortMode,
  RefreshFeedResult,
  RefreshRun,
  RefreshRunReport,
  SourceType,
  UserSetting,
} from "@FeedElity/api";
import { For, Match, Show, Switch, createEffect, createMemo, createResource, createSignal } from "solid-js";

import { authClient } from "@/lib/auth-client";
import { client } from "@/utils/orpc";

export interface ShellColumnDefinition {
  readonly id: "creators" | "content" | "viewer";
  readonly title: string;
  readonly description: string;
}

interface CreatorListInput {
  readonly search?: string;
  readonly limit: number;
}

interface ContentListInput {
  readonly search?: string;
  readonly creatorId?: string;
  readonly sourceType?: SourceType;
  readonly limit: number;
}

export interface ShellSelectionState {
  readonly selectedCreatorId: string | null;
}

export interface ShellContentSelectionState extends ShellSelectionState {
  readonly selectedContentItemId: string | null;
}

export const creatorSearchInputId = "creator-source-search";

export const creatorListLimit = 50;

export const contentListLimit = 50;

export const contentSearchInputId = "content-list-search";

export const contentSourceFilterId = "content-source-filter";

export const contentViewModeAllId = "content-view-all";

export const contentViewModeFavoritesId = "content-view-favorites";

export const contentCatalogFiltersLabel = "Catalog filters";

export const playlistNameInputId = "playlist-name";

export const playlistDescriptionInputId = "playlist-description";

export const playlistSortInputId = "playlist-sort";

export const settingKeyInputId = "setting-key";

export const settingValueInputId = "setting-value";

export const refreshStatusRegionId = "refresh-status-history";

export const settingKeyPattern = "^[a-z][a-z0-9._-]*$";

const allContentSourceFilterValue = "all";

const sourceFilterOptions: readonly SourceType[] = ["youtube", "odysee", "peertube"];

export type ContentViewMode = "all" | "favorites";

interface CatalogContentItemsResourceInput {
  readonly mode: "all";
  readonly input: ContentListInput;
}

interface FavoriteContentItemsResourceInput {
  readonly mode: "favorites";
  readonly reloadKey: number;
}

type ContentItemsResourceInput = CatalogContentItemsResourceInput | FavoriteContentItemsResourceInput;

const playlistSortOptions: readonly { readonly value: PlaylistSortMode; readonly label: string }[] = [
  { value: "manual", label: "Manual" },
  { value: "published_at_desc", label: "Newest published" },
  { value: "published_at_asc", label: "Oldest published" },
  { value: "added_at_desc", label: "Newest added" },
  { value: "added_at_asc", label: "Oldest added" },
];

const sourceLabels: Record<CatalogCreator["sourceType"], string> = {
  youtube: "YouTube",
  odysee: "Odysee",
  peertube: "PeerTube",
};

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

export const shellGridClass = `flex min-h-full w-full flex-col lg:grid lg:min-h-0 ${desktopShellGridClass} lg:overflow-hidden`;

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

export function getShellColumnCount() {
  return shellColumns.length;
}

export function toCreatorListInput(search: string): CreatorListInput {
  const trimmedSearch = search.trim();
  if (trimmedSearch.length === 0) {
    return { limit: creatorListLimit };
  }

  return { search: trimmedSearch, limit: creatorListLimit };
}

export function toContentListInput(search: string, creatorId: string | null, sourceType: SourceType | null): ContentListInput {
  const trimmedSearch = search.trim();
  return {
    ...(trimmedSearch.length === 0 ? {} : { search: trimmedSearch }),
    ...(creatorId === null ? {} : { creatorId }),
    ...(sourceType === null ? {} : { sourceType }),
    limit: contentListLimit,
  };
}

export function showsCatalogFilters(viewMode: ContentViewMode): boolean {
  return viewMode === "all";
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

function formatSourceLabel(sourceType: CatalogCreator["sourceType"]): string {
  return sourceLabels[sourceType];
}

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

export function formatRefreshRunSummary(run: RefreshRun): string {
  const mode = run.force ? "Force" : "Normal";
  const scope = run.scope === "creator" ? "creator" : "all sources";
  return `${mode} ${scope}: ${run.status}, ${run.feedsSucceededCount}/${run.feedsRequestedCount} feeds, ${run.feedsSkippedCount} skipped`;
}

export function formatRefreshReportSummary(report: RefreshRunReport): string {
  return `${report.status}: ${report.feedsSucceededCount}/${report.selectedFeedCount} feeds refreshed, ${report.skippedFeedCount} skipped, ${report.itemsCreatedCount} new items`;
}

function formatPlaylistSortMode(sortMode: PlaylistSortMode): string {
  return playlistSortOptions.find((option) => option.value === sortMode)?.label ?? "Manual";
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

function toPlaylistSortMode(value: string): PlaylistSortMode {
  return playlistSortOptions.find((option) => option.value === value)?.value ?? "manual";
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

function toSourceFilterValue(value: string): SourceType | null {
  return sourceFilterOptions.find((sourceType) => sourceType === value) ?? null;
}

interface CreatorSourceColumnProps {
  readonly isAuthenticated: () => boolean;
  readonly selectedCreatorId: () => string | null;
  readonly selectedCreator: () => CatalogCreator | null;
  readonly selectedPlaylistId: () => string | null;
  readonly playlistItemsReloadKey: () => number;
  readonly onSelectCreator: (creator: CatalogCreator) => void;
  readonly onSelectPlaylist: (playlistId: string | null) => void;
  readonly onSelectContent: (contentItem: CatalogContentListItem) => void;
}

function CreatorSourceColumn(props: CreatorSourceColumnProps) {
  const [search, setSearch] = createSignal("");
  const [creators] = createResource(
    () => toCreatorListInput(search()),
    (input) => client.catalog.creators(input),
  );
  const [feeds] = createResource(props.selectedCreatorId, (creatorId) =>
    client.catalog.feeds({ creatorId, limit: 25 }),
  );
  const creatorCount = createMemo(() => creators()?.length ?? 0);

  return (
    <section
      aria-labelledby="creator-source-title"
      class="min-h-[12rem] border-b border-border bg-muted lg:min-h-0 lg:overflow-y-auto lg:border-b-0 lg:border-r"
      data-shell-column="creators"
    >
      <div class="space-y-2 border-b border-border px-2 py-2">
        <div class="flex items-center justify-between gap-2">
          <h2 id="creator-source-title" class="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Sources
          </h2>
          <span class="text-[0.68rem] text-muted-foreground" data-creator-count>
            {creatorCount()} shown
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
          onInput={(event) => setSearch(event.currentTarget.value)}
        />
      </div>
      <div class="px-2 py-2">
        <Switch>
          <Match when={creators.loading}>
            <p class="text-xs font-semibold text-foreground">Loading sources</p>
            <p class="mt-2 text-[0.72rem] leading-5 text-muted-foreground">Loading the public catalog.</p>
          </Match>
          <Match when={creators.error !== undefined}>
            <p class="text-xs font-semibold text-destructive">Sources unavailable</p>
            <p class="mt-2 text-[0.72rem] leading-5 text-muted-foreground">{formatError(creators.error)}</p>
          </Match>
          <Match when={(creators()?.length ?? 0) === 0}>
            <p class="text-xs font-semibold text-foreground">No sources found</p>
            <p class="mt-2 text-[0.72rem] leading-5 text-muted-foreground">
              {search().trim().length === 0
                ? "The public catalog has no creators yet."
                : "No creators match this search."}
            </p>
          </Match>
          <Match when={creators()}>
            {(loadedCreators) => (
              <ol class="space-y-1" aria-label="Creator sources">
                <For each={loadedCreators()}>
                  {(creator) => (
                    <li>
                      <button
                        type="button"
                        class="w-full border border-border bg-card px-2 py-2 text-left text-card-foreground transition hover:border-ring hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                        aria-pressed={props.selectedCreatorId() === creator.id}
                        data-selected={props.selectedCreatorId() === creator.id ? "true" : "false"}
                        onClick={() => props.onSelectCreator(creator)}
                      >
                        <span class="block truncate text-xs font-semibold">{creator.displayName}</span>
                        <span class="mt-1 block truncate text-[0.68rem] text-muted-foreground">
                          {formatSourceLabel(creator.sourceType)}
                        </span>
                      </button>
                    </li>
                  )}
                </For>
              </ol>
            )}
          </Match>
        </Switch>
      </div>
      <Show when={props.selectedCreator()}>
        {(creator) => (
          <aside class="border-t border-border px-2 py-2" aria-label="Selected source feeds">
            <p class="truncate text-xs font-semibold text-foreground">{creator().displayName}</p>
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
              <Match when={feeds()}>
                {(loadedFeeds) => (
                  <ul class="mt-2 space-y-1" aria-label="Feeds for selected creator">
                    <For each={loadedFeeds()}>{(feed) => <FeedRow feed={feed} />}</For>
                  </ul>
                )}
              </Match>
            </Switch>
          </aside>
        )}
      </Show>
      <RefreshStatusSection isAuthenticated={props.isAuthenticated} selectedCreator={props.selectedCreator} />
      <Show when={props.isAuthenticated()}>
        <SettingsColumnSection />
        <PlaylistColumnSection
          selectedPlaylistId={props.selectedPlaylistId}
          playlistItemsReloadKey={props.playlistItemsReloadKey}
          onSelectPlaylist={props.onSelectPlaylist}
          onSelectContent={props.onSelectContent}
        />
      </Show>
    </section>
  );
}

interface RefreshStatusSectionProps {
  readonly isAuthenticated: () => boolean;
  readonly selectedCreator: () => CatalogCreator | null;
}

function RefreshStatusSection(props: RefreshStatusSectionProps) {
  const [reloadKey, setReloadKey] = createSignal(0);
  const [busyAction, setBusyAction] = createSignal<"normal-all" | "force-all" | "normal-creator" | "force-creator" | null>(null);
  const [refreshError, setRefreshError] = createSignal<string | null>(null);
  const [latestReport, setLatestReport] = createSignal<RefreshRunReport | null>(null);
  const [status] = createResource(
    () => reloadKey(),
    () => client.refresh.status({ limit: 5, feedResultsLimit: 3 }),
  );

  const runAllRefresh = async (force: boolean) => {
    setBusyAction(force ? "force-all" : "normal-all");
    setRefreshError(null);
    try {
      const result = await client.refresh.runAll({ force });
      setLatestReport(result.report);
      setReloadKey((key) => key + 1);
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

    setBusyAction(force ? "force-creator" : "normal-creator");
    setRefreshError(null);
    try {
      const result = await client.refresh.runCreator({ creatorId: creator.id, force });
      setLatestReport(result.report);
      setReloadKey((key) => key + 1);
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
      <Show when={latestReport()}>
        {(report) => (
          <p class="mt-2 border border-border bg-card px-2 py-1.5 text-[0.72rem] leading-5 text-card-foreground" role="status">
            {formatRefreshReportSummary(report())}
          </p>
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

function RefreshFeedResultList(props: { readonly results: readonly RefreshFeedResult[] }) {
  return (
    <Show when={props.results.length > 0}>
      <ul class="space-y-1" aria-label="Latest refresh feed results">
        <For each={props.results}>
          {(result) => (
            <li class="flex items-center justify-between gap-2 border border-border bg-card px-2 py-1 text-[0.68rem] text-card-foreground">
              <span>{result.status}</span>
              <span class="text-muted-foreground">{result.itemsCreatedCount} new</span>
            </li>
          )}
        </For>
      </ul>
    </Show>
  );
}

function SettingsColumnSection() {
  const [settings, { refetch: refetchSettings }] = createResource(() => client.overlays.settings());
  const [settingKey, setSettingKey] = createSignal("");
  const [settingValue, setSettingValue] = createSignal("");
  const [settingsError, setSettingsError] = createSignal<string | null>(null);
  const [settingsBusyKey, setSettingsBusyKey] = createSignal<string | null>(null);
  const [formBusy, setFormBusy] = createSignal(false);

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
      await refetchSettings();
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
      await refetchSettings();
    } catch (error) {
      setSettingsError(formatError(error));
    } finally {
      setSettingsBusyKey(null);
    }
  };

  return (
    <section class="border-t border-border px-2 py-2" aria-labelledby="settings-section-title">
      <div class="flex items-center justify-between gap-2">
        <h3 id="settings-section-title" class="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Settings
        </h3>
        <span class="text-[0.68rem] text-muted-foreground">{settings()?.length ?? 0} saved</span>
      </div>
      <Show when={settingsError()}>
        {(message) => <p class="mt-2 border border-destructive px-2 py-1.5 text-[0.72rem] text-destructive">{message()}</p>}
      </Show>
      <form
        class="mt-2 space-y-2 border border-border bg-background p-2"
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
      <Switch>
        <Match when={settings.loading}>
          <p class="mt-2 text-[0.72rem] leading-5 text-muted-foreground">Loading settings.</p>
        </Match>
        <Match when={settings.error !== undefined}>
          <p class="mt-2 text-[0.72rem] leading-5 text-destructive">Settings unavailable.</p>
        </Match>
        <Match when={(settings()?.length ?? 0) === 0}>
          <p class="mt-2 text-[0.72rem] leading-5 text-muted-foreground">No settings have been saved.</p>
        </Match>
        <Match when={settings()}>
          {(loadedSettings) => (
            <ol class="mt-2 space-y-1" aria-label="Saved settings">
              <For each={loadedSettings()}>
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
          )}
        </Match>
      </Switch>
    </section>
  );
}

interface PlaylistColumnSectionProps {
  readonly selectedPlaylistId: () => string | null;
  readonly playlistItemsReloadKey: () => number;
  readonly onSelectPlaylist: (playlistId: string | null) => void;
  readonly onSelectContent: (contentItem: CatalogContentListItem) => void;
}

function PlaylistColumnSection(props: PlaylistColumnSectionProps) {
  const [playlists, { refetch: refetchPlaylists }] = createResource(() => client.overlays.playlists());
  const [playlistName, setPlaylistName] = createSignal("");
  const [playlistDescription, setPlaylistDescription] = createSignal("");
  const [playlistSortMode, setPlaylistSortMode] = createSignal<PlaylistSortMode>("manual");
  const [editingPlaylist, setEditingPlaylist] = createSignal<Playlist | null>(null);
  const [playlistError, setPlaylistError] = createSignal<string | null>(null);
  const [playlistBusy, setPlaylistBusy] = createSignal(false);
  const selectedPlaylistItemsInput = createMemo(() => props.selectedPlaylistId());
  const [selectedPlaylistItems, { refetch: refetchSelectedPlaylistItems }] = createResource(
    selectedPlaylistItemsInput,
    (playlistId) => client.overlays.playlistItems({ playlistId }),
  );
  const selectedPlaylist = createMemo(
    () => playlists()?.find((playlist) => playlist.id === props.selectedPlaylistId()) ?? null,
  );

  createEffect(() => {
    const playlist = selectedPlaylist();
    setEditingPlaylist(playlist);
    setPlaylistName(playlist?.name ?? "");
    setPlaylistDescription(playlist?.description ?? "");
    setPlaylistSortMode(playlist?.sortMode ?? "manual");
  });

  createEffect(() => {
    const loadedPlaylists = playlists();
    if (loadedPlaylists === undefined) {
      return;
    }

    if (props.selectedPlaylistId() !== null && !loadedPlaylists.some((playlist) => playlist.id === props.selectedPlaylistId())) {
      props.onSelectPlaylist(null);
    }
  });

  createEffect(() => {
    props.playlistItemsReloadKey();
    if (props.selectedPlaylistId() !== null) {
      Promise.resolve(refetchSelectedPlaylistItems()).catch((error: unknown) => setPlaylistError(formatError(error)));
    }
  });

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
      props.onSelectPlaylist(playlist.id);
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
      props.onSelectPlaylist(null);
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
    const items = selectedPlaylistItems() ?? [];
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
      <Show when={playlistError()}>
        {(message) => <p class="mt-2 border border-destructive px-2 py-1.5 text-[0.72rem] text-destructive">{message()}</p>}
      </Show>
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
              props.onSelectPlaylist(null);
              setPlaylistName("");
              setPlaylistDescription("");
              setPlaylistSortMode("manual");
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
                      onClick={() => props.onSelectPlaylist(props.selectedPlaylistId() === playlist.id ? null : playlist.id)}
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
    </section>
  );
}

interface PlaylistItemRowProps {
  readonly item: PlaylistItemWithContent;
  readonly itemIndex: number;
  readonly itemCount: number;
  readonly busy: boolean;
  readonly onSelectContent: (contentItem: CatalogContentListItem) => void;
  readonly onMove: (item: PlaylistItemWithContent, direction: -1 | 1) => Promise<void>;
  readonly onRemove: (item: PlaylistItemWithContent) => Promise<void>;
}

function PlaylistItemRow(props: PlaylistItemRowProps) {
  return (
    <li class="border border-border bg-background p-2">
      <button
        type="button"
        class="w-full text-left text-foreground transition hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        onClick={() => props.onSelectContent(props.item.content)}
      >
        <span class="block truncate text-[0.72rem] font-semibold">{props.item.content.title}</span>
        <span class="mt-1 block truncate text-[0.68rem] text-muted-foreground">{props.item.content.creator.displayName}</span>
      </button>
      <div class="mt-2 grid grid-cols-3 gap-1">
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
}

function FeedRow(props: FeedRowProps) {
  return (
    <li class="border border-border bg-background px-2 py-1.5">
      <p class="truncate text-[0.72rem] font-semibold text-foreground">{props.feed.title ?? props.feed.url}</p>
      <p class="mt-1 truncate text-[0.68rem] text-muted-foreground">{formatSourceLabel(props.feed.sourceType)}</p>
    </li>
  );
}

interface ContentListColumnProps {
  readonly isAuthenticated: () => boolean;
  readonly selectedCreator: () => CatalogCreator | null;
  readonly selectedContentItemId: () => string | null;
  readonly favoritesReloadKey: () => number;
  readonly onSelectContent: (contentItem: CatalogContentListItem) => void;
  readonly onFavoriteChanged: () => void;
}

function ContentListColumn(props: ContentListColumnProps) {
  const [search, setSearch] = createSignal("");
  const [sourceType, setSourceType] = createSignal<SourceType | null>(null);
  const [viewMode, setViewMode] = createSignal<ContentViewMode>("all");
  const contentListInput = createMemo(() => toContentListInput(search(), props.selectedCreator()?.id ?? null, sourceType()));
  const contentItemsResourceInput = createMemo<ContentItemsResourceInput>(() => {
    if (props.isAuthenticated() && viewMode() === "favorites") {
      return { mode: "favorites", reloadKey: props.favoritesReloadKey() };
    }

    return { mode: "all", input: contentListInput() };
  });
  const [contentItems, { refetch: refetchContentItems }] = createResource(contentItemsResourceInput, (input) => {
    if (input.mode === "favorites") {
      return client.overlays.favoriteContentItems();
    }

    return client.catalog.contentItems(input.input);
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
  const contentCount = createMemo(() => contentItems()?.length ?? 0);
  const favoriteContentItemIds = createMemo(() => new Set((favoriteItems() ?? []).map((contentItem) => contentItem.id)));

  createEffect(() => {
    if (!props.isAuthenticated() && viewMode() === "favorites") {
      setViewMode("all");
    }
  });

  const toggleFavorite = async (contentItemId: string) => {
    try {
      await client.overlays.toggleContentFavorite({ contentItemId });
      props.onFavoriteChanged();
      await refetchFavoriteItems();
      await refetchContentItems();
    } catch (error) {
      throw new Error(`Favorite update failed: ${formatError(error)}`);
    }
  };

  return (
    <section
      aria-labelledby="content-list-title"
      class="min-h-[18rem] border-b border-border bg-card lg:min-h-0 lg:overflow-y-auto lg:border-b-0 lg:border-r"
      data-shell-column="content"
      data-selected-creator-id={props.selectedCreator()?.id ?? ""}
    >
      <div class="border-b border-border px-3 py-2">
        <div class="flex items-center justify-between gap-3">
          <h2 id="content-list-title" class="text-sm font-semibold tracking-tight text-card-foreground">
            {viewMode() === "favorites" ? "Favorites" : "Feed"}
          </h2>
          <span class="min-w-0 truncate border border-border bg-background px-2 py-1 text-[0.68rem] text-muted-foreground">
            {props.selectedCreator()?.displayName ?? "All sources"}
          </span>
        </div>
        <Show when={props.isAuthenticated()}>
          <div class="mt-2 grid grid-cols-2 gap-2" aria-label="Content view">
            <button
              id={contentViewModeAllId}
              type="button"
              class="border border-border bg-background px-2 py-1.5 text-xs font-semibold text-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              aria-pressed={viewMode() === "all"}
              onClick={() => setViewMode("all")}
            >
              All videos
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
          </div>
        </Show>
        <Show when={showsCatalogFilters(viewMode())}>
          <div class="mt-2 grid grid-cols-[1fr_auto] gap-2" aria-label={contentCatalogFiltersLabel}>
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
      </div>
      <div class="px-3 py-2">
        <Switch>
          <Match when={contentItems.loading}>
            <p class="text-xs font-semibold text-card-foreground">Loading videos</p>
            <p class="mt-2 text-[0.72rem] leading-5 text-muted-foreground">Loading the public catalog.</p>
          </Match>
          <Match when={contentItems.error !== undefined}>
            <p class="text-xs font-semibold text-destructive">Videos unavailable</p>
            <p class="mt-2 text-[0.72rem] leading-5 text-muted-foreground">{formatError(contentItems.error)}</p>
          </Match>
          <Match when={(contentItems()?.length ?? 0) === 0}>
            <p class="text-xs font-semibold text-card-foreground">No videos found</p>
            <p class="mt-2 text-[0.72rem] leading-5 text-muted-foreground">
              {viewMode() === "favorites"
                ? "Favorite videos from the viewer or feed list to collect them here."
                : search().trim().length === 0 && props.selectedCreator() === null && sourceType() === null
                ? "The public catalog has no videos yet."
                : "No videos match the current filters."}
            </p>
          </Match>
          <Match when={contentItems()}>
            {(loadedContentItems) => (
              <ol class="space-y-1" aria-label={`Catalog videos, ${contentCount()} shown`}>
                <For each={loadedContentItems()}>
                  {(contentItem) => (
                    <li>
                      <ContentListItemRow
                        contentItem={contentItem}
                        isAuthenticated={props.isAuthenticated()}
                        isFavorite={favoriteContentItemIds().has(contentItem.id)}
                        selected={props.selectedContentItemId() === contentItem.id}
                        favoritesView={viewMode() === "favorites"}
                        onSelectContent={props.onSelectContent}
                        onToggleFavorite={toggleFavorite}
                      />
                    </li>
                  )}
                </For>
              </ol>
            )}
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
  readonly selected: boolean;
  readonly favoritesView: boolean;
  readonly onSelectContent: (contentItem: CatalogContentListItem) => void;
  readonly onToggleFavorite: (contentItemId: string) => Promise<void>;
}

function ContentListItemRow(props: ContentListItemRowProps) {
  const [favoriteError, setFavoriteError] = createSignal<string | null>(null);
  const [favoriteBusy, setFavoriteBusy] = createSignal(false);

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

  return (
    <div class="border border-border bg-background p-2 transition hover:border-ring hover:bg-accent hover:text-accent-foreground">
      <button
        type="button"
        class="group grid w-full grid-cols-[4.75rem_1fr] gap-2 text-left text-foreground transition hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        aria-pressed={props.selected}
        data-selected={props.selected ? "true" : "false"}
        onClick={() => props.onSelectContent(props.contentItem)}
      >
        <span class="aspect-video overflow-hidden border border-border bg-muted">
          <Show when={props.contentItem.thumbnailUrl}>
            {(thumbnailUrl) => (
              <img
                class="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                src={thumbnailUrl()}
                alt=""
                loading="lazy"
              />
            )}
          </Show>
        </span>
        <span class="min-w-0">
          <span class="block truncate text-xs font-semibold">{props.contentItem.title}</span>
          <span class="mt-1 block truncate text-[0.68rem] text-muted-foreground">
            {props.contentItem.creator.displayName}
          </span>
          <span class="mt-1 flex items-center justify-between gap-2 text-[0.68rem] text-muted-foreground">
            <span class="truncate">{formatPublishedAt(props.contentItem.publishedAt)}</span>
            <span class="shrink-0">{formatDuration(props.contentItem.durationSeconds)}</span>
          </span>
        </span>
      </button>
      <Show when={props.isAuthenticated}>
        <div class="mt-2 flex items-center justify-end gap-2">
          <Show when={favoriteError()}>
            {(message) => <p class="min-w-0 flex-1 truncate text-[0.68rem] text-destructive">{message()}</p>}
          </Show>
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
  readonly onSelectPlaylist: (playlistId: string | null) => void;
  readonly onPlaylistItemAdded: () => void;
  readonly onFavoriteChanged: () => void;
}

function SelectedContentViewer(props: SelectedContentViewerProps) {
  const selectedContentItemId = createMemo(() => props.selectedContent()?.id ?? null);
  const [contentDetail] = createResource(selectedContentItemId, (id) => client.catalog.contentDetail({ id }));
  const playableSources = createMemo(() => toPlayableSources(contentDetail()?.sources ?? []));
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

    return { contentItemId, reloadKey: props.favoritesReloadKey() };
  });
  const [favoriteItems, { refetch: refetchFavoriteItems }] = createResource(selectedFavoriteSource, () =>
    client.overlays.favoriteContentItems(),
  );
  const selectedContentIsFavorite = createMemo(() => {
    const contentItemId = selectedContentItemId();
    return contentItemId !== null && (favoriteItems() ?? []).some((contentItem) => contentItem.id === contentItemId);
  });
  const [favoriteActionError, setFavoriteActionError] = createSignal<string | null>(null);
  const [favoriteActionBusy, setFavoriteActionBusy] = createSignal(false);

  createEffect(() => {
    const sources = playableSources();
    const currentSourceId = selectedSourceId();
    if (sources.length === 0) {
      setSelectedSourceId(null);
      return;
    }

    if (!sources.some((source) => source.id === currentSourceId)) {
      setSelectedSourceId(sources[0]?.id ?? null);
    }
  });

  createEffect(() => {
    const loadedPlaylists = playlists() ?? [];
    if (loadedPlaylists.length === 0) {
      setTargetPlaylistId(null);
      return;
    }

    if (!loadedPlaylists.some((playlist) => playlist.id === targetPlaylistId())) {
      setTargetPlaylistId(props.selectedPlaylistId() ?? loadedPlaylists[0]?.id ?? null);
    }
  });

  const selectedPlayableSource = createMemo(() => {
    const sources = playableSources();
    return sources.find((source) => source.id === selectedSourceId()) ?? sources[0] ?? null;
  });

  const addSelectedContentToPlaylist = async () => {
    const contentItemId = selectedContentItemId();
    const playlistId = targetPlaylistId();
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

  return (
    <section
      aria-labelledby="selected-viewer-title"
      class="min-h-[30rem] bg-background lg:min-h-0 lg:overflow-y-auto"
      data-shell-column="viewer"
      data-selected-content-item-id={selectedContentItemId() ?? ""}
    >
      <div class="p-3">
        <h2 id="selected-viewer-title" class="sr-only">Viewer</h2>
        <Switch>
          <Match when={selectedContentItemId() === null}>
            <div class="flex min-h-[18rem] items-center justify-center border border-border bg-muted px-6 text-center">
              <p class="text-sm leading-6 text-muted-foreground">Pick a catalog video to open the viewer.</p>
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
                <PlaybackSurface source={selectedPlayableSource()} title={detail().title} />
                <Show when={playableSources().length > 1}>
                  <div class="mt-3 flex justify-end">
                    <label class="sr-only" for="viewer-source-switcher">
                      Playback source
                    </label>
                    <select
                      id="viewer-source-switcher"
                      class="w-52 border border-input bg-background px-2 py-1.5 text-xs text-foreground outline-none transition focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
                      value={selectedPlayableSource()?.id ?? ""}
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
                  <FavoriteActionControls
                    isFavorite={selectedContentIsFavorite()}
                    loading={favoriteItems.loading}
                    busy={favoriteActionBusy()}
                    actionError={favoriteActionError()}
                    onToggle={toggleSelectedContentFavorite}
                  />
                  <PlaylistAddControls
                    playlists={playlists() ?? []}
                    loading={playlists.loading}
                    error={playlists.error}
                    selectedPlaylistId={targetPlaylistId()}
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
          <video class="h-full w-full" src={props.source?.url ?? ""} controls preload="metadata">
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
            <For each={props.detail?.feeds ?? []}>{(feed) => <FeedRow feed={feed} />}</For>
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

export default function AppShell() {
  const session = authClient.useSession();
  const isAuthenticated = createMemo(() => !session().isPending && session().data !== null);
  const [selectedCreator, setSelectedCreator] = createSignal<CatalogCreator | null>(null);
  const [selectedContent, setSelectedContent] = createSignal<CatalogContentListItem | null>(null);
  const [selectedPlaylistId, setSelectedPlaylistId] = createSignal<string | null>(null);
  const [playlistItemsReloadKey, setPlaylistItemsReloadKey] = createSignal(0);
  const [favoritesReloadKey, setFavoritesReloadKey] = createSignal(0);
  const selectedCreatorId = createMemo(() => selectedCreator()?.id ?? null);
  const selectedContentItemId = createMemo(() => selectedContent()?.id ?? null);

  const selectCreator = (creator: CatalogCreator) => {
    setSelectedCreator(creator);
    setSelectedContent(null);
  };

  return (
    <main class={shellRootClass}>
      <div class={shellGridClass}>
        <CreatorSourceColumn
          isAuthenticated={isAuthenticated}
          selectedCreatorId={selectedCreatorId}
          selectedCreator={selectedCreator}
          selectedPlaylistId={selectedPlaylistId}
          playlistItemsReloadKey={playlistItemsReloadKey}
          onSelectCreator={selectCreator}
          onSelectPlaylist={setSelectedPlaylistId}
          onSelectContent={setSelectedContent}
        />
        <ContentListColumn
          isAuthenticated={isAuthenticated}
          selectedCreator={selectedCreator}
          selectedContentItemId={selectedContentItemId}
          favoritesReloadKey={favoritesReloadKey}
          onSelectContent={setSelectedContent}
          onFavoriteChanged={() => setFavoritesReloadKey((key) => key + 1)}
        />
        <SelectedContentViewer
          isAuthenticated={isAuthenticated}
          selectedContent={selectedContent}
          selectedPlaylistId={selectedPlaylistId}
          favoritesReloadKey={favoritesReloadKey}
          onSelectPlaylist={setSelectedPlaylistId}
          onPlaylistItemAdded={() => setPlaylistItemsReloadKey((key) => key + 1)}
          onFavoriteChanged={() => setFavoritesReloadKey((key) => key + 1)}
        />
      </div>
    </main>
  );
}
