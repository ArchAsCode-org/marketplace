---
name: clean
description: Tear down an archascode consuming project's render output back to "nothing but architecture.yml" by calling `archascode clean`. Use when the user wants a clean slate for debugging — wipe src/, spec/src/, aac.py, docker-compose.yml, and the manifest, keeping only the spec and plugin positions.
---

# /archascode:clean

Thin wrapper over the `archascode clean` CLI. The verb deletes the whole
render output surface so the project is back to just its authored inputs.
It is a **debugging** verb — "start over from the spec" — and leans on git
as the recovery path. This skill exists so the user can run it from a
Claude session without switching to a terminal.

The verb is intentionally separate from `/archascode:apply` (the reflexive
render loop) and `/archascode:init` (additive toolchain setup): teardown
gets its own verb so the destructiveness is legible at the call site.

## What clean removes

- `src/` — engine output, regenerated every render.
- `spec/src/` — the **agent overlay**: regenerable body-seed stubs (re-emitted
  on the next render). This is the part worth a second look before confirming.
- `.archascode/manifest.json` — render bookkeeping.
- `.archascode/environments.json` — the environment table (D5).
- `aac.py` — root overwrite file.
- `docker-compose.yml` — root once-seed (user-owned after first render).

## What clean keeps

- `spec/architecture.yml` — the source of truth, and the whole point.
- `spec/.archascode/positions.json` — plugin graph layout (editor state,
  a different `.archascode` dir from the manifest).
- `pyproject.toml`, `.venv/` — owned by `/archascode:init`, untouched here.

## Preconditions

- `cwd` is a consuming project with `spec/architecture.yml`.
- The `archascode` CLI is on the Bash PATH — the plugin's `bin/` provides
  it. If `command -v archascode` fails, the plugin install is broken:
  re-enable/reinstall per INSTALL.md and check the wrapper's executable
  bit (`chmod +x <kit>/marketplace/plugins/archascode/bin/archascode`).

The cloud service does **not** need to be running — clean is filesystem-only.

## Procedure

### Step 1 — preview the plan (no deletion)

Run a dry pass to learn what would be deleted and surface any warnings.
The CLI has no TTY in a skill context, so without `--yes` it prints the
plan + warnings and then refuses (deletes nothing) — exactly the preview
you want:

```bash
archascode clean --json
```

This prints the plan to stderr and refuses on stdin. Capture stderr to
relay the target list and warnings to the user. (The `--json` flag keeps
the success/abort shape parseable for Step 3.)

Warnings to relay verbatim if present:

- **sealed migrations** — the schema history under `spec/locked/.../migrations/`
  will be deleted and re-derived from zero on the next render.
- **deployed environments** — one or more environments are recorded as
  SQL-backed (sqlserver or postgres); deleting the migration chain may
  desync a deployed target.

### Step 2 — confirm with the user

Show the user the delete list and any warnings, and ask them to confirm
in the conversation. git is the recovery path; say so. Proceed only on an
explicit "yes."

If there is nothing to clean (the preview reports
`nothing to clean — no render output found`), say so and stop — there is
no rendered output to remove.

### Step 3 — execute on confirmation

Once the user confirms, run with `--yes` to skip the (unanswerable) TTY
prompt:

```bash
archascode clean --yes --json
```

Parse the single JSON line on stdout:

- `{ "ok": true, "removed": [...], "warnings": [...] }` — print
  `cleaned <N> target(s)` and list them.
- `{ "ok": false, "reason": "aborted" }` — only happens if `--yes` was
  omitted; re-run with `--yes`.

### Step 4 — point at the next step

After a clean, the project is back to `spec/architecture.yml`. Tell the
user the next move is `/archascode:apply` (render + close the loop) when
they want output again. Leave that for them to invoke.

## Scope

This skill previews, confirms, and runs `archascode clean`. It does not
render, re-seed, or edit the spec. It does not delete anything the CLI
does not target — `pyproject.toml`, `.venv/`, `architecture.yml`, and
`positions.json` stay. Recovery of anything deleted is via git.
