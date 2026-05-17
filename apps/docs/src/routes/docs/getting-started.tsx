import { createFileRoute } from "@tanstack/react-router";

import { DocsLayout } from "~/components/docs-layout";

export const Route = createFileRoute("/docs/getting-started")({
  head: () => ({
    meta: [
      { title: "Getting Started - FeedElity Docs" },
      {
        name: "description",
        content:
          "Get started with FeedElity. Learn what FeedElity is, requirements, quick start, and development setup.",
      },
    ],
  }),
  component: GettingStartedPage,
});

function GettingStartedPage() {
  return (
    <DocsLayout>
      <main className="max-w-3xl">
        <h1 className="text-4xl font-bold tracking-tight text-neutral-50">
          Getting Started
        </h1>

        <section className="mt-10">
          <h2 className="text-2xl font-semibold tracking-tight text-neutral-100">
            What is FeedElity?
          </h2>
          <p className="mt-4 leading-relaxed text-neutral-400">
            FeedElity is a personal-first, video-oriented RSS client for
            following creators across YouTube, Odysee, and PeerTube in one fast,
            high-density interface. It is self-hosted, privacy-focused, and open
            source.
          </p>
          <p className="mt-4 leading-relaxed text-neutral-400">
            The app provides a three-column workflow: a creator/source column on
            the left, a content list in the middle, and a selected content
            viewer on the right. You can browse the global catalog anonymously,
            or sign in to manage subscriptions, favorites, playlists, and
            history.
          </p>
          <p className="mt-4 leading-relaxed text-neutral-400">
            Built with modern tooling: Solid on the frontend, Hono on the
            backend, Drizzle ORM with SQLite/libSQL for storage, better-auth for
            authentication, and Bun as the runtime.
          </p>
        </section>

        <section className="mt-12">
          <h2 className="text-2xl font-semibold tracking-tight text-neutral-100">
            Requirements
          </h2>
          <div className="mt-4 space-y-3">
            <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 px-5 py-4">
              <p className="font-medium text-neutral-200">Self-Hosting</p>
              <ul className="mt-2 list-inside list-disc space-y-1 text-neutral-400">
                <li>Docker</li>
                <li>Docker Compose (v2 or later)</li>
              </ul>
            </div>
            <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 px-5 py-4">
              <p className="font-medium text-neutral-200">Development</p>
              <ul className="mt-2 list-inside list-disc space-y-1 text-neutral-400">
                <li>Bun 1.3 or later</li>
                <li>Git</li>
              </ul>
            </div>
          </div>
        </section>

        <section className="mt-12">
          <h2 className="text-2xl font-semibold tracking-tight text-neutral-100">
            Quick Start
          </h2>
          <p className="mt-4 leading-relaxed text-neutral-400">
            The fastest way to get FeedElity running is with Docker Compose.
          </p>

          <div className="mt-6 space-y-6">
            <div>
              <p className="text-sm font-medium text-neutral-300">
                1. Clone the repository
              </p>
              <pre className="mt-2 overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 font-mono text-sm text-neutral-300">
                <code>git clone https://github.com/anomalyco/FeedElity.git&#10;cd FeedElity</code>
              </pre>
            </div>

            <div>
              <p className="text-sm font-medium text-neutral-300">
                2. Create your environment file
              </p>
              <pre className="mt-2 overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 font-mono text-sm text-neutral-300">
                <code>cp .env.docker.example .env</code>
              </pre>
              <p className="mt-2 text-sm text-neutral-500">
                Open <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">.env</code> and set
                at least <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">BETTER_AUTH_SECRET</code> to
                a random string of 32 or more characters. Update{" "}
                <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">BETTER_AUTH_URL</code> and{" "}
                <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">CORS_ORIGIN</code> to match
                your domain if you are not using localhost.
              </p>
            </div>

            <div>
              <p className="text-sm font-medium text-neutral-300">
                3. Start the services
              </p>
              <p className="mt-2 text-sm text-neutral-500">
                With a local libSQL database container:
              </p>
              <pre className="mt-2 overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 font-mono text-sm text-neutral-300">
                <code>docker compose --profile local-db up -d</code>
              </pre>
              <p className="mt-2 text-sm text-neutral-500">
                Or with an external database (Turso cloud or any libSQL-compatible
                server). Set{" "}
                <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">DATABASE_URL</code> in{" "}
                <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">.env</code> to your
                external connection string, then run:
              </p>
              <pre className="mt-2 overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 font-mono text-sm text-neutral-300">
                <code>docker compose up -d</code>
              </pre>
            </div>

            <div>
              <p className="text-sm font-medium text-neutral-300">
                4. Open the app
              </p>
              <pre className="mt-2 overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 font-mono text-sm text-neutral-300">
                <code>http://localhost</code>
              </pre>
              <p className="mt-2 text-sm text-neutral-500">
                If you changed <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">WEB_PORT</code>,
                use that port instead. Create an account and start adding
                sources.
              </p>
            </div>
          </div>
        </section>

        <section className="mt-12">
          <h2 className="text-2xl font-semibold tracking-tight text-neutral-100">
            Development Setup
          </h2>
          <p className="mt-4 leading-relaxed text-neutral-400">
            To work on FeedElity locally without Docker, use the Bun runtime.
          </p>

          <div className="mt-6 space-y-4">
            <div>
              <p className="text-sm font-medium text-neutral-300">
                Install dependencies
              </p>
              <pre className="mt-2 overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 font-mono text-sm text-neutral-300">
                <code>bun install</code>
              </pre>
            </div>

            <div>
              <p className="text-sm font-medium text-neutral-300">
                Start the local database
              </p>
              <pre className="mt-2 overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 font-mono text-sm text-neutral-300">
                <code>bun run db:local</code>
              </pre>
              <p className="mt-2 text-sm text-neutral-500">
                This starts a local libSQL server on port 5000.
              </p>
            </div>

            <div>
              <p className="text-sm font-medium text-neutral-300">
                Push the database schema
              </p>
              <pre className="mt-2 overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 font-mono text-sm text-neutral-300">
                <code>bun run db:push</code>
              </pre>
            </div>

            <div>
              <p className="text-sm font-medium text-neutral-300">
                Start all dev servers
              </p>
              <pre className="mt-2 overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 font-mono text-sm text-neutral-300">
                <code>bun run dev</code>
              </pre>
              <p className="mt-2 text-sm text-neutral-500">
                This starts the web app, API server, and any other dev targets
                through Turborepo. You can also run individual targets:
              </p>
              <pre className="mt-3 overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 font-mono text-sm text-neutral-300">
                <code>bun run dev:web     # Solid web app only&#10;bun run dev:server  # Hono API server only</code>
              </pre>
            </div>

            <div>
              <p className="text-sm font-medium text-neutral-300">
                Type checking and builds
              </p>
              <pre className="mt-2 overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 font-mono text-sm text-neutral-300">
                <code>bun run check-types  # TypeScript type check across workspace&#10;bun run build       # Production build</code>
              </pre>
            </div>
          </div>
        </section>

        <section className="mt-12">
          <h2 className="text-2xl font-semibold tracking-tight text-neutral-100">
            Next Steps
          </h2>
          <ul className="mt-4 list-inside list-disc space-y-2 text-neutral-400">
            <li>
              Read the{" "}
              <a
                href="/docs/self-hosting"
                className="text-neutral-200 underline decoration-neutral-600 underline-offset-2 transition-colors hover:text-neutral-50"
              >
                Self-Hosting Guide
              </a>{" "}
              for full deployment options, environment variables, and backup
              strategies.
            </li>
            <li>
              Add your first source by pasting a YouTube channel URL, Odysee
              channel URL, or PeerTube video/channel URL.
            </li>
            <li>
              Subscribe to creators, mark favorites, and organize content with
              playlists.
            </li>
          </ul>
        </section>
      </main>
    </DocsLayout>
  );
}
