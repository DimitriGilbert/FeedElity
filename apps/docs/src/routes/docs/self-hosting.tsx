import { createFileRoute } from "@tanstack/react-router";

import { DocsLayout } from "~/components/docs-layout";
import { buildSeo } from "~/lib/seo";

export const Route = createFileRoute("/docs/self-hosting")({
  head: () =>
    buildSeo({
      title: "Self-Hosting Guide - FeedElity Docs",
      description:
        "Deploy FeedElity on your own server. Docker Compose, environment variables, database options, backup, and updating.",
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
          with Docker Compose, environment configuration, database options,
          platform deployment, backup, and updates.
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
              At least 512 MB RAM and 1 GB of disk space for the application;
              more if you run the local database container
            </li>
          </ul>
        </section>

        <section className="mt-12">
          <h2 className="text-2xl font-semibold tracking-tight text-neutral-100">
            Docker Deployment
          </h2>

          <section className="mt-6">
            <h3 className="text-lg font-medium text-neutral-200">
              With Local Database
            </h3>
            <p className="mt-3 leading-relaxed text-neutral-400">
              The simplest setup runs a libSQL container alongside the app.
              This uses a Docker volume for data persistence.
            </p>
            <pre className="mt-4 overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 font-mono text-sm text-neutral-300">
              <code>git clone https://github.com/anomalyco/FeedElity.git&#10;cd FeedElity&#10;cp .env.docker.example .env</code>
            </pre>
            <p className="mt-3 text-sm text-neutral-500">
              Edit{" "}
              <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">.env</code> and
              generate a secure{" "}
              <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">BETTER_AUTH_SECRET</code>:
            </p>
            <pre className="mt-2 overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 font-mono text-sm text-neutral-300">
              <code>openssl rand -hex 32</code>
            </pre>
            <p className="mt-3 text-sm text-neutral-500">
              Start everything with the local-db profile:
            </p>
            <pre className="mt-2 overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 font-mono text-sm text-neutral-300">
              <code>docker compose --profile local-db up -d</code>
            </pre>
            <p className="mt-3 text-sm text-neutral-500">
              The app will be available at{" "}
              <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">http://localhost</code> (port
              80 by default, configurable via{" "}
              <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">WEB_PORT</code>).
            </p>
          </section>

          <section className="mt-8">
            <h3 className="text-lg font-medium text-neutral-200">
              With External Database
            </h3>
            <p className="mt-3 leading-relaxed text-neutral-400">
              You can use Turso cloud or any libSQL-compatible server as your
              database. Set the{" "}
              <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">DATABASE_URL</code>{" "}
              environment variable to the external connection string.
            </p>
            <p className="mt-3 text-sm text-neutral-500">
              In your{" "}
              <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">.env</code> file:
            </p>
            <pre className="mt-2 overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 font-mono text-sm text-neutral-300">
              <code>DATABASE_URL=libsql://your-db-name-your-org.turso.io?authToken=your-token</code>
            </pre>
            <p className="mt-3 text-sm text-neutral-500">
              Then start without the local-db profile:
            </p>
            <pre className="mt-2 overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 font-mono text-sm text-neutral-300">
              <code>docker compose up -d</code>
            </pre>
          </section>

          <section className="mt-8">
            <h3 className="text-lg font-medium text-neutral-200">
              Data Persistence
            </h3>
            <p className="mt-3 leading-relaxed text-neutral-400">
              When using the local database container, FeedElity stores data in
              a Docker volume named{" "}
              <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">libsql-data</code>.
              This volume persists across container restarts and rebuilds.
            </p>
            <p className="mt-3 text-sm text-neutral-500">
              To inspect the volume:
            </p>
            <pre className="mt-2 overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 font-mono text-sm text-neutral-300">
              <code>docker volume inspect FeedElity_libsql-data</code>
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
              Add all required variables from the{" "}
              <a href="#environment-variables" className="text-neutral-200 underline decoration-neutral-600 underline-offset-2 transition-colors hover:text-neutral-50">
                Environment Variables
              </a>{" "}
              section below. Set{" "}
              <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">BETTER_AUTH_URL</code> and{" "}
              <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">CORS_ORIGIN</code> to
              your domain.
            </li>
            <li>
              <span className="text-neutral-200">Enable the local-db profile if needed.</span>{" "}
              If you want the platform to run the libSQL container, make sure
              the{" "}
              <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">local-db</code>{" "}
              profile is active. Some platforms let you specify compose profiles
              in their UI.
            </li>
            <li>
              <span className="text-neutral-200">Set up TLS.</span>{" "}
              Most platforms handle TLS termination automatically. Configure
              your domain and enable HTTPS.
            </li>
            <li>
              <span className="text-neutral-200">Deploy.</span>{" "}
              The platform builds and starts the containers. The web service
              exposes port 80 by default (or{" "}
              <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">WEB_PORT</code>).
            </li>
          </ol>
        </section>

        <section className="mt-12" id="environment-variables">
          <h2 className="text-2xl font-semibold tracking-tight text-neutral-100">
            Environment Variables
          </h2>
          <p className="mt-4 leading-relaxed text-neutral-400">
            All configuration is done through environment variables. Copy{" "}
            <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">.env.docker.example</code>{" "}
            to{" "}
            <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">.env</code> as
            a starting point.
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
                    Default
                  </th>
                  <th className="whitespace-nowrap px-4 py-3 font-medium text-neutral-200">
                    Required
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800/50">
                <tr>
                  <td className="px-4 py-3 font-mono text-xs text-neutral-300">
                    RUNTIME_MODE
                  </td>
                  <td className="px-4 py-3 text-neutral-400">
                    Application runtime mode
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-neutral-500">
                    production
                  </td>
                  <td className="px-4 py-3 text-neutral-400">No</td>
                </tr>
                <tr>
                  <td className="px-4 py-3 font-mono text-xs text-neutral-300">
                    DATABASE_URL
                  </td>
                  <td className="px-4 py-3 text-neutral-400">
                    libSQL connection string. Use{" "}
                    <code className="rounded bg-neutral-800 px-1 py-0.5 text-neutral-300">
                      http://db:8080
                    </code>{" "}
                    for local container, or a Turso cloud URL for external
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-neutral-500">
                    http://db:8080
                  </td>
                  <td className="px-4 py-3 text-neutral-400">Yes</td>
                </tr>
                <tr>
                  <td className="px-4 py-3 font-mono text-xs text-neutral-300">
                    BETTER_AUTH_SECRET
                  </td>
                  <td className="px-4 py-3 text-neutral-400">
                    Secret key for auth session encryption. Must be at least 32
                    characters. Generate with{" "}
                    <code className="rounded bg-neutral-800 px-1 py-0.5 text-neutral-300">
                      openssl rand -hex 32
                    </code>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-neutral-500">
                    &mdash;
                  </td>
                  <td className="px-4 py-3 text-neutral-400">Yes</td>
                </tr>
                <tr>
                  <td className="px-4 py-3 font-mono text-xs text-neutral-300">
                    BETTER_AUTH_URL
                  </td>
                  <td className="px-4 py-3 text-neutral-400">
                    Public URL where the app is accessible. Used by better-auth
                    for cookie domain and redirects
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-neutral-500">
                    http://localhost
                  </td>
                  <td className="px-4 py-3 text-neutral-400">Yes</td>
                </tr>
                <tr>
                  <td className="px-4 py-3 font-mono text-xs text-neutral-300">
                    CORS_ORIGIN
                  </td>
                  <td className="px-4 py-3 text-neutral-400">
                    Allowed origin for CORS requests. Must match the public URL
                    of your deployment
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-neutral-500">
                    http://localhost
                  </td>
                  <td className="px-4 py-3 text-neutral-400">Yes</td>
                </tr>
                <tr>
                  <td className="px-4 py-3 font-mono text-xs text-neutral-300">
                    PORT
                  </td>
                  <td className="px-4 py-3 text-neutral-400">
                    Internal port for the Hono API server
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-neutral-500">
                    3002
                  </td>
                  <td className="px-4 py-3 text-neutral-400">No</td>
                </tr>
                <tr>
                  <td className="px-4 py-3 font-mono text-xs text-neutral-300">
                    NODE_ENV
                  </td>
                  <td className="px-4 py-3 text-neutral-400">
                    Node environment. Set to production for deployment
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-neutral-500">
                    production
                  </td>
                  <td className="px-4 py-3 text-neutral-400">No</td>
                </tr>
                <tr>
                  <td className="px-4 py-3 font-mono text-xs text-neutral-300">
                    WEB_PORT
                  </td>
                  <td className="px-4 py-3 text-neutral-400">
                    External port exposed by the nginx web container
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-neutral-500">
                    80
                  </td>
                  <td className="px-4 py-3 text-neutral-400">No</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-12">
          <h2 className="text-2xl font-semibold tracking-tight text-neutral-100">
            Database Options
          </h2>
          <div className="mt-4 space-y-4">
            <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 px-5 py-4">
              <p className="font-medium text-neutral-200">
                Local libSQL Container
              </p>
              <p className="mt-2 text-sm text-neutral-400">
                Enabled with the{" "}
                <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">
                  --profile local-db
                </code>{" "}
                flag. Data is stored in a Docker volume on the host. Good for
                single-server deployments. No external dependency.
              </p>
              <pre className="mt-3 overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-950 px-4 py-3 font-mono text-sm text-neutral-300">
                <code>docker compose --profile local-db up -d</code>
              </pre>
            </div>

            <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 px-5 py-4">
              <p className="font-medium text-neutral-200">
                Turso Cloud
              </p>
              <p className="mt-2 text-sm text-neutral-400">
                Set{" "}
                <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">
                  DATABASE_URL
                </code>{" "}
                to your Turso connection string. Includes built-in backups,
                replication, and no local storage management.
              </p>
              <pre className="mt-3 overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-950 px-4 py-3 font-mono text-sm text-neutral-300">
                <code>DATABASE_URL=libsql://my-db-my-org.turso.io?authToken=your-token</code>
              </pre>
            </div>

            <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 px-5 py-4">
              <p className="font-medium text-neutral-200">
                Any libSQL-Compatible Server
              </p>
              <p className="mt-2 text-sm text-neutral-400">
                FeedElity works with any server that speaks the libSQL protocol.
                Point{" "}
                <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">
                  DATABASE_URL
                </code>{" "}
                to your server endpoint.
              </p>
            </div>
          </div>
        </section>

        <section className="mt-12">
          <h2 className="text-2xl font-semibold tracking-tight text-neutral-100">
            Updating
          </h2>
          <p className="mt-4 leading-relaxed text-neutral-400">
            Pull the latest images and restart the services:
          </p>
          <pre className="mt-4 overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 font-mono text-sm text-neutral-300">
            <code>docker compose pull&#10;docker compose up -d</code>
          </pre>
          <p className="mt-3 text-sm text-neutral-500">
            If you are building from source instead of using pre-built images,
            pull the latest code first:
          </p>
          <pre className="mt-2 overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 font-mono text-sm text-neutral-300">
            <code>git pull&#10;docker compose build&#10;docker compose up -d</code>
          </pre>
          <p className="mt-3 text-sm text-neutral-500">
            Database schema changes are applied through Drizzle migrations. If
            a release includes schema changes, run:
          </p>
          <pre className="mt-2 overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 font-mono text-sm text-neutral-300">
            <code>bun run db:migrate</code>
          </pre>
        </section>

        <section className="mt-12">
          <h2 className="text-2xl font-semibold tracking-tight text-neutral-100">
            Backup
          </h2>

          <section className="mt-4">
            <h3 className="text-lg font-medium text-neutral-200">
              Local Database Backup
            </h3>
            <p className="mt-3 leading-relaxed text-neutral-400">
              When using the local libSQL container, back up the Docker volume:
            </p>
            <pre className="mt-3 overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 font-mono text-sm text-neutral-300">
              <code>docker run --rm -v FeedElity_libsql-data:/data -v $(pwd):/backup alpine tar czf /backup/feedelity-db-backup-$(date +%Y%m%d).tar.gz -C /data .</code>
            </pre>
            <p className="mt-3 text-sm text-neutral-500">
              To restore from a backup:
            </p>
            <pre className="mt-2 overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 font-mono text-sm text-neutral-300">
              <code>docker run --rm -v FeedElity_libsql-data:/data -v $(pwd):/backup alpine sh -c "cd /data && tar xzf /backup/feedelity-db-backup-YYYYMMDD.tar.gz"</code>
            </pre>
          </section>

          <section className="mt-6">
            <h3 className="text-lg font-medium text-neutral-200">
              Turso Cloud Backup
            </h3>
            <p className="mt-3 leading-relaxed text-neutral-400">
              Turso handles backups automatically. You can also create manual
              snapshots through the Turso CLI or dashboard. Refer to the{" "}
              <a
                href="https://docs.turso.tech"
                target="_blank"
                rel="noopener noreferrer"
                className="text-neutral-200 underline decoration-neutral-600 underline-offset-2 transition-colors hover:text-neutral-50"
              >
                Turso documentation
              </a>{" "}
              for details.
            </p>
          </section>
        </section>

        <section className="mt-12">
          <h2 className="text-2xl font-semibold tracking-tight text-neutral-100">
            Architecture Overview
          </h2>
          <p className="mt-4 leading-relaxed text-neutral-400">
            The Docker Compose setup runs three services:
          </p>
          <ul className="mt-4 list-inside list-disc space-y-2 text-neutral-400">
            <li>
              <span className="text-neutral-200">web</span> &mdash; Nginx
              serving the static Solid frontend. Proxies{" "}
              <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">
                /rpc/
              </code>{" "}
              and{" "}
              <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-300">
                /api/
              </code>{" "}
              requests to the server service.
            </li>
            <li>
              <span className="text-neutral-200">server</span> &mdash; Bun
              runtime hosting the Hono API server with oRPC procedures and
              better-auth.
            </li>
            <li>
              <span className="text-neutral-200">db</span> &mdash; libSQL
              server container (optional, only started with the local-db
              profile).
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
