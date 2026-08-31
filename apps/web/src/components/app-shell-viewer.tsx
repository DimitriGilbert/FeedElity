import type { CatalogContentDetail, CatalogContentListItem, CatalogContentSource, CatalogCreatorSummary, Playlist, UserContentStatus, UserSetting } from "@FeedElity/api";
import { For, Match, Show, Switch, createEffect, createMemo, createResource, createSignal, on, onCleanup, onMount } from "solid-js";
import ArrowLeft from "lucide-solid/icons/arrow-left";
import CircleCheck from "lucide-solid/icons/circle-check";
import CirclePlay from "lucide-solid/icons/circle-play";
import Clapperboard from "lucide-solid/icons/clapperboard";
import Copy from "lucide-solid/icons/copy";
import ExternalLink from "lucide-solid/icons/external-link";
import Eye from "lucide-solid/icons/eye";
import EyeOff from "lucide-solid/icons/eye-off";
import Heart from "lucide-solid/icons/heart";
import Plus from "lucide-solid/icons/plus";
import Shield from "lucide-solid/icons/shield";
import ShieldOff from "lucide-solid/icons/shield-off";

import { createYouTubePlaybackTracker, type YouTubePlaybackTracker } from "@/lib/youtube-player-bridge";
import { client } from "@/utils/orpc";

import { SettingsColumnSection } from "./app-shell-source-sections";
import {
  formatError,
  formatContentDuration,
  formatContentPublishedAt,
  formatSourceLabel,
  isYouTubeEmbedUrl,
  isResumablePlaybackPosition,
  shouldFlushPlaybackPosition,
  toContentStatusFlags,
  toEmbedUrlWithApi,
  toPlaybackPosition,
  toCopyableStreamLink,
  toPlayableSources,
  toYoutubeNoCookieFromSettings,
  viewerColumnClass,
  viewerScrollRegionClass,
  youtubePrivacySettingKey,
  type PlaybackPosition,
  type PlayableSource,
  type ViewerMode,
} from "./app-shell.contract";
import { SourceTypeIcon } from "./source-indicator";

const emptyCatalogContentItems: readonly CatalogContentListItem[] = [];

const emptyCatalogContentSources: readonly CatalogContentSource[] = [];

const emptyPlaylists: readonly Playlist[] = [];

// How long the "Copy stream URL" button shows its "Copied" flash before
// reverting to the normal label.
const copyFeedbackResetMs = 2_000;

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
  readonly onSelectCreator: (creator: CatalogCreatorSummary) => void;
  readonly onSelectContent: (contentItem: CatalogContentListItem) => Promise<void>;
  readonly onPlaylistItemAdded: () => void;
  readonly onFavoriteChanged: () => void;
  readonly onMarkContentOpened: (contentItemId: string) => Promise<void>;
  readonly onMarkContentPlayed: (contentItemId: string) => Promise<void>;
  readonly onAutoMarkContentPlayed: (contentItemId: string) => Promise<void>;
  readonly onPlaybackPositionSaved: (status: UserContentStatus) => void;
}

export function SelectedContentViewer(props: SelectedContentViewerProps) {
  const selectedContentItemId = createMemo(() => props.selectedContent()?.id ?? null);
  const [contentDetail] = createResource(selectedContentItemId, (id) => client.catalog.contentDetail({ id }));
  const contentDetailValue = createMemo(() => contentDetail.latest);
  // The YouTube no-cookie preference seeds from the user settings the viewer
  // already receives and re-converges whenever those settings refetch
  // (including after our own save below). Anonymous users keep a session-local
  // toggle: nothing is saved without an authenticated session.
  const [useNoCookieEmbed, setUseNoCookieEmbed] = createSignal(toYoutubeNoCookieFromSettings(props.settings()));
  createEffect(() => {
    setUseNoCookieEmbed(toYoutubeNoCookieFromSettings(props.settings()));
  });
  const [noCookieSavePending, setNoCookieSavePending] = createSignal(false);
  const [noCookieActionError, setNoCookieActionError] = createSignal<string | null>(null);

  const toggleNoCookieEmbed = async () => {
    // Serialize authenticated saves: a second click while one is in flight
    // could otherwise race the server and persist the older value while the
    // label shows the newer one.
    if (noCookieSavePending()) {
      return;
    }

    // Capture the current value so a failed authenticated save can revert the
    // optimistic flip instead of leaving the label diverged from the server
    // until the next toggle. Anonymous users keep a session-local flip with
    // nothing to save and nothing to revert.
    const previous = useNoCookieEmbed();
    const next = !previous;
    setUseNoCookieEmbed(next);
    if (!props.isAuthenticated()) {
      return;
    }

    setNoCookieActionError(null);
    setNoCookieSavePending(true);
    try {
      await client.overlays.saveSetting({ key: youtubePrivacySettingKey, value: next ? "true" : "false" });
      await props.onSettingsChanged();
    } catch (error) {
      setUseNoCookieEmbed(previous);
      setNoCookieActionError(formatError(error));
    } finally {
      setNoCookieSavePending(false);
    }
  };
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
  // Read playlists via .latest so refetchPlaylists (after adding a video to a
  // playlist) never re-suspends: the viewer column is not wrapped in any
  // <Suspense>, so a plain read would bubble to the route-level boundary and
  // blank the app.
  const playlistsValue = createMemo(() => playlists.latest);
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
  // F5: "Copy stream URL" copies the selected source's native media URL (or the
  // canonical page link for embed-only items) so it can be handed to mpv or
  // yt-dlp. The "Copied" flash self-clears after two seconds; the timer is
  // cleared on disposal and before each re-arm, so it can neither leak past
  // unmount nor clear a newer flash early.
  const copyStreamLink = createMemo(() => toCopyableStreamLink(selectedPlayableSource()));
  const [streamUrlCopied, setStreamUrlCopied] = createSignal(false);
  const [copyStreamError, setCopyStreamError] = createSignal<string | null>(null);
  const copyControlTitle = createMemo(() => {
    if (streamUrlCopied()) {
      return "Copied";
    }

    const source = selectedPlayableSource();
    if (source === null) {
      return "";
    }

    return source.kind === "native" ? "Stream URL for mpv/yt-dlp" : "Page link for mpv/yt-dlp";
  });
  let copyFeedbackTimerId: ReturnType<typeof setTimeout> | undefined;
  const clearCopyFeedbackTimer = () => {
    if (copyFeedbackTimerId !== undefined) {
      clearTimeout(copyFeedbackTimerId);
      copyFeedbackTimerId = undefined;
    }
  };
  onCleanup(clearCopyFeedbackTimer);

  const copyStreamUrl = async () => {
    const link = copyStreamLink();
    if (link === null) {
      return;
    }

    setCopyStreamError(null);
    try {
      // navigator.clipboard is absent in insecure contexts; the access throws
      // inside the try and is surfaced as a visible error below.
      await navigator.clipboard.writeText(link.url);
    } catch (error) {
      setStreamUrlCopied(false);
      setCopyStreamError(`Copy failed: ${formatError(error)}`);
      return;
    }

    setStreamUrlCopied(true);
    clearCopyFeedbackTimer();
    copyFeedbackTimerId = setTimeout(() => {
      copyFeedbackTimerId = undefined;
      setStreamUrlCopied(false);
    }, copyFeedbackResetMs);
  };
  const effectiveTargetPlaylistId = createMemo(() => {
    const loadedPlaylists = playlistsValue() ?? emptyPlaylists;
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

  // D2: auto "played" fires once per selected content id from NEAR-END/ended
  // playback; the flag resets whenever the selection changes so a later replay
  // of the same video re-arms it.
  let autoMarkPlayedHandled = false;
  const autoMarkSelectedContentPlayed = async () => {
    const contentItemId = selectedContentItemId();
    if (!props.isAuthenticated() || contentItemId === null) {
      return;
    }

    if (autoMarkPlayedHandled) {
      return;
    }

    autoMarkPlayedHandled = true;
    setStatusActionError(null);
    try {
      await props.onAutoMarkContentPlayed(contentItemId);
    } catch (error) {
      setStatusActionError(formatError(error));
    }
  };

  // ---- Playback position tracking (F1b) ---------------------------------
  // Only tracked surfaces report positions (native <video> and YouTube embeds
  // through the IFrame API bridge); PeerTube/Odysee embeds render untracked.
  // The surfaces own the per-session shouldFlushPlaybackPosition throttle, so
  // every report that arrives here is worth saving. Saves are gated on the
  // authenticated session; failures are logged with context (a handled
  // degradation — background position saves have no action for the user) and
  // never interrupt playback.
  let lastKnownPlayback: {
    readonly contentItemId: string;
    readonly positionSeconds: number;
    readonly durationSeconds: number | null;
  } | null = null;

  const savePlaybackPosition = async (
    contentItemId: string,
    positionSeconds: number,
    durationSeconds: number | null,
  ): Promise<void> => {
    // Mirrors the server's zod bounds (0..86400 integer); clamping keeps saves
    // for ultra-long videos working instead of failing validation forever.
    const boundedPositionSeconds = Math.min(86_400, Math.max(0, Math.floor(positionSeconds)));
    const boundedDurationSeconds = durationSeconds === null ? null : Math.min(86_400, Math.max(0, Math.floor(durationSeconds)));
    try {
      const result = await client.overlays.savePlaybackPosition({
        contentItemId,
        positionSeconds: boundedPositionSeconds,
        ...(boundedDurationSeconds === null ? {} : { durationSeconds: boundedDurationSeconds }),
      });
      props.onPlaybackPositionSaved(result.status);
    } catch (error) {
      console.error(`Playback position save failed for content item ${contentItemId}.`, error);
    }
  };

  const handlePlaybackPositionUpdate = (positionSeconds: number, durationSeconds: number | null): void => {
    const contentItemId = selectedContentItemId();
    if (!props.isAuthenticated() || contentItemId === null) {
      return;
    }

    lastKnownPlayback = { contentItemId, positionSeconds, durationSeconds };
    void savePlaybackPosition(contentItemId, positionSeconds, durationSeconds);
  };

  // Flushes the last reported position under ITS OWN content id tag, so a
  // flush fired after the selection moved on can never land on the new item.
  const flushLastKnownPlaybackPosition = (): void => {
    const known = lastKnownPlayback;
    if (known === null || !props.isAuthenticated()) {
      return;
    }

    void savePlaybackPosition(known.contentItemId, known.positionSeconds, known.durationSeconds);
  };

  // Last-chance flushes: selection change (previous item's tail), page hide,
  // tab hiding, and viewer teardown — all force-saved through the same
  // idempotent, id-tagged save.
  createEffect(
    on(selectedContentItemId, () => {
      flushLastKnownPlaybackPosition();
      autoMarkPlayedHandled = false;
    }, { defer: true }),
  );
  onMount(() => {
    const handlePageHide = () => {
      flushLastKnownPlaybackPosition();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flushLastKnownPlaybackPosition();
      }
    };
    window.addEventListener("pagehide", handlePageHide);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    onCleanup(() => {
      window.removeEventListener("pagehide", handlePageHide);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    });
  });
  onCleanup(() => {
    flushLastKnownPlaybackPosition();
  });

  // Resume position for the selected item, read from the opened row's
  // metadataJson. The active playback surfaces read this once per session so
  // later position patches never rewrite a live player's source. Near-finished
  // positions are suppressed here (single gate for BOTH surfaces): the YouTube
  // start param path only knows `positionSeconds >= 10`, so without this check
  // a saved position 5s before the end would resume at the tail.
  const selectedResumePosition = createMemo(() => {
    const contentItemId = selectedContentItemId();
    if (contentItemId === null) {
      return null;
    }

    const openedStatus = props.contentStatuses().find(
      (status) => status.contentItemId === contentItemId && status.status === "opened",
    );
    if (openedStatus === undefined) {
      return null;
    }

    const position = toPlaybackPosition(openedStatus.metadataJson);
    return position !== null && isResumablePlaybackPosition(position) ? position : null;
  });

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
                  contentItemId={selectedContentItemId() ?? ""}
                  resumePosition={selectedResumePosition}
                  onPositionUpdate={handlePlaybackPositionUpdate}
                  onNearEnd={autoMarkSelectedContentPlayed}
                  onExplicitEnded={autoMarkSelectedContentPlayed}
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
                    <Show when={noCookieActionError()}>
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
                    <Show when={(playlistsValue() ?? emptyPlaylists).length > 0}>
                      <label class="sr-only" for="viewer-playlist-target">Save to playlist</label>
                      <select
                        id="viewer-playlist-target"
                        class="min-w-0 max-w-32 border border-input bg-background px-1.5 py-1 text-xs text-foreground outline-none transition focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
                        value={effectiveTargetPlaylistId() ?? ""}
                        onChange={(event) => setTargetPlaylistId(event.currentTarget.value)}
                      >
                        <For each={playlistsValue() ?? emptyPlaylists}>{(playlist) => <option value={playlist.id}>{playlist.name}</option>}</For>
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
                        class="inline-flex items-center gap-1 border border-border px-2 py-1 text-xs text-muted-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
                        aria-label={noCookieSavePending()
                          ? "Saving privacy preference"
                          : useNoCookieEmbed()
                          ? "Using privacy-enhanced embed"
                          : "Using standard YouTube embed"}
                        title={noCookieSavePending()
                          ? "Saving privacy preference"
                          : useNoCookieEmbed()
                          ? "Privacy mode (click for standard)"
                          : "Standard mode (click for privacy)"}
                        disabled={noCookieSavePending()}
                        onClick={toggleNoCookieEmbed}
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
                      class="inline-flex items-center gap-1 border border-border px-2 py-1 text-xs text-muted-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
                      aria-label={noCookieSavePending()
                        ? "Saving privacy preference"
                        : useNoCookieEmbed()
                        ? "Using privacy-enhanced embed"
                        : "Using standard YouTube embed"}
                      title={noCookieSavePending()
                        ? "Saving privacy preference"
                        : useNoCookieEmbed()
                        ? "Privacy mode (click for standard)"
                        : "Standard mode (click for privacy)"}
                      disabled={noCookieSavePending()}
                      onClick={toggleNoCookieEmbed}
                    >
                      {useNoCookieEmbed() ? <Shield size={12} /> : <ShieldOff size={12} />}
                      <span class="text-xs">{useNoCookieEmbed() ? "Privacy" : "Standard"}</span>
                    </button>
                  </div>
                </Show>
                <Show when={copyStreamLink()}>
                  {(link) => (
                    <div class="mt-2 flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        class="inline-flex items-center gap-1 border border-border bg-background px-2 py-1 text-xs font-semibold text-card-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                        data-copy-stream-url
                        aria-label={copyControlTitle()}
                        title={copyControlTitle()}
                        onClick={copyStreamUrl}
                      >
                        <Copy size={12} />
                        <span>{streamUrlCopied() ? "Copied" : link().label}</span>
                      </button>
                      <Show when={copyStreamError()}>
                        {(message) => <p class="text-xs text-destructive">{message()}</p>}
                      </Show>
                    </div>
                  )}
                </Show>
                <Show when={detail().mirrors.length > 0}>
                  <div class="mt-2 flex flex-wrap items-center gap-1.5" data-viewer-mirror-switcher>
                    <span class="text-xs font-semibold text-muted-foreground">Also on</span>
                    <For each={detail().mirrors}>
                      {(mirror) => (
                        <button
                          type="button"
                          class="inline-flex items-center gap-1 border border-border bg-background px-2 py-1 text-xs font-semibold text-card-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                          title={mirror.title}
                          aria-label={`Also on ${formatSourceLabel(mirror.sourceType)}: ${mirror.title}`}
                          data-viewer-mirror-option
                          onClick={() => {
                            void props.onSelectContent(mirror);
                          }}
                        >
                          <SourceTypeIcon sourceType={mirror.sourceType} />
                          {formatSourceLabel(mirror.sourceType)}
                        </button>
                      )}
                    </For>
                  </div>
                </Show>
                <ContentDetailBody detail={detail()} onCreatorClick={props.onSelectCreator} />
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
  readonly contentItemId: string;
  readonly resumePosition: () => PlaybackPosition | null;
  readonly onPositionUpdate: (positionSeconds: number, durationSeconds: number | null) => void;
  readonly onNearEnd: () => void;
  readonly onExplicitEnded: () => void;
}

function PlaybackSurface(props: PlaybackSurfaceProps) {
  // Tracked YouTube embeds get the IFrame API bridge; every other embed
  // (PeerTube, Odysee) renders its bare embed URL with NO tracker, and native
  // media tracks through <video> media events. Keyed matches remount the
  // active player per source identity, so each playback session (content or
  // source switch) gets a fresh tracker, throttle clock, and near-end guard.
  const trackedEmbedSource = createMemo(() => {
    const source = props.source;
    if (source !== null && source.kind === "embed" && isYouTubeEmbedUrl(source.url)) {
      return source;
    }

    return undefined;
  });
  const bareEmbedSource = createMemo(() => {
    const source = props.source;
    if (source !== null && source.kind === "embed" && !isYouTubeEmbedUrl(source.url)) {
      return source;
    }

    return undefined;
  });
  const nativeSource = createMemo(() => {
    const source = props.source;
    if (source !== null && source.kind === "native") {
      return source;
    }

    return undefined;
  });

  return (
    <div class="aspect-video overflow-hidden rounded-lg border border-border bg-muted">
      <Switch>
        <Match when={trackedEmbedSource()}>
          {(source) => (
            <TrackedEmbedPlayer
              source={source()}
              title={props.title}
              contentItemId={props.contentItemId}
              resumePosition={props.resumePosition}
              onPositionUpdate={props.onPositionUpdate}
              onNearEnd={props.onNearEnd}
              onExplicitEnded={props.onExplicitEnded}
            />
          )}
        </Match>
        <Match when={bareEmbedSource()}>
          {(source) => (
            <iframe
              class="h-full w-full"
              src={source().url}
              title={props.title}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowfullscreen
              referrerpolicy="strict-origin-when-cross-origin"
            />
          )}
        </Match>
        <Match when={nativeSource()}>
          {(source) => (
            <NativeVideoPlayer
              source={source()}
              contentItemId={props.contentItemId}
              resumePosition={props.resumePosition}
              onPositionUpdate={props.onPositionUpdate}
              onNearEnd={props.onNearEnd}
              onExplicitEnded={props.onExplicitEnded}
            />
          )}
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

interface TrackedEmbedPlayerProps {
  readonly source: PlayableSource;
  readonly title: string;
  readonly contentItemId: string;
  readonly resumePosition: () => PlaybackPosition | null;
  readonly onPositionUpdate: (positionSeconds: number, durationSeconds: number | null) => void;
  readonly onNearEnd: () => void;
  readonly onExplicitEnded: () => void;
}

function TrackedEmbedPlayer(props: TrackedEmbedPlayerProps) {
  let iframeEl: HTMLIFrameElement | undefined;
  let tracker: YouTubePlaybackTracker | null = null;
  // Session-scoped throttle clock, last-known position, and near-end guard; a
  // fresh surface (content or source switch) starts a fresh session and
  // disposes the old one here.
  let lastSavedSeconds: number | null = null;
  let lastSavedAtMs: number | null = null;
  let lastKnownPositionSeconds: number | null = null;
  let lastKnownDurationSeconds: number | null = null;
  let nearEndReported = false;
  // The content item this playback session belongs to, captured once at
  // creation so a cleanup flush that fires after the selection moved on can
  // be skipped (the viewer's id-tagged flush already saved that tail).
  const sessionContentItemId = props.contentItemId;
  // The embed src is frozen at creation: resumePosition is read exactly once
  // so later position patches (from our own saves) can never rewrite the
  // iframe src and reload the player mid-playback. Resume itself rides the
  // start param (floor >= 10s, Phase 4 consumes the same helper for restore).
  const embedSrc = toEmbedUrlWithApi(props.source.url, window.location.origin, props.resumePosition()?.positionSeconds) ?? props.source.url;

  const reportThrottledPosition = (positionSeconds: number, durationSeconds: number | null): void => {
    lastKnownPositionSeconds = positionSeconds;
    lastKnownDurationSeconds = durationSeconds;
    if (!shouldFlushPlaybackPosition({ lastSavedSeconds, nextSeconds: positionSeconds, lastSavedAtMs, nowMs: Date.now(), force: false })) {
      return;
    }

    lastSavedSeconds = positionSeconds;
    lastSavedAtMs = Date.now();
    props.onPositionUpdate(positionSeconds, durationSeconds);
  };

  onMount(() => {
    if (iframeEl === undefined) {
      return;
    }

    tracker = createYouTubePlaybackTracker({
      iframe: iframeEl,
      onPosition: (position) => {
        // D2 near-end detection, mirroring the native surface: within 30s of
        // the end or past 90% when the duration is known; fired exactly once
        // per playback session (keyed remounts re-arm the guard above).
        if (
          position.durationSeconds !== null &&
          !nearEndReported &&
          (position.positionSeconds >= position.durationSeconds - 30 || position.positionSeconds >= position.durationSeconds * 0.9)
        ) {
          nearEndReported = true;
          props.onNearEnd();
        }

        if (position.ended) {
          // The ended report carries the final position: deliver unthrottled.
          lastKnownPositionSeconds = position.positionSeconds;
          lastKnownDurationSeconds = position.durationSeconds;
          lastSavedSeconds = position.positionSeconds;
          lastSavedAtMs = Date.now();
          props.onPositionUpdate(position.positionSeconds, position.durationSeconds);
          return;
        }

        reportThrottledPosition(position.positionSeconds, position.durationSeconds);
      },
      onEnded: props.onExplicitEnded,
    });
  });

  onCleanup(() => {
    tracker?.dispose();
    tracker = null;
    // Flush the last known embed position on video switch/close — but not when
    // the selection already changed (that tail was flushed under its own id).
    if (props.contentItemId !== sessionContentItemId) {
      return;
    }
    // The save is idempotent, so duplicating the final throttled save is
    // harmless.
    if (lastKnownPositionSeconds !== null) {
      props.onPositionUpdate(lastKnownPositionSeconds, lastKnownDurationSeconds);
    }
  });

  return (
    <iframe
      class="h-full w-full"
      src={embedSrc}
      title={props.title}
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
      allowfullscreen
      referrerpolicy="strict-origin-when-cross-origin"
      ref={(el) => { iframeEl = el; }}
    />
  );
}

interface NativeVideoPlayerProps {
  readonly source: PlayableSource;
  readonly contentItemId: string;
  readonly resumePosition: () => PlaybackPosition | null;
  readonly onPositionUpdate: (positionSeconds: number, durationSeconds: number | null) => void;
  readonly onNearEnd: () => void;
  readonly onExplicitEnded: () => void;
}

function NativeVideoPlayer(props: NativeVideoPlayerProps) {
  let videoEl: HTMLVideoElement | undefined;
  // Session-scoped throttle clock and guards; fresh per mounted <video>.
  let lastSavedSeconds: number | null = null;
  let lastSavedAtMs: number | null = null;
  let nearEndReported = false;
  let explicitEndedReported = false;
  // The content item this playback session belongs to, captured once at
  // creation so a cleanup flush that fires after the selection moved on can
  // be skipped (the viewer's id-tagged flush already saved that tail).
  const sessionContentItemId = props.contentItemId;

  const toNativeDuration = (video: HTMLVideoElement): number | null => {
    const duration = video.duration;
    return typeof duration === "number" && Number.isFinite(duration) && duration > 0 ? duration : null;
  };

  onCleanup(() => {
    const video = videoEl;
    if (video === undefined) {
      return;
    }

    // Flush the freshest position on video switch/close — but not when the
    // selection already changed (that tail was flushed under its own id).
    if (props.contentItemId !== sessionContentItemId) {
      return;
    }

    // The save path is idempotent, so duplicating the final throttled save is
    // harmless.
    const position = video.currentTime;
    if (Number.isFinite(position) && position > 0) {
      props.onPositionUpdate(position, toNativeDuration(video));
    }
  });

  return (
    <video
      class="h-full w-full"
      src={props.source.url}
      controls
      preload="metadata"
      ref={(el) => { videoEl = el; }}
      onLoadedMetadata={(event) => {
        const resume = props.resumePosition();
        if (resume === null) {
          return;
        }

        const video = event.currentTarget;
        const duration = toNativeDuration(video);
        // Seek back only when meaningful video remains after the resume point;
        // reopening a finished (or nearly finished) video starts fresh instead.
        if (duration !== null && resume.positionSeconds < duration - 10) {
          video.currentTime = resume.positionSeconds;
        }
      }}
      onTimeUpdate={(event) => {
        const video = event.currentTarget;
        const position = video.currentTime;
        if (!Number.isFinite(position) || position < 0) {
          return;
        }

        const duration = toNativeDuration(video);
        // D2 near-end detection: within 30s of the end or past 90% when the
        // duration is known; reported exactly once per playback session.
        if (duration !== null && !nearEndReported && (position >= duration - 30 || position >= duration * 0.9)) {
          nearEndReported = true;
          props.onNearEnd();
        }

        if (shouldFlushPlaybackPosition({ lastSavedSeconds, nextSeconds: position, lastSavedAtMs, nowMs: Date.now(), force: false })) {
          lastSavedSeconds = position;
          lastSavedAtMs = Date.now();
          props.onPositionUpdate(position, duration);
        }
      }}
      onPause={(event) => {
        const video = event.currentTarget;
        const position = video.currentTime;
        if (!Number.isFinite(position)) {
          return;
        }

        // Immediate (unthrottled) flush on pause.
        const duration = toNativeDuration(video);
        lastSavedSeconds = position;
        lastSavedAtMs = Date.now();
        props.onPositionUpdate(position, duration);
      }}
      onEnded={() => {
        if (explicitEndedReported) {
          return;
        }

        explicitEndedReported = true;
        props.onExplicitEnded();
      }}
    >
      <a class="text-primary underline" href={props.source.url} rel="noreferrer" target="_blank">
        Open video source
      </a>
    </video>
  );
}

interface ContentDetailBodyProps {
  readonly detail: CatalogContentDetail;
  readonly onCreatorClick: (creator: CatalogCreatorSummary) => void;
}

function ContentDetailBody(props: ContentDetailBodyProps) {
  return (
    <article class="mt-3 space-y-2">
      <div>
        <h3 class="text-lg font-semibold tracking-tight text-foreground">{props.detail.title}</h3>
        <p class="mt-1 text-sm text-muted-foreground">
          <button
            type="button"
            class="rounded-sm text-sm text-muted-foreground underline-offset-2 transition hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            onClick={() => props.onCreatorClick(props.detail.creator)}
          >
            {props.detail.creator.displayName}
          </button>
          {" · "}{formatContentPublishedAt(props.detail.publishedAt)}
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
