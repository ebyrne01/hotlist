# Supabase Schema

This directory is the source of truth for database migrations going forward.

## Commands

Run the schema coverage check before adding database-dependent code:

```bash
npm run db:check-schema:warn
```

Use the strict version in CI once the migration backlog is closed:

```bash
npm run db:check-schema
```

## Baseline And Replay

The original schema was created before Supabase migration tracking was enabled.
`migrations/00000000000000_legacy_baseline.sql` is the idempotent bootstrap for
that legacy schema. It must remain the first migration so fresh databases can
replay the full chain.

The production migration ledger also needs a one-time repair: record the
baseline as version `00000000000000` before relying on Supabase development
branch replay. Applying the SQL alone is harmless on an existing project, but a
ledger entry with the early version is what makes Supabase replay it before the
historical migrations.

Legacy root-level snapshots remain for reference:

- `schema.sql`
- `schema-reading-dna.sql`
- `schema-user-cw-preferences.sql`

New database changes should be added under `supabase/migrations/`. The coverage
check compares table and RPC names referenced by app code with definitions in
checked-in SQL, including both the legacy snapshots and migration files.
