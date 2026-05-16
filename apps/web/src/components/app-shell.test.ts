import { expect, test } from "bun:test";
import type { CatalogContentSource } from "@FeedElity/api";

import {
  contentListLimit,
  contentSearchInputId,
  contentSourceFilterId,
  creatorListLimit,
  creatorSearchInputId,
  desktopShellGridClass,
  getShellColumnCount,
  hasInternalAppHeader,
  shellGridClass,
  shellColumns,
  shellPaneIds,
  shellRootClass,
  toContentListInput,
  toPlayableSources,
  toSafePlaybackUrl,
  toShellContentSelectionState,
  toCreatorListInput,
  toShellSelectionState,
} from "./app-shell";
import { focusVisibleClass, shellNavigationLinkClass, shellNavigationLinks } from "./header";

const changedUiSourceFiles = [
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

test("primary navigation preserves anonymous catalog access and authenticated workspace entry", () => {
  expect(shellNavigationLinks).toEqual([
    { to: "/", label: "Catalog", helper: "Browse" },
    { to: "/dashboard", label: "Library", helper: "Saved" },
  ]);
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
  expect(toCreatorListInput("   ")).toEqual({ limit: creatorListLimit });
  expect(toCreatorListInput("  alpha creator  ")).toEqual({ search: "alpha creator", limit: creatorListLimit });
});

test("creator selection exposes middle-pane filtering state", () => {
  expect(toShellSelectionState(null)).toEqual({ selectedCreatorId: null });
  expect(toShellSelectionState("creator-1")).toEqual({ selectedCreatorId: "creator-1" });
});

test("content list builds bounded public catalog input", () => {
  expect(contentSearchInputId).toBe("content-list-search");
  expect(contentSourceFilterId).toBe("content-source-filter");
  expect(toContentListInput("   ", null, null)).toEqual({ limit: contentListLimit });
  expect(toContentListInput("  matrix  ", "creator-1", "youtube")).toEqual({
    search: "matrix",
    creatorId: "creator-1",
    sourceType: "youtube",
    limit: contentListLimit,
  });
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

  expect(source).toContain("client.catalog.creators(input)");
  expect(source).toContain("client.catalog.feeds({ creatorId, limit: 25 })");
  expect(source).toContain("type=\"search\"");
  expect(source).toContain("aria-pressed={props.selectedCreatorId() === creator.id}");
  expect(source).toContain("data-selected-creator-id={props.selectedCreator()?.id ?? \"\"}");
});

test("content pane is wired to anonymous catalog content items", async () => {
  const source = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();

  expect(source).toContain("client.catalog.contentItems(input)");
  expect(source).toContain("toContentListInput(search(), props.selectedCreator()?.id ?? null, sourceType())");
  expect(source).toContain("type=\"search\"");
  expect(source).toContain("id={contentSourceFilterId}");
  expect(source).toContain("aria-pressed={props.selectedContentItemId() === contentItem.id}");
  expect(source).toContain("data-selected-content-item-id={selectedContentItemId() ?? \"\"}");
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
  const playbackIndex = source.indexOf("<PlaybackSurface source={selectedPlayableSource()} title={detail().title} />");
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
  expect(source).toContain("<video class=\"h-full w-full\" src={props.source?.url ?? \"\"} controls preload=\"metadata\">");
});

test("creator pane does not expose unwired refresh or subscription actions", async () => {
  const source = await Bun.file(new URL("./app-shell.tsx", import.meta.url)).text();

  expect(source).not.toContain("refreshCreator");
  expect(source).not.toContain("Refresh");
  expect(source).not.toContain("subscribeToCreator");
  expect(source).not.toContain("Subscribe");
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

test("primary navigation declares deliberate keyboard focus styling", () => {
  expect(focusVisibleClass).toContain("focus-visible:outline");
  expect(shellNavigationLinkClass).toContain(focusVisibleClass);
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
    `Hide ${"played"}`,
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
