---
name: analyze
description: Draft a first-pass spec/architecture.yml from a PRD document, add to or change an existing spec/architecture.yml, or answer "how would I model X in architecture.yml?" — entities, relationships, enums, value objects, invariants, methods, and API posture, validated against the real engine via archascode validate.
---

# /archascode:analyze

Turn a PRD into a first-pass `spec/architecture.yml`, extend or edit an
existing one, or answer a modeling question — this is the front door of
the pipeline for spec authoring across the whole life of a project, not
just its start:

```
/archascode:analyze <prd.md>  →  spec/architecture.yml + spec/analysis.md
/archascode:init              →  pyproject.toml + .venv matching the spec
/archascode:apply             →  render + hand-off dispatch
/archascode:seed → API Explorer
```

In PRD mode the skill produces **two artifacts of equal standing**: the
spec, and a coverage report (`spec/analysis.md`) that gives every PRD
requirement exactly one disposition — mapped, assumption, deferred, or
out of scope. A PRD always carries requirements the spec language can't
express (RBAC matrices, audit trails, NFRs, import UX) and others whose
behavior lands in a hand-off body rather than a spec node; the report is
what keeps the first pass honest about which is which.

Validation is authoritative and side-effect-free: every mutating mode
ends with `archascode validate`, which runs the full engine surface
(jsonschema + Pydantic shape checks *and* planning-level checks like
ADR-068 invariant resolution) against a throwaway directory the skill
never names — strictly stronger than a schema lint, and nothing lands in
the project tree but the spec (and, in PRD mode, the report). `validate`
is a network call to the archascode cloud service, not a local lint —
same auth precondition as every other verb below (`archascode login`).

## Mode dispatch

Decide the mode **before** doing anything else — this determines which
part of the procedure below even applies:

| Invocation | Mode |
|---|---|
| Bare `/archascode:analyze`, no argument, no accompanying prose | Reserved critique stub — the existing hard-stop message (see Arguments) |
| Any invocation carrying a natural-language modeling request (typed by the user, or supplied by the router on auto-invoke) | Question mode or incremental mode, per whether it asks or instructs |
| A path argument | PRD mode (unchanged) |

**The dispatch key is the presence of a natural-language request, not the
presence of a positional argument.** This matters because the reserved
no-arg slot and a router auto-invoke both arrive with no `$1` — from
inside the skill body alone they look identical. What distinguishes them
is whether there is a modeling question or instruction to act on: none
means the reserved stub; some means question or incremental mode.

- **Question mode** — the user asks how to model something ("how would I
  represent a many-to-many with extra fields?", "what's the invariant
  syntax?"). Answer using the Authoring reference below. **Write
  nothing unless asked** — this mode is read-only by default.
- **Incremental mode** — the user instructs a change to the existing spec
  ("add a `cancel` method to Order", "add an invariant that quantity is
  positive", "make email optional on Contact"). Edit
  `spec/architecture.yml` **in place**, then validate. See Incremental
  mode below for the mechanism.
- **PRD mode** — a path argument names a PRD document. Draft a fresh
  `spec/architecture.yml` + `spec/analysis.md`. This is the original,
  unchanged procedure — see Preconditions onward.

### Question mode

Answer from the Authoring reference (and the schema/examples it points
at) directly in conversation. Do not create, edit, or validate any file
unless the user's own request asks for a change — a question is a
question, not an implicit edit instruction.

### Incremental mode

An existing `spec/architecture.yml` is a hand-owned artifact — it carries
comments, key ordering, and structure that a naive YAML load-and-dump
would silently destroy. Edit it **in place using the same
comment-preserving `ruamel.yaml` round-trip** `/archascode:init` already
uses for its `environments:` scaffold — see
`init/SKILL.md:114-140` for the exact `uv run --no-project --with
'ruamel.yaml' python - <<'PY'` heredoc shape. Do not re-derive the
mechanism; reuse it: read the spec once via `ruamel.yaml`'s round-trip
loader, apply the requested change to the loaded object (add/edit the
relevant node under `domain`, `application`, etc. — see the Authoring
reference for shapes), and dump it back with the same `YAML()` instance
so comments and ordering survive.

**Every mutating mode ends in a validation run:**

```bash
archascode validate spec/architecture.yml --json
```

- `{"ok": true}` → report what changed, in one line per change.
- `{"ok": false, "errors": [...]}` → read `errors`, fix the spec, re-run.
  Cap at **5** iterations; if still red, stop, leave the edit in place,
  and print the remaining errors verbatim.
- Exit **2** → the command could not be attempted — either
  `spec/architecture.yml` is missing, or the user is not logged in. Read
  the stderr message rather than assuming which; report it and stop
  (`archascode login` if it's the latter).

## Authoring reference

The engine validates all of this; `archascode validate` (below) catches
anything this summary gets wrong.

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
  — see `01-minimal-crud` in `${CLAUDE_PLUGIN_ROOT}/examples/` for the
  smallest complete instance of this shape.
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

**Worked examples ship with the plugin** at
`${CLAUDE_PLUGIN_ROOT}/examples/` — six real specs, the engine's own
CI-verified fixtures (not hand-written prose), one per construct family:

- `01-minimal-crud` — smallest complete spec.
- `02-rental-booking` — realistic mid-size: relationships, invariants,
  a value object, a mutating `use_case` method.
- `03-value-objects-enums` — simple/composite value objects, enums.
- `04-entity-methods` — method shapes, `use_case` promotion.
- `05-invariants-derived` — derived attributes, `None` propagation.
- `06-custom-use-cases` — custom ports, use cases, `memory.reads`.

Read the one closest to what's being drafted before writing from
scratch — a worked example answers shape questions faster than the
schema's `definitions` block alone, and both agree because the examples
are the same fixtures the engine tests every run.

Shape sketch (abbreviated — real drafts carry descriptions on every
node; see `${CLAUDE_PLUGIN_ROOT}/examples/` for full worked specs):

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

## PRD mode

Turn a PRD into a first-pass `spec/architecture.yml`. This is the
"create spec/architecture.yml by hand" hole between greenfield and
`/archascode:init`.

### Arguments

- `<prd-path>` — required positional. Path to the PRD (markdown or
  plain text). Invoking with no argument, and no accompanying modeling
  request, stops with:
  `analyze-current-spec (no-arg) mode is not implemented yet — pass a PRD path, or describe what you want to model or change.`
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

### Preconditions

- The PRD file exists and is readable text.
- `cwd` is the consuming project root (the directory where `spec/`
  belongs).
- The `archascode` CLI is on the Bash PATH — the plugin's `bin/` provides
  it. If `command -v archascode` fails, the plugin install is broken:
  re-enable/reinstall per INSTALL.md and check the wrapper's executable
  bit (`chmod +x <kit>/marketplace/plugins/archascode/bin/archascode`).
- The user is logged in (`archascode login`).
- `.venv` / `pyproject.toml` are **not** required. Analyze precedes
  `/archascode:init`; validation needs neither.

If `spec/architecture.yml` already exists, **stop and ask** before
touching it. Offer: overwrite, write the draft to
`spec/architecture.proposed.yml` instead, or cancel. Default to cancel
in non-interactive contexts. An existing spec usually means the user
wants incremental mode (above) or the future critique mode, not a fresh
draft.

If any other precondition fails, stop with a one-line message naming
what's missing — report it, don't try to install or start services.

### What it produces

```
spec/
├── architecture.yml   # first-pass spec, validated by archascode validate
└── analysis.md        # coverage report: requirement map, assumptions, deferred
```

Nothing else. No `src/`, no manifest, no lockfile — `archascode
validate` writes into a temp directory that does not survive the call.

### Procedure

#### Step 1 — verify preconditions and read the PRD

```bash
test -f "$PRD_PATH" || { echo "PRD not found: $PRD_PATH"; exit 1; }
command -v archascode >/dev/null 2>&1 || { echo "archascode CLI not on PATH — the plugin install is broken; re-enable/reinstall per INSTALL.md"; exit 1; }
test -f spec/architecture.yml && echo "spec/architecture.yml exists — ask before proceeding"
```

Read the PRD in full. Note its explicit open-questions section if it
has one — those flow into the report verbatim.

#### Step 2 — clarifying forks (load-bearing only)

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

#### Step 3 — extract the domain model

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

**Route to the report:** authentication *mechanics* (sessions, password
reset), role-based permission matrices, audit history, soft-delete
semantics, import/export UX, dashboards beyond a data read, NFRs,
browser/deployment requirements. Sort these as you go — `deferred` when
something downstream resolves it (a hand-off body, adapter config,
`/archascode:wire`), `out of scope` when the PRD itself declared it a
non-goal. Defensible approximations are allowed — e.g. a polymorphic
"linked to X or Y or Z" becomes N optional `many-to-one` relationships —
but every approximation is recorded as an `assumption`.

If the PRD yields no identifiable entities, stop and say so rather
than fabricating a domain.

#### Step 4 — draft `spec/architecture.yml`

Draft the spec using the Authoring reference above — it applies
unchanged to PRD mode; nothing here repeats it.

#### Step 5 — validate, iterate to green

```bash
archascode validate spec/architecture.yml --json
```

- **`ok: false`** → read `errors`, fix the spec, re-validate. The
  errors are the authoritative teacher — when they name unknown keys or
  an induced op set, trust them over the Authoring reference summary.
  Cap at **5** iterations; if still red, stop, leave the draft in
  place, and print the remaining errors verbatim for the user.
- **`ok: true`** → done. Nothing to clean up — `archascode validate`
  writes into a temp directory that does not survive the call.
- **Exit `2`, no JSON on stdout** → the command could not be attempted
  — either `spec/architecture.yml` is missing, or the user is not
  logged in. Read the stderr message rather than assuming which. If
  it's the latter, report `not logged in — run archascode login` and
  stop.

A successful validation may report pending hand-offs (seeded method
bodies, custom-port adapters). That's healthy — it's exactly what
`/archascode:apply` consumes next; mention the count in the summary.

**`archascode validate` cannot see injected-store gaps in memory
adapters** — it runs against a spec-only temp tree, so there is nothing
in this skill's control to inspect for that after the fact (unlike the
former scratch-render loop, which held the rendered tree open). Guard
against the gap at the source instead: every port's
`adapters.memory.reads` list (Authoring reference, Custom use cases /
ports) must name every entity its methods read. Omitting it produces
`NEEDS SPEC: ports.<Port>.adapters.memory.reads must include <Entity>`
later, mid-`/archascode:apply`, after overlays have been seeded against
it — catching it here costs nothing; finding it there costs a stale
overlay tree.

#### Step 6 — write the coverage report

Write `spec/analysis.md`:

```markdown
# <Project> — PRD → architecture.yml coverage
Source: <prd-path> · Drafted: <date> · By: /archascode:analyze

## Requirement map
| PRD requirement | Disposition | Where / why |
|---|---|---|
| <section/req> | mapped | `domain.entities.X`, `JobStatus` enum |
| <section/req> | assumption | <the approximation, in one clause> |
| <section/req> | deferred | <what resolves it> |
| <section/req> | out of scope | <the PRD's own non-goal / scope note> |

## Assumptions made (re-run analyze with --interactive to explore other options on any)
- **<the choice>** — <one line of why>

## Deferred
| Requirement | Resolved by |
|---|---|
| <requirement> | <hand-off body, adapter config, `/archascode:wire`, app code> |

## PRD open questions (carried forward)
| # | Question | This draft |
|---|---|---|
| 1 | <verbatim from the PRD> | <the default applied, and its cost> |

## Next steps
/archascode:init → /archascode:apply (N pending hand-offs) → /archascode:seed → API Explorer
Persistence: memory (by omission) — run /archascode:wire persistence when ready for a real database.
```

**Disposition is one of exactly four values**, each pointing at one
downstream section:

- `mapped` — expressed as a spec construct. Cite it; no prose.
- `assumption` — mapped via an approximation the PRD didn't dictate.
  Gets an Assumptions bullet.
- `deferred` — the intent is in the spec, the behavior lands elsewhere
  (a hand-off body, adapter config, wiring). Gets a Deferred row.
- `out of scope` — the PRD declared it a non-goal or out of scope. Cite
  the section; nothing further is owed.

Every PRD functional requirement appears in the map exactly once — the
table is the completeness check on the analysis itself.

**Write each fact once.** The map is the index; the three sections below
it add only what a table cell can't hold. Specifically:

- A `deferred` row's destination lives in the Deferred table, not also
  in Assumptions.
- Anything traceable to a PRD open question lives **only** in the open-
  questions table — Assumptions doesn't restate the same resolution.
- `out of scope` rows get **no** Deferred entry. A non-goal is not
  something the spec failed to express; listing it as unfinished
  business misreports the PRD.
- Assumptions bullets state the choice and, where it isn't obvious, what
  it means in practice. They do **not** justify it. When a rationale
  feels necessary, it belongs in the open-questions table's "This draft"
  cell, where the consequence is load-bearing.

The report is a decision record, not a narrative. Prefer a table row to
a paragraph, a citation to an explanation, and one clause to three.

**Every citation is read back from the drafted spec, never recalled from
intent.** The report is written after Step 5, so the spec on disk — not
your memory of what you meant to write — is the source for every route
path, key name, enum value, attribute name, default, and hand-off target
the report mentions. Before writing a row that names one, confirm it:

```bash
grep -nE '^\s{6}[a-z_]+:' spec/architecture.yml         # attribute / key names
```

Route paths are the one thing the spec alone does not settle — a
declared `http.path` is a suffix under a router prefix (see below), and
confirming the resolved prefix now requires a real render (`archascode
validate` writes into a temp tree that doesn't survive the call, so it
can't be inspected after the fact) — cite `group` + `http.path` per the
rule below instead of grepping rendered output.

A wrong citation is worse than a vague one — the reader trusts the report
as a map of the spec. Never state a path the spec doesn't contain, and
never build an Assumptions bullet on a detail you have not just verified.
When the drafted spec and your intent disagree, the spec is what shipped:
report it, or go fix the spec and re-validate.

**A custom use case's route is its group prefix + its `http.path`, not
the bare `path`.** Per ADR 041, `application.use_cases.<UC>.group` picks
the router: a declared entity name mounts the route under that entity's
resource path, and an absent or `Application` group mounts it under the
reserved `/application` prefix. So `group` unset with `http: {method:
GET, path: /dashboard}` serves `GET /application/dashboard` — the prefix
is real, not an artifact. Cite the resolved path by combining `group` and
`http.path` per that rule (there is no scratch tree to grep for the
final router prefix in this mode).

Set `group: <Entity>` when a route belongs under an entity; leave it
unset for a standalone application-level read.

**Write for the product reader, not the engine implementer.** The
audience is whoever owns the PRD — they need to know what the spec
decided and what it costs them, not how the engine works. Concretely:

- **State the consequence, not the mechanism.** "Deleting a company that
  has activities will be refused" — not the cascade-path rule, the
  vendor error number, or the topology that forced it.
- **No rendered code, no emitted SQL, no engine internals** in the report
  body. If a limitation was found by reading generated output, report the
  observable behavior ("the API currently accepts an activity linked to
  nothing, or to two things at once") and skip the derivation.
- **No methodology.** What was probed, which expression forms were tried,
  and how many validation passes it took are session detail, not
  findings. The summary line in Step 7 carries the pass count; the
  report doesn't.
- **Skip the tuning arithmetic.** Cite a chosen value plainly
  (`Money`: 2 decimal places, max ~12 digits) without deriving the
  ceiling or defending the convention.
- Spec keys, entity names, enum values, and hand-off kinds are fine —
  they're the shared vocabulary. It's the *engine's* implementation
  details that stay out.

No section opens with a status preamble — no validation-pass counts, no
flag-state recap, no "persistence is memory by omission" (Next steps
already says it). The title block is the source line and nothing more.

**State assumptions flatly; assign no blame.** An assumption is a
decision the reader may want to change, so it needs to be legible — not
defended, and not attributed to a shortcoming in the spec language, the
engine, or the PRD. In particular, never explain a modeling choice by
what the language *lacks*: "the spec has no subtyping mechanism", "there
is no single-target-of-three reference", "the language can't express
this". Such phrasing reads as the tool excusing itself, and it goes stale
the moment the language gains the feature.

Say what was done, and where it isn't self-evident, what it means in
practice:

- ✗ "Task-only fields live on every activity. The spec has no subtyping
  mechanism, and dropping them would lose FR-6."
- ✓ "Task-only fields live on every activity — due date and completion
  flag are optional on all five types, so a Note may carry a due date."

- ✗ "Modeled as three independent optional references. The spec language
  has no single-target-of-three reference, so exclusivity becomes a
  separate constraint rather than part of the shape."
- ✓ "An activity's subject is three optional references, one per target
  type. Exactly-one is a separate constraint — see Deferred."

The same restraint applies to the open-questions table and the Deferred
table: give the reader the decision and its cost, not the constraint
that produced it. A `Resolved by` cell names a destination; it does not
argue.

#### Step 7 — summarize

```
✓ spec/architecture.yml — E entities, R relationships, N enums, V value objects, M methods (validated in K pass(es))
✓ spec/analysis.md — X requirements: M mapped, Y assumptions, Z deferred, S out of scope (A load-bearing forks resolved by default — see Assumptions)
Next: /archascode:init, then /archascode:apply (P hand-offs pending)
Persistence: memory (by omission) — /archascode:wire persistence when ready
```

Omit the parenthetical fork count when `--interactive` was set (forks
were asked, not defaulted).

## What this skill does NOT do

- **Write to the project tree except the spec (and, in PRD mode, the
  report).** `archascode validate` writes into a temp directory that is
  gone before the call returns. The next real render belongs to
  `/archascode:apply`.
- **Run `/archascode:init` or `/archascode:apply`.** Explicit invocation only —
  family rule.
- **Draft `adapters` / `port_bindings` / `environments`.** The first
  pass is memory-bound by omission; persistence and deployment choices
  belong to `/archascode:wire persistence`, invoked when the user is ready.
- **Select an auth adapter.** The spec carries auth *posture*;
  jwt_bearer selection, key config, and claims mapping are recorded in
  the report as next steps.
- **Critique an existing spec unprompted.** The no-arg "analyze the
  current architecture.yml for flaws" mode is a future version — a bare
  invocation with no argument and no modeling request stops rather than
  guessing; a *targeted* change or question about the existing spec is
  incremental or question mode (above), not this.
- **Modify the PRD.** Read-only input, always.
- **Silently approximate.** Every approximation and every deferred
  requirement is in the report; the spec never quietly narrows the PRD.

## Failure modes

| Symptom                                             | Behavior                                                                     |
| ---------------------------------------------------- | ---------------------------------------------------------------------------- |
| No argument and no modeling request                  | Print "critique mode not implemented — pass a PRD path, or describe what you want to model or change"; stop. |
| PRD path missing / unreadable (PRD mode)              | Print the path; stop.                                                        |
| `spec/architecture.yml` already exists (PRD mode)     | Prompt: overwrite / write `.proposed.yml` / cancel. Cancel when non-interactive. |
| `archascode` CLI not on PATH                         | Print install pointer (re-enable/reinstall the plugin per INSTALL.md); stop. |
| `archascode validate` exits 2                        | Missing spec file or not logged in — read the stderr message, report it, stop. Same posture as `/archascode:apply`. |
| Validation still `ok: false` after 5 iterations       | Stop; leave the draft/edit in place; print remaining errors verbatim.        |
| PRD yields no identifiable entities (PRD mode)        | Stop and say so; a fabricated domain is worse than no draft.                 |

No retries beyond the bounded validation loop. The user re-invokes
after adjusting the PRD, the `--context` steer, the instruction, or the
draft by hand.

The "cancel when non-interactive" row above is about session
capability (can the skill show a prompt at all), independent of
`--interactive` — an existing-spec collision in PRD mode always stops
and asks when a prompt is possible, flag or no flag; `--interactive`
only gates the load-bearing modeling forks in Step 2.

## Notes for future versions

- **No-arg critique mode** — analyze the *current* `architecture.yml`
  for flaws and concerns (normalization, missing invariants, auth
  holes). Reserved as the no-argument, no-request invocation; the
  reason it still errors instead of guessing.
- **`--update` mode** — re-analyze an evolved PRD against an existing
  spec and emit a diff proposal instead of a fresh draft.
- **Multi-document input** — a PRD plus supplementary docs (API notes,
  data dictionary) as additional positional args.
- **`archascode validate` verb** — this now exists (ADR 082) and is
  what every mutating mode above runs.
