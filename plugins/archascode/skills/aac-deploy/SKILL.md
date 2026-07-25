---
name: aac-deploy
description: Deploy a rendered archascode consuming project to a named environment by calling `archascode db apply --env <name>`. Use when the user wants to apply pending schema cuts and migrate a target environment without leaving the Claude session.
---

# /aac-deploy

Thin wrapper over the `archascode db apply` CLI. The CLI does all the
real work — verify the env exists in the manifest, check `_inflight.sql`
is empty, check every cut file under `spec/locked/.../migrations/` is
committed to git, then spawn `python aac.py --env <name> migrate`.
This skill exists so the user can pick the env (or accept the default)
from a Claude session without switching to a terminal.

## Arguments

- `$ARGUMENTS` (optional) — interpreted as the target environment name
  and passed verbatim as `--env <name>` to the CLI. Whitespace-only
  counts as omitted.

Invocation forms:

```
/aac-deploy           # prompt with the manifest's defaultEnvironment
/aac-deploy prod      # deploy straight to prod
```

## Preconditions

- `cwd` is a rendered consuming project — `.archascode/manifest.json`
  exists. If it's missing, print `no manifest at .archascode/manifest.json; run /aac-apply first`
  and stop. Do not run `archascode render` on the user's behalf.
- The `archascode` CLI is on PATH (or invokable as
  `node <repo>/apps/local/cli/dist/cli.mjs`). Standard for this project.

## Procedure

### Step 1 — resolve the target env

If `$ARGUMENTS` is non-empty (after trimming), use it verbatim as the
env name; skip to Step 2.

Otherwise, read `.archascode/manifest.json` and look at
`defaultEnvironment` and the keys of `environments`.

Three sub-cases:

1. **`defaultEnvironment` present and points at a key in `environments`**
   → ask the user, with the default pre-filled:

   > Deploy to environment `<defaultEnvironment>`?

   Use `AskUserQuestion` with options `Yes` (proceed) and
   `Pick a different env` (show the remaining `environments` keys as
   a follow-up single-select). On `Yes`, the env name is
   `defaultEnvironment`. On the alternate, use the user's pick.

2. **`defaultEnvironment` absent, `environments` has one or more keys**
   → ask the user to pick from `environments` keys via
   `AskUserQuestion`. Use the chosen key as the env name.

3. **No `environments` block at all** → print
   `no environments declared in manifest; nothing to deploy to`
   and stop.

### Step 2 — invoke deploy

```bash
archascode db apply --env "<env-name>"
```

The CLI streams its own output (it inherits stdio for the inner
`python aac.py migrate`). Forward the user's terminal experience —
do not capture or reformat. Exit codes:

- `0` — deploy succeeded. Print one line: `deployed to <env-name>`.
- `1` — precondition failed (uncommitted `_inflight.sql`, uncommitted
  cut files) **or** the underlying `aac.py migrate` failed. The CLI
  has already printed the specific reason; do not editorialise.
- `2` — env not found in manifest. Surface the CLI's message verbatim.
  Re-prompting from a stale name is not the skill's job; the user
  re-invokes with a correct name.

Do not retry. Do not fix uncommitted files yourself. Do not run
`/aac-cut-schema-migration` as remediation — the user re-invokes after
addressing the gap.

## What this skill does NOT do

- **Render or cut migrations.** Deploy assumes the project is already
  rendered and any pending DDL has been cut. If `_inflight.sql` is
  non-empty, the CLI exits 1 with a pointer to `/aac-cut-schema-migration`;
  surface that and stop.
- **Commit cut files for the user.** Uncommitted cuts under
  `spec/locked/.../migrations/` are an exit-1 from the CLI. The user
  commits and re-invokes.
- **Expose `--baseline-existing-target`.** That's a one-shot rescue
  flag for protected targets that pre-date ADR 021. Drop to a
  terminal and run `archascode db apply --env <name>
  --baseline-existing-target` directly.
- **Set or change `defaultEnvironment`.** That's a spec-level
  decision, not a deploy-time one.
