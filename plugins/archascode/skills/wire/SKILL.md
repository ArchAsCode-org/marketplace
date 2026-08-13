---
name: wire
description: Wire real adapters into an archascode consuming project — an interview that writes the persistence stratum (adapters.persistence.postgres or .sqlserver, per-entity opt-ins, environments) or the auth stratum (adapters.auth.id + api.auth.type, fail-closed with explicit per-environment noop opt-outs) into spec/architecture.yml. The auth mode interview offers api_key or jwt (oauth2 stays reserved) and is a reconcile — safe to re-run to switch modes or remove auth. Validates every edit via a scratch render and pre-seeds/retrofits the new and existing envs' .env.<env>.example files. Bare invocation reports current wiring. Use after the in-memory first run, when the user is ready for a real database and/or real auth.
---

# /archascode:wire

Bind real adapters to ports that are running on synthesized defaults.
`architecture.yml` carries two strata: the domain HOW (`/archascode:analyze`'s
job — entities, invariants, methods, derivable from the PRD) and the
infra HOW (adapters, environments — not derivable from any PRD). This
skill owns the second stratum, as an interview. The infra stratum now
has two targets — `persistence` and `auth`:

```
/archascode:analyze → /archascode:init → /archascode:apply → /archascode:seed → API Explorer   # act one: memory, zero infra questions
/archascode:wire persistence                                        # act two: make it real
/archascode:init → /archascode:apply → cp .env.docker.example .env.docker → API Explorer (env: docker)
/archascode:wire auth                                                # act two, other axis: gate it
```

The skill edits `spec/architecture.yml` only — additively, via the same
uv-provisioned `ruamel.yaml` round-trip `/archascode:init` uses (ADR 070 A1),
so comments and formatting survive. It validates the edit with a
scratch render, pre-seeds the engine-authored `.env.<env>.example`
template for each environment it creates, and prints a posture-aware
next-steps chain. It never runs that chain itself.

## Arguments

- `$ARGUMENTS` (optional) — the wiring target:
  - *(bare)* — **report mode**: print current wiring and open
    decisions; write nothing.
  - `persistence` — the persistence interview (this file's main job).
  - `auth` — the auth-mode interview: choose `api_key` or `jwt`
    (`oauth2` stays reserved and is not offered), write the
    fail-closed spec shape (§`Procedure — auth`), and validate via a
    scratch render. Re-running against an already-wired spec reports
    current state, offers switching modes, and — only then — offers
    removing auth entirely.
  - anything else — print the grammar above and stop.
- `--context <text>` — optional free-text steering, mirroring
  `/archascode:analyze`. When it answers an interview question
  (`"docker only"`, `"qa + prod on an external server, protected"`,
  `"api_key, only prod verifies"`), the skill skips asking that
  question — this covers both the persistence interview's questions
  and the auth-mode interview's mode/per-environment questions alike.

```
/archascode:wire
/archascode:wire persistence
/archascode:wire persistence --context "docker only; Sessions stay in memory"
/archascode:wire auth
/archascode:wire auth --context "api_key; only prod verifies"
```

## Preconditions

- `spec/architecture.yml` exists. If not:
  `no spec/architecture.yml — run /archascode:analyze <prd.md> (or write one by hand) first` — stop.
- `persistence` mode and `auth` mode: the `archascode` CLI is on the Bash
  PATH — the plugin's `bin/` provides it. If `command -v archascode`
  fails, the plugin install is broken: re-enable/reinstall per
  INSTALL.md and check the wrapper's executable bit
  (`chmod +x <kit>/marketplace/plugins/archascode/bin/archascode`). The
  user must also be logged in (`archascode login`). Both modes render
  via the same Step 3/6-shaped baseline-then-scratch brackets.
- `persistence` mode and `auth` mode: `uv` is on PATH (the spec write
  runs under `uv run --no-project --with 'ruamel.yaml'`, same as
  `/archascode:init`). Both modes write via the same single-pass
  ruamel round-trip.
- No manifest, no `.venv`, no prior render required. Wire runs before
  or after the first `/archascode:apply` equally well.

Report mode needs only the spec file.

## Report mode (bare `/archascode:wire`)

Read `spec/architecture.yml` and print, in order:

1. **Persistence** — `memory (by omission)` when neither
   `adapters.persistence.postgres` nor `adapters.persistence.sqlserver`
   is present; otherwise the declared backend name (`postgres` or
   `sqlserver` — ADR 092 exclusivity means at most one), with entity
   coverage: `N of M entities carry adapters.<backend>`, naming the
   exceptions (they resolve to memory inside the auto backend binding —
   deliberate mixed storage, or an oversight).
2. **Environments** — a table of `name / port_binding / compute /
   data`, marking `default_environment`. A spec with none (pre-ADR-070
   floor) gets: `no environments declared — /archascode:init will scaffold dev (memory)`.
3. **Auth** — the mode, derived from `api.auth.type`: `none` |
   `api_key` | `jwt`. `type` absent means `none` **even when**
   `adapters.auth` is declared — a verifying adapter under anonymous
   posture enforces nothing, so report the declared-but-unenforcing
   adapter as a fact (`adapters.auth.id: <id> declared, but api.auth.type
   is unset — nothing is enforced`) rather than as the mode. When
   `type` is set, print it as the mode even if `adapters.auth` is
   absent (it resolves to `noop` by omission — the spec is in a
   partial hand-wired state `/archascode:wire auth` will adopt on next
   run). Then print a per-environment table of **resolved** auth —
   `env / port_binding / adapter` — computed by walking each declared
   environment's `port_binding` to that binding's `app_adapters.auth`,
   falling back to the spec-level `adapters.auth.id`, falling back to
   `noop` (auto bindings always inherit the spec-level default, never
   an override — annotate those rows `(inherits default)`). Close with
   the `/archascode:wire auth` pointer.
4. **Open decisions** — one line per unwired stratum, each with its
   pointer, e.g.
   `Persistence: memory (by omission) — run /archascode:wire persistence when ready for a real database.`
   `Auth: none — run /archascode:wire auth when ready to require credentials.`

No writes, no render, no questions.

## Procedure — `persistence`

### Step 1 — verify preconditions

```bash
test -f spec/architecture.yml || { echo "no spec/architecture.yml — run /archascode:analyze first"; exit 1; }
command -v uv >/dev/null 2>&1 || { echo "uv is required but not on PATH"; exit 1; }
command -v archascode >/dev/null 2>&1 || echo "archascode CLI not on PATH — the plugin install is broken; see INSTALL.md"
```

### Step 2 — already-wired check

If `adapters.persistence.postgres` **or** `adapters.persistence.sqlserver`
is already present in the spec, print the report-mode output followed by
`persistence is already wired — edit spec/architecture.yml by hand to change it (re-wire mode is a future version)`
and stop. v1 wires exactly once. This check is also the exclusivity
guard: a project declares **one** SQL backend (ADR 092) — writing a
second would fail the very next parse, so switching backends is a hand
edit that *replaces* the declared key, never a second wire run.

### Step 3 — baseline render (green-before-edit)

```bash
SCRATCH="$(mktemp -d)"
archascode render spec/architecture.yml --out "$SCRATCH" --json
```

The current spec must come back `ok: true` **before** any edit. This
buys two guarantees at the cost of one fast render: the cloud service
is reachable before the spec is mutated, and any Step-6 failure is
attributable to wire's own edit. If the baseline is red, print the
errors and stop:
`spec is failing validation before any wiring — fix it first (the /archascode:apply loop is the usual path)`.
A connection failure here is the cloud-service precondition; same
posture as `/archascode:analyze`. Exit **2** with no JSON on stdout means not
logged in, not a render failure. Report `not logged in — run archascode
login` and stop.

### Step 4 — the interview (once, up front)

At most **four** questions, asked once — never mid-write. `--context`
answers skip their question. Defaults are marked; in a non-interactive
context take every default.

1. **Backend** — a two-option question: `Postgres` and `SQL Server`
   (both fully supported since ADR 092). Keep each option's
   `description` neutral — a one-liner on the runtime shape at most
   (`psycopg driver, postgres:16 container` / `pymssql driver, mcr
   mssql container`); the choice is the user's, on their own
   grounds. The answer sets `<backend>` (`postgres` | `sqlserver`) for
   every later step: the adapter key, entity opt-ins, env
   `port_binding`, and the summary. Postgres is the non-interactive
   default. Exclusivity (ADR 092) means this choice is exhaustive —
   one SQL backend per project.
2. **Topology** — `local docker only` *(default)*, `docker + an
   external server env`, or `external only`. The docker env is named
   `docker`; when an external env is chosen, ask its name (default
   `prod`).
3. **External env data posture** *(only when an external env was
   chosen)* — `protected` *(default; `archascode db apply` owns the
   schema, ADR 052)* or `ephemeral`. Alongside this question, print —
   don't ask — the adoption caveat: an external DB that already holds
   data is the `--baseline-existing-target` adoption flow at deploy
   time; wire does not handle it.
4. **Mixed storage** — any entities that should stay memory-only
   (ephemeral sessions, caches)? *(default: none — every entity
   persists.)* Excluded entities simply don't get the adapter and fall
   back to memory inside the auto backend binding; no `port_bindings`
   block is needed or written.

Not a question: `default_environment` stays exactly as it is (normally
`dev`/memory, per the ADR-070 scaffold). Flipping the default binding
is the ADR-017 silent-data-loss footgun; wire never touches it, and
the summary says so.

### Step 5 — write the spec (one round-trip pass, additive only)

Before writing, check the chosen environment names against existing
`environments:` keys — on any collision, stop:
`environment '<name>' already exists — pick another name or hand-edit it`.

Then apply every mutation in **one** load → edit → dump pass, using
`/archascode:init` Step 3's exact loader settings (this skeleton is the
contract; fill the interview-derived values in):

```bash
uv run --no-project --with 'ruamel.yaml' python - <<'PY'
import sys
from ruamel.yaml import YAML

yaml = YAML(typ="rt")
yaml.preserve_quotes = True
yaml.indent(mapping=2, sequence=4, offset=2)
yaml.width = 4096

with open("spec/architecture.yml") as f:
    spec = yaml.load(f)

BACKEND = "postgres"  # <- interview answer 1: "postgres" | "sqlserver"
DEFAULT_PORT = {"postgres": 5432, "sqlserver": 1433}[BACKEND]

# 1. Adapter declaration — canonical env-var block (values live in
#    .env.<env>, never in the spec). Shape diverges by backend (ADR
#    097): postgres connects via a single DATABASE_URL-shaped
#    connection string; sqlserver keeps its four discrete keys.
if BACKEND == "postgres":
    spec.setdefault("adapters", {}).setdefault("persistence", {})[BACKEND] = {
        "env": {"url": "DATABASE_URL"}
    }
else:
    spec.setdefault("adapters", {}).setdefault("persistence", {})[BACKEND] = {
        "env": {
            "host": "DB_HOST",
            "port": f"DB_PORT:{DEFAULT_PORT}",
            "database": "DB_NAME",
            "username": "DB_USER",
            "password": "DB_PASSWORD",
        }
    }

# 2. Per-entity opt-in — every entity except the interview's
#    memory-only exclusions.
EXCLUDE = set()  # <- interview answer 4
for name, entity in spec["domain"]["entities"].items():
    if name not in EXCLUDE:
        entity.setdefault("adapters", {})[BACKEND] = {}

# 3. Environments — append only; existing envs (dev included) are
#    never edited. Shape per the interview (the auto port binding is
#    named after the backend):
envs = spec.setdefault("environments", {})
envs["docker"] = {"port_binding": BACKEND, "compute": "docker", "data": "ephemeral"}
# external env, when chosen:
# envs["prod"] = {"port_binding": BACKEND, "compute": "external", "data": "protected"}

# Never: default_environment, port_bindings, existing environments.

with open("spec/architecture.yml", "w") as f:
    yaml.dump(spec, f)
PY
```

### Step 6 — validate via scratch render

Re-render the edited spec into a fresh scratch dir (same command as
Step 3). Wire's edits are mechanical, so red is unexpected — cap at
**3** iterations of read-errors → fix → re-render. Still red: **leave
the edits in place**, print the remaining errors verbatim, and stop.
Reverting would discard the interview; `git diff spec/architecture.yml`
is the user's review surface and `git checkout` the undo.

### Step 7 — pre-seed `.env.<env>.example` for the new envs

The green scratch tree contains the engine-authored per-env templates
(ADR 055 — the docker one carries the container's superuser login:
`DB_USER=postgres` for postgres, `DB_USER=sa` for sqlserver). Copy them out for
**exactly the environments this run created**, and only when absent at
the project root:

```bash
for env_name in "${CREATED_ENVS[@]}"; do
  src="$SCRATCH/.env.${env_name}.example"
  [ -f "$src" ] && [ ! -f ".env.${env_name}.example" ] && cp "$src" ".env.${env_name}.example" \
    && echo "✓ .env.${env_name}.example pre-seeded (engine-authored)"
done
rm -rf "$SCRATCH"
```

Copying from the scratch render — never hand-writing the content —
keeps the bytes identical to what the next real render would emit, so
there is nothing to drift. Core's once-ever writer skips any existing
file and tombstones it on that render (`packages/core/src/files.ts`),
so the pre-seed is never clobbered and a later deliberate delete
sticks. Scoping to created-this-run envs means wire can never
resurrect an example the user deliberately deleted.

### Step 8 — summarize with a posture-aware chain

Substitute the chosen backend throughout (`postgres → psycopg`,
`sqlserver → pymssql`; superuser `postgres` / `sa`):

```
✓ spec/architecture.yml — <backend> wired: N entities (M memory-only), envs added: docker (ephemeral), prod (protected) (validated in K render pass(es))
✓ .env.docker.example, .env.prod.example pre-seeded
default_environment unchanged: dev (memory)

Next:
1. /archascode:init                       # adapter set changed → <driver>
2. /archascode:apply                      # render: docker-compose.yml, schema DDL, <backend> adapters
3. cp .env.docker.example .env.docker     # DB_USER=<superuser> already set
4. API Explorer → select env 'docker'     # ephemeral: start owns the schema (ADR 052)
```

When a protected env was created, append its branch:

```
prod (protected) — when ready:
  fill .env.prod from .env.prod.example (real credentials; never committed)
  /archascode:cut-schema-migration         # seal pending DDL
  /archascode:db apply prod   # archascode db apply --env prod
```

Every step in the chain is the user's to invoke — wire runs none of
them (family rule).

## Procedure — `auth`

### Step A1 — verify preconditions + read wired state

```bash
test -f spec/architecture.yml || { echo "no spec/architecture.yml — run /archascode:analyze first"; exit 1; }
command -v uv >/dev/null 2>&1 || { echo "uv is required but not on PATH"; exit 1; }
command -v archascode >/dev/null 2>&1 || echo "archascode CLI not on PATH — the plugin install is broken; see INSTALL.md"
```

Then the **pinned** no-environments stop — a spec with no
`environments:` block (the pre-ADR-070 floor) must not proceed, because
writing the verifying spec default with no opt-out subjects would let
a later `/archascode:init`-scaffolded `dev` silently inherit
verification, the one place fail-closed would ambush the dev loop:

```
no environments declared — run /archascode:init first (it scaffolds dev) or declare environments; wire auth reconciles per environment
```

Wired-ness and the current mode are **derived from `api.auth.type`**,
nowhere else: `type` absent → not wired (`none`), even if
`adapters.auth` is declared (a verifying adapter under anonymous
posture enforces nothing). `type` set → that is the current mode, even
if `adapters.auth` is absent. A spec in a **partial** hand-wired state
is adopted, not stopped on: this run writes whichever half is missing,
and an existing `adapters.auth.id` that contradicts the interview's
chosen mode is replaced under the switch semantics (Step A3/A4).

### Step A2 — baseline render (green-before-edit)

Same command, posture, and stop messages as persistence Step 3: render
the current spec into a fresh `mktemp -d` and require `ok: true` before
any edit; red stops with the errors and the
`/archascode:apply`-loop pointer; exit 2 with no JSON means not logged
in (`not logged in — run archascode login`), not a render failure.

### Step A3 — the interview (once, up front)

**Question 1 — mode.** `api_key` or `jwt`. `oauth2` is **not
offered** — it has no engine ADR yet (ADR 107 narrowed the
not-yet-implemented render rejection to `oauth2` alone), and wire must
never author a spec it knows the engine will reject.

- **Re-run against an already-wired spec** (Step A1's derivation says
  `type` is set): print the report-mode Auth section first — current
  mode + the per-environment resolved-auth table — then ask the mode
  question with the **current mode preselected**, and, only in this
  state, offer a third option: **remove auth**. Choosing remove auth
  skips straight to Step A4's removal branch.
- Switching modes (e.g. `jwt` → `api_key`) rewrites `adapters.auth.id`
  **and** `api.auth.type` together, as a pair — the ADR 107
  cross-check forbids a mode/adapter mismatch, so there is no
  partial-switch state.

**Question 2 — per-environment verification.** Exactly one question:
which declared environments should verify? Suggestion-only heuristic
(never a silent default): an environment whose `port_binding` resolves
to a SQL-backed binding, or whose `compute` is `external`, gets
**verify** preselected; a memory/local environment gets **open**
(noop) preselected. On a re-run, the **current** per-environment
resolution is preselected instead of the heuristic — adopt, don't
churn. `--context` can answer either question (wire's existing
steering rule, unchanged from persistence mode).

### Step A4 — write the spec (one round-trip pass)

Same ruamel skeleton as persistence Step 5 (loader settings identical:
`YAML(typ="rt")`, `preserve_quotes`, 2-space mapping / 4-space sequence
indent, `width=4096`), one load → edit → dump pass. Two spec keys only:

```
adapters.auth.id: <jwt_bearer | api_key>   # the spec-level default
api.auth.type: <jwt | api_key>             # coherent with the adapter (ADR 107 cross-check)
```

Writing `type` is the whole authoring act — **never** write `scheme`
(ADR 107 D3's plan-time bearer default already covers it; an explicit
`scheme: bearer` is dead weight and anything else is render-rejected)
and **never** write per-entity `entity.api.auth` (granularity stays
`/archascode:analyze` / entity-editor territory). On a mode switch,
both keys are rewritten together as a pair.

This is the **fail-closed** shape: `adapters.auth.id` becomes the
spec-level default, so every binding verifies unless explicitly opted
out — including bindings and environments added later. For each
environment the interview marked **opted-out**, emit an explicit noop
route, by the binding kind the environment selects:

- **Auto binding** (the common case — persistence mode never writes
  `port_bindings`, so most projects only have auto bindings): declare
  a clone named `<auto-name>_noauth` — e.g. `memory_noauth`,
  `postgres_noauth` — with body
  `{default: <same id>, app_adapters: {auth: noop}}` — **never** an
  `overrides` block on an auto-binding clone; this reproduces the auto
  binding's own entry semantics exactly (every entity that declares
  `<same id>` binds to it, everything else falls to memory). Write
  **one** shared clone per distinct auto binding among the opted-out
  environments, then re-point each of those environments'
  `port_binding` at it.
  - **Adoption**: if a declared binding already named
    `<auto-name>_noauth` exists and its shape matches exactly what
    wire would write (same `default`, no `overrides`,
    `app_adapters.auth: noop`), adopt it — a re-run must find its own
    prior clone, not stop on it. Mismatched shape is a **stop**,
    naming the mismatch, so wire never silently overwrites a
    hand-edited binding of the same name.
  - **Zero-opt-in-backend stop**: an opted-out environment selecting a
    `<backend>` auto binding when no entity declares that backend is a
    second named **stop**. The auto binding is legal on its own (it
    synthesizes from the `adapters.persistence` declaration alone) but
    its clone would fail plan (a `default: <backend>` binding requires
    ≥1 entity opted into that backend) — and a `default: memory`
    fallback is **not** safe here: custom-port adapter resolution keys
    on the binding's `default` id, so it would silently flip
    custom-port adapters to their memory implementations. Name the fix
    in the stop text: opt an entity into the backend, or leave the
    environment verifying. Do not suggest a `default: memory` clone.
- **Declared binding** (a hand-authored `port_bindings` entry): if
  **every** environment selecting it opted out, set (or update) that
  binding's `app_adapters.auth: noop` **in place** — a single additive
  key, never touching `default` or `overrides`. If the environments
  selecting it **split** (some opt in, some opt out), clone it as
  `<name>_noauth` (same `default` **and** `overrides` as the original,
  plus `app_adapters.auth: noop`) and re-point only the opted-out
  environments at the clone.
- **Opted-in environment with a stale explicit noop**: symmetrically,
  if an environment now marked **verify** is pointed at a binding that
  carries an explicit `app_adapters.auth: noop` it no longer wants
  (e.g. from a prior run), remove that key (or re-point the
  environment off the clone back to the original binding) — the whole
  edit is a reconcile of per-environment *resolved* auth, matching
  what the interview's answers say, never a pure append.

Environment edits touch `port_binding` **only** — `default_environment`
is never touched (the ADR-017 footgun stands).

### Step A5 — validate via scratch render

Same bracket as persistence Step 6, in shape: re-render the edited spec
into a fresh scratch dir, cap at 3 iterations of read-errors → fix →
re-render, and on persistent red **leave the edits in place**, print
the errors verbatim, and stop — `git diff spec/architecture.yml` /
`git checkout` is the user's review-and-undo surface.

### Step A6 — retrofit `.env.<env>.example` for verifying environments

For every **pre-existing** root `.env.<env>.example` whose environment
now resolves to a verifying adapter, append the engine-authored auth
section: one blank line, then the tail this pinned extraction captures
over the scratch render's freshly emitted counterpart (the scratch
tree has no manifest, so every example emits fresh, auth lines
included):

```bash
sed -n '/^AUTH_/,$p' "$SCRATCH/.env.${env_name}.example"
```

**Idempotent per mode**: skip any file already carrying a `^AUTH_`
line — Step A7's mode-switch arm owns replacing it. Opted-out (noop)
environments get no append at all (`AUTH_ENV_KEYS` has no `noop`
entry — the same gate the engine itself uses). A file **absent** at
the root because it was never yet seeded needs nothing — the next real
render's once-ever seed emits it auth-lines-included. A file the user
deliberately **deleted** is absent *and* tombstoned
(`packages/core/src/files.ts` skips a once-ever write on tombstone
**or** presence) — out of wire's reach, same hand lane as the render's.

**On a mode switch** (Step A3 already wired, different mode chosen):
this step becomes a **tail-replace** instead of an append — the one
licensed rewrite of example content, still engine-authored bytes only:
delete from the first `^AUTH_` line to EOF, then run the same append
above. Without this, the skip-if-`^AUTH_` idempotence would strand the
old mode's keys in every committed template forever (once-ever
tombstones mean no ordinary render fixes them).

Wire never hand-writes example content, in either arm — this extends
the persistence Step 7 principle: everything in the file is bytes the
engine already emitted somewhere.

### Step A7 — mode completion (api_key completes; jwt parks)

**api_key** completes locally. For each verifying environment, seed
`AUTH_API_KEY` into the gitignored `.env.<env>`:

```bash
openssl rand -hex 32
```

— exactly ADR 110 D2's recipe. Generate **only** when the key is
absent from the file (never overwrite an existing value). Guard every
write with `git check-ignore .env.<env_name>`; if it would be tracked,
refuse the write and point at `/archascode:init` (its gitignore block
covers `.env`/`.env.*`). Create the file when absent. Each environment
gets its **own** distinct key — never copy one environment's key to
another. **Never print the generated value** in the summary. This is
deliberately ADR 110's value source: deploy's rule is
generate-only-when-both-sides-absent, push-local-when-only-local-has-
one, so a wire-seeded key is exactly what deploy later adopts and
pipes to the platform.

**jwt** declares and parks — wire writes the spec stratum (Step A4)
and the example-file keys (Step A6) but never provisions a provider.
Print the pinned next-steps chain, verbatim:

```
1. /archascode:apply        # real render — environments.json now carries appAdapters.auth
2. /archascode:auth         # provider reconcile (values into .env.<env>)
3. /archascode:deploy       # platform vars (ADR 110 reads auth's output)
```

The ordering is load-bearing, not stylistic: ADR 108's gate reads the
engine-resolved `appAdapters.auth.id` from the project's
`environments.json`, and wire's scratch renders never touch that file
— skipping step 1 lands `/archascode:auth` on a closed gate. Family
rule unchanged: wire runs none of the chain itself.

On a mode switch, stale `.env.<env>` values left over from the old
mode are **reported**, never deleted — they're the user's file.

### Step A8 — summarize

State the posture flip plainly: writing `api.auth.type` flips ADR
033's app-wide posture default to `required` for every endpoint
without an explicit `entity.api.auth: anonymous` — across **all**
bindings and environments, because posture is spec-level while
enforcement is binding-level. Its corollary in the same breath: opted-
out (noop) environments still serve those `required` routes
anonymously — the dev loop survives untouched — while opted-in
environments start returning 401 without credentials the moment the
next render deploys. When the spec declares `ui:` (ADR 096), restate
ADR 107's static-mount caveat: the SPA still *loads* publicly; only
its data calls gate.

For an **api_key** run, state the completion facts: a memory-only
verifying environment is now runnable end to end (the next
`/archascode:apply` + `aac up` serves 401/200 correctly with zero
further steps; a SQL-backed environment still needs its DB values in
`.env.<env>`, unchanged from the existing persistence chain), and name
the footgun explicitly: persistence mode's printed
`cp .env.<env>.example .env.<env>` step would **clobber** a generated
key with the example's `AUTH_API_KEY=<set me>` placeholder — a
non-empty wrong key the adapter will happily compare against (ADR 107
fail-closes only on an empty/whitespace key, not a wrong one). When
`.env.<env>` already exists, the instruction is **merge**, never
`cp`-overwrite.

For **removal** (the re-run-only option from Step A3): confirm
**before** writing anything, naming the consequence plainly — every
deployed environment becomes anonymous, world-readable and
world-writable, on its next deploy. On confirmation, delete `api.auth`
and `adapters.auth` **only** and stop there — leave every `_noauth`
clone binding, environment re-pointing, explicit per-binding noop
override, example-file AUTH line, and `.env.<env>` value exactly in
place. They are all inert once nothing verifies (the spec default
falls back to `noop`), harmless, and exactly what makes the removal
cheaply reversible. List what was left behind in the summary. On
decline, nothing is written.

## What this skill does NOT do

- **Run `/archascode:init`, `/archascode:apply`, `/archascode:db apply`,
  `/archascode:auth`, or `/archascode:deploy`.** Explicit invocation
  only — family rule, both strata.
- **Write or read a live `.env` / `.env.<env>`, or ask for
  credentials — except auth mode's api_key generation.** The
  persistence interview carries no secrets; placeholders stay
  placeholders until the user fills the live file (ADR 055's
  boundary). Auth mode's *only* licensed exception is Step A7's
  `openssl rand -hex 32` key seed into a `git check-ignore`-guarded
  `.env.<env>` — never a credential, never a jwt value (those are
  `/archascode:auth`'s job).
- **Write `port_bindings` — except auth mode's noop-override
  clones and in-place `app_adapters.auth`.** The auto backend binding
  already gives mixed storage the right semantics for persistence
  mode; a custom lens there is a hand-authored construct. Auth mode's
  license is narrow: the `<name>_noauth` clone shape (Step A4) and
  setting/removing `app_adapters.auth` in place on an *existing*
  declared binding — a single additive key, never rewriting that
  binding's `default` or `overrides`. Never a persistence lens, in
  either mode.
- **Touch `default_environment` — absolute in both modes.** Additive
  persistence writes and auth mode's environment re-pointing both stay
  scoped to `port_binding`; `default_environment` is untouched by
  either mode (the ADR-017 silent-data-loss footgun).
- **Touch existing environments — except auth mode's `port_binding`
  re-pointing.** Persistence mode is purely additive. Auth mode's one
  licensed edit to an existing environment is re-pointing its
  `port_binding` at (or off) a `_noauth` clone (Step A4); nothing else
  about an existing environment changes.
- **Re-wire persistence, or switch backends.** A spec with a SQL
  backend already declared gets a report and a stop, not a merge.
  Under ADR 092 exclusivity a backend switch is a hand edit that
  replaces the declared key (and the per-entity opt-ins and env
  `port_binding`s that name it). **Auth mode is different by design**:
  it is a reconcile, not wire-once — persistence's stop exists for
  ADR 092 exclusivity physics plus data-migration consequences neither
  of which apply to a pure spec-level auth-posture edit, so re-running
  `wire auth` to switch modes or remove auth entirely is expected and
  legal (§`Procedure — auth`, Step A3/A8).
- **Adopt an existing database.** `--baseline-existing-target` and the
  adoption runbook live at `/archascode:db apply`'s layer; wire prints the
  pointer and moves on.
- **Modify the plugin UI.** Surfacing the memory-by-omission default
  on the canvas is separate work.
- **Write `scheme`, `entity.api.auth`, or a jwt value into any live
  file, in auth mode or persistence mode.** `scheme` is never spelled
  (ADR 107 D3's plan-time default covers it); per-entity posture stays
  `/archascode:analyze` / entity-editor territory; jwt values
  (`AUTH_JWKS_URL`, `AUTH_ISSUER`, `AUTH_AUDIENCE`) are never written
  to a live `.env.<env>` — that is `/archascode:auth`'s job, never
  wire's, in either mode.
- **Offer `oauth2`.** The mode question offers only `api_key` and
  `jwt`; `oauth2` stays reserved until it has its own engine ADR.

## Failure modes (v1)

| Symptom                                              | Behavior                                                                      |
| ----------------------------------------------------- | ------------------------------------------------------------------------------ |
| No `spec/architecture.yml`                            | Point at `/archascode:analyze`; stop.                                                 |
| Unknown target argument                               | Print the grammar (bare = report, `persistence`, `auth`); stop.       |
| `uv` / `archascode` CLI missing                       | Print the pointer; stop. Nothing written.                                      |
| Baseline render red or cloud unreachable (Step 3/A2)  | Print errors / the URL precondition; stop. Nothing written.                    |
| Already wired (either SQL backend declared)           | Print wiring report; stop. Backend switching is a hand edit (exclusivity).     |
| Environment name collision (persistence mode)         | Stop before writing; user picks another name.                                  |
| No environments declared (auth mode, Step A1)         | Print the pinned stop naming `/archascode:init` or hand-declaring one; stop. Nothing written. |
| `_noauth` clone shape mismatch (auth mode, Step A4)   | Stop, naming the mismatch; the pre-existing binding is left untouched.         |
| Zero-opt-in backend clone (auth mode, Step A4)        | Stop, naming the fix: opt an entity into the backend, or leave the environment verifying. Never suggests a `default: memory` clone. |
| `.env.<env>` not gitignored (auth mode, Step A7)      | Refuse the api_key seed; point at `/archascode:init`'s gitignore block; stop.  |
| Auth removal declined (auth mode, Step A8)            | Nothing written; existing wiring stands.                                       |
| Malformed spec YAML                                   | Print the parse error; stop.                                                   |
| Validation still red after 3 iterations (Step 6/A5)   | Leave edits in place; print errors verbatim; `git checkout` is the undo.       |

No retries beyond the bounded loop. The user re-invokes after fixing
whatever the error surfaced.

## Notes for future versions

- **`oauth2` mode** — blocked on its own engine ADR (ADR 024's second
  reserved slot, ADR 107's not-yet-implemented rejection still narrows
  to it alone); when that lands, the auth-mode interview's Question 1
  gains a third option.
- **Per-entity posture carve-outs** — anonymous exceptions
  (`entity.api.auth`) stay hand/editor-edited; if demand shows up, it
  is an `/archascode:analyze` or entity-editor concern, not wire's.
- **Re-wire / edit mode for persistence** — change posture, add
  environments, extend entity coverage, or switch the SQL backend on
  an already-wired spec (today: report + hand-edit; a switch replaces
  the declared key under ADR 092 exclusivity). Auth mode's reconcile
  mechanics (report-then-preselect-current, adopt-don't-churn
  per-environment resolution, the switch/removal machinery in
  §`Procedure — auth`) are the template to follow when this lands.
- **Adoption interview** — existing-DB targets: walk the
  cut → baseline flow instead of just naming it.
- **Custom-port adapter wiring** — external-service backends (email,
  payments) through the same target grammar.
