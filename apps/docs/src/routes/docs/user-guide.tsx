import { createFileRoute } from "@tanstack/react-router";

import { DocsLayout } from "~/components/docs-layout";
import { buildSeo } from "~/lib/seo";

export const Route = createFileRoute("/docs/user-guide")({
  head: () =>
    buildSeo({
      title: "User Guide - FeedElity Docs",
      description:
        "Learn how to use FeedElity. Browsing, subscriptions, content playback, playlists, favorites, and settings.",
      pathname: "/docs/user-guide",
      type: "article",
    }),
  component: UserGuidePage,
});

function UserGuidePage() {
  return (
    <DocsLayout>
      <main className="max-w-3xl">
        <h1 className="text-4xl font-bold tracking-tight text-neutral-50">
          User Guide
        </h1>
        <p className="mt-4 leading-relaxed text-neutral-400">
          FeedElity is a personal-first, video-oriented RSS client for following
          creators across YouTube, Odysee, and PeerTube. This guide covers
          everything you need to browse content, manage subscriptions, organize
          playlists, and control your viewing experience.
        </p>

        <section className="mt-10">
          <h2 className="text-2xl font-semibold tracking-tight text-neutral-100">
            The Three-Column Layout
          </h2>
          <p className="mt-4 leading-relaxed text-neutral-400">
            FeedElity uses a high-density three-column interface designed for
            power users who want to scan and consume content quickly:
          </p>
          <div className="mt-4 space-y-3">
            <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 px-5 py-4">
              <p className="font-medium text-neutral-200">
                Left Column &mdash; Creators &amp; Sources
              </p>
              <p className="mt-2 text-sm text-neutral-400">
                Browse all creators in the global catalog or view only your
                subscribed creators. Search by name. Select a creator to load
                their content in the middle column. Use the add-source controls
                to subscribe to new channels.
              </p>
            </div>
            <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 px-5 py-4">
              <p className="font-medium text-neutral-200">
                Middle Column &mdash; Content List
              </p>
              <p className="mt-2 text-sm text-neutral-400">
                Shows content items for the selected creator, subscription, or
                favorites view. Each item displays the title, thumbnail,
                duration, source indicator, and status badges (opened, played,
                favorite). Use search, filters, and the hide-played toggle to
                narrow the list.
              </p>
            </div>
            <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 px-5 py-4">
              <p className="font-medium text-neutral-200">
                Right Column &mdash; Content Viewer
              </p>
              <p className="mt-2 text-sm text-neutral-400">
                Displays the selected content item with full metadata, video
                playback, description, source switching, and action buttons.
                Switch between available playback sources (YouTube embed, Odysee
                native, PeerTube embed) when multiple sources exist.
              </p>
            </div>
          </div>
        </section>

        <section className="mt-12">
          <h2 className="text-2xl font-semibold tracking-tight text-neutral-100">
            Browsing the Catalog
          </h2>
          <p className="mt-4 leading-relaxed text-neutral-400">
            FeedElity maintains a global catalog of creators, feeds, and content
            items from all sources. You do not need an account to browse.
            Anonymous users can explore the full catalog, select creators, and
            view content details including playback.
          </p>
          <ul className="mt-4 list-inside list-disc space-y-2 text-neutral-400">
            <li>
              <span className="text-neutral-200">Creator list</span> &mdash;
              Click any creator in the left column to load their content. The
              search field filters creators by display name.
            </li>
            <li>
              <span className="text-neutral-200">Content list</span> &mdash;
              Browse content items for the selected creator. Items show title,
              thumbnail, publication date, duration, and source type indicator.
            </li>
            <li>
              <span className="text-neutral-200">Content detail</span> &mdash;
              Click a content item to open it in the viewer. See full
              description, metadata, and playback options.
            </li>
          </ul>
          <p className="mt-4 text-sm text-neutral-500">
            Subscription actions (subscribe, unsubscribe), status tracking
            (opened, played, favorite), and playlist management require a signed-in
            account. These actions are hidden or gated for anonymous browsers.
          </p>
        </section>

        <section className="mt-12">
          <h2 className="text-2xl font-semibold tracking-tight text-neutral-100">
            Managing Sources
          </h2>

          <section className="mt-6">
            <h3 className="text-lg font-medium text-neutral-200">
              Adding a Source
            </h3>
            <p className="mt-3 leading-relaxed text-neutral-400">
              Paste a URL into the add-source input. FeedElity supports the
              following source types and URL forms:
            </p>
            <ul className="mt-3 list-inside list-disc space-y-2 text-neutral-400">
              <li>
                <span className="text-neutral-200">YouTube</span> &mdash;
                Channel URLs and channel RSS feed URLs. The adapter normalizes
                channel identity, video metadata, thumbnails, and produces
                privacy-friendly no-cookie embed links for playback.
              </li>
              <li>
                <span className="text-neutral-200">Odysee</span> &mdash;
                Channel URLs and RSS feed URLs. The adapter normalizes channel
                identity, video metadata, duration, and provides native media
                URLs for playback.
              </li>
              <li>
                <span className="text-neutral-200">PeerTube</span> &mdash;
                Video URLs, channel URLs, and account URLs from any PeerTube
                instance. The adapter uses instance APIs for metadata and
                provides embed URLs for playback.
              </li>
            </ul>
            <p className="mt-3 text-sm text-neutral-500">
              FeedElity auto-detects the source type from the URL. You do not
              need to specify whether a URL is YouTube, Odysee, or PeerTube.
            </p>
          </section>

          <section className="mt-6">
            <h3 className="text-lg font-medium text-neutral-200">
              Batch Adding Sources
            </h3>
            <p className="mt-3 leading-relaxed text-neutral-400">
              Add multiple source URLs at once using the batch-add feature.
              Paste one URL per line. FeedElity processes each URL independently
              and reports per-item results: successful additions, duplicates
              (already subscribed), and failures with reasons.
            </p>
          </section>

          <section className="mt-6">
            <h3 className="text-lg font-medium text-neutral-200">
              Refreshing Content
            </h3>
            <p className="mt-3 leading-relaxed text-neutral-400">
              FeedElity uses manual refresh. There is no automatic background
              refresh in the current version. You control when content is
              updated:
            </p>
            <div className="mt-4 space-y-3">
              <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 px-5 py-4">
                <p className="font-medium text-neutral-200">
                  Normal Refresh
                </p>
                <p className="mt-2 text-sm text-neutral-400">
                  Respects stored refresh cadence metadata. Only fetches feeds
                  that are due for a refresh based on their schedule. Use this
                  for routine checks. Available for all sources or for a single
                  creator.
                </p>
              </div>
              <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 px-5 py-4">
                <p className="font-medium text-neutral-200">
                  Force Refresh
                </p>
                <p className="mt-2 text-sm text-neutral-400">
                  Bypasses cadence metadata and fetches all feeds regardless of
                  when they were last refreshed. Use this when you know new
                  content is available or want a complete update.
                </p>
              </div>
            </div>
            <ul className="mt-4 list-inside list-disc space-y-2 text-neutral-400">
              <li>
                <span className="text-neutral-200">Refresh all</span> &mdash;
                Triggers a refresh across every feed known to the server (the
                whole catalog), not just the creators you subscribe to.
              </li>
              <li>
                <span className="text-neutral-200">Refresh creator</span>
                &mdash; Refreshes only the feeds belonging to a specific
                creator, using the per-creator refresh control in the left
                column.
              </li>
            </ul>
            <p className="mt-3 text-sm text-neutral-500">
              Refresh status and results are visible after each run. The report
              shows how many feeds were requested, skipped, succeeded, and
              failed, along with counts of discovered, created, and updated
              content items.
            </p>
          </section>

          <section className="mt-6">
            <h3 className="text-lg font-medium text-neutral-200">
              Feed Health
            </h3>
            <p className="mt-3 leading-relaxed text-neutral-400">
              The feed health dashboard shows how every feed is behaving: each
              feed's current success or failure streak and the last time a
              refresh succeeded. Feeds that keep failing can be unsubscribed in
              bulk straight from the dashboard, so a broken source does not sit
              in your subscriptions forever.
            </p>
          </section>
        </section>

        <section className="mt-12">
          <h2 className="text-2xl font-semibold tracking-tight text-neutral-100">
            Subscriptions &amp; Favorites
          </h2>

          <section className="mt-6">
            <h3 className="text-lg font-medium text-neutral-200">
              Subscriptions
            </h3>
            <p className="mt-3 leading-relaxed text-neutral-400">
              Subscribing to a creator adds them to your personal subscription
              list. Your subscriptions appear in the left column, letting you
              quickly access content from creators you follow. Subscriptions are
              private to your account.
            </p>
            <ul className="mt-3 list-inside list-disc space-y-2 text-neutral-400">
              <li>
                <span className="text-neutral-200">Subscribe</span> &mdash;
                Click the subscribe action on a creator card or from the content
                viewer.
              </li>
              <li>
                <span className="text-neutral-200">Unsubscribe</span> &mdash;
                Remove a creator from your subscriptions. This does not delete
                the creator or their content from the global catalog.
              </li>
              <li>
                <span className="text-neutral-200">Subscribed content</span>
                &mdash; Switch to the subscribed-content view to see items from
                all your subscribed creators in a unified list.
              </li>
              <li>
                <span className="text-neutral-200">Unread counts</span> &mdash;
                Each subscribed creator shows an unread badge for items you have
                not opened yet. Mark a single creator as read from their
                controls, or use the mark-all-as-read action to clear every
                unread badge at once.
              </li>
            </ul>
          </section>

          <section className="mt-6">
            <h3 className="text-lg font-medium text-neutral-200">
              Favorites
            </h3>
            <p className="mt-3 leading-relaxed text-neutral-400">
              Mark any content item as a favorite. Favorites are a separate
              status from opened and played, so you can favorite an item you
              want to return to without marking it as watched.
            </p>
            <ul className="mt-3 list-inside list-disc space-y-2 text-neutral-400">
              <li>
                <span className="text-neutral-200">Toggle favorite</span>
                &mdash; Click the favorite action from the content list or
                content viewer. The toggle adds or removes the favorite status.
              </li>
              <li>
                <span className="text-neutral-200">Favorites view</span>
                &mdash; Access the favorites-only view from the sidebar to
                browse all your favorited content in one place.
              </li>
            </ul>
          </section>

          <section className="mt-6">
            <h3 className="text-lg font-medium text-neutral-200">
              Creator Collections
            </h3>
            <p className="mt-3 leading-relaxed text-neutral-400">
              Collections let you group creators into your own sets, independent
              of your subscriptions. The Collections tab in the left column lets
              you create, rename, and delete collections and add or remove
              creators from them. Selecting a collection focuses on its
              creators' content.
            </p>
          </section>
        </section>

        <section className="mt-12">
          <h2 className="text-2xl font-semibold tracking-tight text-neutral-100">
            Content Status &amp; History
          </h2>
          <p className="mt-4 leading-relaxed text-neutral-400">
            FeedElity tracks three content statuses per item, scoped to your
            account:
          </p>
          <div className="mt-4 overflow-x-auto rounded-lg border border-neutral-800">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-neutral-800 bg-neutral-900/50">
                  <th className="whitespace-nowrap px-4 py-3 font-medium text-neutral-200">
                    Status
                  </th>
                  <th className="px-4 py-3 font-medium text-neutral-200">
                    Description
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800/50">
                <tr>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-neutral-300">
                    opened
                  </td>
                  <td className="px-4 py-3 text-neutral-400">
                    You selected and viewed the content item. Set automatically
                    when you open an item in the viewer, or toggle manually.
                  </td>
                </tr>
                <tr>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-neutral-300">
                    played
                  </td>
                  <td className="px-4 py-3 text-neutral-400">
                    You watched or consumed the content. Set automatically when
                    playback nears the end (within 30 seconds of the end or past
                    90% of the video) or ends, and still toggleable manually
                    from the content list or viewer.
                  </td>
                </tr>
                <tr>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-neutral-300">
                    favorite
                  </td>
                  <td className="px-4 py-3 text-neutral-400">
                    You bookmarked the item for later. Independent of opened and
                    played status.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-sm text-neutral-500">
            Use the <span className="text-neutral-300">hide played</span> toggle
            in the content list to filter out items you have already marked as
            played. Status badges are displayed on each content item in the list.
          </p>
          <p className="mt-4 leading-relaxed text-neutral-400">
            Your watch history is browsable: the library includes Opened and
            Played views that list the items you have opened or completed, so
            you can catch up on what you started or re-find what you watched.
          </p>
        </section>

        <section className="mt-12">
          <h2 className="text-2xl font-semibold tracking-tight text-neutral-100">
            Content Playback
          </h2>
          <p className="mt-4 leading-relaxed text-neutral-400">
            FeedElity is video-oriented. When you select a content item, the
            viewer shows the video player along with metadata and actions.
          </p>
          <ul className="mt-4 list-inside list-disc space-y-2 text-neutral-400">
            <li>
              <span className="text-neutral-200">YouTube</span> &mdash; Plays
              through a privacy-friendly YouTube no-cookie iframe embed. No
              tracking cookies from YouTube are set.
            </li>
            <li>
              <span className="text-neutral-200">Odysee</span> &mdash; Plays
              through native media URLs provided by the Odysee RSS feed.
            </li>
            <li>
              <span className="text-neutral-200">PeerTube</span> &mdash; Plays
              through PeerTube embed URLs from the originating instance.
            </li>
          </ul>
          <p className="mt-4 leading-relaxed text-neutral-400">
            Some content items have multiple sources (for example, a video
            mirrored on both YouTube and Odysee). When multiple sources are
            available, use the source switcher in the viewer to change the
            playback source without leaving the content item.
          </p>
          <ul className="mt-4 list-inside list-disc space-y-2 text-neutral-400">
            <li>
              <span className="text-neutral-200">Resume playback</span> &mdash;
              Your playback position is saved automatically. Reopening a
              partially watched video offers to resume where you left off
              ("Resume at ...").
            </li>
            <li>
              <span className="text-neutral-200">Copy stream URL</span> &mdash;
              A button in the viewer copies the selected source's media URL to
              the clipboard, handy for opening a video in an external player.
            </li>
          </ul>
        </section>

        <section className="mt-12">
          <h2 className="text-2xl font-semibold tracking-tight text-neutral-100">
            Keyboard Shortcuts
          </h2>
          <p className="mt-4 leading-relaxed text-neutral-400">
            The app shell is fully navigable from the keyboard. Shortcuts are
            disabled while you are typing in a text field or a dialog is open.
          </p>
          <div className="mt-4 overflow-x-auto rounded-lg border border-neutral-800">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-neutral-800 bg-neutral-900/50">
                  <th className="whitespace-nowrap px-4 py-3 font-medium text-neutral-200">
                    Key
                  </th>
                  <th className="px-4 py-3 font-medium text-neutral-200">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800/50">
                <tr>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-neutral-300">
                    j / k
                  </td>
                  <td className="px-4 py-3 text-neutral-400">
                    Move the selection down / up in the content list.
                  </td>
                </tr>
                <tr>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-neutral-300">
                    Enter
                  </td>
                  <td className="px-4 py-3 text-neutral-400">
                    Open the selected content item in the viewer.
                  </td>
                </tr>
                <tr>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-neutral-300">
                    /
                  </td>
                  <td className="px-4 py-3 text-neutral-400">
                    Focus the creator search field.
                  </td>
                </tr>
                <tr>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-neutral-300">
                    Escape
                  </td>
                  <td className="px-4 py-3 text-neutral-400">
                    Clear the current selection or close the open panel.
                  </td>
                </tr>
                <tr>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-neutral-300">
                    f
                  </td>
                  <td className="px-4 py-3 text-neutral-400">
                    Toggle favorite on the selected content item.
                  </td>
                </tr>
                <tr>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-neutral-300">
                    g then l
                  </td>
                  <td className="px-4 py-3 text-neutral-400">
                    Go to the Library.
                  </td>
                </tr>
                <tr>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-neutral-300">
                    g then c
                  </td>
                  <td className="px-4 py-3 text-neutral-400">
                    Go to the Catalog.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-12">
          <h2 className="text-2xl font-semibold tracking-tight text-neutral-100">
            Playlists
          </h2>
          <p className="mt-4 leading-relaxed text-neutral-400">
            Create playlists to organize content items into curated collections.
            Playlists are private to your account.
          </p>
          <ul className="mt-4 list-inside list-disc space-y-2 text-neutral-400">
            <li>
              <span className="text-neutral-200">Create a playlist</span>
              &mdash; Provide a name and optional description. Choose a sort
              mode: manual ordering, publication date ascending or descending,
              or added-date ascending or descending.
            </li>
            <li>
              <span className="text-neutral-200">Add items</span> &mdash; Add
              content items to a playlist from the content list or viewer.
              Items are appended at the end in manual sort mode.
            </li>
            <li>
              <span className="text-neutral-200">Reorder items</span> &mdash;
              Move items up or down with the reorder buttons when the playlist
              uses manual sort mode.
            </li>
            <li>
              <span className="text-neutral-200">Remove items</span> &mdash;
              Remove individual items from a playlist. This does not delete the
              content item from the catalog.
            </li>
            <li>
              <span className="text-neutral-200">Edit or delete</span> &mdash;
              Rename a playlist, change its description or sort mode, or delete
              the entire playlist.
            </li>
          </ul>
        </section>

        <section className="mt-12">
          <h2 className="text-2xl font-semibold tracking-tight text-neutral-100">
            Account &amp; Settings
          </h2>

          <section className="mt-6">
            <h3 className="text-lg font-medium text-neutral-200">
              Creating an Account
            </h3>
            <p className="mt-3 leading-relaxed text-neutral-400">
              FeedElity uses local email and password authentication. Sign up
              with your email and a password. No external identity provider is
              required. Your account data (subscriptions, favorites, history,
              playlists, settings) is private and scoped to your user.
            </p>
          </section>

          <section className="mt-6">
            <h3 className="text-lg font-medium text-neutral-200">
              Settings
            </h3>
            <p className="mt-3 leading-relaxed text-neutral-400">
              Account settings let you configure app-level preferences. Settings
              are stored as key-value pairs scoped to your account. Changes are
              saved immediately and persist across sessions.
            </p>
            <p className="mt-3 text-sm text-neutral-500">
              Layout preferences &mdash; the hide-played toggle, creator and
              content source filters, pane widths, and your view mode &mdash;
              are kept on your device and also persist across sessions.
            </p>
          </section>

          <section className="mt-6">
            <h3 className="text-lg font-medium text-neutral-200">
              Export &amp; Import
            </h3>
            <p className="mt-3 leading-relaxed text-neutral-400">
              Settings can export all of your user data &mdash; subscriptions,
              history, playlists, collections, and settings &mdash; to a single
              JSON file, and import it back. Importing the same file again is
              safe: the round-trip is idempotent, so repeated imports do not
              create duplicates.
            </p>
          </section>

          <section className="mt-6">
            <h3 className="text-lg font-medium text-neutral-200">
              Migrated Accounts
            </h3>
            <p className="mt-3 leading-relaxed text-neutral-400">
              If you imported data from the previous version of FeedElity, your
              account will require a new password setup on first login. This is
              a security measure &mdash; old password hashes are not carried over
              during migration. Once you set a new password, your account works
              normally with all imported subscriptions, favorites, history, and
              playlists preserved.
            </p>
          </section>
        </section>
      </main>
    </DocsLayout>
  );
}
