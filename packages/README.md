# Packages

`packages/api` owns oRPC procedure definitions and API-level access rules. It may depend on domain, auth, and database packages, but apps should call it through its exported router/client types.

`packages/auth` owns better-auth configuration and auth database integration. User-facing auth flows should stay in apps, while session enforcement belongs at API boundaries.

`packages/db` owns Drizzle schema and database construction. It should not expose product-specific UI state or source adapter behavior.

`packages/env` owns validated environment boundaries for server and web runtimes. Callers should import the runtime-specific entrypoint only.

`packages/config` owns shared TypeScript configuration for the monorepo.

Backend and future domain packages use Bun's built-in test runner by default. Web UI tests also use Bun for Phase 0 smoke coverage; add a DOM-specific dependency only when rendered interaction tests need browser APIs beyond the current bootstrap checks.
