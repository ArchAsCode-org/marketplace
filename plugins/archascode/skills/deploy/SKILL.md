---
name: deploy
description: Provision and reconcile deployment-platform environments for a rendered archascode consuming project — an interview + plan/confirm/apply reconcile over the Railway CLI that creates environments and DB services, wires APP_ENV and reference variables, seeds the local .env.<env>, runs archascode db apply, and smoke-checks /health per environment. Railway is the only v1 platform. Use when the user wants the app on a platform; `db` applies schema, `apply` resolves hand-offs.
---

# /archascode:deploy

Put the rendered app on a deployment platform, and keep it in sync with
`spec/architecture.yml`'s environment table on every later run. **`deploy`
provisions and reconciles the platform; `/archascode:db` applies schema;
`/archascode:apply` resolves hand-offs.** This skill never applies schema
itself beyond invoking `/archascode:db`'s own `apply` verb (D7), and it never
resolves a hand-off — those stay separate, explicit steps in the chain.

Every run of this skill is a **reconcile**: it reads the project's declared
environments, asks which of them should exist on the platform, compares that
desired state against what the platform actually has, and applies only what
the user confirms. The first run is this same flow starting from empty
platform state — there is no separate "first deploy" mode.

## Arguments

- `$ARGUMENTS` (optional) — free-text steering that pre-answers interview
  questions, mirroring `/archascode:wire`/`/archascode:analyze` (e.g. `"just
  prod"`, `"skip the schema apply"`, a platform name). A question the
  free text already answers is skipped; everything else is still asked.
  There is no positional grammar — this is prose, not flags.

```
/archascode:deploy
/archascode:deploy just prod
/archascode:deploy skip the schema apply this time
```

## Preconditions

Checked in order; each is a stop-and-explain, never a stack trace, and
**nothing billable or mutating happens on an unconfirmed run** — every
create/update/delete in this skill sits behind the plan confirmation
described under Procedure.

1. **Rendered project.** `.archascode/environments.json` exists. If not:
   `no .archascode/environments.json — run /archascode:apply first` and stop.
2. **Railway CLI installed.** `command -v railway` succeeds. If not, point
   at Railway's CLI install docs and stop — this skill does not install it.
3. **Authenticated.** `railway whoami` succeeds. If not, run `railway login
   --browserless` **in the background** (the `/archascode:login` pattern:
   the activation URL prints as soon as the flow starts, and a foreground
   call only returns after it ends) and relay the activation URL to the
   user the moment it appears. Keep polling until the background task
   exits, then re-check `railway whoami`.
4. **GitHub integration present**, needed for `railway add --repo` (D5). If
   the CLI or API reports the integration missing, relay the dashboard
   install step (Railway's project settings → GitHub) and stop — this
   skill cannot install the integration itself.
5. **Plan-limit refusals are a first-class outcome, not a crash.** A Free
   plan may refuse project or environment creation at its resource cap.
   Surface the refusal verbatim and offer the user's real options: free up
   space (delete an unused Railway project/environment), upgrade the plan,
   or link into an existing project instead of creating one.
6. **Confirmation gates every mutation.** Every create, update, and delete
   below is proposed on a plan screen first (D4) and only applied once the
   user confirms that specific screen. A precondition failure never
   silently retries into a mutation.

## Desired state

Desired state comes from exactly two reads — never from any other spec
field, and never inferred from `compute`/`data` alone (they are heuristics
for interview *defaults*, not decisions):

- **`.archascode/environments.json`**, read directly (this skill is a
  fourth reader of its version semantics, alongside core's
  `readEnvironments`, the emitted `aac.py`, and `bootstrap.py` —
  ADR 099 D3 / ADR 100). Restate the tolerance rule here, verbatim:
  - **Absent** → stop: `no .archascode/environments.json — render first
    (/archascode:apply)`. Absence means "never rendered or cleaned."
  - **`schemaVersion` present but not `1`** → **fatal**, same stop message
    — never resolve against a stale table.
  - **Present with `environments: {}`** → its own outcome, not an error:
    `no environments declared — nothing to deploy`, stop.
  - Otherwise: the environment table — name, `portBinding`, `compute?`,
    `data`, `persistenceBackends` — is the desired-state input.
- **One `spec/architecture.yml` read**: the declared env-key names under
  `adapters.persistence.<backend>.env` (for postgres, the single `url` key
  — ADR 097). This supplies the variable *name* to wire, never a value.

### The interview: which environments exist on Railway is asked, every run

Railway is the durable record of platform reality; the repo never caches
an answer. So on **every** run, list **every** declared environment and ask
whether it should exist on Railway, with defaults layered in this order:

1. **Railway presence, first.** If `railway environment list --json`
   already shows an environment matching the declared name, preselect
   **yes**. If it doesn't, preselect per the axis heuristics below.
2. **Axis heuristics, for envs with no Railway presence** (suggestions
   only — the user's answer is what counts):
   - `persistenceBackends` non-empty **and** `compute: external` →
     suggested **yes**.
   - `compute: docker` → suggested **no** (this env is a local rehearsal
     loop, not a platform target).
   - Memory-only (`persistenceBackends` empty) → preselected **no**,
     annotated **"(demo candidate)"** — a memory env is a legitimate
     platform target (a stateless demo), just not the default guess.

The answer is recorded **nowhere in the repo** — Railway is the record of
*defaults*, not of unaskable answers. Unchecking an environment that
already exists on Railway is exactly how it enters the delete/orphan lane
below, not a special case. A `compute: docker` environment the user opts
into anyway is reconciled identically to any other SQL environment: the
`compute` axis describes the *local* dev loop, and on the platform every
database is external by construction.

## Branch posture

Railway builds from GitHub, not the working tree, so branch identity is
checked before planning:

- The skill deploys **the branch the repository is currently on** — never
  a hardcoded `main`. This is what keeps the invariant "the spec that
  declares environment X travels on the branch that deploys X" true
  without any extra bookkeeping (ADR 100 D3 reads the deployed checkout's
  `environments.json`).
- Verify the current branch tracks a pushed remote (`git rev-parse
  --abbrev-ref --symbolic-full-name @{u}`, then compare `git rev-parse
  HEAD` against the remote ref). If local `HEAD` is ahead of or diverged
  from the tracked remote, warn — Railway will build whatever is on
  GitHub, not the uncommitted or unpushed state of the working tree.
- **Detached `HEAD` or an untracked branch degrades to asking** the user
  which branch to deploy, rather than guessing.
- Parse the `<owner>/<repo>` slug from the tracked remote's URL (for
  `railway add --repo`, D5). A non-GitHub remote (Railway's repo
  integration is GitHub-only) or an ambiguous multi-remote setup is a
  stop-and-explain outcome — never a guess.
- **The plan/confirm screen always names the branch** being deployed,
  inferred or overridden, so an inferred default is never invisible at
  confirm time.
- The interview offers an optional **per-environment branch override**
  (existing branches only — see D5/Procedure step 5 below). **This skill
  never creates a branch** — repo topology has another owner.

## Procedure

### Step 1 — query current Railway state

Every run, gather current state with `--json` throughout, so nothing below
relies on link-state or memory:

```bash
railway status --json
railway environment list --json
railway environment config --environment <name> --json   # per environment
railway variable list --environment <name> --json         # per environment
railway domain list --service <app-service> --environment <name> --json
railway tcp-proxy list --service <db-service> --environment <name> --json
```

On first run (unlinked working directory), current state is empty; the
interview (below) offers linking an existing Railway project or `railway
init` (project name defaulting to the repo name). A Free-plan refusal here
is a reported outcome with options (free space / upgrade / link existing),
not a failure.

**CLI scoping pattern** (stated once, applies throughout this skill): every
verb that accepts explicit `--environment` / `--service` / `--project`
flags is called with them — stateless, never relying on the CLI's link
state. The one exception is `railway add`, which only acts on the linked
environment; every use of `add` is wrapped in a deliberate, stated
`railway environment link --environment <name>` switch immediately before
it, so the executor never drifts between the two styles.

### Step 2 — run the interview

Ask, once, up front (skipping any question `$ARGUMENTS` already answered):

1. **Platform.** Only v1 answer: Railway. (Additional platforms will fork
   here in a future version — no per-platform skill.)
2. **Per-declared-environment inclusion**, per Desired State's defaults
   above.
3. **Project linking**, if unlinked (Step 1).
4. **Per-environment branch override**, optional, existing branches only.
5. **BYO coordinates**, only for environments whose persistence backend
   Railway cannot provision (D6/Step 6 below) — see the BYO note there for
   exactly what is (and is not) asked.

### Step 3 — build and present the plan

Diff desired state (Step 2's answers) against current state (Step 1) and
present **one** plan covering every environment in scope, split into two
kinds of line:

- **Creates / updates** — new environments, DB services, missing or
  drifted wiring variables, `APP_ENV`, missing domain or TCP proxy,
  per-environment branch override. These apply together on **one**
  confirmation.
- **Deletes — always their own, separate confirmation.** An orphan
  (a Railway environment matching no declared environment, or one the
  user just declined) is reported, and its deletion is offered behind a
  confirmation that **names the consequence**: "this destroys this
  environment's services and database data." Never bundled into the
  create/update confirmation, never auto-applied.
  - The default `production` environment gets the same treatment with
    softer framing: while it is service-less, the plan notes it matches
    no declared environment and offers its deletion (own confirmation;
    declining carries no warning tone — it just remains an informational
    plan line on future runs). If it carries services (e.g. a pre-skill
    manual deployment), it's an ordinary orphan and the user decides.

**Ownership boundary** — the plan only ever proposes changes within this
closed vocabulary: environments, the DB services this skill provisioned,
the wiring variables it set, `APP_ENV`, `APP_DATA`, domain existence,
TCP-proxy existence, and the per-environment branch override. Everything
else on a service — scaling, regions, healthchecks, dashboard experiments,
any variable this skill did not set — is user-owned and is never read,
"corrected," or deleted, no matter how it compares to desired state.

**`APP_DATA` flip semantics** — if an environment's entry is now `data:
protected` but its service still carries `APP_DATA=ephemeral`, the plan
offers **removing** that variable (restoring the fail-closed default).
Removal is the safe direction, so it rides the normal update
confirmation, not the delete lane.

**Owned-DB identification** — there is no state file, so on later runs the
skill identifies "its" DB service per environment as **the one named by
the app service's own wiring reference variable**
(`${{<svc>.DATABASE_URL}}`, read from `environment config --json`). A
database the user added by hand is invisible to reconcile by construction
— it was never referenced, so it's never touched. Any environment with an
existing app-service instance is a valid source for `--duplicate` (Step 5)
— "first deployed environment" is a first-run notion, not a persistent
identity remembered across runs.

**Named exclusions — detect, stop, explain; never migrate:**

- **SQL backend switch** — a spec whose declared backend changed since the
  last deploy is a hand edit (ADR 092 / `wire` precedent), not something
  this skill resolves.
- **Environment rename** — reported as exactly the delete+create pair it
  actually is; the skill never treats an old-name/new-name pair as one
  environment.
- **Data migration**, of any kind — this skill provisions and wires; it
  never moves data between databases.

### Step 4 — apply what was confirmed

Apply only the confirmed create/update lines, then (if confirmed
separately) the delete lines. Nothing here proceeds without its own
confirmation from Step 3.

### Step 5 — topology: create or duplicate environments

- **Railway environment name == spec environment name**, always — this is
  what keeps `APP_ENV`, `RAILWAY_ENVIRONMENT_NAME`, and the spec in visible
  agreement. The default `production` environment is left alone (Step 3).
- **First deployed environment in the project**: create the named
  environment, `railway environment link --environment <name>`, then
  create services directly into it:
  - App service: `railway add --repo <owner>/<repo> --branch <deploy
    branch>` (service name defaults to the repo name).
  - DB service: `railway add --database postgres`, **only when** the
    environment's `persistenceBackends` names a Railway-provisionable
    backend. A memory-only environment gets no DB-shaped resource at all
    — its whole footprint is `APP_ENV` + domain.
  - A memory-only first environment followed by a SQL second environment
    is legal: the duplicate (below) carries no DB, and `add --database`
    into the second environment creates it there, with its name captured
    as always.
- **Subsequent environments**: `railway environment new <name>
  --duplicate <source-env>`, then reconcile the copy against this
  environment's own desired state — set `APP_ENV`, remove a DB instance a
  memory environment doesn't need (`railway service delete --environment
  <name>`), add one the source lacked, apply the branch override, fix
  wiring variables. **After duplication, reconcile closes only the owned
  subset** (the vocabulary from Step 3); the copy may also carry
  **non-owned** variables and settings pointing at the source
  environment's resources — those are **reported for the user's review
  and edited never**, and the report says so explicitly.
- **Names are always captured, never assumed.** Every created service's
  `serviceName`/`serviceId` is read from the `add`/`status` `--json`
  output and threaded into reference variables. This is load-bearing:
  Railway's project-scoped auto-suffix behavior (a second Postgres coming
  back named `Postgres-Qurn`, for example) makes an assumed name silently
  wrong.
- **Verb-spelling hedge** (standing instruction, not a one-time check):
  several verbs this section spells — `add --repo --branch` and its
  repo-name service default, `service delete --environment`, `domain
  list`, domain-generation re-invocation behavior, `variable set
  --service` scoping in a two-service environment — were spike-verified
  only in outline. **Before relying on any of these spellings, verify the
  exact syntax against the installed CLI's own `--help` output.** If a
  verb is missing or renamed in the installed CLI, degrade to a reported
  manual dashboard step for that one action — never guess at a
  replacement spelling.

### Step 6 — per-environment configuration

For each in-scope environment, once its services exist:

- **`APP_ENV=<spec environment name>`** on the app service. Nothing else
  selects the environment — there is no start command to override
  post-ADR-100.
- **Postgres wiring is one reference variable**:
  `<urlKey>=${{<dbServiceName>.DATABASE_URL}}` (the private-network URL),
  set on the app service, where `<urlKey>` is the spec's declared
  `adapters.persistence.postgres.env.url` value (ADR 097) and
  `<dbServiceName>` is the captured name from Step 5. **Never** the five
  discrete `DB_*` variables.
- **BYO mode**, for backends Railway cannot provision (sqlserver — no
  managed offering; any future engine-known backend absent from `railway
  add --database`'s options): set the spec-declared env keys as plain
  variables with user-supplied values, collected as described below — or
  leave them unset and say so plainly in the final report. **Never fake a
  provision.**
  - **Secret collection channel**: anything typed into the chat transits
    the transcript, so this skill does not ask the user to paste
    credentials. Instead: ask the user to write the coordinates
    **themselves** into the gitignored `.env.<env>` (or name an existing
    untracked file that already holds them). The skill then reads that
    file to set the Railway variables — values are piped straight from
    the file, never printed into the transcript — and the same file
    doubles as Step 7's laptop-side apply seed. If the user prefers to
    paste values into chat anyway, that's their call; the skill never
    *asks* for a paste and never re-prints a value it received.
- **`APP_DATA=ephemeral`** — set **only** when the environment's
  `persistenceBackends` is non-empty **and** its `data` field is
  `ephemeral`, and only after the plan screen has named **both**
  consequences: ADR 095's boot-time clear-and-load, and the admin
  save route mounting on a public URL. **Never** set for memory
  environments (their autoload is unconditional — ADR 094 — and the
  fail-closed `protected` default is what keeps the admin router
  unmounted on a public URL). **Never** set for `protected` environments
  — the fail-closed default already *is* the semantics there.
- **Domain**: list the app service's existing domains first; any existing
  one satisfies this step. `railway domain` runs **only** when none
  exists yet (its behavior on re-invocation is deliberately not relied
  on).
- **TCP proxy**: `tcp-proxy list` first per provisioned DB service;
  an existing proxy satisfies this step. Otherwise `tcp-proxy create
  --port 5432` on that DB service — one proxy per provisioned DB service
  instance.

### Step 7 — schema apply and smoke check

**For each in-scope SQL environment:**

1. **Seed the local, gitignored `.env.<env>`.** Before writing, run `git
   check-ignore -q .env.<name>`. If it is **not** ignored, **stop the seed
   step** for that environment and point at `/archascode:init` (it writes
   the ignore rules) rather than create a trackable secret file — this is
   a stop, not a warning.
   - Provisioned-postgres environments: set the declared `url` key to the
     **public** connection URL — read `DATABASE_PUBLIC_URL` from the DB
     service's own variables via `--json`. Composing the URL from the
     `tcp-proxy list` endpoint plus credentials (also read via `--json`)
     is the fallback only, when `DATABASE_PUBLIC_URL` isn't present.
   - BYO environments: the spec-declared keys, from the coordinates the
     user already placed in `.env.<env>` (Step 6's collection channel —
     the same file serves as this seed). If the user declined to supply
     laptop-reachable coordinates, schema apply is **skipped, with a
     report line saying so** — not treated as a failure.
   - Every mode: values are piped directly from `--json` output or the
     file into place. **No secret value is ever echoed into the
     transcript** — this hygiene rule holds everywhere in this skill,
     not just here.
2. **Schema apply, with a zero-cuts arm.** `archascode db apply --env
   <name>` hard-fails on a project with no sealed cuts, and a first-ever
   SQL deploy is exactly that. So: check `spec/locked/**/schema/
   migrations/` for existing cuts.
   - **No cuts yet**: offer to run `archascode cut-schema-migration` —
     naming plainly that it is a **network verb needing archascode-cloud
     login** (ADR 088; relay `/archascode:login` on a 401) — then **stop
     for the user to commit the cut**. `db apply` refuses uncommitted
     cuts, and this skill never commits on the user's behalf.
   - **Cuts present and committed**: `archascode db apply --env <name>`
     is cloud-free. A fresh database receives the full chain
     (empty-but-existing is adoptable); an existing one gets the
     unapplied tail; `data: ephemeral` environments proceed under the
     existing stderr nudge. In-flight changes beyond the last cut get
     `/archascode:db`'s own advisory posture — offer its `--dry-run`
     preflight (itself a cloud call) or proceed.
   - **Environment-shadowing hygiene**: a pre-set shell variable
     out-ranks `.env.<env>` (ADR 055 precedence), so a stray exported
     connection variable could silently point the apply at the wrong
     database. Before applying, scrub the spec-declared connection keys
     from the spawned process's environment, or verify the resolved
     target matches the seed.

**For every in-scope environment** (memory environments included):

3. **Smoke check**: `GET /health` on the environment's generated domain.
   This probe is registered unprefixed and unauthenticated on every
   generated app (`api.base_path` only re-roots entity/application
   routers, ADR 098), so this step needs no auth, no `base_path`
   knowledge, and no spec read. Report reachability per environment.

### Step 8 — final report

Print one table, environment → URL, DB service, `APP_ENV`, branch,
applied-cut count (or `skipped` / `BYO` / `memory` as applicable) — plus
any non-owned variables reported-not-edited from Step 5's duplication
arm, and any BYO/skip notes from Step 7.

## What this skill does NOT do

- **Write any tracked repo file** — no `railway.json`, no state or ID
  cache file, no spec edits, no `.gitignore` edits. The only local write
  this skill makes is the gitignored `.env.<env>` seed.
- **Commit anything, ever** — the zero-cuts arm stops for the user to
  commit the sealed cut themselves.
- **Create branches** — repo topology has another owner.
- **Echo secret values into the transcript** — `variable list` output,
  BYO credentials, connection URLs. Values are piped into gitignored
  files only, never printed.
- **Touch non-owned service settings** — anything outside the ownership
  boundary (Procedure Step 3) is never read-modify-written, "corrected,"
  or deleted, regardless of what it looks like compared to desired state.
- **Migrate data, switch SQL backends, or rename environments** — each is
  detected and reported with a stop-and-explain, never resolved
  automatically.
- **Apply a delete on the create/update confirmation**, or apply anything
  at all on an unconfirmed run.
- **Fake a provision** for a backend Railway cannot supply — BYO mode or
  an unset-with-report line only.
- **Detect and heal pre-ADR-100 deployments** — a stale start-command
  override or a once-seeded serve Dockerfile is fixed by hand; this skill
  carries no detect-and-heal machinery for them.
- **Run the wider chain on the user's behalf** — no `/archascode:apply`,
  no render, no `/archascode:init`. This skill's own `db apply` call and
  optional `cut-schema-migration` offer (Step 7) are the only named
  exceptions, and each is its own explicit skill step, not an implicit one.

## Failure modes

| Symptom                                                    | Behavior                                                                                          |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| No `.archascode/environments.json`                          | Stop: "render first" (`/archascode:apply`).                                                       |
| `environments.json` `schemaVersion != 1`                     | Stop: "render first" — fatal, never resolved against a stale table.                               |
| `environments.json` present with `environments: {}`          | Stop: "no environments declared — nothing to deploy."                                              |
| Railway CLI not installed                                    | Print the install pointer; stop.                                                                   |
| Not authenticated                                             | Background `railway login --browserless`, relay the URL, re-check on completion.                    |
| GitHub integration missing                                    | Relay the dashboard install step; stop.                                                            |
| Free-plan resource cap reached                                | Report the refusal verbatim with options (free space / upgrade / link existing); stop.              |
| Detached `HEAD` or untracked branch                           | Ask which branch to deploy rather than guessing.                                                    |
| Non-GitHub or ambiguous multi-remote                          | Stop-and-explain; no guess at a slug.                                                               |
| SQL backend switch detected                                   | Report as a hand-edit case (ADR 092); stop, never migrate.                                          |
| Environment rename detected                                   | Report as the delete+create pair it is; stop, never migrate.                                        |
| Zero sealed cuts on first SQL deploy                          | Offer `archascode cut-schema-migration` (network verb, login relay on 401); stop for user to commit. |
| `.env.<env>` would be a tracked file                          | Stop the seed step for that environment; point at `/archascode:init`'s ignore rules.                |
| BYO coordinates declined                                      | Skip schema apply for that environment, with a report line — not a failure.                         |
| `db apply` fails                                              | Surface the CLI's own message verbatim; do not retry or fix on the user's behalf.                    |
| `/health` unreachable                                         | Report the environment as unreachable in the final table; do not retry indefinitely.                |

No retries beyond what is stated above. The user re-invokes after
addressing whatever a stop pointed at.

## Notes for future versions

- **Branch-mapped environments + Railway ephemeral PR environments** — a
  promotion workflow using per-environment source branches, and PR
  preview environments (`external + ephemeral` semantics), inheriting
  this version's spec-travels-with-branch invariant.
- **Remote API Explorer targets** — pointing the Explorer at a deployed
  base URL with real auth, plus a warning when Start connects to an
  external `protected` database.
- **Platform-side demo reset** — a documented one-liner (or skill step)
  to reset an `external + ephemeral` demo environment to snapshot state
  without a laptop.
- **Additional platforms** — Render, Fly, Supabase — as interview forks
  inside this same skill, not new skills.
- **`railway config` IaC migration** — revisit the `railway config`
  plan/apply surface once its runner and resource vocabulary mature.
- **Railway's own MCP server / agent skills** — an alternative substrate
  for the CLI calls, if it stabilizes.
