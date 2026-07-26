---
name: analyze
description: Analyze a PRD document and draft a first-pass spec/architecture.yml for an archascode consuming project — entities, relationships, enums, value objects, invariants, methods, and API posture — validated against the real engine via a scratch-dir render. Use at project start, when a PRD exists but spec/architecture.yml does not.
---

# /archascode:analyze

Turn a PRD into a first-pass `spec/architecture.yml`. This is the front
door of the pipeline — it fills the "create spec/architecture.yml by
hand" hole between greenfield and `/archascode:init`:

```
/archascode:analyze <prd.md>  →  spec/architecture.yml + spec/analysis.md
/archascode:init              →  pyproject.toml + .venv matching the spec
/archascode:apply             →  render + hand-off dispatch
/archascode:seed → aac.py up
```

The skill produces **two artifacts of equal standing**: the spec, and a
coverage report (`spec/analysis.md`) that maps every PRD requirement to
a spec construct, a documented assumption, or a named gap. A PRD always
contains requirements the spec language cannot express (RBAC matrices,
audit trails, NFRs, import UX); the report is what keeps the first pass
honest about what it covered.

Validation is authoritative and side-effect-free: the skill runs
`archascode render --out <scratch> --json` against a throwaway
directory. Every path render writes — rendered files,
`.archascode/manifest.json`, `spec/locked/interfaces.lock`, once-ever
seeds — resolves under `--out`, so the project tree receives exactly
one file pair: the spec and the report. The scratch render exercises
the full engine validation surface (jsonschema + Pydantic shape checks
*and* planning-level checks like ADR-068 invariant resolution), which
is strictly stronger than a schema lint.

## Arguments

- `<prd-path>` — required positional. Path to the PRD (markdown or
  plain text). Invoking with no argument stops with:
  `analyze-current-spec (no-arg) mode is not implemented yet — pass a PRD path.`
- `--context <text>` — optional. Free-text steering merged into the
  drafting step and recorded verbatim in the report's Assumptions
  section, e.g. `"auth required everywhere"` or
  `"treat Reporting as out of scope"`. When `--context` answers a
  clarifying fork, the skill skips asking it.
- `--interactive` — optional. Without it (the default), the skill never
  stops to ask — every load-bearing fork resolves to its documented
  default (see Step 2) and gets recorded as an assumption in the
  report. This is the fast, demo-friendly path: one shot,
  `architecture.yml` + `analysis.md`, no pauses. With it, the skill
  asks about load-bearing forks as they're found in Step 2/3/4 —
  auth posture, out-of-scope sections, and modeling forks like
  exclusive-arc relationships or `on_delete` policy — each once, as
  they come up, rather than deferring them all to the report.

Invocation forms:

```
/archascode:analyze docs/product_prd.md
/archascode:analyze docs/product_prd.md --context "auth on; ignore the mobile app sections"
/archascode:analyze docs/product_prd.md --interactive
```

## Preconditions

- The PRD file exists and is readable text.
- `cwd` is the consuming project root (the directory where `spec/`
  belongs).
- The `archascode` CLI is on the Bash PATH — the plugin's `bin/` provides
  it. If `command -v archascode` fails, the plugin install is broken:
  re-enable/reinstall per INSTALL.md and check the wrapper's executable
  bit (`chmod +x <kit>/marketplace/plugins/archascode/bin/archascode`).
- The user is logged in (`archascode login`).
- `.venv` / `pyproject.toml` are **not** required. Analyze precedes
  `/archascode:init`; render needs neither.

If `spec/architecture.yml` already exists, **stop and ask** before
touching it. Offer: overwrite, write the draft to
`spec/architecture.proposed.yml` instead, or cancel. Default to cancel
in non-interactive contexts. An existing spec usually means the user
wants the future critique mode, not a fresh draft.

If any other precondition fails, stop with a one-line message naming
what's missing — report it, don't try to install or start services.

## What it produces

```
spec/
├── architecture.yml   # first-pass spec, validated by a scratch render
└── analysis.md        # coverage report: requirement map, assumptions, gaps
```

Nothing else. No `src/`, no manifest, no lockfile — validation renders
go to a scratch directory that is deleted afterward.

## Procedure

### Step 1 — verify preconditions and read the PRD

```bash
test -f "$PRD_PATH" || { echo "PRD not found: $PRD_PATH"; exit 1; }
command -v archascode >/dev/null 2>&1 || { echo "archascode CLI not on PATH — the plugin install is broken; re-enable/reinstall per INSTALL.md"; exit 1; }
test -f spec/architecture.yml && echo "spec/architecture.yml exists — ask before proceeding"
```

Read the PRD in full. Note its explicit open-questions section if it
has one — those flow into the report verbatim.

### Step 2 — clarifying forks (load-bearing only)

The PRD will surface load-bearing forks — genuinely open questions
where the spec language can't express the PRD's intent directly and
more than one defensible modeling choice exists. Two are common enough
to name up front; more turn up during Step 3/4 domain modeling
(e.g. an exclusive-arc relationship, an `on_delete` policy under a
"never hard-delete" constraint):

1. **Auth posture** — does the app require authentication on its API?
   (Most PRDs say; only open if silent or contradictory.)
2. **Out-of-scope sections** — when the PRD mixes the buildable system
   with clearly separate concerns (a mobile app, a marketing site),
   which sections to map.
3. **Modeling forks found while drafting** (Step 3/4) — e.g. "linked to
   a company, contact, or opportunity" (singular) implies an
   exclusive-or the spec can only approximate as N independent optional
   `many-to-one` relationships plus an invariant; or an `on_delete`
   policy under a PRD-wide "nothing is ever hard-deleted" constraint.

Without `--interactive` (the default): never ask. Every fork resolves
to its default and is recorded as an assumption in `analysis.md`,
worded so the user can override by hand:

- **Auth posture** — infer from the PRD's own language; if genuinely
  silent, default to auth **on** (`api.auth: {type: jwt, scheme:
  bearer}`) — safer to narrow from than to widen from.
- **Out-of-scope sections** — map the whole PRD; do not guess a section
  out of scope on your own judgment.
- **Exclusive-arc / "belongs to exactly one of" relationships** — model
  as N independent optional `many-to-one` relationships plus an entity
  invariant requiring exactly one to be set — count non-nulls, so the
  check holds in every fill state:
  `(a_id is not None) + (b_id is not None) + (c_id is not None) == 1`
  (closest fit to the PRD's intent; never silently drop the
  exclusivity constraint).
- **`on_delete` under a "no hard delete" PRD constraint** — `restrict`
  on every relationship into the affected entity. Deletion itself being
  out of scope means no path should ever cascade; don't introduce a
  cascade the PRD never asked for.
- Any other load-bearing fork Step 3/4 turns up — pick the option
  closest to the PRD's literal wording, prefer the choice that adds the
  least unrequested behavior (no cascades, no assumed permissions, no
  invented workflow steps), and record the fork, the choice, and the
  rationale in the report's Assumptions section.

With `--interactive`: ask each fork once, as it's found — auth posture
and out-of-scope sections up front, modeling forks inline during Step
3/4 — rather than deferring all of them to the report. `--context`
answering a fork (interactive or not) skips asking it and is recorded
verbatim as the rationale.

### Step 3 — extract the domain model

Read the PRD as a domain modeler. The mapping doctrine, in confidence
order:

**Map confidently (the domain layer):**

- **Entities** — durable nouns with identity and lifecycle. Fields
  become typed attributes; field lists in the PRD map near-verbatim.
- **Enums** — categorical closed sets: statuses, stages, types, roles
  *as data*. A PRD list like "pipeline stages: Lead, Qualified, …" is
  a `domain.enums` entry.
- **Value objects** — scalars carrying reusable domain semantics
  (Money, EmailAddress, Percentage). Use `simple` VOs (base `type` +
  `validation`/`pattern`) by default.
- **Relationships** — "each X has many Y", "Y belongs to X". Declare
  both directions.
- **Invariants** — "amount must be positive", "probability between 0
  and 100" → entity invariants.
- **Methods** — domain verbs beyond field-editing CRUD: archive,
  approve, cancel, close. Promote to an endpoint (`use_case: true`)
  when the PRD implies a user-triggered action.
- **API posture** — auth on/off app-wide and per entity; per-op
  suppression when the PRD forbids an operation (e.g. "records are
  never deleted" → `api.disabled: [delete]`).

**Map sparingly (the application layer):** a custom use case + port
only when the PRD *explicitly names* a cross-entity read or workflow —
a dashboard, a report, a summary view. Model reads CQRS-lite: a custom
port returning an inline DTO, a thin pass-through use case. Each one
creates hand-off obligations that `/archascode:apply` fills later; that is
expected, but every speculative one dilutes the first pass, so when in
doubt it goes in the report as a *candidate*, not in the spec.

**Route to the report (unexpressible):** authentication *mechanics*
(sessions, password reset), role-based permission matrices, audit
history, soft-delete semantics, import/export UX, dashboards beyond a
data read, NFRs, browser/deployment requirements. Defensible
approximations are allowed — e.g. a polymorphic "linked to X or Y or
Z" becomes N optional `many-to-one` relationships — but every
approximation is recorded in the report as an assumption.

If the PRD yields no identifiable entities, stop and say so rather
than fabricating a domain.

### Step 4 — draft `spec/architecture.yml`

Authoring reference (the engine validates all of this; the loop in
Step 5 catches anything this summary gets wrong):

- **Top level**: only `domain` is required. Emit `schema_version:
  "1.0"`, `metadata` (`name` kebab-cased from the PRD title,
  `version: "0.1.0"`, `description`), `domain`, and `api` when auth is
  on. **Omit `adapters`, `port_bindings`, and `environments`
  entirely** — the engine defaults to the memory binding, which is the
  fastest path to a running app; switching to sqlserver later is
  `/archascode:wire persistence`.
- **Entities**: `domain.entities.<PascalName>` with `description` and
  `attributes` (required key). Give every entity `id: {type: UUID}`
  plus `created_at`/`updated_at` as `{type: datetime, generated: true}`
  (fixture convention).
- **Attribute types**: `str` | `text` | `int` | `float` | `bool` |
  `UUID` | `datetime` | `date` | `decimal` | `json`, or a declared VO
  or enum name. Attributes default to required; mark optional fields
  `required: false`. `pattern`, `examples`, and `faker` hints are
  optional but cheap — `faker` hints feed `/archascode:seed` later.
- **Relationships**: `relationships.<key>: {entity, cardinality,
  on_delete?, required?}` with `cardinality` ∈ `one-to-one` |
  `one-to-many` | `many-to-one` | `many-to-many`. Let the engine
  synthesize FK attributes — a `many-to-one`/`one-to-one` relationship
  gets `{relationship_key}_id` automatically, nullability from
  `relationship.required` (ADR 057); declare the FK attribute only to
  override. `on_delete: cascade` for owned children, `restrict` for
  references — keeping **at most one cascading path into any entity**:
  SQL Server rejects a table reachable by two cascade routes from the
  same ancestor (error 1785; `set_null` counts as cascading too). When
  a child has several cascading parents that are themselves linked by a
  cascade (e.g. an Activity under both Company and Contact, where
  Company already cascades to Contact), cascade only the nearest parent
  and `restrict` the rest. Prefer an explicit join entity over
  `many-to-many`.
- **Enums**: `domain.enums.<Name>: {values: [...]}`. Prefer declared
  enums over inline `attribute.enum` lists whenever the set is shared
  or named in the PRD.
- **Value objects**: `domain.value_objects.<Name>` — simple form is
  `{type, validation?/pattern?}` (e.g. `Money: {type: Decimal,
  validation: {precision: 12, scale: 2, min: 0}}`).
- **Invariants**: `entity.invariants.<snake_name>: "<expr>"` — Python
  expressions over the entity's own attribute names (`quantity > 0`,
  `0 <= probability <= 100`). Comprehensions are supported;
  unresolvable expressions fail the render loudly (ADR 068), so keep
  them simple and let the loop catch mistakes. Compare enum-typed
  fields by bare value equality — `status == 'won'` — enum members
  compare equal to their value strings (ADR 077). Write "exactly one
  of" checks by counting non-nulls:
  `(a_id is not None) + (b_id is not None) == 1`.
- **Methods**: `entity.methods.<verb>: {description, parameters?,
  returns?, use_case?}`. A parameter is a bare type string (required)
  or `{type, required?, default?, description?}` for optional/defaulted
  (ADR 061). `use_case: true` promotes the method to a generated use
  case + endpoint (ADR 039). An aggregate-construction factory is
  `static: true`, never named `create`, paired with
  `api.disabled: [create]` on the root (ADR 060). Method bodies are
  `entity_method` hand-offs — `/archascode:apply` fills them; the spec
  carries only signatures and intent.
- **API posture**: app-wide `api: {auth: {type: jwt, scheme: bearer}}`
  when the PRD requires authentication (posture cascades to every
  entity, ADR 033); per-entity override `entity.api.auth: required |
  anonymous`; per-op suppression `entity.api.disabled: [<op>, ...]`
  (bare CRUD op names + `rel-<relName>`; invalid names fail the render
  with the induced set, ADR 059). Posture is the contract; *adapter*
  selection (jwt_bearer key config, claims mapping) is a deployment
  concern that stays out of the first pass — note it in the report.
- **Custom use cases / ports** (when Step 3 justified one) — the
  fiddliest corner of the language; read the schema (see below) before
  drafting one. Port and use-case names are **PascalCase**
  (`^[A-Z][a-zA-Z0-9]*$`) — a snake_case key fails the render.
  - `application.ports.<PortName>: {description, methods, value_objects?,
    adapters?}`. A port **method** takes `{description, input?, output?,
    raises?}` — it is `output`, *not* `returns`; use `input: void` when
    the method takes nothing. Declare read shapes as port-scoped
    `value_objects.<Name>: {description, fields: {...}}` and name the VO
    in the method's `output`.
  - `application.use_cases.<UCName>: {description, input?, output?, uses,
    workflow?, http?, ...}`. Dependencies go in `uses.ports` as a list of
    **objects**, not bare strings: `[{port: <PortName>, mode: read |
    write | read_write}]`. Entity repositories go in `uses.repositories`
    as bare entity names.
  - **A memory adapter that reads entity data must declare its stores**:
    `ports.<PortName>.adapters.memory.reads: [<Entity>, ...]` (ADR 045).
    The engine injects one `MemoryStore[<Entity>State]` per listed entity
    via a generated base class. **Omit `reads` and the adapter is seeded
    with an empty constructor and no stores — literally unimplementable**,
    and `/archascode:apply` will stop with `NEEDS SPEC: ports.<Port>.adapters.
    memory.reads must include <Entity>`. List every entity the read
    touches.
  - Prefer typed port `value_objects` over an attribute of type `json`
    for structured reads. `json` renders as `dict[str, Any]`, which
    erases list-ness — a "recent activities" collection typed `json`
    forces the adapter to invent a dict-shaped wrapper for what is
    plainly a list.
  - Workflow bodies and adapter implementations become hand-offs for
    `/archascode:apply`.

**The schema is the contract; this summary is a convenience.** The
authoritative shape of every construct above lives in the engine's
`spec-schema.json`, bundled with the plugin — read it at:

```
${CLAUDE_PLUGIN_ROOT}/schema/spec-schema.json
```

Its `definitions` block is the ground truth (`ApplicationPort`,
`ApplicationPortMethod`, `ApplicationUseCase`, `UseCaseUses`,
`PortDependency`, `InlineDTO`, `AdapterDeclaration`, `Method`,
`Attribute`, …). **Read the relevant `definitions` entry before drafting
anything beyond a plain entity** — custom ports, use cases, adapters,
value objects. Render errors tell you what is *wrong*; only the schema
tells you what is *right*, and one read up front is cheaper than a
round-trip per mistake. If the schema and this summary disagree, the
schema wins and this file is stale.

Shape sketch (abbreviated — real drafts carry descriptions on every
node):

```yaml
schema_version: "1.0"
metadata:
  name: field-service-tracker
  version: "0.1.0"
  description: First-pass spec drafted from docs/prd.md by /archascode:analyze
api:
  auth: { type: jwt, scheme: bearer }
domain:
  enums:
    JobStatus: { values: [scheduled, in_progress, completed, cancelled] }
  value_objects:
    Money: { type: Decimal, validation: { precision: 12, scale: 2, min: 0 } }
  entities:
    Technician:
      attributes:
        id: { type: UUID }
        name: { type: str, faker: person.name }
        email: { type: str, required: false, faker: internet.email }
        created_at: { type: datetime, generated: true }
        updated_at: { type: datetime, generated: true }
      relationships:
        jobs: { entity: Job, cardinality: one-to-many }
    Job:
      attributes:
        id: { type: UUID }
        status: { type: JobStatus }
        quoted_price: { type: Money }
        scheduled_for: { type: date }
        created_at: { type: datetime, generated: true }
        updated_at: { type: datetime, generated: true }
      relationships:
        technician: { entity: Technician, cardinality: many-to-one, on_delete: restrict }
      invariants:
        price_non_negative: "quoted_price >= 0"
      methods:
        cancel:
          description: Cancel a scheduled job before work begins.
          use_case: true
      api:
        disabled: [delete]

# Only when the PRD explicitly names a cross-entity read (a dashboard,
# a report). Note the PascalCase names, `output` (not `returns`), the
# object-shaped `uses.ports`, and `adapters.memory.reads` — without
# `reads` the generated adapter has no stores to read from.
application:
  ports:
    ScheduleReader:
      description: Read-side port assembling the daily schedule view.
      adapters:
        memory:
          reads: [Job, Technician]
      value_objects:
        ScheduleView:
          description: The assembled schedule summary.
          fields:
            open_job_count: { type: int }
            total_quoted_value: { type: Money }
      methods:
        load:
          description: Return today's open jobs and their quoted total.
          input: void
          output: ScheduleView
  use_cases:
    GetSchedule:
      description: Load the daily schedule summary.
      input: void
      output: ScheduleView
      uses:
        ports:
          - port: ScheduleReader
            mode: read
      workflow:
        - Call ScheduleReader.load() and return the assembled ScheduleView.
      http: { method: GET, path: /schedule }
```

### Step 5 — validate via scratch render, iterate to green

```bash
SCRATCH="$(mktemp -d)"
archascode render spec/architecture.yml --out "$SCRATCH" --json
```

- **`ok: false`** → read `errors`, fix the spec, re-render. The errors
  are the authoritative teacher — when they name unknown keys or an
  induced op set, trust them over the Step 4 summary. Cap at **5**
  iterations; if still red, stop, leave the draft in place, and print
  the remaining errors verbatim for the user.
- **`ok: true`** → done. Remove the scratch directory:

```bash
rm -rf "$SCRATCH"
```

- **Connection failure** → the cloud service isn't reachable. Stop and
  report it, same posture as `/archascode:apply`. Exit **2** with no JSON on
  stdout means not logged in, not a render failure. Report `not logged
  in — run archascode login` and stop.

A successful validation may report pending hand-offs (seeded method
bodies, custom-port adapters). That's healthy — it's exactly what
`/archascode:apply` consumes next; mention the count in the summary.

**Before deleting the scratch directory, check every memory custom-port
adapter for injected stores.** A render goes green whether or not a port
declared `adapters.memory.reads`, but omitting it emits a base class with
an empty constructor — an adapter with nothing to read, which only fails
later, mid-`/archascode:apply`, after overlays have been seeded against it. The
scratch tree already holds the answer:

```bash
for base in "$SCRATCH"/src/adapter/*/memory/_base.py; do
  [ -e "$base" ] || continue
  grep -q "def __init__(self) -> None:" "$base" \
    && echo "NO STORES: $base — add adapters.memory.reads to this port"
done
```

Any hit means the spec is under-declared: add the entities the read
touches to `ports.<Port>.adapters.memory.reads` and re-render. Fixing it
here costs one iteration; finding it in `/archascode:apply` costs a stale
overlay tree.

### Step 6 — write the coverage report

Write `spec/analysis.md`:

```markdown
# <Project> — PRD → architecture.yml coverage
Source: <prd-path> · Drafted: <date> · By: /archascode:analyze

## Requirement map
| PRD requirement | Disposition | Where / why |
|---|---|---|
| <section/req> | mapped | `domain.entities.X`, `JobStatus` enum |
| <section/req> | assumption | <the approximation and its rationale> |
| <section/req> | gap | <why the spec can't express it; suggested home> |

## Assumptions
- <every non-obvious modeling choice, --context text verbatim, clarifying answers>

## Gaps (not expressible in architecture.yml)
- <requirement> — <suggested home: hand-off body, future custom UC, app code, ops>

## PRD open questions (carried forward)
- <verbatim from the PRD, plus any the analysis surfaced>

## Next steps
/archascode:init → /archascode:apply (N pending hand-offs) → /archascode:seed → aac.py up
Persistence: memory (by omission) — run /archascode:wire persistence when ready for a real database.
```

Every PRD functional requirement appears in the map exactly once —
the table is the completeness check on the analysis itself.

### Step 7 — summarize

```
✓ spec/architecture.yml — E entities, R relationships, N enums, V value objects, M methods (validated in K render pass(es))
✓ spec/analysis.md — X requirements mapped, Y assumptions, Z gaps (A load-bearing forks resolved by default — see Assumptions)
Next: /archascode:init, then /archascode:apply (P hand-offs pending)
Persistence: memory (by omission) — /archascode:wire persistence when ready
```

Omit the parenthetical fork count when `--interactive` was set (forks
were asked, not defaulted).

## What this skill does NOT do

- **Render into the project tree.** All validation renders target a
  scratch `--out` directory, deleted afterward. The next real render
  belongs to `/archascode:apply`.
- **Run `/archascode:init` or `/archascode:apply`.** Explicit invocation only —
  family rule.
- **Draft `adapters` / `port_bindings` / `environments`.** The first
  pass is memory-bound by omission; persistence and deployment choices
  belong to `/archascode:wire persistence`, invoked when the user is ready.
- **Select an auth adapter.** The spec carries auth *posture*;
  jwt_bearer selection, key config, and claims mapping are recorded in
  the report as next steps.
- **Critique an existing spec.** The no-arg "analyze the current
  architecture.yml" mode is a future version; today an existing spec
  triggers the overwrite prompt.
- **Modify the PRD.** Read-only input, always.
- **Silently approximate.** Every approximation and every unexpressible
  requirement is in the report; the spec never quietly narrows the PRD.

## Failure modes (v1)

| Symptom                                             | Behavior                                                                     |
| ---------------------------------------------------- | ---------------------------------------------------------------------------- |
| No argument given                                    | Print "critique mode not implemented — pass a PRD path"; stop.               |
| PRD path missing / unreadable                        | Print the path; stop.                                                        |
| `spec/architecture.yml` already exists               | Prompt: overwrite / write `.proposed.yml` / cancel. Cancel when non-interactive. |
| `archascode` CLI not on PATH                         | Print install pointer (re-enable/reinstall the plugin per INSTALL.md); stop. |
| Cloud service unreachable                            | Print the URL precondition; stop. Same posture as `/archascode:apply`.               |
| Render still `ok: false` after 5 iterations          | Stop; leave the draft; print remaining errors verbatim.                       |
| PRD yields no identifiable entities                  | Stop and say so; a fabricated domain is worse than no draft.                  |

No retries beyond the bounded validation loop. The user re-invokes
after adjusting the PRD, the `--context` steer, or the draft by hand.

The "cancel when non-interactive" row above is about session
capability (can the skill show a prompt at all), independent of
`--interactive` — an existing-spec collision always stops and asks
when a prompt is possible, flag or no flag; `--interactive` only gates
the load-bearing modeling forks in Step 2.

## Notes for future versions

- **No-arg critique mode** — analyze the *current* `architecture.yml`
  for flaws and concerns (normalization, missing invariants, auth
  holes). Reserved as the no-argument invocation; the reason v1 errors
  on a missing arg instead of guessing.
- **`--update` mode** — re-analyze an evolved PRD against an existing
  spec and emit a diff proposal instead of a fresh draft.
- **Multi-document input** — a PRD plus supplementary docs (API notes,
  data dictionary) as additional positional args.
- **`archascode validate` verb** — if the scratch render ever proves
  too slow or heavy as a validation gate, a validate-only CLI verb is
  the clean fix; that's new product surface and gets its own ADR.
