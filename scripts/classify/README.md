# Creator classification → Collections

Classify production creators into the 11 interest Collections so they can be
browsed by topic. Three stages, fully decoupled:

1. **Fetch** (read-only) — pull creators + content signal from the API into a local dump.
2. **Classify** — subagents read the dump and emit per-shard assignment files.
3. **Build** — validate + emit reviewable SQL and a human-readable review doc.

A fourth step smoke-tests the SQL on a throwaway in-memory DB. **Nothing here
writes to production or to the dev `local.db`.** The final import is run by you,
manually, against whichever database you choose, only after review.

## The 11 collections

`science`, `tech`, `computer`, `dev+ai`, `cars-bike-engine`, `engineering`,
`gaucho` (left-wing politics), `droitarde` (right-wing politics), `music`,
`humor`, `movies`.

A creator may be in several, or in none (uncategorized creators are simply
skipped — there is no "other" bucket).

## Run

```bash
# 1. Fetch (read-only against the API). Default API is http://localhost:31001.
bun scripts/classify/fetch-creators.ts

# 2. Classify — 6 subagents write data/shard-{1..6}.json.
#    (Run by the orchestrator; see the plan / agent dispatch.)

# 3. Build reviewable SQL + markdown.
bun scripts/classify/build-sql.ts

# 4. Smoke-test the SQL on an in-memory DB (no real DB touched).
bun scripts/classify/verify-sql.ts
```

## Review, then apply

- `data/collections.review.md` — per-collection creator lists with one-line reasons. **Read this first.**
- `data/collections.sql` — the idempotent INSERTs (raw; consumed by `apply.ts`).

When you are happy, apply with the apply script. It takes the user id and the
target DB as **arguments**, validates them against the target DB (user must
exist, every referenced creator must exist), and **dry-runs by default** — add
`--yes` to actually write.

```bash
# Dry run (validates everything, writes nothing):
bun scripts/classify/apply.ts --user <userId> --db local.db

# Write for real:
bun scripts/classify/apply.ts --user <userId> --db local.db --yes
```

The apply script writes inside a single transaction (rolled back on any error)
and the SQL is idempotent, so re-running is safe.

> ⚠️ Point `--db` at a LOCAL dev/test database, never production. The fetch /
> build / verify stages are read-only or in-memory; `apply.ts` is the only stage
> that mutates a persistent database, and only with `--yes`.

## Files

| File | Stage | Purpose |
| --- | --- | --- |
| `fetch-creators.ts` | 1 | Read-only API dump → `data/creators.json` |
| `data/shard-N.json` | 2 | Subagent classification output |
| `build-sql.ts` | 3 | Shards → `data/collections.sql` + `data/collections.review.md` |
| `verify-sql.ts` | 4 | In-memory FK/idempotency smoke test |
| `apply.ts` | 5 | Arg-driven import to a DB (dry-run by default, `--yes` to write) |
| `data/` | — | Generated; gitignored |
