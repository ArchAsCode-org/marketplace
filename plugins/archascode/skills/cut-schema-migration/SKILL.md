---
name: cut-schema-migration
description: Cut the in-flight schema migration in an archascode consuming project by calling `archascode cut-schema-migration`. Use when the user wants to seal pending DDL into a named, append-only migration file without leaving the Claude session.
---

# /archascode:cut-schema-migration

Thin wrapper over the `archascode cut-schema-migration` CLI (ADR 019,
ADR 020, ADR 088). The CLI does all the real work — it computes each
backend's pending schema delta via the archascode cloud (`POST
/schema-delta`) and seals the result under
`spec/locked/adapter/persistence/<backend>/schema/migrations/` with a
timestamp + slug (one chain per backend, sharing one name per
invocation, ADR 087). This skill exists so the user can invoke that
flow from a Claude session without switching to a terminal.

## Network dependency

This is a network verb: it requires a resolved cloud target and a
logged-in session (ADR 071/088). On exit 1 with an auth-related error in
the message, point the user at `/archascode:login` — mirror the
render-path skills' 401 hint. On exit 2, the CLI has already determined
there is no cloud target (not logged in); surface its message verbatim
and suggest `/archascode:login`.

## Arguments

- `$ARGUMENTS` (optional) — passed verbatim as `--name <slug>` to the
  CLI. The CLI normalizes to lowercase snake_case. When `$ARGUMENTS` is
  empty, first run `archascode cut-schema-migration --dry-run --json`
  and derive a short `lowercase_snake_case` name from the **actual
  pending DDL** shown in its output, then invoke for real with that name
  via `--name`. A bare invocation with no `--name` at all remains legal;
  the CLI then names the cut `update_schema`.

Invocation forms:

```
/archascode:cut-schema-migration
/archascode:cut-schema-migration add_customer_email
/archascode:cut-schema-migration "drop legacy orders index"
```

## Preconditions

- `cwd` is a rendered consuming project — a manifest exists and at
  least one backend has a live schema anchor
  (`src/adapter/persistence/<backend>/schema/migrations/__init__.py`).
- The user is logged in (`archascode login`).

Both preconditions are enforced by the CLI itself; this skill does not
pre-check them.

## Procedure

When `$ARGUMENTS` is empty, preview first to derive a name:

```bash
archascode cut-schema-migration --dry-run --json
```

Parse the JSON on stdout. On `{ "ok": true, "dryRun": true, "cuts": […] }`
(exit 0), read the pending DDL in `cuts[].deltaSql` and derive a short
`lowercase_snake_case` name describing it. On any other outcome from this
preview call, skip name derivation and proceed straight to the real
invocation below with no `--name` (the CLI will report the same outcome
again, this time as the real result to surface).

Then run the real invocation:

```bash
archascode cut-schema-migration [--name "$ARGUMENTS"] --json
```

- If `$ARGUMENTS` is empty/whitespace and no name was derived from the
  dry-run preview, omit `--name` entirely.
- Use `--json` so the outcome is machine-parseable.

Parse the single line of JSON on stdout:

- `{ "ok": true, "dryRun": false, "cuts": […], "producedFilenames":
  ["<file>", …] }` (exit 0) — print `cut migration <files>` (the
  produced filenames, joined by `, `) and stop.
- `{ "ok": false, "reason": "<reason>", "message": "<msg>" }` (exit 3)
  — print `<msg>` and stop. Reasons: `not-rendered` (no manifest or no
  live backend anchor — remediation: run `archascode render` first) and
  `no-delta` (every backend's delta is empty — nothing to cut).
- exit 1 with `ok: false` and `reason: "error"` — print the message and
  stop. If the message indicates an auth failure, suggest
  `/archascode:login`. If the message indicates an unconfigured backend
  (the spec was edited since the last render), the remediation is to
  re-render first — suggest `/archascode:apply` or `archascode render`.
- exit 2 with no JSON on stdout — not logged in. Surface the CLI's
  stderr message verbatim and suggest `/archascode:login`.

Do not retry, do not edit files yourself. The user re-invokes after
fixing the underlying issue (logging in, re-rendering, etc.).

## What this skill does NOT do

- **Render.** Cutting requires a rendered project with at least one live
  schema backend, which only `archascode render` produces. If that's
  missing, that's the user's next step, not the skill's.
- **Edit migration files.** The CLI computes the delta over the network
  and writes the sealed migration files with the right timestamp and
  slug; the skill never writes SQL.
- **Validate the slug.** The CLI normalizes; pass through whatever the
  user gave (or what was derived from the dry-run preview).
- **Retry a failed network call.** A failed delta call for any backend
  aborts the whole cut with no files written; the user re-invokes.
