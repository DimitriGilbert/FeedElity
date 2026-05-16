import type { CatalogContentDetail, CatalogContentListItem, CatalogContentSource, CatalogFeed, Playlist, UserContentStatus } from "@FeedElity/api";
import { For, Match, Show, Switch, createMemo, createResource, createSignal } from "solid-js";

import { client } from "@/utils/orpc";

import { FeedRow } from "./app-shell-rows";
import {
  formatError,
  formatContentDuration,
  formatContentPublishedAt,
  formatSourceLabel,
  toContentStatusFlags,
  toPlayableSources,
  viewerColumnClass,
  viewerScrollRegionClass,
  type ContentStatusFlags,
  type PlayableSource,
} from "./app-shell.contract";

const emptyCatalogContentItems: readonly CatalogContentListItem[] = [];

const emptyCatalogContentSources: readonly CatalogContentSource[] = [];

const emptyCatalogFeeds: readonly CatalogFeed[] = [];

const emptyPlaylists: readonly Playlist[] = [];

export interface SelectedContentViewerProps {
  readonly isAuthenticated: () => boolean;
  readonly selectedContent: () => CatalogContentListItem | null;
  readonly selectedPlaylistId: () => string | null;
  readonly favoritesReloadKey: () => number;
  readonly contentStatuses: () => readonly UserContentStatus[];
  readonly contentStatusesLoading: () => boolean;
  readonly statusSelectionError: () => string | null;
  readonly onSelectPlaylist: (playlistId: string | null) => void;
  readonly onPlaylistItemAdded: () => void;
  readonly onFavoriteChanged: () => void;
  readonly onMarkContentOpened: (contentItemId: string) => Promise<void>;
  readonly onMarkContentPlayed: (contentItemId: string) => Promise<void>;
}

export function SelectedContentViewer(props: SelectedContentViewerProps) {
  const selectedContentItemId = createMemo(() => props.selectedContent()?.id ?? null);
  const [contentDetail] = createResource(selectedContentItemId, (id) => client.catalog.contentDetail({ id }));
  const playableSources = createMemo(() => toPlayableSources(contentDetail()?.sources ?? emptyCatalogContentSources));
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

    return `${contentItemId}\u001f${props.favoritesReloadKey().toString()}`;
  });
  const [favoriteItems, { refetch: refetchFavoriteItems }] = createResource(selectedFavoriteSource, () =>
    client.overlays.favoriteContentItems(),
  );
  const selectedContentIsFavorite = createMemo(() => {
    const contentItemId = selectedContentItemId();
    return contentItemId !== null && (favoriteItems() ?? emptyCatalogContentItems).some((contentItem) => contentItem.id === contentItemId);
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

  const markSelectedContentOpened = async () => {
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

  const markSelectedContentPlayed = async () => {
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

  return (
    <section
      aria-labelledby="selected-viewer-title"
      class={viewerColumnClass}
      data-shell-column="viewer"
      data-selected-content-item-id={selectedContentItemId() ?? ""}
    >
      <div class={viewerScrollRegionClass} data-viewer-scroll-region>
        <h2 id="selected-viewer-title" class="sr-only">Viewer</h2>
        <Switch>
          <Match when={selectedContentItemId() === null}>
            <div class="flex min-h-[18rem] items-center justify-center border border-border bg-muted px-6 text-center">
              <p class="text-sm leading-6 text-muted-foreground">Pick a video to open the viewer.</p>
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
                <PlaybackSurface
                  source={selectedPlayableSource()}
                  title={detail().title}
                  onNativePlay={markSelectedContentPlayed}
                />
                <Show when={playableSources().length > 1}>
                  <div class="mt-3 flex justify-end">
                    <label class="sr-only" for="viewer-source-switcher">
                      Playback source
                    </label>
                    <select
                      id="viewer-source-switcher"
                      class="w-52 border border-input bg-background px-2 py-1.5 text-xs text-foreground outline-none transition focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
                      value={selectedPlayableSource()?.id ?? ""}
                      aria-label={playbackSourceSwitcherLabel()}
                      title={playbackSourceSwitcherLabel()}
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
                  <Show when={props.statusSelectionError()}>
                    {(message) => <p class="mt-3 border border-destructive px-3 py-2 text-xs text-destructive">{message()}</p>}
                  </Show>
                  <FavoriteActionControls
                    isFavorite={selectedContentIsFavorite()}
                    loading={favoriteItems.loading}
                    busy={favoriteActionBusy()}
                    actionError={favoriteActionError()}
                    onToggle={toggleSelectedContentFavorite}
                  />
                  <ContentStatusActionControls
                    status={selectedContentStatus()}
                    loading={props.contentStatusesLoading()}
                    busy={statusActionBusy()}
                    actionError={statusActionError()}
                    onMarkOpened={markSelectedContentOpened}
                    onMarkPlayed={markSelectedContentPlayed}
                  />
                  <PlaylistAddControls
                    playlists={playlists() ?? emptyPlaylists}
                    loading={playlists.loading}
                    error={playlists.error}
                    selectedPlaylistId={effectiveTargetPlaylistId()}
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

interface ContentStatusActionControlsProps {
  readonly status: ContentStatusFlags;
  readonly loading: boolean;
  readonly busy: "opened" | "played" | null;
  readonly actionError: string | null;
  readonly onMarkOpened: () => Promise<void>;
  readonly onMarkPlayed: () => Promise<void>;
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

function ContentStatusActionControls(props: ContentStatusActionControlsProps) {
  return (
    <section
      class="mt-3 border border-border bg-card p-2"
      aria-label="Opened and played actions for selected video"
      data-opened={props.status.opened ? "true" : "false"}
      data-played={props.status.played ? "true" : "false"}
    >
      <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
        <p class="text-xs text-muted-foreground">
          {props.status.played ? "Played." : props.status.opened ? "Opened." : "Mark this video opened or played."}
        </p>
        <button
          type="button"
          class="border border-border bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
          aria-pressed={props.status.opened}
          disabled={props.loading || props.busy !== null || props.status.opened}
          onClick={async () => {
            await props.onMarkOpened();
          }}
        >
          {props.status.opened ? "Opened" : "Mark opened"}
        </button>
        <button
          type="button"
          class="border border-border bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
          aria-pressed={props.status.played}
          disabled={props.loading || props.busy !== null || props.status.played}
          onClick={async () => {
            await props.onMarkPlayed();
          }}
        >
          {props.status.played ? "Played" : "Mark played"}
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
  readonly onNativePlay: () => Promise<void>;
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
    <article class="mt-4 space-y-3">
      <div>
        <h3 class="text-xl font-semibold tracking-tight text-foreground">{props.detail.title}</h3>
        <p class="mt-2 text-sm text-muted-foreground">
          {props.detail.creator.displayName} · {formatContentPublishedAt(props.detail.publishedAt)} · {formatContentDuration(props.detail.durationSeconds)}
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
            <For each={props.detail?.feeds ?? emptyCatalogFeeds}>{(feed) => <FeedRow feed={feed} />}</For>
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
