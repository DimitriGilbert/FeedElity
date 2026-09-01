import { createFileRoute } from "@tanstack/react-router";

import { DocsLayout } from "~/components/docs-layout";
import { buildSeo } from "~/lib/seo";

export const Route = createFileRoute("/docs/self-hosting")({
  head: () =>
    buildSeo({
      title: "Self-Hosting Guide - FeedElity Docs",
      description:
        "Deploy FeedElity on your own server. Docker Compose, environment variables, database persistence, backup, updates, and running without Docker.",
      pathname: "/docs/self-hosting",
      type: "article",
    }),
  component: SelfHostingPage,
});

function SelfHostingPage() {
  return (
    <DocsLayout>
      <main className="max-w-3xl">
        <h1 className="text-4xl font-bold tracking-tight text-neutral-50">
          Self-Hosting Guide
        </h1>
        <p className="mt-4 leading-relaxed text-neutral-400">
          FeedElity is designed to be self-hosted. This guide covers deployment
          with Docker Compose, environment configuration, database persistence,
          backup, updates, and running without Docker.
        </p>

        <section className="mt-10">
          <h2 className="text-2xl font-semibold tracking-tight text-neutral-100">
            Prerequisites
          </h2>
          <ul className="mt-4 list-inside list-disc space-y-2 text-neutral-400">
            <li>
              A server running Linux (or any OS with Docker support)
            </li>
            <li>
              Docker Engine 20.10 or later
            </li>
            <li>
              Docker Compose v2 or later (included with Docker Desktop and
              modern Docker Engine)
            </li>
            <li>
              At least 512 MB RAM and 1 GB of disk space for the application
              and its database
            </li>
          </ul>
        </section>

        <section className="mt-12">
          <h2 className="text-2xl font-semibold tracking-tight text-neutral-100">
            Docker Deployment
          </h2>
          <p className="mt-4 leading-relaxed text-neutral-400">
            The Compose stack runs two services, both built from source:
          </p>
          <ul className="mt-4 list-inside list-disc space-y-2 text-neutral-400">
            <li>
              <span className="text-neutral-200">web</span> &mdash; nginx
              serving the built Solid app, published on port{" "}
              <span className="text-neutral-200">31000</span>.
            </li>
            <li>
              <span className="text-neutral-200">server</span> &mdash; the Hono
              API server, published on port{" "}
              <span className="text-neutral-200">31001</span>.
            </li>
          </ul>

          <section className="mt-6">
            <h3 className="text-lg font-medium text-neutral-200">
              Step-by-Step
            </h3>
            <pre className="mt-4 overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 font-mono text-sm text-neutral-300">
              <code>git clone https://github.com/DimitriGilbert/FeedElity.git&#10;cd FeedElity&#10;cp docker/.env.example .env</code>
            </pre>
            <p className="mt-3 text-sm text-neutral-500">
              Edit{" "}
              <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">.env</code> at
              the repo root and set the three{" "}
              <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">FEEDELITY_*</code>{" "}
              variables (see the{" "}
              <a href="#environment-variables" className="text-neutral-200 underline decoration-neutral-600 underline-offset-2 transition-colors hover:text-neutral-50">
                Environment Variables
              </a>{" "}
              section below). Generate a secure secret with:
            </p>
            <pre className="mt-2 overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 font-mono text-sm text-neutral-300">
              <code>openssl rand -base64 48</code>
            </pre>
            <p className="mt-3 text-sm text-neutral-500">
              Then build and start:
            </p>
            <pre className="mt-2 overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 font-mono text-sm text-neutral-300">
              <code>docker compose up -d --build</code>
            </pre>
            <p className="mt-3 text-sm text-neutral-500">
              There are no pre-built images to pull &mdash; the containers are
              always built from your checkout. The app will be available at{" "}
              <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">http://localhost:31000</code>.
            </p>
          </section>

          <section className="mt-8">
            <h3 className="text-lg font-medium text-neutral-200">
              Data Persistence
            </h3>
            <p className="mt-3 leading-relaxed text-neutral-400">
              The server stores its libSQL database file at{" "}
              <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">/data/local.db</code>{" "}
              inside the container, persisted through a Docker volume named{" "}
              <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">feedelity-data</code>.
              This volume persists across container restarts and rebuilds.
            </p>
            <p className="mt-3 text-sm text-neutral-500">
              On first start, the server seeds the database from your local dev
              snapshot (<code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">./local.db</code> at
              the repo root, bind-mounted read-only). Every subsequent start
              reuses the existing database untouched, so your data survives
              restarts. If no snapshot exists, the server starts with an empty
              database. To inspect the volume (the Compose project is named{" "}
              <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">feedelity</code>):
            </p>
            <pre className="mt-2 overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 font-mono text-sm text-neutral-300">
              <code>docker volume inspect feedelity_feedelity-data</code>
            </pre>
          </section>
        </section>

        <section className="mt-12">
          <h2 className="text-2xl font-semibold tracking-tight text-neutral-100">
            Platform Deployment (Dokploy / Coolify)
          </h2>
          <p className="mt-4 leading-relaxed text-neutral-400">
            FeedElity can be deployed through PaaS platforms that support
            Docker Compose projects, such as Dokploy or Coolify.
          </p>
          <ol className="mt-4 list-inside list-decimal space-y-3 text-neutral-400">
            <li>
              <span className="text-neutral-200">Connect your repository.</span>{" "}
              Point the platform to your FeedElity fork or clone.
            </li>
            <li>
              <span className="text-neutral-200">Set the compose file.</span>{" "}
              The platform should detect{" "}
              <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">docker-compose.yml</code> at
              the repository root.
            </li>
            <li>
              <span className="text-neutral-200">Configure environment variables.</span>{" "}
              Add all three{" "}
              <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">FEEDELITY_*</code>{" "}
              variables from the{" "}
              <a href="#environment-variables" className="text-neutral-200 underline decoration-neutral-600 underline-offset-2 transition-colors hover:text-neutral-50">
                Environment Variables
              </a>{" "}
              section below, with{" "}
              <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">FEEDELITY_PUBLIC_URL</code> and{" "}
              <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">FEEDELITY_CORS_ORIGIN</code> set
              to your domain.
            </li>
            <li>
              <span className="text-neutral-200">Allow time for the build.</span>{" "}
              Images are built from source, so the first deployment includes a
              full build of the web app and server.
            </li>
            <li>
              <span className="text-neutral-200">Set up TLS.</span>{" "}
              Most platforms handle TLS termination automatically. Configure
              your domain and enable HTTPS.
            </li>
            <li>
              <span className="text-neutral-200">Deploy.</span>{" "}
              The web service exposes port 31000 and the server port 31001.
            </li>
          </ol>
        </section>

        <section className="mt-12" id="environment-variables">
          <h2 className="text-2xl font-semibold tracking-tight text-neutral-100">
            Environment Variables
          </h2>
          <p className="mt-4 leading-relaxed text-neutral-400">
            Copy{" "}
            <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">docker/.env.example</code>{" "}
            to{" "}
            <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">.env</code> at
            the repo root. Compose reads exactly three variables from this file
            and injects them into the server container:
          </p>

          <div className="mt-6 overflow-x-auto rounded-lg border border-neutral-800">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-neutral-800 bg-neutral-900/50">
                  <th className="whitespace-nowrap px-4 py-3 font-medium text-neutral-200">
                    Variable
                  </th>
                  <th className="px-4 py-3 font-medium text-neutral-200">
                    Description
                  </th>
                  <th className="whitespace-nowrap px-4 py-3 font-medium text-neutral-200">
                    Required
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800/50">
                <tr>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-neutral-300">
                    FEEDELITY_AUTH_SECRET
                  </td>
                  <td className="px-4 py-3 text-neutral-400">
                    Random string of at least 32 characters used to sign auth
                    tokens and cookies. Generate with{" "}
                    <code className="rounded bg-neutral-800 px-1 py-0.5 text-neutral-300">
                      openssl rand -base64 48
                    </code>
                    . Keep it stable: changing it logs everyone out and
                    invalidates sessions. The server fails to start without it.
                  </td>
                  <td className="px-4 py-3 text-neutral-400">Yes</td>
                </tr>
                <tr>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-neutral-300">
                    FEEDELITY_PUBLIC_URL
                  </td>
                  <td className="px-4 py-3 text-neutral-400">
                    The full public URL browsers use to reach the web app,
                    including scheme and port (for example{" "}
                    <code className="rounded bg-neutral-800 px-1 py-0.5 text-neutral-300">
                      http://localhost:31000
                    </code>
                    ). better-auth uses this as its base URL and for cookie and
                    CORS decisions.
                  </td>
                  <td className="px-4 py-3 text-neutral-400">Yes</td>
                </tr>
                <tr>
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-neutral-300">
                    FEEDELITY_CORS_ORIGIN
                  </td>
                  <td className="px-4 py-3 text-neutral-400">
                    Comma-separated list of origins allowed to call the API
                    (CORS and better-auth trusted origins). Always include the
                    web app origin.
                  </td>
                  <td className="px-4 py-3 text-neutral-400">Yes</td>
                </tr>
              </tbody>
            </table>
          </div>

          <p className="mt-6 leading-relaxed text-neutral-400">
            Two more variables are fixed inside the server container and do not
            need to be configured:{" "}
            <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">PORT=31001</code>{" "}
            (the port the Hono server binds to) and{" "}
            <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">DATABASE_URL=file:/data/local.db</code>{" "}
            (the libSQL database file in the persistent volume).
          </p>
        </section>

        <section className="mt-12">
          <h2 className="text-2xl font-semibold tracking-tight text-neutral-100">
            Database
          </h2>
          <p className="mt-4 leading-relaxed text-neutral-400">
            The stack ships with a file-backed libSQL database: the server
            reads and writes{" "}
            <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">/data/local.db</code>{" "}
            inside the container, persisted through the{" "}
            <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">feedelity-data</code>{" "}
            Docker volume. There is no separate database service to run or
            monitor. On first start the database is seeded from the{" "}
            <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">./local.db</code>{" "}
            dev snapshot in your checkout (if present); afterwards the volume
            copy is the single source of truth.
          </p>
        </section>

        <section className="mt-12">
          <h2 className="text-2xl font-semibold tracking-tight text-neutral-100">
            Updating
          </h2>
          <p className="mt-4 leading-relaxed text-neutral-400">
            There are no pre-built images to pull &mdash; images are built
            locally from your checkout. To update, pull the latest code and
            rebuild:
          </p>
          <pre className="mt-4 overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 font-mono text-sm text-neutral-300">
            <code>git pull&#10;docker compose up -d --build</code>
          </pre>
          <p className="mt-3 text-sm text-neutral-500">
            The containers do not apply database migrations automatically. If a
            release includes schema changes, run Drizzle Kit from a checkout
            with <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">DATABASE_URL</code> set
            (Drizzle Kit reads it from{" "}
            <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">apps/server/.env</code>):
          </p>
          <pre className="mt-2 overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 font-mono text-sm text-neutral-300">
            <code>bun run db:migrate</code>
          </pre>
        </section>

        <section className="mt-12">
          <h2 className="text-2xl font-semibold tracking-tight text-neutral-100">
            Backup
          </h2>
          <p className="mt-3 leading-relaxed text-neutral-400">
            Back up the Docker volume that holds the database file (
            <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">local.db</code>):
          </p>
          <pre className="mt-3 overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 font-mono text-sm text-neutral-300">
            <code>docker run --rm -v feedelity_feedelity-data:/data -v $(pwd):/backup alpine tar czf /backup/feedelity-db-backup-$(date +%Y%m%d).tar.gz -C /data .</code>
          </pre>
          <p className="mt-3 text-sm text-neutral-500">
            To restore from a backup:
          </p>
          <pre className="mt-2 overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 font-mono text-sm text-neutral-300">
            <code>docker run --rm -v feedelity_feedelity-data:/data -v $(pwd):/backup alpine sh -c "cd /data && tar xzf /backup/feedelity-db-backup-YYYYMMDD.tar.gz"</code>
          </pre>
          <p className="mt-3 text-sm text-neutral-500">
            Stop the stack before restoring so the server is not writing to the
            database file while you replace it.
          </p>
        </section>

        <section className="mt-12">
          <h2 className="text-2xl font-semibold tracking-tight text-neutral-100">
            Running Without Docker
          </h2>
          <p className="mt-4 leading-relaxed text-neutral-400">
            For a single-machine setup without Docker, the repository ships a
            start/stop manager:
          </p>
          <pre className="mt-4 overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 font-mono text-sm text-neutral-300">
            <code>bun run serve&#10;# or: bun run feedelity</code>
          </pre>
          <p className="mt-3 text-sm text-neutral-500">
            This builds the workspace, then serves the web client on port{" "}
            <span className="text-neutral-200">42666</span> and the API server
            on port <span className="text-neutral-200">42667</span> (both
            configurable via <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">--client-port</code>{" "}
            and <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">--server-port</code>).
            The same script stops a running instance when invoked again, and the
            client proxies API requests to the server.
          </p>
        </section>

        <section className="mt-12">
          <h2 className="text-2xl font-semibold tracking-tight text-neutral-100">
            Architecture Overview
          </h2>
          <p className="mt-4 leading-relaxed text-neutral-400">
            The Docker Compose setup runs two services:
          </p>
          <ul className="mt-4 list-inside list-disc space-y-2 text-neutral-400">
            <li>
              <span className="text-neutral-200">web</span> &mdash; Nginx
              serving the static Solid frontend. Proxies{" "}
              <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">
                /rpc/
              </code>
              ,{" "}
              <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">
                /api/
              </code>
              , and{" "}
              <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">
                /api-reference/
              </code>{" "}
              requests to the server service.
            </li>
            <li>
              <span className="text-neutral-200">server</span> &mdash; Bun
              runtime hosting the Hono API server with oRPC procedures and
              better-auth, backed by the libSQL file in the persistent volume.
            </li>
          </ul>
          <p className="mt-4 text-sm text-neutral-500">
            Nginx handles static asset caching with 1-year expiry, gzip
            compression, and security headers (X-Frame-Options,
            X-Content-Type-Options, X-XSS-Protection, Referrer-Policy).
          </p>
        </section>
      </main>
    </DocsLayout>
  );
}
