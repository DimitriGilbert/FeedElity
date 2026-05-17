import type {
  AddSourceResult,
  AddSourceValue,
  CatalogContentListItem,
  IngestionError,
  Playlist,
  PlaylistItemWithContent,
  PlaylistSortMode,
  UserSetting,
} from "@FeedElity/api";
import { For, Match, Show, Switch, createMemo, createResource, createSignal } from "solid-js";
import Plus from "lucide-solid/icons/plus";
import RotateCcw from "lucide-solid/icons/rotate-ccw";
import Save from "lucide-solid/icons/save";
import Trash2 from "lucide-solid/icons/trash-2";
import UserMinus from "lucide-solid/icons/user-minus";
import UserPlus from "lucide-solid/icons/user-plus";
import X from "lucide-solid/icons/x";

import { client } from "@/utils/orpc";

import {
  addSourceHelpId,
  addSourceInputId,
  formatError,
  formatSettingValue,
  playlistDescriptionInputId,
  playlistNameInputId,
  playlistSortInputId,
  readerDensityInputId,
  readerDensitySettingKey,
  readerDensityValues,
  settingKeyInputId,
  settingKeyPattern,
  settingValueInputId,
  toReaderDensityFromSettings,
  type ReaderDensity,
} from "./app-shell.contract";
import { PlaylistItemRow } from "./app-shell-rows";

type SubscriptionAction = "subscribe" | "unsubscribe";

const emptyPlaylists: readonly Playlist[] = [];

const emptyPlaylistItems: readonly PlaylistItemWithContent[] = [];

const playlistSortOptions: readonly { readonly value: PlaylistSortMode; readonly label: string }[] = [
  { value: "manual", label: "Manual" },
  { value: "published_at_desc", label: "Newest published" },
  { value: "published_at_asc", label: "Oldest published" },
  { value: "added_at_desc", label: "Newest added" },
  { value: "added_at_asc", label: "Oldest added" },
];

const readerDensityOptions: readonly { readonly value: ReaderDensity; readonly label: string; readonly helper: string }[] = [
  { value: "comfortable", label: "Comfortable", helper: "App default; roomier rows for scanning thumbnails and actions." },
  { value: "compact", label: "Compact", helper: "Denser rows for faster source and video scanning." },
];

function formatPlaylistSortMode(sortMode: PlaylistSortMode): string {
  return playlistSortOptions.find((option) => option.value === sortMode)?.label ?? "Manual";
}

function toPlaylistSortMode(value: string): PlaylistSortMode {
  return playlistSortOptions.find((option) => option.value === value)?.value ?? "manual";
}

export interface SubscriptionActionButtonProps {
  readonly creatorId: string;
  readonly isSubscribed: boolean;
  readonly onUpdateSubscription: (creatorId: string, action: SubscriptionAction) => Promise<void>;
}

export function SubscriptionActionButton(props: SubscriptionActionButtonProps) {
  const [busy, setBusy] = createSignal(false);
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null);
  const action = createMemo<SubscriptionAction>(() => (props.isSubscribed ? "unsubscribe" : "subscribe"));

  const updateSubscription = async () => {
    setBusy(true);
    setErrorMessage(null);
    try {
      await props.onUpdateSubscription(props.creatorId, action());
    } catch (error) {
      setErrorMessage(formatError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="min-w-0">
      <button
        type="button"
        class="rounded-sm border border-border bg-background p-1 text-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
        aria-pressed={props.isSubscribed}
        aria-label={props.isSubscribed ? "Unsubscribe" : "Subscribe"}
        title={props.isSubscribed ? "Unsubscribe" : "Subscribe"}
        disabled={busy()}
        onClick={updateSubscription}
      >
        {props.isSubscribed ? <UserMinus size={14} /> : <UserPlus size={14} />}
      </button>
      <Show when={errorMessage()}>
        {(message) => <p class="mt-1 max-w-32 truncate text-[0.68rem] text-destructive">{message()}</p>}
      </Show>
    </div>
  );
}

interface AddSourceSectionProps {
  readonly isAuthenticated: () => boolean;
  readonly onSourceAdded: (value: AddSourceValue) => Promise<void>;
}

function formatIngestionCounts(value: AddSourceValue): string {
  const reusedCreators = 1 - value.created.creators;
  const reusedFeeds = value.feeds.length - value.created.feeds;
  const reusedContentItems = value.contentItems.length - value.created.contentItems;

  return [
    `Creators: ${value.created.creators} created, ${reusedCreators} reused`,
    `Feeds: ${value.created.feeds} created, ${reusedFeeds} reused`,
    `Content: ${value.created.contentItems} created, ${reusedContentItems} reused`,
  ].join("; ");
}

function formatIngestionError(error: IngestionError): string {
  return `${error.code}: ${error.message}`;
}

export function AddSourceSection(props: AddSourceSectionProps) {
  const [sourceInput, setSourceInput] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [successMessage, setSuccessMessage] = createSignal<string | null>(null);
  const [failureMessage, setFailureMessage] = createSignal<string | null>(null);

  const submitSource = async () => {
    const trimmedSourceInput = sourceInput().trim();
    if (trimmedSourceInput.length === 0) {
      setFailureMessage("Enter a source URL before adding it.");
      setSuccessMessage(null);
      return;
    }

    setBusy(true);
    setFailureMessage(null);
    setSuccessMessage(null);
    try {
      const result: AddSourceResult = await client.ingestion.addSource({ sourceInput: trimmedSourceInput });
      if (!result.ok) {
        setFailureMessage(formatIngestionError(result.error));
        return;
      }

      await props.onSourceAdded(result.value);
      setSuccessMessage(formatIngestionCounts(result.value));
      setSourceInput("");
    } catch (error) {
      setFailureMessage(formatError(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section class="border-t border-border px-2 py-2" aria-labelledby="add-source-title" data-add-source-region>
      <div class="flex items-center justify-between gap-2">
        <h3 id="add-source-title" class="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Add source
        </h3>
        <span class="text-[0.68rem] text-muted-foreground">Manual</span>
      </div>
      <p id={addSourceHelpId} class="mt-2 text-[0.72rem] leading-5 text-muted-foreground">
        Paste a creator, channel, feed, or video URL supported by the YouTube, Odysee, or PeerTube adapters.
      </p>
      <Show when={props.isAuthenticated()}>
        <form
          class="mt-2 space-y-2 border-t border-border p-2"
          onSubmit={async (event) => {
            event.preventDefault();
            await submitSource();
          }}
        >
          <label class="sr-only" for={addSourceInputId}>Source URL</label>
          <input
            id={addSourceInputId}
            class="w-full border border-input bg-background px-2 py-1.5 text-xs text-foreground outline-none transition focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring"
            value={sourceInput()}
            maxlength={2048}
            placeholder="https://..."
            aria-describedby={addSourceHelpId}
            autocomplete="off"
            onInput={(event) => setSourceInput(event.currentTarget.value)}
          />
          <button
            type="submit"
            class="w-full border border-border bg-primary px-2 py-1.5 text-xs font-semibold text-primary-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60"
            disabled={busy()}
          >
            Add source
          </button>
        </form>
      </Show>
      <Show when={!props.isAuthenticated()}>
        <p class="mt-2 border border-border bg-background px-2 py-1.5 text-[0.72rem] leading-5 text-muted-foreground">
          Sign in to add or subscribe to sources. Public catalog browsing stays available.
        </p>
      </Show>
      <Show when={failureMessage()}>
        {(message) => <p class="mt-2 border border-destructive px-2 py-1.5 text-[0.72rem] leading-5 text-destructive">{message()}</p>}
      </Show>
      <Show when={successMessage()}>
        {(message) => (
          <p class="mt-2 border border-border bg-card px-2 py-1.5 text-[0.72rem] leading-5 text-card-foreground" role="status">
            {message()}
          </p>
        )}
      </Show>
    </section>
  );
}

interface SettingsColumnSectionProps {
  readonly settings: () => readonly UserSetting[];
  readonly settingsUnavailable: () => boolean;
  readonly onSettingsChanged: () => Promise<void>;
}

export function SettingsColumnSection(props: SettingsColumnSectionProps) {
  const [settingKey, setSettingKey] = createSignal("");
  const [settingValue, setSettingValue] = createSignal("");
  const [settingsError, setSettingsError] = createSignal<string | null>(null);
  const [settingsBusyKey, setSettingsBusyKey] = createSignal<string | null>(null);
  const [formBusy, setFormBusy] = createSignal(false);
  const [readerDensityBusy, setReaderDensityBusy] = createSignal(false);
  const readerDensity = createMemo(() => toReaderDensityFromSettings(props.settings()));

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
      await props.onSettingsChanged();
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
      await props.onSettingsChanged();
    } catch (error) {
      setSettingsError(formatError(error));
    } finally {
      setSettingsBusyKey(null);
    }
  };

  const saveReaderDensity = async (nextReaderDensity: ReaderDensity) => {
    setReaderDensityBusy(true);
    setSettingsError(null);
    try {
      await client.overlays.saveSetting({ key: readerDensitySettingKey, value: nextReaderDensity });
      await props.onSettingsChanged();
    } catch (error) {
      setSettingsError(formatError(error));
    } finally {
      setReaderDensityBusy(false);
    }
  };

  const useReaderDensityDefault = async () => {
    setReaderDensityBusy(true);
    setSettingsError(null);
    try {
      await client.overlays.deleteSetting({ key: readerDensitySettingKey });
      await props.onSettingsChanged();
    } catch (error) {
      setSettingsError(formatError(error));
    } finally {
      setReaderDensityBusy(false);
    }
  };

  return (
    <section class="border-t border-border px-2 py-2" aria-labelledby="settings-section-title" data-settings-entry-point>
      <div class="flex items-center justify-between gap-2"><h3 id="settings-section-title" class="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Settings</h3><span class="text-[0.68rem] text-muted-foreground">{props.settings().length} saved</span></div>
      <Show when={settingsError()}>{(message) => <p class="mt-2 border border-destructive px-2 py-1.5 text-[0.72rem] text-destructive">{message()}</p>}</Show>
      <Show when={props.settingsUnavailable()}><p class="mt-2 border border-destructive px-2 py-1.5 text-[0.72rem] text-destructive">Settings unavailable.</p></Show>
      <section class="mt-2 border-t border-border p-2" aria-labelledby="reader-density-title" data-typed-settings>
        <p id="reader-density-title" class="text-[0.72rem] font-semibold text-foreground">Reader density</p>
        <p class="mt-1 text-[0.68rem] leading-5 text-muted-foreground">Controls the actual spacing used by source, feed, and video rows. Comfortable is the app default when no setting is saved.</p>
        <label class="sr-only" for={readerDensityInputId}>Reader density</label>
        <select id={readerDensityInputId} class="mt-2 w-full border border-input bg-background px-2 py-1.5 text-xs text-foreground outline-none transition focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring" value={readerDensity()} disabled={readerDensityBusy() || props.settingsUnavailable()} onChange={async (event) => { const nextReaderDensity = readerDensityValues.find((value) => value === event.currentTarget.value); if (nextReaderDensity !== undefined) { await saveReaderDensity(nextReaderDensity); } }}>
          <For each={readerDensityOptions}>{(option) => <option value={option.value}>{option.label}</option>}</For>
        </select>
        <p class="mt-1 text-[0.68rem] leading-5 text-muted-foreground">{readerDensityOptions.find((option) => option.value === readerDensity())?.helper}</p>
        <button type="button" class="mt-2 w-full inline-flex items-center justify-center gap-1 rounded-sm border border-border bg-card p-1 text-[0.68rem] font-semibold text-card-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60" aria-label="Use app default" title="Use app default" disabled={readerDensityBusy() || props.settingsUnavailable()} onClick={useReaderDensityDefault}><RotateCcw size={14} /></button>
      </section>
      <details class="mt-2 border-t border-border p-2" data-advanced-settings>
        <summary class="cursor-pointer text-[0.72rem] font-semibold text-foreground">Advanced settings</summary>
        <p class="mt-2 text-[0.68rem] leading-5 text-muted-foreground">Edit raw stored keys only when a typed control is unavailable.</p>
        <form class="mt-2 space-y-2 border-t border-border bg-card p-2" onSubmit={async (event) => { event.preventDefault(); await saveSetting(); }}>
          <label class="sr-only" for={settingKeyInputId}>Setting key</label>
          <input id={settingKeyInputId} class="w-full border border-input bg-background px-2 py-1.5 text-xs text-foreground outline-none transition focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring" value={settingKey()} maxlength={64} pattern={settingKeyPattern} placeholder="setting.key" autocomplete="off" onInput={(event) => setSettingKey(event.currentTarget.value)} />
          <label class="sr-only" for={settingValueInputId}>Setting value</label>
          <input id={settingValueInputId} class="w-full border border-input bg-background px-2 py-1.5 text-xs text-foreground outline-none transition focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring" value={settingValue()} maxlength={4096} placeholder="Value" onInput={(event) => setSettingValue(event.currentTarget.value)} />
          <div class="grid grid-cols-2 gap-2"><button type="submit" class="inline-flex items-center justify-center gap-1 rounded-sm border border-border bg-primary p-1 text-xs font-semibold text-primary-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60" aria-label="Save setting" title="Save setting" disabled={formBusy()}><Save size={14} /></button><button type="button" class="inline-flex items-center justify-center gap-1 rounded-sm border border-border bg-card p-1 text-xs font-semibold text-card-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" aria-label="Clear form" title="Clear form" onClick={() => { setSettingKey(""); setSettingValue(""); setSettingsError(null); }}><X size={14} /></button></div>
        </form>
        <Show when={props.settings().length === 0}><p class="mt-2 text-[0.72rem] leading-5 text-muted-foreground">No settings have been saved.</p></Show>
        <Show when={props.settings().length > 0}>
          <ol class="mt-2 space-y-1" aria-label="Saved settings">
            <For each={props.settings()}>{(setting) => <li class="border-t border-border p-2"><button type="button" class="w-full text-left text-card-foreground transition hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" onClick={() => editSetting(setting)}><span class="block truncate text-xs font-semibold">{setting.key}</span><span class="mt-1 block truncate text-[0.68rem] text-muted-foreground">{formatSettingValue(setting.valueJson)}</span></button><button type="button" class="mt-2 w-full inline-flex items-center justify-center gap-1 rounded-sm border border-border bg-background p-1 text-[0.68rem] font-semibold text-destructive transition hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60" aria-label="Delete setting" title="Delete setting" disabled={settingsBusyKey() === setting.key} onClick={async () => { await deleteSetting(setting.key); }}><Trash2 size={14} /></button></li>}</For>
          </ol>
        </Show>
      </details>
    </section>
  );
}

interface PlaylistColumnSectionProps {
  readonly selectedPlaylistId: () => string | null;
  readonly playlistItemsReloadKey: () => number;
  readonly onSelectPlaylist: (playlistId: string | null) => void;
  readonly onSelectContent: (contentItem: CatalogContentListItem) => Promise<void>;
}

export function PlaylistColumnSection(props: PlaylistColumnSectionProps) {
  const [playlists, { refetch: refetchPlaylists }] = createResource(() => client.overlays.playlists());
  const [playlistName, setPlaylistName] = createSignal("");
  const [playlistDescription, setPlaylistDescription] = createSignal("");
  const [playlistSortMode, setPlaylistSortMode] = createSignal<PlaylistSortMode>("manual");
  const [editingPlaylist, setEditingPlaylist] = createSignal<Playlist | null>(null);
  const [playlistError, setPlaylistError] = createSignal<string | null>(null);
  const [playlistBusy, setPlaylistBusy] = createSignal(false);
  const selectedPlaylistItemsInput = createMemo(() => {
    const playlistId = props.selectedPlaylistId();
    if (playlistId === null) {
      return null;
    }

    return `${playlistId}\u001f${props.playlistItemsReloadKey().toString()}`;
  });
  const [selectedPlaylistItems, { refetch: refetchSelectedPlaylistItems }] = createResource(
    selectedPlaylistItemsInput,
    (resourceKey) => {
      const [playlistId] = resourceKey.split("\u001f", 1);
      if (playlistId === undefined) {
        return emptyPlaylistItems;
      }

      return client.overlays.playlistItems({ playlistId });
    },
  );
  const selectedPlaylist = createMemo(() => playlists()?.find((playlist) => playlist.id === props.selectedPlaylistId()) ?? null);
  const selectedPlaylistUsesManualOrder = createMemo(() => selectedPlaylist()?.sortMode === "manual")

  const editPlaylist = (playlist: Playlist | null) => {
    props.onSelectPlaylist(playlist?.id ?? null);
    setEditingPlaylist(playlist);
    setPlaylistName(playlist?.name ?? "");
    setPlaylistDescription(playlist?.description ?? "");
    setPlaylistSortMode(playlist?.sortMode ?? "manual");
  };

  const createPlaylist = async () => {
    const name = playlistName().trim();
    if (name.length === 0) {
      setPlaylistError("Name the playlist before saving.");
      return;
    }

    setPlaylistBusy(true);
    setPlaylistError(null);
    try {
      const playlist = await client.overlays.createPlaylist({ name, description: playlistDescription().trim().length === 0 ? null : playlistDescription().trim(), sortMode: playlistSortMode() });
      await refetchPlaylists();
      editPlaylist(playlist);
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
      await client.overlays.updatePlaylist({ playlistId: playlist.id, name, description: playlistDescription().trim().length === 0 ? null : playlistDescription().trim(), sortMode: playlistSortMode(), position: playlist.position });
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
      editPlaylist(null);
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
    const items = selectedPlaylistItems() ?? emptyPlaylistItems;
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
      <div class="flex items-center justify-between gap-2"><h3 id="playlist-section-title" class="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Playlists</h3><span class="text-[0.68rem] text-muted-foreground">{playlists()?.length ?? 0} saved</span></div>
      <Show when={(playlists()?.length ?? 0) > 0}><div class="mt-2"><label class="sr-only" for="source-playlist-selector">Selected playlist</label><select id="source-playlist-selector" class="w-full border border-input bg-background px-2 py-1.5 text-xs text-foreground outline-none transition focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring" value={props.selectedPlaylistId() ?? ""} onChange={(event) => { const playlistId = event.currentTarget.value; editPlaylist(playlistId.length === 0 ? null : playlists()?.find((playlist) => playlist.id === playlistId) ?? null); }} data-compact-playlist-selector><option value="">No playlist selected</option><For each={playlists() ?? emptyPlaylists}>{(playlist) => <option value={playlist.id}>{playlist.name}</option>}</For></select></div></Show>
      <Show when={playlistError()}>{(message) => <p class="mt-2 border border-destructive px-2 py-1.5 text-[0.72rem] text-destructive">{message()}</p>}</Show>
      <details class="mt-2 border-t border-border p-2" data-playlist-management-panel>
        <summary class="cursor-pointer text-xs font-semibold text-foreground">Manage playlists</summary>
        <form class="mt-2 space-y-2 border-t border-border p-2" onSubmit={async (event) => { event.preventDefault(); const playlist = editingPlaylist(); if (playlist === null) { await createPlaylist(); } else { await updatePlaylist(playlist); } }}>
          <label class="sr-only" for={playlistNameInputId}>Playlist name</label><input id={playlistNameInputId} class="w-full border border-input bg-background px-2 py-1.5 text-xs text-foreground outline-none transition focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring" value={playlistName()} maxlength={120} placeholder="Playlist name" onInput={(event) => setPlaylistName(event.currentTarget.value)} />
          <label class="sr-only" for={playlistDescriptionInputId}>Playlist description</label><textarea id={playlistDescriptionInputId} class="min-h-14 w-full resize-none border border-input bg-background px-2 py-1.5 text-xs text-foreground outline-none transition focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring" value={playlistDescription()} maxlength={2000} placeholder="Description" onInput={(event) => setPlaylistDescription(event.currentTarget.value)} />
          <label class="sr-only" for={playlistSortInputId}>Playlist order</label><select id={playlistSortInputId} class="w-full border border-input bg-background px-2 py-1.5 text-xs text-foreground outline-none transition focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring" value={playlistSortMode()} onChange={(event) => setPlaylistSortMode(toPlaylistSortMode(event.currentTarget.value))}><For each={playlistSortOptions}>{(option) => <option value={option.value}>{option.label}</option>}</For></select>
          <div class="grid grid-cols-2 gap-2"><button type="submit" class="inline-flex items-center justify-center gap-1 rounded-sm border border-border bg-primary p-1 text-xs font-semibold text-primary-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60" aria-label={editingPlaylist() === null ? "Create playlist" : "Save playlist"} title={editingPlaylist() === null ? "Create playlist" : "Save playlist"} disabled={playlistBusy()}>{editingPlaylist() === null ? <Plus size={14} /> : <Save size={14} />}</button><button type="button" class="inline-flex items-center justify-center gap-1 rounded-sm border border-border bg-card p-1 text-xs font-semibold text-card-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" aria-label="New playlist" title="New playlist" onClick={() => { editPlaylist(null); }}>New</button></div>
        </form>
        <Switch>
          <Match when={playlists.loading}><p class="mt-2 text-[0.72rem] leading-5 text-muted-foreground">Loading playlists.</p></Match>
          <Match when={playlists.error !== undefined}><p class="mt-2 text-[0.72rem] leading-5 text-destructive">Playlists unavailable.</p></Match>
          <Match when={(playlists()?.length ?? 0) === 0}><p class="mt-2 text-[0.72rem] leading-5 text-muted-foreground">Create a playlist to collect videos.</p></Match>
          <Match when={playlists()}>{(loadedPlaylists) => <ol class="mt-2 space-y-1" aria-label="Playlists"><For each={loadedPlaylists()}>{(playlist) => <li class="border-t border-border p-2"><button type="button" class="w-full text-left text-card-foreground transition hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" aria-pressed={props.selectedPlaylistId() === playlist.id} onClick={() => editPlaylist(props.selectedPlaylistId() === playlist.id ? null : playlist)}><span class="block truncate text-xs font-semibold">{playlist.name}</span><span class="mt-1 block truncate text-[0.68rem] text-muted-foreground">{formatPlaylistSortMode(playlist.sortMode)}</span></button><Show when={props.selectedPlaylistId() === playlist.id}><div class="mt-2 flex gap-2"><button type="button" class="flex-1 inline-flex items-center justify-center gap-1 rounded-sm border border-border bg-background p-1 text-[0.68rem] font-semibold text-foreground transition hover:bg-accent hover:text-accent-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60" aria-label="Update playlist" title="Update playlist" disabled={playlistBusy()} onClick={async () => { await updatePlaylist(playlist); }}><Save size={14} /></button><button type="button" class="flex-1 inline-flex items-center justify-center gap-1 rounded-sm border border-border bg-background p-1 text-[0.68rem] font-semibold text-destructive transition hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60" aria-label="Delete playlist" title="Delete playlist" disabled={playlistBusy()} onClick={async () => { await deletePlaylist(playlist.id); }}><Trash2 size={14} /></button></div></Show></li>}</For></ol>}</Match>
        </Switch>
        <Show when={props.selectedPlaylistId() !== null}>
          <section class="mt-2 border-t border-border pt-2" aria-label="Selected playlist videos">
            <Switch>
              <Match when={selectedPlaylistItems.loading}><p class="text-[0.72rem] leading-5 text-muted-foreground">Loading playlist videos.</p></Match>
              <Match when={selectedPlaylistItems.error !== undefined}><p class="text-[0.72rem] leading-5 text-destructive">Playlist videos unavailable.</p></Match>
              <Match when={(selectedPlaylistItems()?.length ?? 0) === 0}><p class="text-[0.72rem] leading-5 text-muted-foreground">Add the selected video from the viewer.</p></Match>
              <Match when={selectedPlaylistItems()}>{(items) => <ol class="space-y-1" aria-label="Videos in selected playlist"><For each={items()}>{(item, index) => <PlaylistItemRow item={item} itemIndex={index()} itemCount={items().length} busy={playlistBusy()} showManualControls={selectedPlaylistUsesManualOrder()} onSelectContent={props.onSelectContent} onMove={movePlaylistItem} onRemove={removePlaylistItem} />}</For></ol>}</Match>
            </Switch>
          </section>
        </Show>
      </details>
    </section>
  );
}
