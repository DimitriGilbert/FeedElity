import type { CatalogContentDetail, CatalogContentListItem, CatalogContentSource, Playlist, UserContentStatus, UserSetting } from "@FeedElity/api";
import { For, Match, Show, Switch, createMemo, createResource, createSignal } from "solid-js";
import ArrowLeft from "lucide-solid/icons/arrow-left";
import CircleCheck from "lucide-solid/icons/circle-check";
import CirclePlay from "lucide-solid/icons/circle-play";
import Clapperboard from "lucide-solid/icons/clapperboard";
import ExternalLink from "lucide-solid/icons/external-link";
import Eye from "lucide-solid/icons/eye";
import EyeOff from "lucide-solid/icons/eye-off";
import Heart from "lucide-solid/icons/heart";
import Plus from "lucide-solid/icons/plus";
import Shield from "lucide-solid/icons/shield";
import ShieldOff from "lucide-solid/icons/shield-off";

import { client } from "@/utils/orpc";

import { SettingsColumnSection } from "./app-shell-source-sections";
import {
  formatError,
  formatContentDuration,
  formatContentPublishedAt,
  formatSourceLabel,
  toContentStatusFlags,
  toPlayableSources,
  viewerColumnClass,
  viewerScrollRegionClass,
  type PlayableSource,
  type ViewerMode,
} from "./app-shell.contract";
import { SourceTypeIcon } from "./source-indicator";

const emptyCatalogContentItems: readonly CatalogContentListItem[] = [];

const emptyCatalogContentSources: readonly CatalogContentSource[] = [];

const emptyPlaylists: readonly Playlist[] = [];

export interface SelectedContentViewerProps {
  readonly isAuthenticated: () => boolean;
  readonly selectedContent: () => CatalogContentListItem | null;
  readonly selectedPlaylistId: () => string | null;
  readonly contentStatuses: () => readonly UserContentStatus[];
  readonly contentStatusesLoading: () => boolean;
  readonly statusSelectionError: () => string | null;
  readonly viewerMode: () => ViewerMode;
  readonly settings: () => readonly UserSetting[];
  readonly settingsUnavailable: () => boolean;
  readonly onCloseSettings: () => void;
  readonly onSettingsChanged: () => Promise<void>;
  readonly onSelectPlaylist: (playlistId: string | null) => void;
  readonly onPlaylistItemAdded: () => void;
  readonly onFavoriteChanged: () => void;
  readonly onMarkContentOpened: (contentItemId: string) => Promise<void>;
  readonly onMarkContentPlayed: (contentItemId: string) => Promise<void>;
  readonly onAutoMarkContentPlayed: (contentItemId: string) => Promise<void>;
}

export function SelectedContentViewer(props: SelectedContentViewerProps) {
  const selectedContentItemId = createMemo(() => props.selectedContent()?.id ?? null);
  const [contentDetail] = createResource(selectedContentItemId, (id) => client.catalog.contentDetail({ id }));
  const contentDetailValue = createMemo(() => contentDetail.latest);
  const [useNoCookieEmbed, setUseNoCookieEmbed] = createSignal(true);
  const playableSources = createMemo(() => {
    const noCookie = useNoCookieEmbed();
    const sources = contentDetail.latest?.sources ?? emptyCatalogContentSources;
    return toPlayableSources(noCookie ? sources : sources.map((source) => ({
      ...source,
      embedUrl: source.sourceType === "youtube" && source.embedUrl !== null
        ? source.embedUrl.replace("youtube-nocookie.com", "youtube.com")
        : source.embedUrl,
    })));
  });
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

    return contentItemId;
  });
  const [favoriteItems, { refetch: refetchFavoriteItems }] = createResource(selectedFavoriteSource, () =>
    client.overlays.favoriteContentItems(),
  );
  // Read favoriteItems via .latest so a refetch never re-suspends up to the
  // viewer's <Suspense> and tears down the playing video. The viewer refetches
  // in place after a toggle (refetchFavoriteItems) instead of re-keying.
  const favoriteItemsValue = createMemo(() => favoriteItems.latest);
  const selectedContentIsFavorite = createMemo(() => {
    const contentItemId = selectedContentItemId();
    return contentItemId !== null && (favoriteItemsValue() ?? emptyCatalogContentItems).some((contentItem) => contentItem.id === contentItemId);
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
  const hasYouTubeSource = createMemo(() =>
    playableSources().some((source) => source.sourceType === "youtube"),
  );
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

  const toggleSelectedContentOpened = async () => {
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

  const toggleSelectedContentPlayed = async () => {
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

  const autoMarkSelectedContentPlayed = async () => {
    const contentItemId = selectedContentItemId();
    if (!props.isAuthenticated() || contentItemId === null) {
      return;
    }

    setStatusActionError(null);
    try {
      await props.onAutoMarkContentPlayed(contentItemId);
    } catch (error) {
      setStatusActionError(formatError(error));
    }
  };

  return (
    <section
      aria-label="Viewer"
      class={viewerColumnClass}
      data-shell-column="viewer"
      data-selected-content-item-id={selectedContentItemId() ?? ""}
    >
      <div class={viewerScrollRegionClass} data-viewer-scroll-region>
        <Show when={props.viewerMode() === "settings"}>
          <div data-settings-viewer>
            <div class="flex items-center gap-2 border-b border-border px-1 py-2">
              <button
                type="button"
                class="shrink-0 border border-border bg-background p-1.5 text-muted-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                aria-label="Close settings"
                title="Close settings"
                onClick={props.onCloseSettings}
              >
                <ArrowLeft size={14} />
              </button>
              <h3 class="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Settings</h3>
            </div>
            <SettingsColumnSection
              settings={props.settings}
              settingsUnavailable={props.settingsUnavailable}
              onSettingsChanged={props.onSettingsChanged}
            />
          </div>
        </Show>
        <Show when={props.viewerMode() === "content"}>
          <Switch>
          <Match when={selectedContentItemId() === null}>
            <div class="flex min-h-[18rem] flex-col items-center justify-center gap-3 rounded-lg border border-border bg-muted px-6 py-10 text-center">
              <Clapperboard size={32} class="text-muted-foreground" stroke-width={1.5} aria-hidden="true" />
              <p class="text-sm leading-6 text-muted-foreground">Pick a video to open the viewer.</p>
            </div>
          </Match>
          <Match when={contentDetail.error !== undefined && contentDetailValue() === undefined}>
            <div class="border border-border bg-card p-4">
              <p class="text-sm font-semibold text-destructive">Video unavailable</p>
              <p class="mt-2 text-sm leading-6 text-muted-foreground">{formatError(contentDetail.error)}</p>
            </div>
          </Match>
          <Match when={contentDetail.loading && contentDetailValue() === undefined}>
            <div class="flex flex-col gap-3">
              <div class="aspect-video w-full animate-pulse rounded-lg border border-border bg-muted" />
              <div class="space-y-2">
                <div class="h-5 w-3/4 animate-pulse rounded bg-muted" />
                <div class="h-4 w-1/2 animate-pulse rounded bg-muted" />
              </div>
            </div>
          </Match>
          <Match when={contentDetailValue()}>
            {(detail) => (
              <div class="min-w-0">
                <PlaybackSurface
                  source={selectedPlayableSource()}
                  title={detail().title}
                  onNativePlay={autoMarkSelectedContentPlayed}
                />
                <Show when={props.isAuthenticated()}>
                  <div class="mt-2 flex flex-wrap items-center gap-1.5">
                    <Show when={props.statusSelectionError()}>
                      {(message) => <p class="text-xs text-destructive">{message()}</p>}
                    </Show>
                    <Show when={statusActionError()}>
                      {(message) => <p class="text-xs text-destructive">{message()}</p>}
                    </Show>
                    <Show when={favoriteActionError()}>
                      {(message) => <p class="text-xs text-destructive">{message()}</p>}
                    </Show>
                    <Show when={playlistActionError()}>
                      {(message) => <p class="text-xs text-destructive">{message()}</p>}
                    </Show>
                    <button
                      type="button"
                      class="inline-flex items-center justify-center gap-1 rounded-md border border-border p-1.5 text-card-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
                      aria-pressed={selectedContentStatus().opened}
                      aria-label={selectedContentStatus().opened ? "Unmark opened" : "Mark opened"}
                      title={selectedContentStatus().opened ? "Unmark opened" : "Mark opened"}
                      disabled={props.contentStatusesLoading() || statusActionBusy() !== null}
                      onClick={toggleSelectedContentOpened}
                    >
                      {selectedContentStatus().opened ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                    <button
                      type="button"
                      class="inline-flex items-center justify-center gap-1 rounded-md border border-border p-1.5 text-card-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
                      aria-pressed={selectedContentStatus().played}
                      aria-label={selectedContentStatus().played ? "Unmark played" : "Mark played"}
                      title={selectedContentStatus().played ? "Unmark played" : "Mark played"}
                      disabled={props.contentStatusesLoading() || statusActionBusy() !== null}
                      onClick={toggleSelectedContentPlayed}
                    >
                      {selectedContentStatus().played ? <CircleCheck size={14} /> : <CirclePlay size={14} />}
                    </button>
                    <button
                      type="button"
                      class={`inline-flex items-center justify-center gap-1 rounded-md border border-border p-1.5 transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60 ${selectedContentIsFavorite() ? "text-primary" : "text-card-foreground"}`}
                      aria-pressed={selectedContentIsFavorite()}
                      aria-label={selectedContentIsFavorite() ? "Remove favorite" : "Favorite"}
                      title={selectedContentIsFavorite() ? "Remove favorite" : "Favorite"}
                      disabled={favoriteItems.loading || favoriteActionBusy()}
                      onClick={toggleSelectedContentFavorite}
                    >
                      <Heart size={14} />
                    </button>
                    <Show when={(playlists() ?? emptyPlaylists).length > 0}>
                      <label class="sr-only" for="viewer-playlist-target">Save to playlist</label>
                      <select
                        id="viewer-playlist-target"
                        class="min-w-0 max-w-32 border border-input bg-background px-1.5 py-1 text-xs text-foreground outline-none transition focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
                        value={effectiveTargetPlaylistId() ?? ""}
                        onChange={(event) => setTargetPlaylistId(event.currentTarget.value)}
                      >
                        <For each={playlists() ?? emptyPlaylists}>{(playlist) => <option value={playlist.id}>{playlist.name}</option>}</For>
                      </select>
                      <button
                        type="button"
                        class="inline-flex items-center justify-center gap-1 rounded-md border border-border p-1.5 text-card-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
                        aria-label="Add to playlist"
                        title="Add to playlist"
                        disabled={playlistActionBusy() || effectiveTargetPlaylistId() === null}
                        onClick={addSelectedContentToPlaylist}
                      >
                        <Plus size={14} />
                      </button>
                    </Show>
                  </div>
                </Show>
                <Show when={playableSources().length > 1}>
                  <div class="mt-2 flex items-center justify-between gap-2" id="viewer-source-switcher">
                    <div class="inline-flex" role="group" aria-label={playbackSourceSwitcherLabel()}>
                      <For each={playableSources()}>
                        {(source) => {
                          const isActive = createMemo(() => selectedPlayableSource()?.id === source.id);
                          const compactLabel = createMemo(() => formatSourceLabel(source.sourceType));
                          return (
                            <button
                              type="button"
                              class={`inline-flex items-center gap-1 border border-border px-2 py-1 text-xs font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${isActive() ? "bg-accent text-accent-foreground" : "bg-background text-foreground hover:bg-accent hover:text-accent-foreground"}`}
                              aria-label={source.label}
                              aria-pressed={isActive()}
                              onClick={() => setSelectedSourceId(source.id)}
                            >
                              <SourceTypeIcon sourceType={source.sourceType} />
                              {compactLabel()}
                            </button>
                          );
                        }}
                      </For>
                    </div>
                    <Show when={hasYouTubeSource()}>
                      <button
                        type="button"
                        class="inline-flex items-center gap-1 border border-border px-2 py-1 text-xs text-muted-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                        aria-label={useNoCookieEmbed() ? "Using privacy-enhanced embed" : "Using standard YouTube embed"}
                        title={useNoCookieEmbed() ? "Privacy mode (click for standard)" : "Standard mode (click for privacy)"}
                        onClick={() => setUseNoCookieEmbed((prev) => !prev)}
                      >
                        {useNoCookieEmbed() ? <Shield size={12} /> : <ShieldOff size={12} />}
                        <span class="text-xs">{useNoCookieEmbed() ? "Privacy" : "Standard"}</span>
                      </button>
                    </Show>
                  </div>
                </Show>
                <Show when={playableSources().length === 1 && hasYouTubeSource()}>
                  <div class="mt-2 flex justify-end">
                    <button
                      type="button"
                      class="inline-flex items-center gap-1 border border-border px-2 py-1 text-xs text-muted-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      aria-label={useNoCookieEmbed() ? "Using privacy-enhanced embed" : "Using standard YouTube embed"}
                      title={useNoCookieEmbed() ? "Privacy mode (click for standard)" : "Standard mode (click for privacy)"}
                      onClick={() => setUseNoCookieEmbed((prev) => !prev)}
                    >
                      {useNoCookieEmbed() ? <Shield size={12} /> : <ShieldOff size={12} />}
                      <span class="text-xs">{useNoCookieEmbed() ? "Privacy" : "Standard"}</span>
                    </button>
                  </div>
                </Show>
                <ContentDetailBody detail={detail()} />
              </div>
            )}
          </Match>
          </Switch>
        </Show>
      </div>
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
    <div class="aspect-video overflow-hidden rounded-lg border border-border bg-muted">
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
    <article class="mt-3 space-y-2">
      <div>
        <h3 class="text-lg font-semibold tracking-tight text-foreground">{props.detail.title}</h3>
        <p class="mt-1 text-sm text-muted-foreground">
          {props.detail.creator.displayName} · {formatContentPublishedAt(props.detail.publishedAt)}
          <Show when={props.detail.durationSeconds !== null}>
            {" · "}{formatContentDuration(props.detail.durationSeconds)}
          </Show>
        </p>
      </div>
      <Show when={props.detail.description}>
        {(description) => <p class="whitespace-pre-line text-sm leading-6 text-foreground">{description()}</p>}
      </Show>
      <Show when={props.detail.canonicalUrl}>
        {(canonicalUrl) => (
          <a
            class="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs font-semibold text-card-foreground transition hover:border-ring hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            href={canonicalUrl()}
            aria-label="Open original"
            title="Open original"
            rel="noreferrer"
            target="_blank"
          >
            <ExternalLink size={12} />
          </a>
        )}
      </Show>
    </article>
  );
}
