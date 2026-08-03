---
name: db
description: Preview or apply pending schema cuts for a rendered archascode consuming project by calling archascode db plan / db apply --env <name>. Bare invocation runs the read-only plan for the default environment; mutation requires the explicit 'apply' word. Use when the user wants to inspect or migrate a target database without leaving the Claude session.
---

# /archascode:db

Thin wrapper over the `archascode db` CLI verb family (`plan` and
`apply`). The CLI does all the real work — verify the env exists in the
manifest, check every cut file under `spec/locked/.../migrations/` is
committed to git, then either preview (`plan`) or spawn `python aac.py
--env <name> migrate` (`apply`). Both verbs stay cloud-free (ADR 088
D4); this skill adds a non-blocking advisory preflight of its own before
`apply` (see below). This skill exists so the user can pick the env (or
accept the default) and choose preview-vs-mutate from a Claude session
without switching to a terminal.

## Arguments

- `$ARGUMENTS` — `[subcommand] [env?]`, whitespace-trimmed.
  - First token `apply`, optionally followed by an env name.
  - First token `plan`, optionally followed by an env name.
  - Empty (bare invocation) — runs the read-only plan for the resolved
    default environment.
  - Any other first token — unsupported; print the two supported forms
    and stop (see below).

Invocation forms:

```
/archascode:db                # read-only plan for the default env
/archascode:db plan            # read-only plan, prompt for env
/archascode:db plan prod       # read-only plan for prod
/archascode:db apply           # apply, prompt with the manifest's defaultEnvironment
/archascode:db apply prod      # apply straight to prod
```

Bare invocation is deliberately the safe verb: mutation always requires
the explicit `apply` word.

## Preconditions

- `cwd` is a rendered consuming project — `.archascode/manifest.json`
  exists. If it's missing, print `no manifest at .archascode/manifest.json; run /archascode:apply first`
  and stop. Do not run `archascode render` on the user's behalf.
- The `archascode` CLI is on the Bash PATH — the plugin's `bin/` provides
  it. If `command -v archascode` fails, the plugin install is broken:
  re-enable/reinstall per INSTALL.md and check the wrapper's executable
  bit (`chmod +x <kit>/marketplace/plugins/archascode/bin/archascode`).

## Procedure

### Step 0 — parse `$ARGUMENTS`

Trim whitespace. Split on the first run of whitespace into a first token
and a remainder.

- First token `apply` → remainder (if any) is the env name; go to the
  **apply path**.
- First token `plan` → remainder (if any) is the env name; go to the
  **plan path**.
- Empty (no first token at all) → go to the **bare path**.
- Anything else → print exactly:

  ```
  Supported forms:
    /archascode:db plan <env?>
    /archascode:db apply <env?>
  ```

  and stop.

### Env resolution (shared by all three paths)

If an env name was supplied (non-empty after trimming), use it verbatim;
skip to the path's next step.

Otherwise, read `.archascode/manifest.json` and look at
`defaultEnvironment` and the keys of `environments`.

Three sub-cases:

1. **`defaultEnvironment` present and points at a key in `environments`**
   → ask the user, with the default pre-filled:

   > Use environment `<defaultEnvironment>`?

   Use `AskUserQuestion` with options `Yes` (proceed) and
   `Pick a different env` (show the remaining `environments` keys as
   a follow-up single-select). On `Yes`, the env name is
   `defaultEnvironment`. On the alternate, use the user's pick.

2. **`defaultEnvironment` absent, `environments` has one or more keys**
   → ask the user to pick from `environments` keys via
   `AskUserQuestion`. Use the chosen key as the env name.

3. **No `environments` block at all** → print
   `no environments declared in manifest; nothing to <verb>`
   (substitute `plan`/`deploy to` for `<verb>` as appropriate to the
   path) and stop.

The bare path skips the `AskUserQuestion` mutation-style framing above
only in wording — it still needs a resolved env name, so it runs the
same three sub-cases, but there is no mutation to confirm (`plan` writes
nothing), so it simply resolves the env and proceeds.

### The `apply` path

#### Step 1 — resolve the target env

Per env resolution above.

#### Step 1a — advisory `cut --dry-run` preflight (non-blocking)

Before invoking apply, run:

```bash
archascode cut-schema-migration --dry-run --json
```

- Exit 0 with `{ "ok": true, "dryRun": true, "cuts": […] }` where
  `cuts` is non-empty — pending un-cut spec changes exist. Tell the
  user, e.g.: `heads up: there are pending schema changes not yet cut
  (run /archascode:cut-schema-migration first if you want them
  included)`. This is advisory only — proceed to apply if the user
  says to.
- Exit 0 with an empty `cuts` list, or exit 3 with `"reason":
  "no-delta"` — verified: nothing pending; proceed silently.
- Exit 2 (not logged in), exit 1 (cloud unreachable / call failed), or
  a JSON parse failure — the check could not run: include one passing
  informational line in your narration, e.g. `note: skipped the
  pending-changes preflight (not logged in) — couldn't verify there are
  no un-cut schema changes`, and proceed straight to apply. This is a
  mention, and never a question — apply proceeds without waiting for a
  response; the preflight is not a precondition of `apply`. (Silence
  means "verified clean"; the note marks "unverified".)
- Exit 3 with `"reason": "not-rendered"` — proceed silently; `apply`'s
  own precondition will report the un-rendered project with its
  authoritative message.

#### Step 2 — invoke apply

```bash
archascode db apply --env "<env-name>"
```

The CLI streams its own output (it inherits stdio for the inner
`python aac.py migrate`). Forward the user's terminal experience —
do not capture or reformat. Exit codes:

- `0` — deploy succeeded. Print one line: `deployed to <env-name>`.
- `1` — precondition failed (uncommitted cut files) **or** the
  underlying `aac.py migrate` failed. The CLI has already printed the
  specific reason; do not editorialise.
- `2` — env not found in manifest. Surface the CLI's message verbatim.
  Re-prompting from a stale name is not the skill's job; the user
  re-invokes with a correct name.

Do not retry. Do not fix uncommitted files yourself. Do not run
`/archascode:cut-schema-migration` as remediation — the user re-invokes
after addressing the gap.

### The `plan` path

Read-only — writes nothing (ADR 056 semantics: `db plan` never bootstraps
`schema_version`, never issues `CREATE DATABASE`, and refuses identically
to `apply` on protected divergence).

#### Step 1 — resolve the target env

Per env resolution above.

#### Step 2 — invoke plan

```bash
archascode db plan --env "<env-name>"
```

Stream the CLI's output unmodified. Exit codes:

- `0` — plan printed successfully. Nothing further to do.
- nonzero — surface the CLI's message verbatim and stop.

### The bare path

Resolve the default env per env resolution above (no mutation-confirmation
prompt is needed — `plan` writes nothing). Run the `plan` path's Step 2
against the resolved env. On exit `0`, after the CLI's own output, print
exactly one closing line:

```
to apply: /archascode:db apply <env-name>
```

On a nonzero exit, surface the CLI's message and stop (no closing line).

## What this skill does NOT do

- **Render or cut migrations.** Both `plan` and `apply` assume the
  project is already rendered. Pending un-cut DDL is surfaced only by
  the advisory `cut --dry-run` preflight above (non-blocking) — `plan`
  and `apply` themselves do not check for it (ADR 088 D4). If the
  preflight flags pending changes, point the user at
  `/archascode:cut-schema-migration`.
- **Commit cut files for the user.** Uncommitted cuts under
  `spec/locked/.../migrations/` are an exit-1 from the CLI. The user
  commits and re-invokes.
- **Expose `--baseline-existing-target` or `--up-to`.**
  `--baseline-existing-target` is a one-shot rescue flag for protected
  targets that pre-date ADR 021; `--up-to` bounds `db plan`/`db apply` to
  an inclusive version prefix (ADR 069). Both are drop-to-terminal: run
  `archascode db apply --env <name> --baseline-existing-target` or
  `archascode db apply --env <name> --up-to <bound>` directly.
- **Set or change `defaultEnvironment`.** That's a spec-level
  decision, not a plan/apply-time one.
- **Apply on a bare invocation.** Bare `/archascode:db` always runs the
  read-only plan; mutation requires the explicit `apply` word.
