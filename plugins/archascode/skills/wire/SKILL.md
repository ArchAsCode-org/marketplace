---
name: wire
description: Wire real adapters into an archascode consuming project — an interview that writes the persistence stratum (adapters.persistence.sqlserver or .postgres, per-entity opt-ins, environments) into spec/architecture.yml, validates via a scratch render, and pre-seeds the new envs' .env.<env>.example files. Bare invocation reports current wiring. Use after the in-memory first run, when the user is ready for a real database.
---

# /archascode:wire

Bind real adapters to ports that are running on synthesized defaults.
`architecture.yml` carries two strata: the domain HOW (`/archascode:analyze`'s
job — entities, invariants, methods, derivable from the PRD) and the
infra HOW (adapters, environments — not derivable from any PRD). This
skill owns the second stratum, as an interview:

```
/archascode:analyze → /archascode:init → /archascode:apply → /archascode:seed → API Explorer   # act one: memory, zero infra questions
/archascode:wire persistence                                        # act two: make it real
/archascode:init → /archascode:apply → cp .env.docker.example .env.docker → API Explorer (env: docker)
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
  - `auth` — reserved for a future version. Print
    `auth wiring is not implemented yet — posture lives on api.auth (ADR 033); adapter selection is a hand edit today` and stop.
  - anything else — print the grammar above and stop.
- `--context <text>` — optional free-text steering, mirroring
  `/archascode:analyze`. When it answers an interview question
  (`"docker only"`, `"qa + prod on an external server, protected"`),
  the skill skips asking that question.

```
/archascode:wire
/archascode:wire persistence
/archascode:wire persistence --context "docker only; Sessions stay in memory"
```

## Preconditions

- `spec/architecture.yml` exists. If not:
  `no spec/architecture.yml — run /archascode:analyze <prd.md> (or write one by hand) first` — stop.
- `persistence` mode only: the `archascode` CLI is on the Bash PATH — the
  plugin's `bin/` provides it. If `command -v archascode` fails, the
  plugin install is broken: re-enable/reinstall per INSTALL.md and check
  the wrapper's executable bit
  (`chmod +x <kit>/marketplace/plugins/archascode/bin/archascode`). The
  user must also be logged in (`archascode login`).
- `persistence` mode only: `uv` is on PATH (the spec write runs under
  `uv run --no-project --with 'ruamel.yaml'`, same as `/archascode:init`).
- No manifest, no `.venv`, no prior render required. Wire runs before
  or after the first `/archascode:apply` equally well.

Report mode needs only the spec file.

## Report mode (bare `/archascode:wire`)

Read `spec/architecture.yml` and print, in order:

1. **Persistence** — `memory (by omission)` when neither
   `adapters.persistence.sqlserver` nor `adapters.persistence.postgres`
   is present; otherwise the declared backend name (`sqlserver` or
   `postgres` — ADR 092 exclusivity means at most one), with entity
   coverage: `N of M entities carry adapters.<backend>`, naming the
   exceptions (they resolve to memory inside the auto backend binding —
   deliberate mixed storage, or an oversight).
2. **Environments** — a table of `name / port_binding / compute /
   data`, marking `default_environment`. A spec with none (pre-ADR-070
   floor) gets: `no environments declared — /archascode:init will scaffold dev (memory)`.
3. **Auth** — `adapters.auth.id` if declared, else
   `noop (by omission)`; note that adapter selection is a hand edit
   today (`/archascode:wire auth` is reserved).
4. **Open decisions** — one line per unwired stratum, each with its
   pointer, e.g.
   `Persistence: memory (by omission) — run /archascode:wire persistence when ready for a real database.`

No writes, no render, no questions.

## Procedure — `persistence`

### Step 1 — verify preconditions

```bash
test -f spec/architecture.yml || { echo "no spec/architecture.yml — run /archascode:analyze first"; exit 1; }
command -v uv >/dev/null 2>&1 || { echo "uv is required but not on PATH"; exit 1; }
command -v archascode >/dev/null 2>&1 || echo "archascode CLI not on PATH — the plugin install is broken; see INSTALL.md"
```

### Step 2 — already-wired check

If `adapters.persistence.sqlserver` **or** `adapters.persistence.postgres`
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

1. **Backend** — a two-option question: `SQL Server` and `Postgres`
   (both fully supported since ADR 092). Keep each option's
   `description` neutral — a one-liner on the runtime shape at most
   (`pymssql driver, mcr mssql container` / `psycopg driver,
   postgres:16 container`); the choice is the user's, on their own
   grounds. The answer sets `<backend>` (`sqlserver` | `postgres`) for
   every later step: the adapter key, entity opt-ins, env
   `port_binding`, and the summary. SQL Server is the non-interactive
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

BACKEND = "sqlserver"  # <- interview answer 1: "sqlserver" | "postgres"
DEFAULT_PORT = {"sqlserver": 1433, "postgres": 5432}[BACKEND]

# 1. Adapter declaration — canonical env-var block (values live in
#    .env.<env>, never in the spec). Same shape for both backends;
#    only the default port differs.
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
`DB_USER=sa` for sqlserver, `DB_USER=postgres` for postgres). Copy them out for
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

Substitute the chosen backend throughout (`sqlserver → pymssql`,
`postgres → psycopg`; superuser `sa` / `postgres`):

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

## What this skill does NOT do

- **Run `/archascode:init`, `/archascode:apply`, or `/archascode:db apply`.** Explicit
  invocation only — family rule.
- **Write or read a live `.env` / `.env.<env>`, or ask for
  credentials.** The interview carries no secrets; placeholders stay
  placeholders until the user fills the live file (ADR 055's
  boundary). Only the committed `.example` templates are touched.
- **Wire auth.** The `auth` target is reserved; posture stays ADR
  033's cascade and adapter selection stays a hand edit until that
  version lands.
- **Write `port_bindings`.** The auto backend binding already gives
  mixed storage the right semantics (unopted entities fall back to
  memory); a custom lens is a hand-authored construct.
- **Touch `default_environment` or existing environments.** Additive
  only; the memory dev loop survives wiring untouched.
- **Re-wire or switch backends.** A spec with a SQL backend already
  declared gets a report and a stop, not a merge. Under ADR 092
  exclusivity a backend switch is a hand edit that replaces the
  declared key (and the per-entity opt-ins and env `port_binding`s
  that name it).
- **Adopt an existing database.** `--baseline-existing-target` and the
  adoption runbook live at `/archascode:db apply`'s layer; wire prints the
  pointer and moves on.
- **Modify the plugin UI.** Surfacing the memory-by-omission default
  on the canvas is separate work.

## Failure modes (v1)

| Symptom                                              | Behavior                                                                      |
| ----------------------------------------------------- | ------------------------------------------------------------------------------ |
| No `spec/architecture.yml`                            | Point at `/archascode:analyze`; stop.                                                 |
| Unknown target argument                               | Print the grammar (bare = report, `persistence`, `auth` reserved); stop.       |
| `uv` / `archascode` CLI missing                       | Print the pointer; stop. Nothing written.                                      |
| Baseline render red or cloud unreachable (Step 3)     | Print errors / the URL precondition; stop. Nothing written.                    |
| Already wired (either SQL backend declared)           | Print wiring report; stop. Backend switching is a hand edit (exclusivity).     |
| Environment name collision                            | Stop before writing; user picks another name.                                  |
| Malformed spec YAML                                   | Print the parse error; stop.                                                   |
| Validation still red after 3 iterations (Step 6)      | Leave edits in place; print errors verbatim; `git checkout` is the undo.       |

No retries beyond the bounded loop. The user re-invokes after fixing
whatever the error surfaced.

## Notes for future versions

- **`auth` target** — jwt_bearer selection, key-config env vars, and
  the claims-mapper hand-off (dispatched by `/archascode:apply`); plus
  per-binding `app_adapters.auth` overrides.
- **Re-wire / edit mode** — change posture, add environments, extend
  entity coverage, or switch the SQL backend on an already-wired spec
  (today: report + hand-edit; a switch replaces the declared key under
  ADR 092 exclusivity).
- **Adoption interview** — existing-DB targets: walk the
  cut → baseline flow instead of just naming it.
- **Custom-port adapter wiring** — external-service backends (email,
  payments) through the same target grammar.
