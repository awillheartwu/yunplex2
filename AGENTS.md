# Project instructions

This file provides repository guidance for coding agents working on reYunPlex.

## Project

reYunPlex (package name `yunplex2`) mirrors NetEase playlist or album intent into local media and Plex. It is a Nuxt 4 SPA with a Nitro backend, SQLite persistence, SSE progress and a single-process background scheduler.

Use these sources when relevant to the requested behavior; a local edit does not require reading the full set:

- `CONTEXT.md` — canonical domain vocabulary.
- `ROADMAP.md` — priorities, validation debt and completion criteria.
- `docs/README.md` — current implementation docs and ADR index.
- `docs/sync-flow.md` and `docs/compare-decision.md` — current synchronization behavior.

## Commands

```bash
pnpm dev                  # development server on localhost:3001
pnpm build                # production build in .output/
pnpm start                # run the production build
pnpm test                 # all Vitest tests
pnpm test:watch           # Vitest watch mode
pnpm lint                 # ESLint
pnpm typecheck            # TypeScript without emit
pnpm check:repo-size      # repository-wide 800-line source gate
pnpm diagnose:sync-source -- --source <id> --runs 2
```

Validate according to the change. For documentation or instruction edits, check formatting, references and the changed diff. For source changes, run focused behavior tests and applicable lint/type checks; use `pnpm check:repo-size` for source-size changes. Run `pnpm build` for bundling, dependency, runtime integration or release changes. Preserve required CI/release checks. After relevant checks pass, broaden or repeat only for new changes or unresolved concerns. Report unrelated baseline failures separately. A build or mocked test is not a real NetEase/Plex E2E; report external validation separately.

Use Conventional Commits (`feat`, `fix`, `perf`, `refactor`, `docs`, `style`, `chore`, `test`). Preserve unrelated working-tree changes.

## Architecture

```text
Browser SPA
  pages -> composables -> useApi -> /api
  composables/sse.ts <- /api/sync/events

Nitro server
  server/api                 HTTP boundary
  server/plugins/sync-daemon startup, recovery, scheduler and lease sweep
  server/lib/config          typed config, defaults, validation and persistence
  server/lib/db              current schema, migrations and introspection
  server/lib/playlist        Playlist Source persistence and batch actions
  server/lib/download        persistent queue and one-song download pipeline
  server/lib/run             unified task-run history
  server/lib/sync            Source Convergence and identity system
```

### Source Convergence

`server/lib/sync/service.ts` is the only orchestration path. Keep its domain seams intact:

- `source-downloads.ts` — download planning, media replacement and post-download state.
- `source-plex-reconciliation.ts` — Plex lookup, binding, deletion protection, reorder and read-back.
- `source-pure-reorder.ts` — verified pure-reorder fast path.
- `source-finalization.ts` — source cursors, failure memory, and task run finalization.
- `lookup.ts` and its focused modules — path/manual Media Link resolution and managed-download fallback.
- `reconciliation-plan.ts` — occurrence-specific Plex mutation authorization.
- `identity-coordinator.ts` — binding version snapshots and safe commit order.

All global, source, batch, retry and scheduled entrypoints must call this service. Do not create another download/Plex mutation sequence in an API handler.

### Identity invariants

- Formal identity lives in `song_identity_bindings`; local file provenance and continuity live in `local_media_assets`.
- `song_lookup` is retired. It appears only in historical migration compatibility tests and must not be restored as a runtime fact.
- Metadata similarity, provider identity and MusicBrainz data are presentation or search aids only; they cannot establish a Media Link.
- Manual decisions take priority. A unique, continuous managed exact path is the only automatic Media Link evidence.
- Identity resolution does not authorize deletion. Removal is per Plex `playlistItemID` and requires a complete target, unchanged binding versions, explicit plan authorization and Plex write/read-back validation.
- Inside the mutation lock, verify external binding versions, apply the current run's verified bindings, then mutate Plex and read back.

### Download invariants

- `server/lib/download/options.ts::resolveSingleSongConfig()` is the shared default assembly point for sync, repair and retries.
- Download concurrency is global. New scheduling work must not multiply it per Playlist Source.
- Replacements validate a staged file before atomic rename. A failure preserves the old Local Media Asset, Identity Binding and Plex Playlist Occurrence.
- Path mapping only translates names between reYunPlex and Plex. It does not copy or publish files to a remote Plex host.

### Persistence and runtime

- `server/lib/db/schema.ts` defines the current fresh schema.
- `server/lib/db/source-request-upgrade.ts` and `file-task-schema.ts` own bounded, idempotent upgrades for existing records; `schema.ts` invokes them. The retired full historical migration system must not be restored.
- Fresh-install tests must validate critical tables and columns, not only `PRAGMA user_version`.
- The live database is `<dataDir>/data.db`; do not create a guessed SQLite filename during diagnosis.
- `server/lib/sync/source-requests.ts` accepts and routes source requests; `worker.ts` runs analysis and convergence through one persistent consumer. `request-store.ts` persists requests; `source-schedule-store.ts` owns scheduling, claiming, leases and recovery.
- SSE uses an in-process event bus. Client subscriptions are reference-counted and should always release listeners and timers on unmount.

### API and frontend patterns

- API responses use `{ code: 0, msg: "ok", data: T }` through `server/lib/response.ts`. Failures retain that envelope and include structured error details from `shared/domain-errors.ts`.
- Config writes are validated and deep-merged. Source boolean overrides are nullable: `null` inherits global policy, while `true` and `false` are explicit.
- Nuxt auto-imports Vue APIs, components under `components/` without path prefixes, and composables under `composables/`.
- Extracted Vue children do not inherit a parent's scoped selectors for their internal DOM. Keep page-specific shared styles in the relevant global page stylesheet and preserve static layout tests.

## Documentation policy

- Current behavior belongs in `docs/sync-flow.md` or another indexed current-state document.
- Long-lived architectural decisions belong in numbered ADRs. Mark replaced ADRs `Superseded`; do not rewrite their historical context as if it were current.
- Future work belongs in `ROADMAP.md`, with acceptance criteria and explicit validation status.
- Do not commit one-off screenshot QA notes, machine-local paths or temporary investigation logs as permanent root documentation.
