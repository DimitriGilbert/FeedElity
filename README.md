# FeedElity

This project was created with [Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack), a modern TypeScript stack that combines SolidJS, Hono, ORPC, and more.

## Features

- **TypeScript** - For type safety and improved developer experience
- **SolidJS** - Simple and performant reactivity
- **TailwindCSS** - Utility-first CSS for rapid UI development
- **Hono** - Lightweight, performant server framework
- **oRPC** - End-to-end type-safe APIs with OpenAPI integration
- **Bun** - Runtime environment
- **Drizzle** - TypeScript-first ORM
- **SQLite/Turso** - Database engine
- **Authentication** - Better-Auth
- **Electrobun** - Lightweight desktop shell for web frontends
- **Turborepo** - Optimized monorepo build system

## Getting Started

First, install the dependencies:

```bash
bun install
```

## Database Setup

This project uses SQLite with Drizzle ORM.

1. Start the local SQLite/libSQL database (optional). This uses the root `local.db` file that `apps/server/.env.example` points at with `DATABASE_URL=file:../../local.db`:

```bash
bun run db:local
```

2. Update your `.env` file in the `apps/server` directory with the appropriate connection details if needed.

3. Apply the schema to your database before starting the server. Re-run this after pulling or making schema changes so the ignored local runtime database has the catalog and overlay tables expected by the app:

```bash
bun run db:push
```

For committed schema changes, generate a Drizzle migration with `bun run db:generate` and apply migrations with `bun run db:migrate`. Use `db:push` for local development databases that need to be brought in sync without resetting data.

Then, run the development server:

```bash
bun run dev
```

Open [http://localhost:3001](http://localhost:3001) in your browser to see the web application.
The API is running at [http://localhost:3002](http://localhost:3002).

## Runtime Configuration

The web app reads `VITE_RUNTIME_MODE` and `VITE_SERVER_URL` from `apps/web/.env`. Use `local` for local browser development, `web` for deployed web builds, `desktop-local` for a desktop shell talking to a local server, and `desktop-remote` for a desktop shell talking to a configured remote server. The server reads `RUNTIME_MODE`, `BETTER_AUTH_URL`, `CORS_ORIGIN`, and `PORT` from `apps/server/.env`; the default server port is `3002`.

For local development, keep `VITE_SERVER_URL` and `BETTER_AUTH_URL` at `http://localhost:3002`, with `CORS_ORIGIN=http://localhost:3001`. For deployed web builds, set `VITE_SERVER_URL` to the public API origin and set `CORS_ORIGIN` to the deployed web origin.

Desktop defaults to `desktop-local`, starts its embedded backend on `http://127.0.0.1:3217`, and stores its local SQLite database outside the packaged app. To run the desktop shell against a shared backend, set an explicit HTTP(S) remote URL and use the remote desktop scripts:

```bash
FEELITY_DESKTOP_REMOTE_SERVER_URL=https://api.feedelity.example bun --filter desktop run dev:hmr:remote
FEELITY_DESKTOP_REMOTE_SERVER_URL=https://api.feedelity.example bun --filter desktop run build:remote
```

In `desktop-remote` mode the desktop app does not start the embedded backend or open a local database; it injects the normalized remote URL into the web view so auth and oRPC target that server.

## Project Structure

```
FeedElity/
├── apps/
│   ├── web/         # Frontend application (SolidJS)
│   └── server/      # Backend API (Hono, ORPC)
├── packages/
│   ├── api/         # API layer / business logic
│   ├── auth/        # Authentication configuration & logic
│   └── db/          # Database schema & queries
```

## Available Scripts

- `bun run dev`: Start all applications in development mode
- `bun run build`: Build all applications
- `bun run dev:web`: Start only the web application
- `bun run dev:server`: Start only the server
- `bun run check-types`: Check TypeScript types across all apps
- `bun run db:push`: Push schema changes to the configured local development database
- `bun run db:generate`: Generate Drizzle migration files for committed schema changes
- `bun run db:migrate`: Run committed Drizzle migrations against the configured database
- `bun run db:studio`: Open database studio UI
- `bun run db:local`: Start the local SQLite database
- `bun run dev:desktop`: Start the Electrobun desktop app with HMR
- `bun run build:desktop`: Build the stable Electrobun desktop app
- `bun run build:desktop:canary`: Build the canary Electrobun desktop app
