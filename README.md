# FeedElity

Follow creators across YouTube, Odysee, and PeerTube from one place. FeedElity pulls video-oriented RSS and API feeds into a fast three-column interface — sources on the left, content list in the middle, viewer on the right. Browse the full catalog without an account. Sign in to subscribe, mark favorites, track what you've watched, build playlists, and refresh on your own terms.

Runs as a web app or a desktop app (Electrobun). Local-first by default: the desktop shell bundles its own backend and SQLite database. Point it at a remote server instead if you want.

## Stack

| Layer | Choice |
|---|---|
| Runtime | [Bun](https://bun.sh) |
| Frontend | [SolidJS](https://solidjs.com) + [Tailwind CSS](https://tailwindcss.com) + [TanStack Router/Query](https://tanstack.com) |
| Backend | [Hono](https://hono.dev) on Bun |
| API | [oRPC](https://orpc.unnoq.com) — end-to-end type-safe, OpenAPI-compatible |
| Auth | [better-auth](https://better-auth.com) — email/password, self-service sign-up |
| Database | SQLite / libSQL + [Drizzle ORM](https://orm.drizzle.team) |
| Desktop | [Electrobun](https://electrobun.dev) |
| Monorepo | [Turborepo](https://turbo.build) |

Scaffolded with [Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack).

## Architecture

```
FeedElity/
├── apps/
│   ├── web/            SolidJS frontend (Vite)
│   ├── server/         Hono API server
│   ├── desktop/        Electrobun desktop shell
│   └── docs/           Project documentation site
├── packages/
│   ├── api/            oRPC procedures, source adapters, domain services
│   ├── auth/           better-auth configuration and session handling
│   ├── db/             Drizzle schema, migrations, repository functions
│   ├── env/            Shared environment variable schemas
│   └── config/         Shared TypeScript configuration
├── docs/               Design docs, UI plans, diagnostics
├── research/           Source/API research and behavior inventory
├── prd-from-scratch.md          Product requirements
└── final-from-scratch-plan.md   Execution plan and phase breakdown
```

### How it fits together

**Source adapters** (`packages/api`) — YouTube RSS, Odysee RSS, PeerTube instance APIs. Each adapter normalizes remote data into a uniform shape. Want to add a new platform? Write an adapter and register it. The rest of the app doesn't change.

**Global catalog** — Creators, feeds, content items, and playable sources stored in source-neutral tables. Anyone can browse this data. No account required.

**User overlays** — Subscriptions, favorites, watched history, playlists, and settings live in separate tables tied to a `userId`. Your data is yours. The API enforces this at the boundary, not just in the UI.

**API layer** — Public catalog reads for anonymous browsing. Protected procedures for everything user-owned. All input validated at the edge.

**Ingestion** — Separate from presentation. Manual refresh respects cadence metadata. Force refresh ignores it. No background scheduler. You refresh when you want.

## Getting Started

### Prerequisites

- [Bun](https://bun.sh) >= 1.3

### Install and run

```bash
bun install
bun run db:local    # start the local SQLite database
bun run db:push     # apply the schema
bun run dev
```

- Web app: http://localhost:3001
- API server: http://localhost:3002

Re-run `db:push` after pulling schema changes. For committed migrations, use `db:generate` then `db:migrate`.

### Run individual targets

```bash
bun run dev:web        # frontend only
bun run dev:server     # backend only
bun run dev:desktop    # desktop app with HMR
```

## Runtime Modes

| Mode | Use case | Backend | Database |
|---|---|---|---|
| `local` | Browser development | Local server at localhost:3002 | Shared `local.db` |
| `web` | Deployed web build | Configured remote server | Remote |
| `desktop-local` | Desktop app, default | Embedded Bun/Hono on 127.0.0.1:3217 | Local SQLite |
| `desktop-remote` | Desktop app, shared server | Configured remote server | Remote |

Configuration lives in `apps/web/.env` (`VITE_SERVER_URL`, `VITE_RUNTIME_MODE`) and `apps/server/.env` (`RUNTIME_MODE`, `BETTER_AUTH_URL`, `CORS_ORIGIN`, `PORT`).

Desktop remote mode:

```bash
FEELITY_DESKTOP_REMOTE_SERVER_URL=https://api.example.com bun --filter desktop run dev:hmr:remote
```

## Scripts

| Command | What it does |
|---|---|
| `bun run dev` | Start all dev targets |
| `bun run build` | Build everything |
| `bun run check-types` | TypeScript check across the monorepo |
| `bun run test` | Run tests |
| `bun run db:push` | Push schema to local dev database |
| `bun run db:generate` | Generate a Drizzle migration |
| `bun run db:migrate` | Run committed migrations |
| `bun run db:studio` | Open Drizzle Studio |
| `bun run db:local` | Start the local SQLite dev database |
| `bun run dev:desktop` | Desktop app with HMR |
| `bun run build:desktop` | Build stable desktop app |
| `bun run build:desktop:canary` | Build canary desktop app |

Desktop platform builds:

```bash
bun run build:desktop:linux
bun run build:desktop:mac
bun run build:desktop:windows
```

## Supported Sources

- **YouTube** — RSS channel feeds, iframe embed playback
- **Odysee** — RSS feeds, native media playback
- **PeerTube** — Instance API for discovery and metadata, embed playback

Each adapter handles URL detection, metadata fetching, content normalization, and playback URL generation independently.

## License

Private project. All rights reserved.
