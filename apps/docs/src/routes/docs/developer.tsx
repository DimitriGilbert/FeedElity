import { createFileRoute } from "@tanstack/react-router";

import { DocsLayout } from "~/components/docs-layout";
import { buildSeo } from "~/lib/seo";

export const Route = createFileRoute("/docs/developer")({
  head: () =>
    buildSeo({
      title: "Developer Docs - FeedElity Docs",
      description:
        "Developer documentation for FeedElity. Architecture, monorepo layout, API layer, database schema, source adapters, and contributing guidelines.",
      pathname: "/docs/developer",
      type: "article",
    }),
  component: DeveloperPage,
});

function DeveloperPage() {
  return (
    <DocsLayout>
      <main className="max-w-3xl">
        <h1 className="text-4xl font-bold tracking-tight text-neutral-50">
          Developer Docs
        </h1>
        <p className="mt-4 leading-relaxed text-neutral-400">
          This guide covers the FeedElity architecture, monorepo structure,
          package boundaries, and development conventions. Everything you need to
          contribute, extend, or debug the platform.
        </p>

        <section className="mt-10">
          <h2 className="text-2xl font-semibold tracking-tight text-neutral-100">
            Architecture Overview
          </h2>
          <p className="mt-4 leading-relaxed text-neutral-400">
            FeedElity is a monorepo built with Turborepo, using Bun as the
            package manager and runtime. The app follows a layered architecture
            with strict module boundaries:
          </p>
          <ul className="mt-4 list-inside list-disc space-y-2 text-neutral-400">
            <li>
              <span className="text-neutral-200">Frontend</span> &mdash; Solid
              in <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">apps/web</code>.
              Uses TanStack Solid Router for routing and Vite for bundling.
            </li>
            <li>
              <span className="text-neutral-200">Backend</span> &mdash; Hono
              in <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">apps/server</code>.
              Hosts oRPC procedures and better-auth endpoints.
            </li>
            <li>
              <span className="text-neutral-200">API contract</span> &mdash;
              oRPC procedures defined
              in <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">packages/api</code>.
              Type-safe client and server with Zod validation.
            </li>
            <li>
              <span className="text-neutral-200">Auth</span> &mdash;
              better-auth
              in <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">packages/auth</code>.
              Local email/password authentication with session management.
            </li>
            <li>
              <span className="text-neutral-200">Database</span> &mdash;
              Drizzle ORM with SQLite/libSQL
              in <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">packages/db</code>.
              Schema split into catalog (global) and overlays (user-owned).
            </li>
            <li>
              <span className="text-neutral-200">Desktop</span> &mdash;
              Electrobun
              in <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">apps/desktop</code>.
              Supports local-first and remote backend modes.
            </li>
          </ul>
        </section>

        <section className="mt-12">
          <h2 className="text-2xl font-semibold tracking-tight text-neutral-100">
            Monorepo Layout
          </h2>
          <pre className="mt-4 overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 font-mono text-sm text-neutral-300">
            <code>{`FeedElity/
├── apps/
│   ├── web/          Solid frontend (TanStack Solid Router + Vite)
│   ├── server/       Hono API server (oRPC + better-auth)
│   ├── desktop/      Electrobun desktop wrapper
│   └── docs/         Documentation site (TanStack Start + React + Vite)
├── packages/
│   ├── api/          oRPC routers, services, repositories, source adapters
│   ├── db/           Drizzle ORM schema, database client, migrations
│   ├── auth/         better-auth configuration and helpers
│   ├── env/          Shared environment variable validation
│   └── config/       Shared TypeScript config
├── docker/           Docker assets (Dockerfile, nginx config, entrypoint)
├── scripts/          Utility scripts
├── turbo.json        Turborepo pipeline configuration
├── bts.jsonc         Better-T-Stack scaffold source of truth
└── package.json      Root workspace definition`}</code>
          </pre>
          <p className="mt-3 text-sm text-neutral-500">
            Tailwind CSS is wired per app through{" "}
            <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">
              @tailwindcss/vite
            </code>{" "}
            rather than through a shared package, and the repo has no ESLint
            configuration.
          </p>
          <div className="mt-6 space-y-3">
            <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 px-5 py-4">
              <p className="font-mono text-sm font-medium text-neutral-200">
                packages/api
              </p>
              <p className="mt-2 text-sm text-neutral-400">
                The core of the application. Contains oRPC router definitions,
                domain services (ingestion, refresh), repository functions
                (catalog reads/writes, overlay reads/writes), source adapters
                (YouTube, Odysee, PeerTube), migration logic, and domain types.
                This is where most backend behavior lives.
              </p>
            </div>
            <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 px-5 py-4">
              <p className="font-mono text-sm font-medium text-neutral-200">
                packages/db
              </p>
              <p className="mt-2 text-sm text-neutral-400">
                Drizzle ORM schema definitions split into three modules: auth
                (user, session, account, verification), catalog (creator, feed,
                contentItem, contentSource, feedContent, refreshRun,
                refreshFeedResult), and overlays (subscription, contentStatus,
                playlist, playlistItem, creatorCollection, collectionMember,
                userSetting, migrationRun, migrationMapping). Exports a shared
                database client.
              </p>
            </div>
            <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 px-5 py-4">
              <p className="font-mono text-sm font-medium text-neutral-200">
                packages/auth
              </p>
              <p className="mt-2 text-sm text-neutral-400">
                Configures better-auth with the Drizzle adapter for SQLite,
                email/password authentication, and cookie-based sessions.
                Exports password hashing helpers used for migrated-user password
                setup.
              </p>
            </div>
          </div>
        </section>

        <section className="mt-12">
          <h2 className="text-2xl font-semibold tracking-tight text-neutral-100">
            Data Model
          </h2>
          <p className="mt-4 leading-relaxed text-neutral-400">
            FeedElity separates data into two categories: a shared global
            catalog and private user-owned overlays.
          </p>

          <section className="mt-6">
            <h3 className="text-lg font-medium text-neutral-200">
              Global Catalog
            </h3>
            <p className="mt-3 leading-relaxed text-neutral-400">
              The catalog contains normalized records for all known creators,
              feeds, content items, and content sources. Catalog data is
              source-agnostic at the API level &mdash; source-specific details
              live inside source adapters and metadata fields.
            </p>
            <div className="mt-4 overflow-x-auto rounded-lg border border-neutral-800">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-neutral-800 bg-neutral-900/50">
                    <th className="whitespace-nowrap px-4 py-3 font-medium text-neutral-200">
                      Table
                    </th>
                    <th className="px-4 py-3 font-medium text-neutral-200">
                      Purpose
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-800/50">
                  <tr>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-neutral-300">
                      creator
                    </td>
                    <td className="px-4 py-3 text-neutral-400">
                      Normalized creator/channel identity with source type,
                      external ID, display name, description, and image.
                      Uniqueness on (sourceType, sourceExternalId).
                    </td>
                  </tr>
                  <tr>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-neutral-300">
                      feed
                    </td>
                    <td className="px-4 py-3 text-neutral-400">
                      Source-specific feed belonging to a creator. Stores URL,
                      refresh cadence, last/next refresh timestamps, and adapter
                      metadata.
                    </td>
                  </tr>
                  <tr>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-neutral-300">
                      contentItem
                    </td>
                    <td className="px-4 py-3 text-neutral-400">
                      Normalized video item with title, description, publication
                      date, duration, thumbnail, and content type.
                    </td>
                  </tr>
                  <tr>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-neutral-300">
                      contentSource
                    </td>
                    <td className="px-4 py-3 text-neutral-400">
                      Playable source link for a content item. Includes embed
                      URL, native media URL, canonical URL, and priority. One
                      item can have multiple sources.
                    </td>
                  </tr>
                  <tr>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-neutral-300">
                      feedContent
                    </td>
                    <td className="px-4 py-3 text-neutral-400">
                      Association between a feed and a content item. Composite
                      primary key on (feedId, contentItemId).
                    </td>
                  </tr>
                  <tr>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-neutral-300">
                      refreshRun
                    </td>
                    <td className="px-4 py-3 text-neutral-400">
                      Records a manual refresh attempt with scope, force flag,
                      status, counts, timestamps, and error summary.
                    </td>
                  </tr>
                  <tr>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-neutral-300">
                      refreshFeedResult
                    </td>
                    <td className="px-4 py-3 text-neutral-400">
                      Per-feed result within a refresh run. Status, discovery
                      counts, and error summary.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section className="mt-8">
            <h3 className="text-lg font-medium text-neutral-200">
              User-Owned Overlays
            </h3>
            <p className="mt-3 leading-relaxed text-neutral-400">
              Overlay records are private to each user and reference catalog
              entities. Every overlay table has a userId column with cascade
              delete and is scoped by authenticated userId at the API boundary.
            </p>
            <div className="mt-4 overflow-x-auto rounded-lg border border-neutral-800">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-neutral-800 bg-neutral-900/50">
                    <th className="whitespace-nowrap px-4 py-3 font-medium text-neutral-200">
                      Table
                    </th>
                    <th className="px-4 py-3 font-medium text-neutral-200">
                      Purpose
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-800/50">
                  <tr>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-neutral-300">
                      subscription
                    </td>
                    <td className="px-4 py-3 text-neutral-400">
                      User-to-creator subscription. Unique on (userId,
                      creatorId).
                    </td>
                  </tr>
                  <tr>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-neutral-300">
                      contentStatus
                    </td>
                    <td className="px-4 py-3 text-neutral-400">
                      Per-user status for opened, played, or favorite. Unique on
                      (userId, contentItemId, status).
                    </td>
                  </tr>
                  <tr>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-neutral-300">
                      playlist / playlistItem
                    </td>
                    <td className="px-4 py-3 text-neutral-400">
                      User playlists with ordered items. Items are unique per
                      playlist by position and by contentItemId.
                    </td>
                  </tr>
                  <tr>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-neutral-300">
                      creatorCollection / collectionMember
                    </td>
                    <td className="px-4 py-3 text-neutral-400">
                      User-defined creator collections with ordered members.
                      Members reference both the collection and the creator;
                      deleting a collection cascades to its members.
                    </td>
                  </tr>
                  <tr>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-neutral-300">
                      userSetting
                    </td>
                    <td className="px-4 py-3 text-neutral-400">
                      Key-value settings scoped to a user. Unique on (userId,
                      key).
                    </td>
                  </tr>
                  <tr>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-neutral-300">
                      migrationRun / migrationMapping
                    </td>
                    <td className="px-4 py-3 text-neutral-400">
                      One-time import state from the old Strapi backend. Tracks
                      fingerprint, counts, warnings, failures, and old-to-new
                      entity mappings for idempotency and reporting.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </section>

        <section className="mt-12">
          <h2 className="text-2xl font-semibold tracking-tight text-neutral-100">
            API Layer
          </h2>

          <section className="mt-6">
            <h3 className="text-lg font-medium text-neutral-200">
              oRPC Router Structure
            </h3>
            <p className="mt-3 leading-relaxed text-neutral-400">
              The API uses oRPC with two procedure types:
            </p>
            <ul className="mt-3 list-inside list-disc space-y-2 text-neutral-400">
              <li>
                <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">
                  publicProcedure
                </code>{" "}
                &mdash; Accessible without authentication. Used for catalog
                browsing, session reading, health check, and migrated-password
                setup.
              </li>
              <li>
                <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">
                  protectedProcedure
                </code>{" "}
                &mdash; Requires an authenticated session with an active account.
                A middleware validates the session and injects the user context.
                Used for all overlay mutations, ingestion, refresh, and
                migration.
              </li>
            </ul>
            <p className="mt-3 leading-relaxed text-neutral-400">
              The router is organized into namespaces:
            </p>
            <pre className="mt-3 overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 font-mono text-sm text-neutral-300">
              <code>{`appRouter = {
  healthCheck,                // Public
  session: { current },       // Public (returns null if unauthenticated)
  auth: { setupMigratedPassword },  // Public - migrated-user password setup
  catalog: {
    creators,                 // Public - list creators with search/filter
    feeds,                    // Public - list feeds
    contentItems,             // Public - list content items (accepts an
                              //   optional session-scoped collectionId filter)
    contentDetail,            // Public - single content item with sources
  },
  refresh: {
    status,                   // Public - refresh run status
    startAll,                 // Protected - start background refresh
    runAll,                   // Protected - run refresh synchronously
    runCreator,               // Protected - refresh one creator
    runFeed,                  // Protected - refresh one feed
  },
  creatorMetadata: {
    start,                    // Protected - start creator metadata refresh
    status,                   // Protected - metadata refresh run status
  },
  ingestion: {
    addSource,                // Protected - add single source URL
    batchAddSources,          // Protected - add multiple source URLs
  },
  overlays: {
    subscriptions,            // Protected - list user subscriptions
    subscribedContentItems,   // Protected - items from subscribed creators
    subscribeToCreator,       // Protected - subscribe
    unsubscribeFromCreator,   // Protected - unsubscribe
    bulkUnsubscribe,          // Protected - unsubscribe multiple creators
    unreadCounts,             // Protected - per-creator unread counts
    feedHealth,               // Protected - per-feed success/failure streaks
    markCreatorContentOpened, // Protected - mark one creator's items opened
    markAllContentOpened,     // Protected - mark everything opened
    contentStatuses,          // Protected - list all user statuses
    markContentOpened,        // Protected - mark opened
    markContentPlayed,        // Protected - mark played
    savePlaybackPosition,     // Protected - upsert playback position
    toggleContentOpened,      // Protected - toggle opened
    toggleContentPlayed,      // Protected - toggle played
    toggleContentFavorite,    // Protected - toggle favorite
    favoriteContentItems,     // Protected - list favorited items
    contentHistory,           // Protected - opened/played history
    playlists,                // Protected - list user playlists
    createPlaylist,           // Protected
    updatePlaylist,           // Protected
    deletePlaylist,           // Protected
    playlistItems,            // Protected - list items in playlist
    addPlaylistItem,          // Protected
    removePlaylistItem,       // Protected
    reorderPlaylistItems,     // Protected
    settings,                 // Protected - list user settings
    saveSetting,              // Protected
    deleteSetting,            // Protected
    exportUserData,           // Protected - export user data as JSON
    importUserData,           // Protected - import user data from JSON
    collections,              // Protected - list creator collections
    createCollection,         // Protected
    updateCollection,         // Protected
    deleteCollection,         // Protected
    collectionMembers,        // Protected - list members of a collection
    addCollectionMember,      // Protected
    removeCollectionMember,   // Protected
  },
  migration: {
    runImport,                // Protected - import from Strapi export JSON
  },
}`}</code>
            </pre>
          </section>

          <section className="mt-6">
            <h3 className="text-lg font-medium text-neutral-200">
              Context and Authentication
            </h3>
            <p className="mt-3 leading-relaxed text-neutral-400">
              Each request creates a context through{" "}
              <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">
                createContext
              </code>
              . The context contains:
            </p>
            <ul className="mt-3 list-inside list-disc space-y-2 text-neutral-400">
              <li>
                <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">
                  db
                </code>{" "}
                &mdash; The Drizzle database instance for querying.
              </li>
              <li>
                <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">
                  session
                </code>{" "}
                &mdash; The authenticated session and user, or null for
                anonymous requests. Includes accountState to distinguish active
                users from migrated users pending password setup.
              </li>
              <li>
                <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">
                  sourceRegistry
                </code>{" "}
                &mdash; The source adapter registry with YouTube, Odysee, and
                PeerTube adapters registered.
              </li>
            </ul>
            <p className="mt-3 text-sm text-neutral-500">
              The protected procedure middleware rejects requests with no session
              (UNAUTHORIZED) or with a non-active accountState (FORBIDDEN).
            </p>
          </section>

          <section className="mt-6">
            <h3 className="text-lg font-medium text-neutral-200">
              Adding a New API Procedure
            </h3>
            <ol className="mt-3 list-inside list-decimal space-y-3 text-neutral-400">
              <li>
                <span className="text-neutral-200">
                  Define the input schema.
                </span>{" "}
                Use Zod schemas at the top of the router file. Follow the naming
                convention of descriptive input names
                (e.g.,{" "}
                <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">
                  playlistNameInput
                </code>
                ).
              </li>
              <li>
                <span className="text-neutral-200">Choose the procedure.</span>{" "}
                Use{" "}
                <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">
                  publicProcedure
                </code>{" "}
                for anonymous catalog reads or{" "}
                <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">
                  protectedProcedure
                </code>{" "}
                for authenticated mutations and user-scoped data.
              </li>
              <li>
                <span className="text-neutral-200">
                  Implement the handler.
                </span>{" "}
                Use repository functions from{" "}
                <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">
                  repositories/catalog
                </code>{" "}
                or{" "}
                <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">
                  repositories/overlays
                </code>
                . Keep the handler thin &mdash; delegate to services or
                repositories.
              </li>
              <li>
                <span className="text-neutral-200">Validate existence.</span>{" "}
                For operations that reference catalog entities, validate the
                entity exists before proceeding. Throw{" "}
                <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">
                  ORPCError("NOT_FOUND")
                </code>{" "}
                when missing.
              </li>
              <li>
                <span className="text-neutral-200">Scope by userId.</span>{" "}
                All user-owned data must pass{" "}
                <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">
                  context.session.user.id
                </code>{" "}
                to repository functions. Never trust client-supplied user IDs.
              </li>
              <li>
                <span className="text-neutral-200">Write tests.</span>{" "}
                Add test coverage through the API procedure (public interface),
                not private internals.
              </li>
            </ol>
          </section>
        </section>

        <section className="mt-12">
          <h2 className="text-2xl font-semibold tracking-tight text-neutral-100">
            Source Adapters
          </h2>
          <p className="mt-4 leading-relaxed text-neutral-400">
            Source adapters normalize platform-specific data into FeedElity's
            unified catalog model. Each adapter implements the{" "}
            <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">
              SourceAdapter
            </code>{" "}
            interface and is registered in the source adapter registry.
          </p>

          <section className="mt-6">
            <h3 className="text-lg font-medium text-neutral-200">
              Source Adapter Interface
            </h3>
            <pre className="mt-3 overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 font-mono text-sm text-neutral-300">
              <code>{`interface SourceAdapter<TSourceType extends SourceType = SourceType> {
  readonly sourceType: TSourceType;
  detect(input: string): SourceDetectionResult;
  resolveInput(input: DetectedSourceInput): Promise<SourceAdapterResult<ResolvedSourceInput>>;
  normalizeCatalogPayload(input: ResolvedSourceInput, payload: string): SourceAdapterResult<NormalizedCatalogPayload>;
  fetchCatalog(input: ResolvedSourceInput): Promise<SourceAdapterResult<NormalizedCatalogPayload>>;
  fetchCreatorMetadata?(
    input: FetchCreatorMetadataInput,
  ): Promise<SourceAdapterResult<CreatorMetadata>>;
}`}</code>
            </pre>
            <ul className="mt-3 list-inside list-disc space-y-2 text-neutral-400">
              <li>
                <span className="text-neutral-200">detect</span> &mdash;
                Determines if a URL is supported by this adapter and classifies
                the input kind (feed URL, creator URL, content URL, unknown).
                Returns a DetectedSourceInput or an error.
              </li>
              <li>
                <span className="text-neutral-200">resolveInput</span> &mdash;
                Resolves a detected input into creator/feed identity with a
                canonical URL and optional title.
              </li>
              <li>
                <span className="text-neutral-200">
                  normalizeCatalogPayload
                </span>{" "}
                &mdash; Parses raw feed or API response data (XML, JSON) into
                the normalized catalog structure: creator, feeds, and content
                items with sources.
              </li>
              <li>
                <span className="text-neutral-200">fetchCatalog</span> &mdash;
                Fetches data from the remote source and normalizes it in one
                step. Combines HTTP fetch and normalization.
              </li>
              <li>
                <span className="text-neutral-200">
                  fetchCreatorMetadata (optional)
                </span>{" "}
                &mdash; Fetches creator metadata fields (display name, image,
                description, canonical URL) beyond what the catalog payload
                provides. Adapters that cannot determine these fields may omit
                the method.
              </li>
            </ul>
          </section>

          <section className="mt-6">
            <h3 className="text-lg font-medium text-neutral-200">
              Source Adapter Registry
            </h3>
            <p className="mt-3 leading-relaxed text-neutral-400">
              The{" "}
              <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">
                SourceAdapterRegistry
              </code>{" "}
              holds all registered adapters. On source detection, it iterates
              adapters in registration order and returns the first match. The
              registry is created in the context module with the three built-in
              adapters:
            </p>
            <pre className="mt-3 overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 font-mono text-sm text-neutral-300">
              <code>{`const defaultSourceRegistry = createSourceAdapterRegistry([
  youtubeAdapter,
  odyseeAdapter,
  peertubeAdapter,
]);`}</code>
            </pre>
          </section>

          <section className="mt-6">
            <h3 className="text-lg font-medium text-neutral-200">
              Adding a New Source
            </h3>
            <p className="mt-3 leading-relaxed text-neutral-400">
              To add support for a new video platform:
            </p>
            <ol className="mt-3 list-inside list-decimal space-y-3 text-neutral-400">
              <li>
                <span className="text-neutral-200">
                  Add the source type to the union.
                </span>{" "}
                Update{" "}
                <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">
                  SourceType
                </code>{" "}
                in{" "}
                <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">
                  packages/api/src/domain/catalog.ts
                </code>{" "}
                and the corresponding{" "}
                <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">
                  sourceTypeValues
                </code>{" "}
                in{" "}
                <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">
                  packages/db/src/schema/catalog.ts
                </code>
                .
              </li>
              <li>
                <span className="text-neutral-200">
                  Create the adapter file.
                </span>{" "}
                Add a new file in{" "}
                <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">
                  packages/api/src/sources/
                </code>
                . Implement the SourceAdapter interface with detect,
                resolveInput, normalizeCatalogPayload, and fetchCatalog;
                fetchCreatorMetadata is optional.
              </li>
              <li>
                <span className="text-neutral-200">Write fixture-backed tests.</span>{" "}
                Test detection against real URL forms, normalization against
                saved response fixtures, and error handling for malformed input.
                Do not depend on live network calls.
              </li>
              <li>
                <span className="text-neutral-200">Register the adapter.</span>{" "}
                Export the adapter from{" "}
                <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">
                  packages/api/src/sources/index.ts
                </code>{" "}
                and add it to the registry in{" "}
                <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">
                  packages/api/src/context.ts
                </code>
                .
              </li>
              <li>
                <span className="text-neutral-200">
                  Update the router input schema.
                </span>{" "}
                Add the new source type to{" "}
                <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">
                  sourceTypeInput
                </code>{" "}
                in the router if you want filter support.
              </li>
            </ol>
          </section>
        </section>

        <section className="mt-12">
          <h2 className="text-2xl font-semibold tracking-tight text-neutral-100">
            Database
          </h2>

          <section className="mt-6">
            <h3 className="text-lg font-medium text-neutral-200">
              Schema Structure
            </h3>
            <p className="mt-3 leading-relaxed text-neutral-400">
              Drizzle schema is in{" "}
              <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">
                packages/db/src/schema/
              </code>{" "}
              split into three files:
            </p>
            <ul className="mt-3 list-inside list-disc space-y-2 text-neutral-400">
              <li>
                <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">
                  auth.ts
                </code>{" "}
                &mdash; User, session, account, and verification tables managed
                by better-auth.
              </li>
              <li>
                <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">
                  catalog.ts
                </code>{" "}
                &mdash; Global catalog tables (creator, feed, contentItem,
                contentSource, feedContent, refreshRun, refreshFeedResult) with
                Drizzle relations.
              </li>
              <li>
                <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">
                  overlays.ts
                </code>{" "}
                &mdash; User-owned overlay tables (subscription, contentStatus,
                playlist, playlistItem, creatorCollection, collectionMember,
                userSetting, migrationRun, migrationMapping) with
                cross-references to catalog and auth tables.
              </li>
            </ul>
            <p className="mt-3 text-sm text-neutral-500">
              All tables use text primary keys (UUID), integer timestamps in
              millisecond mode, and appropriate indexes for query patterns.
              Unique indexes enforce source identity deduplication and user-data
              constraints.
            </p>
          </section>

          <section className="mt-6">
            <h3 className="text-lg font-medium text-neutral-200">
              Migration Workflow
            </h3>
            <pre className="mt-3 overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 font-mono text-sm text-neutral-300">
              <code>{`bun run db:generate   # Generate SQL migration files from schema changes
bun run db:migrate    # Apply pending migrations to the database
bun run db:push       # Push schema directly (dev only, no migration files)
bun run db:studio     # Open Drizzle Studio to inspect data
bun run db:local      # Start local libSQL server on port 8080`}</code>
            </pre>
          </section>

          <section className="mt-6">
            <h3 className="text-lg font-medium text-neutral-200">
              Adding a New Table
            </h3>
            <ol className="mt-3 list-inside list-decimal space-y-3 text-neutral-400">
              <li>
                <span className="text-neutral-200">Choose the right file.</span>{" "}
                Auth-related tables go in auth.ts, catalog tables in catalog.ts,
                user overlay tables in overlays.ts.
              </li>
              <li>
                <span className="text-neutral-200">Define the table.</span>{" "}
                Use sqliteTable with text IDs, integer timestamps (mode:
                timestamp_ms), and the shared currentTimestampMs helper.
              </li>
              <li>
                <span className="text-neutral-200">Add indexes.</span>{" "}
                Include a unique index for natural identity columns and regular
                indexes for foreign keys and common query patterns.
              </li>
              <li>
                <span className="text-neutral-200">Define relations.</span>{" "}
                Add a Drizzle relations definition for the table if it has
                foreign keys to other tables.
              </li>
              <li>
                <span className="text-neutral-200">Export from index.</span>{" "}
                The file re-exports through schema/index.ts.
              </li>
              <li>
                <span className="text-neutral-200">
                  Generate and apply migration.
                </span>{" "}
                Run db:generate to produce the SQL migration, then db:migrate to
                apply it.
              </li>
            </ol>
          </section>
        </section>

        <section className="mt-12">
          <h2 className="text-2xl font-semibold tracking-tight text-neutral-100">
            Ingestion and Refresh
          </h2>

          <section className="mt-6">
            <h3 className="text-lg font-medium text-neutral-200">
              Ingestion Pipeline
            </h3>
            <p className="mt-3 leading-relaxed text-neutral-400">
              The ingestion service handles adding new sources and creating
              catalog records. The flow is:
            </p>
            <ol className="mt-3 list-inside list-decimal space-y-2 text-neutral-400">
              <li>Detect the source type from the input URL via the registry.</li>
              <li>Resolve the input to a canonical creator/feed identity.</li>
              <li>Fetch the remote catalog data through the adapter.</li>
              <li>Normalize into creator, feed, content items, and content sources.</li>
              <li>Persist to the database with upsert semantics (deduplicate by
              source identity).</li>
              <li>Create a subscription linking the user to the creator.</li>
            </ol>
            <p className="mt-3 text-sm text-neutral-500">
              Batch ingestion processes each URL independently and reports
              per-item success or failure without aborting the entire batch.
            </p>
          </section>

          <section className="mt-6">
            <h3 className="text-lg font-medium text-neutral-200">
              Refresh Service
            </h3>
            <p className="mt-4 leading-relaxed text-neutral-400">
              The refresh service re-fetches feed data and updates the catalog.
              Two modes:
            </p>
            <ul className="mt-3 list-inside list-disc space-y-2 text-neutral-400">
              <li>
                <span className="text-neutral-200">Normal refresh</span>{" "}
                &mdash; Selects feeds where nextRefreshAfter has passed or is
                null. Skips feeds that are not due.
              </li>
              <li>
                <span className="text-neutral-200">Force refresh</span>{" "}
                &mdash; Selects all feeds regardless of cadence metadata.
              </li>
            </ul>
            <p className="mt-3 text-sm text-neutral-500">
              Refresh runs produce a refreshRun record and per-feed
              refreshFeedResult records with counts and error summaries. The
              startAll procedure returns immediately while the refresh continues
              in the background.
            </p>
          </section>
        </section>

        <section className="mt-12">
          <h2 className="text-2xl font-semibold tracking-tight text-neutral-100">
            Development Workflow
          </h2>
          <div className="mt-4 overflow-x-auto rounded-lg border border-neutral-800">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-neutral-800 bg-neutral-900/50">
                  <th className="whitespace-nowrap px-4 py-3 font-medium text-neutral-200">
                    Command
                  </th>
                  <th className="px-4 py-3 font-medium text-neutral-200">
                    Description
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800/50">
                <tr>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-neutral-300">
                    bun install
                  </td>
                  <td className="px-4 py-3 text-neutral-400">
                    Install workspace dependencies
                  </td>
                </tr>
                <tr>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-neutral-300">
                    bun run dev
                  </td>
                  <td className="px-4 py-3 text-neutral-400">
                    Start all dev targets through Turborepo
                  </td>
                </tr>
                <tr>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-neutral-300">
                    bun run dev:web
                  </td>
                  <td className="px-4 py-3 text-neutral-400">
                    Start the Solid web app only
                  </td>
                </tr>
                <tr>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-neutral-300">
                    bun run dev:server
                  </td>
                  <td className="px-4 py-3 text-neutral-400">
                    Start the Hono API server only
                  </td>
                </tr>
                <tr>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-neutral-300">
                    bun run dev:desktop
                  </td>
                  <td className="px-4 py-3 text-neutral-400">
                    Start the Electrobun desktop app with HMR
                  </td>
                </tr>
                <tr>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-neutral-300">
                    bun run check-types
                  </td>
                  <td className="px-4 py-3 text-neutral-400">
                    TypeScript type check across the entire monorepo
                  </td>
                </tr>
                <tr>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-neutral-300">
                    bun run build
                  </td>
                  <td className="px-4 py-3 text-neutral-400">
                    Production build of all apps and packages
                  </td>
                </tr>
                <tr>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-neutral-300">
                    bun run test
                  </td>
                  <td className="px-4 py-3 text-neutral-400">
                    Run all test suites through Turborepo
                  </td>
                </tr>
                <tr>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-neutral-300">
                    bun run build:desktop
                  </td>
                  <td className="px-4 py-3 text-neutral-400">
                    Build the stable Electrobun desktop app
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-12">
          <h2 className="text-2xl font-semibold tracking-tight text-neutral-100">
            Testing
          </h2>
          <p className="mt-4 leading-relaxed text-neutral-400">
            FeedElity uses vertical TDD slices: write one behavior test, then
            implement the behavior, then repeat. Tests verify behavior through
            public interfaces &mdash; API procedures, domain services, source
            adapter contracts, migration commands, or rendered UI behavior.
          </p>
          <p className="mt-4 leading-relaxed text-neutral-400">
            Run every suite with{" "}
            <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">
              bun run test
            </code>
            , which fans out through Turborepo. Each package uses{" "}
            <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">
              bun test
            </code>{" "}
            directly; the web app runs{" "}
            <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">
              bun test --conditions browser
            </code>
            . Suites live alongside the code they cover, for example{" "}
            <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">
              packages/api/src/routers/*.test.ts
            </code>
            ,{" "}
            <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">
              packages/db/src/*.test.ts
            </code>
            , and{" "}
            <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">
              apps/web/src/*.test.ts
            </code>
            .
          </p>
          <ul className="mt-4 list-inside list-disc space-y-2 text-neutral-400">
            <li>
              <span className="text-neutral-200">
                Source adapter tests
              </span>{" "}
              &mdash; Use saved response fixtures. Do not depend on live network
              calls. Cover URL detection, normalization, and error handling.
            </li>
            <li>
              <span className="text-neutral-200">API tests</span> &mdash; Test
              through the oRPC router. Verify catalog browsing is public,
              overlay mutations are protected, and cross-user isolation is
              enforced.
            </li>
            <li>
              <span className="text-neutral-200">Migration tests</span> &mdash;
              Test with fixture export JSON. Cover malformed input rejection,
              successful import, idempotent re-import, and unmapped record
              reporting.
            </li>
            <li>
              <span className="text-neutral-200">Repository tests</span> &mdash;
              Test repository functions against a real database. Verify
              constraints, uniqueness, and scoping.
            </li>
          </ul>
          <p className="mt-4 text-sm text-neutral-500">
            Tests must cover failure paths, not only the happy path, for auth,
            migration, ingestion, refresh, and cross-user data access.
          </p>
        </section>

        <section className="mt-12">
          <h2 className="text-2xl font-semibold tracking-tight text-neutral-100">
            Code Conventions
          </h2>
          <ul className="mt-4 list-inside list-disc space-y-2 text-neutral-400">
            <li>
              TypeScript strict mode. No{" "}
              <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">
                any
              </code>
              ,{" "}
              <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">
                as any
              </code>
              , or{" "}
              <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">
                : any
              </code>
              .
            </li>
            <li>
              Use{" "}
              <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">
                import type
              </code>{" "}
              for type-only imports. verbatimModuleSyntax is enabled.
            </li>
            <li>
              External imports first, blank line, then local imports.
            </li>
            <li>
              No placeholder code, no TODO, no FIXME.
            </li>
            <li>
              Keep source-specific logic inside source adapters. Generic catalog,
              API, and UI code uses normalized contracts.
            </li>
            <li>
              Keep module boundaries explicit: source adapters, domain services,
              repositories, API procedures, and UI state should not bleed into
              each other.
            </li>
            <li>
              Every user-owned read or write must be scoped by authenticated
              userId at the API or service boundary.
            </li>
            <li>
              Use Solid patterns for the frontend, not React patterns.
            </li>
          </ul>
        </section>
      </main>
    </DocsLayout>
  );
}
