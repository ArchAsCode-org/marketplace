---
name: cut-schema-migration
description: Cut the in-flight schema migration in an archascode consuming project by calling `archascode cut-schema-migration`. Use when the user wants to seal pending DDL into a named, append-only migration file without leaving the Claude session.
---

# /archascode:cut-schema-migration

Thin wrapper over the `archascode cut-schema-migration` CLI (ADR 019,
ADR 020). The CLI does all the real work — read `_inflight.sql`,
rename it under `spec/locked/adapter/persistence/sqlserver/schema/migrations/`
with a timestamp + slug, update the manifest. This skill exists so the
user can invoke that flow from a Claude session without switching to a
terminal.

## Arguments

- `$ARGUMENTS` (optional) — passed verbatim as `--name <slug>` to the
  CLI. The CLI normalizes to lowercase snake_case. Omit to let the CLI
  fall back to the manifest's cached `inflightSlug`, then to
  `update_schema`.

Invocation forms:

```
/archascode:cut-schema-migration
/archascode:cut-schema-migration add_customer_email
/archascode:cut-schema-migration "drop legacy orders index"
```

## Preconditions

- `cwd` is a rendered consuming project — there's an
  `_inflight.sql` at
  `src/adapter/persistence/sqlserver/schema/migrations/_inflight.sql`.
  If the file is missing or empty, the CLI exits with code 3 and a
  message; surface that verbatim. Do not try to run `archascode render`
  first.

## Procedure

Run:

```bash
archascode cut-schema-migration [--name "$ARGUMENTS"] --json
```

- If `$ARGUMENTS` is empty/whitespace, omit `--name` entirely.
- Use `--json` so the outcome is machine-parseable.

Parse the single line of JSON on stdout:

- `{ "ok": true, "producedFilenames": ["<file>", …] }` (exit 0) — print
  `cut migration <files>` (the produced filenames, joined by `, `) and stop.
- `{ "ok": false, "reason": "<reason>", "message": "<msg>" }` (exit 3)
  — print `<msg>` and stop. Common reasons: `no-inflight` (no pending
  changes), `missing-inflight-file` (project not rendered yet).
- exit 1 with `ok: false` and `reason: "error"` — print the message
  and stop.

Do not retry, do not edit files yourself, do not call `archascode
render` as a remediation. The user re-invokes after fixing the
underlying issue.

## What this skill does NOT do

- **Render.** Cutting requires a populated `_inflight.sql`, which only
  `archascode render` produces. If it's missing, that's the user's
  next step, not the skill's.
- **Edit migration files.** The CLI moves `_inflight.sql` into place
  with the right timestamp and slug; the skill never writes SQL.
- **Validate the slug.** The CLI normalizes; pass through whatever the
  user gave.
