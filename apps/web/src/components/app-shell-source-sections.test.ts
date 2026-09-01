import { expect, test } from "bun:test";

const sourceSectionsSource = await Bun.file(new URL("./app-shell-source-sections.tsx", import.meta.url)).text();
const confirmDialogSource = await Bun.file(new URL("./confirm-dialog.tsx", import.meta.url)).text();

test("metadata poll stops re-arming after unmount via disposed guard", () => {
  // The poll loop must track disposal explicitly: an in-flight fetch that
  // resolves after unmount re-enters pollCreatorMetadataStatus, so clearing
  // the timer alone cannot stop the chain.
  expect(sourceSectionsSource).toContain("let metadataPollDisposed = false;");
  expect(sourceSectionsSource).toContain("metadataPollDisposed = true;");
  const pollFunction = sourceSectionsSource.slice(
    sourceSectionsSource.indexOf("const pollCreatorMetadataStatus = async () => {"),
    sourceSectionsSource.indexOf("const startCreatorMetadataRefresh"),
  );
  expect(pollFunction).toContain("if (metadataPollDisposed) {\n      return;\n    }");
  const cleanup = sourceSectionsSource.slice(
    sourceSectionsSource.indexOf("onCleanup(() => {"),
    sourceSectionsSource.indexOf("const scheduleMetadataPoll"),
  );
  expect(cleanup).toContain("metadataPollDisposed = true;");
  expect(cleanup).toContain("clearMetadataPollTimer();");
});

test("ConfirmDialog skips onCancel when the native close event is caused by confirm", () => {
  // The confirm path closes the dialog through the parent flipping `open`,
  // which emits the native close event; a confirmed flag must suppress the
  // cancel callback there so confirm never also runs cancel logic.
  expect(confirmDialogSource).toContain("const [confirmed, setConfirmed] = createSignal(false);");
  expect(confirmDialogSource).toContain("setConfirmed(true);");
  const closeHandler = confirmDialogSource.slice(
    confirmDialogSource.indexOf("onClose={() => {"),
    confirmDialogSource.indexOf("<div class=\"px-4 py-3\">"),
  );
  expect(closeHandler).toContain("if (confirmed()) {");
  expect(closeHandler).toContain("props.onCancel();");
});

test("ConfirmDialog resets the confirmed flag when a new open session begins", () => {
  // Without the reset, a confirm in one session would suppress Escape-driven
  // cancel handling in the next session.
  const resetEffect = confirmDialogSource.slice(
    confirmDialogSource.indexOf("createEffect(() => {"),
    confirmDialogSource.indexOf("// Drive the native dialog"),
  );
  expect(resetEffect).toContain("if (props.open) {");
  expect(resetEffect).toContain("setConfirmed(false);");
  expect(confirmDialogSource).not.toContain("TODO");
});

test("playlist save resolves position from the live playlist list, not the captured object", () => {
  // The For-rendered playlist object can be stale after a background
  // refetch; the submit handler must re-resolve by id from playlistsValue()
  // and use the current position, refusing to act when the playlist is gone.
  const updatePlaylist = sourceSectionsSource.slice(
    sourceSectionsSource.indexOf("const updatePlaylist = async (playlist: Playlist) => {"),
    sourceSectionsSource.indexOf("const deletePlaylist = async (playlistId: string) => {"),
  );
  expect(updatePlaylist).toContain("playlistsValue()?.find((candidate) => candidate.id === playlist.id)");
  expect(updatePlaylist).toContain("position: currentPlaylist.position");
  expect(updatePlaylist).toContain("playlistId: currentPlaylist.id");
  expect(updatePlaylist).toContain("This playlist no longer exists.");
  expect(updatePlaylist).not.toContain("position: playlist.position");
});

test("collection save resolves position from the live collection list, not the captured object", () => {
  const updateCollection = sourceSectionsSource.slice(
    sourceSectionsSource.indexOf("const updateCollection = async (collection: CreatorCollection) => {"),
    sourceSectionsSource.indexOf("const deleteCollection = async (collectionId: string) => {"),
  );
  expect(updateCollection).toContain("collectionsValue()?.find((candidate) => candidate.id === collection.id)");
  expect(updateCollection).toContain("position: currentCollection.position");
  expect(updateCollection).toContain("collectionId: currentCollection.id");
  expect(updateCollection).toContain("This collection no longer exists.");
  expect(updateCollection).not.toContain("position: collection.position");
});
