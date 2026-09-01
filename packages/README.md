# Packages

`packages/api` owns oRPC procedure definitions, source adapters, domain services, repositories, and legacy-data migration tooling. It depends on the auth, db, and env packages, and apps should call it through its exported router/client types.

`packages/auth` owns better-auth configuration and auth database integration. User-facing auth flows should stay in apps, while session enforcement belongs at API boundaries.

`packages/db` owns Drizzle schema, migrations, and database construction (connection/bootstrap). Repository functions live in `packages/api`; this package should not expose product-specific UI state or source adapter behavior.

`packages/env` owns validated environment boundaries for server and web runtimes. Callers should import the runtime-specific entrypoint only.

`packages/config` owns shared TypeScript configuration for the monorepo.

All packages use Bun's built-in test runner (`bun test`); web runs it with `--conditions browser`. Run everything from the repo root with `bun run test`.
