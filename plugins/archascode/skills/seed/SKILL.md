---
name: seed
description: Generate plausible example records for every entity in an archascode-rendered project and write them as loadable seed data. Use after `archascode render` when the user wants the running app pre-populated with realistic data instead of an empty database.
---

# /archascode:seed

Auto-populate an archascode consuming project with example records by
generating seed data that the app's boot-time autoload can
ingest (ADR 012, ADR 094, renamed to `seeds/` by ADR 105). The LLM reads
the spec + the rendered `State` dataclasses and produces one JSON file
per entity under `seeds/`, respecting relationships, enums, value
objects, and declared invariants.

The skill writes JSON files on disk — it does **not** require the app
to be running. If the app is up, the next restart picks them up.

The skill *does* import the rendered codec (`src.adapter.persistence._codec`)
to compute the per-entity fingerprints that ADR 015 requires in the
manifest. That means the consuming project's `.venv` must exist and have
the project installed — `/archascode:init` is the prerequisite. Reusing the live
codec instead of reimplementing the hash here keeps drift detection and
seeding in lockstep: when the fingerprint algorithm changes, the seed
output changes with it, no skill edit required.

## Arguments

- `--theme <text>` — optional. A short domain hint passed verbatim to
  the LLM, e.g. `"B2B dental SaaS"` or `"used-car dealership in
  Portland"`. Default: let the LLM infer a theme from entity and field
  names.
- `--count <n>` — optional. Records per entity. Default: `4` (the
  middle of the 3–5 sweet spot). Clamped to `[1, 50]`. Child entities
  on the "many" side of a one-to-many may end up with more records
  than `n` so each parent gets a few children — that's intentional.

Invocation forms:

```
/archascode:seed
/archascode:seed --theme "indie coffee roaster"
/archascode:seed --count 10
/archascode:seed --theme "telehealth clinic" --count 6
```

## Preconditions

- `cwd` is a rendered consuming project: it has
  `.archascode/manifest.json` and a populated `src/domain/entities/`.
  If `src/domain/entities/` is missing, stop and point the user at
  `archascode render` / `/archascode:apply`. Do not try to render here.
- `spec/architecture.yml` is present and parses.
- `src/adapter/persistence/_codec.py` is present — its existence is
  the contract that seed data is loadable for this render. The
  module must export `compute_entity_fingerprint` (ADR 015); if
  importing it fails, the project was rendered by an older engine
  and the user must re-render before seeding.
- `.venv/` exists and `src.adapter.persistence._codec` is importable
  from it. The skill computes fingerprints by calling into the
  rendered codec, so the venv is load-bearing. If the venv is
  missing or the import fails, stop and point the user at
  `/archascode:init`.

If any precondition fails, stop with a clear one-line message naming
the missing file. Do not try to remediate.

## What it produces

```
seeds/
├── manifest.json          # schemaTimestamp, entityFingerprints, portBinding,
│                          # createdAt, loadOrder
└── <entity_snake>.json    # JSON array of State records, one file per entity
```

The shape matches exactly what the rendered project's `dump_all`
writes, using these encoding rules (UUID → str, datetime → isoformat, Decimal →
str, Enum → `.value`, composite VO → dict-of-fields).
`entityFingerprints` is required by ADR 015's load gate; the skill
computes the values by importing the rendered codec rather than
re-implementing the hash. A manifest without the field will be
rejected at load time.

If `seeds/` does not yet exist but a legacy `snapshots/manifest.json`
is present on disk (a pre-ADR-105 project), offer to migrate before
generating anything: **migrate** (`git mv snapshots seeds`, or plain
`mv snapshots seeds` if `snapshots/` is untracked) to keep the existing
seed data under its new name, or **regenerate fresh** into `seeds/`
(leaving `snapshots/` on disk untouched). Do not pick silently — ask.

If `seeds/` already exists, **stop and ask** before overwriting —
the user may have hand-curated data there. Offer: overwrite, merge
(skip entities that already have a file), or cancel. Do not silently
clobber.

## Procedure

### Step 1 — verify preconditions and load the spec

```bash
test -f spec/architecture.yml || { echo "spec/architecture.yml not found"; exit 1; }
test -d src/domain/entities    || { echo "src/domain/entities not found — run /archascode:apply first"; exit 1; }
test -f src/adapter/persistence/_codec.py || { echo "seed codec not rendered — re-run /archascode:apply"; exit 1; }
test -f .archascode/manifest.json || { echo ".archascode/manifest.json missing — re-run /archascode:apply"; exit 1; }
test -d .venv                  || { echo ".venv missing — run /archascode:init"; exit 1; }
uv run python -c "from src.adapter.persistence._codec import compute_entity_fingerprint" \
  || { echo "rendered codec missing compute_entity_fingerprint (ADR 015) — re-render with current engine"; exit 1; }
```

Read `spec/architecture.yml` with PyYAML via a uv-provisioned
interpreter — `uv run --no-project --with pyyaml python -` — which
supplies the library from an ephemeral cached environment (PyYAML is
skill tooling, not a project dep, so it lives in neither system python
nor `.venv`). Extract:

- `domain.entities.<E>` for every entity — keep `attributes`,
  `relationships`, `invariants`, and `methods.<m>.description` (the
  intent text is sometimes the only hint about meaningful values).
- `domain.value_objects.<V>` — note `kind` (simple / values /
  composite). For `values` VOs the closed set goes into the prompt as
  an enum-style constraint. For `simple` VOs treat the `type` as the
  field type. For `composite`, list the inner attribute names so the
  LLM emits the right dict shape (codec round-trips composites as
  dicts in v1).
- `domain.enums.<E>.values` — closed set; the codec decodes by calling
  the enum class on the string.

### Step 2 — read the rendered State dataclasses

The spec is the *intent*; the State class is the *shape*. Generation
adds `id`, `created_at`, `updated_at`, and FK columns derived from
relationships, none of which appear verbatim in the spec.

For each entity, parse `src/domain/entities/<snake>.py` and locate
`@dataclass(frozen=True) class <E>State`. Capture the field list and
each field's annotation string — this is the JSON key set the seed data
must use, and the annotation drives codec decoding on load.

Don't try to be clever: a simple AST walk over the file or a regex
over the `class <E>State:` block is fine. If parsing fails for any
entity, stop with a message naming the file — better to fail loud than
emit bad seed data the loader will choke on.

### Step 3 — compute load order

Seeds must load parents before children (FK constraints). Build a
DAG from `relationships`:

- A `many-to-one` from `Order` → `Customer` means `Customer` is a
  parent of `Order` (orders carry `customer_id`; customers must exist
  first).
- A `one-to-many` is the inverse view of the same edge; don't
  double-count.
- `one-to-one` and `many-to-many` should be rare in v1; treat the
  declared `entity` as the parent for ordering purposes.

Topologically sort entities. If there's a cycle, stop and report it —
seeding a cycle requires deferred FK updates that v1 doesn't do.

The resulting order is also what goes into `manifest.json`'s
`loadOrder` field.

### Step 4 — generate records, one entity at a time, in load order

For each entity in order, prompt the LLM with everything needed to
emit a JSON array of `<E>State` records. Keep prompts per-entity (not
one giant prompt for the whole spec) so each call stays focused and so
parent UUIDs from prior steps can be passed in concretely.

The per-entity prompt should include:

1. **Theme** — the user's `--theme` arg verbatim, or a one-liner like
   "infer a coherent theme from entity and field names." Once a theme
   is established by the first entity's generation, carry it forward
   in subsequent prompts so the records hang together (e.g. customers
   and their orders share a vibe).
2. **Target count** — `--count` (default 4). For child entities on the
   "many" side, target `count` per parent, capped at `count * 3`
   total, so each parent gets a couple of children without exploding.
3. **State field list** — name + annotation for every field in
   `<E>State`. This is the authoritative schema.
4. **Spec context for each field** — pulled from `attributes.<name>`:
   `type`, `required`, `enum`, `pattern`, `description`, `examples`,
   and `faker`. The `faker` value (string or dict) is passed through
   as a *hint* — the LLM doesn't run Faker, it just uses the hint to
   pick a plausible shape. Example: `faker: company` → "make this look
   like a company name."
5. **Value object / enum constraints** — for each field whose type is
   a VO or enum:
   - `values` VO / enum → "pick from this closed set: [...]".
   - `simple` VO → "this is a `<base_type>` semantically; values
     should look like a `<vo_name>`" (e.g. `Money` → decimal money).
   - `composite` VO → "emit a dict with these keys: [...]; the codec
     stores composites as dicts in v1."
6. **Invariants** — paste every entry from `entity.invariants` as
   plain text into the prompt. Tell the LLM: "Every generated record
   must satisfy these. If you cannot, omit the record rather than
   produce an invalid one."
7. **Auto-generated fields** — for `id` (UUID), generate fresh UUIDs
   in the skill itself (use `uuid.uuid4()`), don't ask the LLM. For
   `created_at` / `updated_at`, set them in the skill to a recent
   timestamp (e.g. spread across the last 30 days, with `updated_at
   >= created_at`). The LLM is good at narrative, bad at uniqueness
   and clock arithmetic — keep those out of its hands.
8. **Foreign keys** — for each FK field (e.g. `customer_id` on
   `Order`), pass the LLM the list of already-generated parent UUIDs
   along with one or two distinguishing attributes per parent (e.g.
   `customer_id=<uuid> (name="Acme Corp")`) so it can pick FKs that
   make narrative sense, not just random ones. Tell it: "Distribute
   children across parents — don't dump all orders on one customer."

The LLM's job is **only** to produce the non-derived fields (names,
descriptions, amounts, enum picks, FK selections). Wrap its output:
the skill adds `id`, timestamps, and any field whose value is
deterministic from the spec.

Output format from the LLM: a JSON array. Validate before writing:

- All required fields present.
- Enum / values-VO fields land in the declared set.
- Decimal-typed fields parse as `Decimal`.
- UUID-typed fields parse as UUID.
- FK fields reference a UUID already in scope.

On validation failure for any record, drop that record (log a one-line
note: `dropped 1 Order record: customer_id not in scope`) and
continue. Don't retry — if more than half the records for an entity
fail validation, stop the skill and surface the prompt + the
offending output for the user to inspect.

### Step 5 — write the seed files

For each entity, write `seeds/<snake>.json` as a JSON array,
using the same encoding the codec uses on dump:

- UUID → string
- datetime / date → isoformat string
- Decimal → string
- Enum value → `.value` (already a string, since the LLM picked from
  the closed set)
- composite VO → dict with the inner fields

Then write `seeds/manifest.json` with:

```json
{
  "schemaTimestamp": "<computed via the rendered codec's _compute_schema_identifier(project_root) — see the fingerprint pattern below; '' when no cut migrations exist>",
  "entityFingerprints": {
    "<Entity>": "<16-char hex from compute_entity_fingerprint(<E>State)>",
    ...
  },
  "portBinding": "<the active port binding — read from spec environments[default_environment].port_binding, or 'memory' if not declared>",
  "createdAt": "<datetime.now().isoformat()>",
  "loadOrder": ["<entity1>", "<entity2>", ...]
}
```

`schemaTimestamp` matters for a SQL binding (sqlserver or postgres) —
the codec's `verify_schema` will refuse to load seed data whose
identifier doesn't match the current schema. Despite the name it is no
longer a manifest timestamp (that manifest section was removed by ADR
087): it is `sha256[:16]` of the project's sorted cut-migration
filename set, computed by the rendered codec's
`_compute_schema_identifier(project_root)` (union-glob over
`src/adapter/persistence/*/schema/migrations`, ADR 092). Import it
from `src.adapter.persistence._codec` alongside
`compute_entity_fingerprint` in the pattern below and set `schema_ts`
from it — the hash algorithm is pinned in the rendered codec, so
computing it by hand is as wrong as hand-computing fingerprints. For
memory binding, and for a SQL project with no cut migrations yet, it
returns `''` and verification is skipped.

`entityFingerprints` is required by `verify_fingerprints` (ADR 015).
**Do not compute the hash by hand** — the algorithm (sha256 over a
canonical pair-list, 16-char truncation, type-string rendering via
`_type_key`) is pinned in the rendered codec and may evolve. Instead,
import the live function from the project's `.venv` and call it on each
`<E>State` class. The skill imports the codec the same way the running
app does, so it sees the same fingerprint the load endpoint will
compare against.

Pattern (run via `uv run python ...` from the project root, so the
project's venv and its `src.*` imports resolve):

```python
import json
from datetime import datetime
from pathlib import Path
from src.adapter.persistence._codec import (
    _compute_schema_identifier,
    compute_entity_fingerprint,
)

schema_ts = _compute_schema_identifier(Path.cwd())

# load_order is the topo-sorted list built in step 3.
fingerprints = {}
for entity_name in load_order:
    # Import the State class for each entity. The module path follows
    # the rendered convention: src.domain.entities.<entity_snake>.<E>State.
    mod = __import__(
        f"src.domain.entities.{snake(entity_name)}",
        fromlist=[f"{entity_name}State"],
    )
    state_cls = getattr(mod, f"{entity_name}State")
    fingerprints[entity_name] = compute_entity_fingerprint(state_cls)

manifest = {
    "schemaTimestamp": schema_ts,
    "entityFingerprints": fingerprints,
    "portBinding": port_binding_name,
    "createdAt": datetime.now().isoformat(),
    "loadOrder": load_order,
}
Path("seeds/manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
```

If `compute_entity_fingerprint` is missing from the codec, the project
was rendered by an engine that predates ADR 015 — stop and tell the
user to re-render. Do not fall back to writing the manifest without
fingerprints; the load endpoint will reject it.

### Step 6 — summarize

Print, one line per entity:

```
✓ <Entity>: <n> records → seeds/<snake>.json
```

Followed by a totals line and a hint:

```
Wrote N records across M entities → seeds/
Next: restart the app (or POST /admin/seed/save after refining)

On a SQL binding (sqlserver or postgres), a bare app restart is not
enough: it keeps the existing database rows in place but serves the
binding's memory-bound entities (if any) empty — a hybrid tear. The
seed data loads on the next `aac up` instead, because `data: ephemeral`
drop-and-recreates the schema before boot autoload runs — that
drop-and-recreate is what empties the SQL tables so the fresh seed data
can load cleanly. `aac up` is the reset-to-baseline verb for a SQL
binding.
```

## What this skill does NOT do

- **Run `archascode render`.** If the project isn't rendered, stop
  and tell the user to render first. Same posture as `aac.py up`.
- **Insert records via HTTP.** The skill writes files; loading happens
  at boot (ADR 094), not through an HTTP call. Decoupling keeps the
  skill usable on a project whose app isn't currently up.
- **Go through `<E>.create()` factories.** Direct State construction
  via the seed loader is by design — the same path the existing
  `dump_all` / `load_all` flow uses. Invariant enforcement happens in
  the prompt, not at runtime. If the user wants factory-enforced
  invariants, the right answer is a follow-on skill that drives
  `POST /<entities>` over HTTP; that's out of scope for v1.
- **Overwrite an existing `seeds/` directory silently.** Always
  prompt.
- **Use the `faker` library.** The `faker:` field on attributes is a
  *hint* to the LLM, not a directive to run Faker. Reasonable for v1;
  if hint-fidelity isn't enough, a later version can shell out to
  Faker for fields where the hint maps to a known Faker method.
- **Generate composite VO inner fields beyond a dict.** The codec
  round-trips composites as dicts in v1 (see the `# TODO: composite
  VO decode` markers in `_codec.py`). The skill matches that
  limitation — composite values come out as dicts in the JSON, which
  is what the loader expects.

## Failure modes (v1)

| Symptom                                                | Behavior                                                                                |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Not in a rendered project                              | Print which file is missing; stop.                                                      |
| `spec/architecture.yml` invalid YAML                   | Print parse error; stop.                                                                |
| `<E>State` not parseable from `src/domain/entities/`   | Print the file and entity; stop. Likely a render bug, not a seed bug.                   |
| Relationship cycle detected                            | Print the cycle; stop. Deferred FK seeding not supported in v1.                         |
| LLM produces invalid JSON                              | Drop the entity's batch; continue with others; report at the end.                       |
| >50% of an entity's records fail validation            | Stop; print the prompt and the offending output for the user to inspect.                |
| `seeds/` already exists                                 | Prompt: overwrite / merge / cancel. Default to cancel on non-interactive contexts.      |
| `_compute_schema_identifier` returns `""` (no cuts yet) | Write `""`; loader will skip verification (matches memory-binding behavior).            |
| `compute_entity_fingerprint` missing from rendered codec | Stop. Project predates ADR 015 — user must re-render with the current engine.           |
| `<E>State` not importable from `src.domain.entities.*`  | Stop. Likely an `/archascode:apply` step was skipped; tell the user to re-render.              |

No retries. The user re-invokes after adjusting the spec or theme.

## Notes for future versions

- **Hand off through HTTP factories.** A `--via-http` flag could drive
  `POST /<entities>` instead of writing seed files, picking up
  invariant enforcement through `<E>.create()`. Useful once entities
  reliably expose create endpoints.
- **Real Faker integration.** When an attribute's `faker:` value maps
  to a known Faker provider, generate that field in the skill rather
  than the LLM. Keeps the LLM focused on narrative coherence.
- **Volume scaling.** A `--scale realistic` mode that picks per-entity
  counts based on cardinality (e.g. 100 line items per 10 orders per
  3 customers) instead of a uniform `--count`.
- **Multiple themes / named seeds.** Today seeds are
  unnamed (ADR 012 v1). When the seed system grows named
  seeds, this skill should grow a `--name <slug>` arg.
