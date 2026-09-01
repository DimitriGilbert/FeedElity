# Apps

`apps/web` owns the Solid user interface and browser-side API client wiring. It should not contain persistence, ingestion, source adapter, or server-only auth logic.

`apps/server` owns the Hono process bootstrap, CORS, auth handler mounting, and oRPC/OpenAPI transport wiring. Product behavior should live in packages and be exposed through API procedures.

`apps/desktop` owns the Electrobun shell and desktop packaging. It should consume the web app and server modes without duplicating product domain logic.

All apps use Bun's built-in test runner (`bun test`); web runs it with `--conditions browser`. Run everything from the repo root with `bun run test`. Suites cover API routers/services/migrations, db schema/migrations, web component behavior, and the desktop backend.
