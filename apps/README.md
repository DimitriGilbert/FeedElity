# Apps

`apps/web` owns the Solid user interface and browser-side API client wiring. It should not contain persistence, ingestion, source adapter, or server-only auth logic.

`apps/server` owns the Hono process bootstrap, CORS, auth handler mounting, and oRPC/OpenAPI transport wiring. Product behavior should live in packages and be exposed through API procedures.

`apps/desktop` owns the Electrobun shell and desktop packaging. It should consume the web app and server modes without duplicating product domain logic.

Phase 0 uses Bun's built-in test runner for smoke tests. Backend and domain package tests should use `bun test`; web UI tests should start with import/render smoke coverage and can add a DOM-capable runner only when UI behavior requires it.
