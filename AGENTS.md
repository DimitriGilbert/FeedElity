# Agent Guidelines for FeedElity

FeedElity is a personal-first, video-oriented RSS client rewrite built on the existing Better-T-Stack monorepo scaffold.

## Build/Test Commands

- `bun install` - Install workspace dependencies
- `bun run check-types` - Check TypeScript types across the monorepo with Turbo
- `bun run build` - Build all apps/packages with Turbo
- `bun run dev` - Start all dev targets through Turbo
- `bun run dev:web` - Start only the Solid web app
- `bun run dev:server` - Start only the Hono server
- `bun run dev:desktop` - Start the Electrobun desktop app with HMR
- `bun run build:desktop` - Build the stable Electrobun desktop app
- `bun run db:push` - Push Drizzle schema changes
- `bun run db:generate` - Generate Drizzle migrations
- `bun run db:migrate` - Run Drizzle migrations
- `bun run db:studio` - Open Drizzle Studio
- `bun run db:local` - Start the local SQLite/libSQL dev database

Do not start long-running dev servers unless the user explicitly asks for it. For verification, prefer `bun run check-types` and `bun run build`.

## Project Shape

- This repo is already bootstrapped with Better-T-Stack. Treat `bts.jsonc` as the stack source of truth.
- Use Bun, Solid, Hono, oRPC, better-auth, Drizzle, SQLite/libSQL, Electrobun, and Turborepo.
- Work inside the existing monorepo layout: `apps/*` and `packages/*`.
- Do not create a new top-level `client/` app.
- The old app at `../Feedelity` is only a behavioral and migration reference. Do not import its Strapi client, generated types, event-bus shell, or low-code component structure.

## Rewrite Plan

- `final-from-scratch-plan.md` is the execution plan for this rewrite.
- `prd-from-scratch.md` is the product PRD.
- `research/` contains old-app behavior inventory and data/API research.
- Preserve anonymous browsing of the global creator/content catalog.
- Use global catalog records for creators, feeds, and content items.
- Use user-owned overlays for subscriptions, favorites, opened/played history, playlists, and settings.
- Support YouTube, Odysee, and PeerTube at launch through source adapters.
- Preserve manual normal refresh and force refresh. Do not add automatic background refresh for v1.
- Migration input is Strapi export JSON; migrated users must reset/set a new password.

## Code Rules

- Use TypeScript strict mode.
- Do not use `any`, `as any`, or `: any`. Use proper types, `unknown`, or validated schemas.
- Use `import type` for type-only imports; `verbatimModuleSyntax` is enabled.
- Keep external imports first, then a blank line, then local imports.
- Do not leave placeholder code, `TODO`, or `FIXME` in implemented work.
- Do not add unused imports, unused variables, or void hacks to silence errors.
- Do not silence TypeScript, lint, or runtime errors. Fix the cause.
- Do not use unsafe non-null assertions (`!`) unless the invariant is enforced immediately before use and the reason is obvious from the code.
- Do not use broad type assertions to force code through the compiler. Validate or narrow the value instead.
- Do not catch errors and ignore them. Handle, return, or rethrow with useful context.
- Do not add speculative abstractions, generic helpers, or clever indirection before there is a real repeated use.
- Keep functions small enough to understand, but do not fragment logic into thin pass-through wrappers.
- Keep module boundaries explicit: source adapters, domain services, repositories, API procedures, and UI state should not bleed into each other.
- Prefer deterministic, testable logic over hidden global state, mutation-heavy flows, timers, or ambient side effects.
- Check existing workspace dependencies before adding new packages. Prefer catalog/workspace references when available.
- Keep source-specific logic inside source adapters; generic catalog, API, and UI code should use normalized contracts.
- Do not reintroduce document-wide custom events as the main app architecture.

## Production Quality Bar

- Treat every implementation as production code, not a scaffold.
- A feature is not complete until it has real data flow, real error handling, and verification through the relevant public interface.
- Avoid no-op UI, fake success states, hardcoded demo data, mock-only code paths, and optimistic behavior that is not reconciled with server state.
- Do not introduce hidden coupling to the old Strapi model. Old names may appear only in migration mapping code or research references.
- Validate all external input at boundaries: API inputs, source adapter payloads, migration files, environment variables, and user-submitted URLs.
- Make failure modes explicit. Return structured errors/results where users or callers need to act on partial failure.
- Preserve invariants with database constraints and service-level checks, not only UI assumptions.
- Keep cross-user isolation obvious in code. Any user-owned read or write must be scoped by authenticated `userId` at the API/service boundary.
- Prefer idempotent writes for ingestion, refresh, and migration. Duplicate remote content or repeated imports must not corrupt state.
- Do not add a dependency unless it removes meaningful complexity and fits the existing stack.
- If a shortcut is tempting, stop and implement the smaller correct version instead.

## TDD Workflow

- Use vertical TDD slices: one behavior test, one implementation, then repeat.
- Tests should verify behavior through public interfaces: API procedures, domain services, source adapter contracts, migration commands, or rendered UI behavior.
- Do not write bulk tests for imagined behavior before implementing a slice.
- Prefer fixture-backed tests for source adapters and migration. Do not depend on live network calls by default.
- Tests must cover the important failure path, not only the happy path, when implementing auth, migration, ingestion, refresh, or cross-user data access.
- Tests should fail for real regressions. Avoid brittle tests that assert private helper structure, implementation order, or incidental formatting.
- Do not weaken or delete existing tests to make a change pass unless the test is demonstrably wrong and the replacement preserves the behavior contract.
- If a package/app receives implementation work, make sure it has a usable `check-types` script before final verification.

## Frontend Rules

- Use Solid patterns, not React patterns.
- Preserve the high-density three-column workflow: creator/source column, content list column, selected content viewer column.
- Keep anonymous browsing usable while hiding or gating authenticated overlay actions.
- Implement visible features as real flows. Do not leave no-op buttons for confirmed v1 scope.
- Explicitly defer `topics` and `external-content` unless a later PRD defines them.

## Backend/API Rules

- Public API procedures may expose safe catalog reads for anonymous browsing.
- User overlays must be protected and scoped by authenticated `userId`.
- Cross-user leakage is a release blocker.
- Keep ingestion separate from presentation.
- Keep normal refresh cadence metadata separate from force refresh behavior.
- Validate migration input before writes and report unmapped records clearly.

## Verification Expectations

- Run `bun run check-types` after TypeScript changes when feasible.
- Run `bun run build` for substantial changes or before handing off orchestration phases.
- Run relevant tests once test scripts exist for the touched package/app.
- If a command cannot be run because of environment limitations, report that explicitly with the reason.
