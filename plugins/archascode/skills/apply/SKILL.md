---
name: apply
description: Render the archascode spec and resolve pending impl hand-offs by dispatching sub-agents to fill in `repo_port_extensions` stubs (entity_adapter kind), entity domain-method bodies (entity_method kind), custom port adapter implementations (custom_port_adapter kind), or custom use-case workflow bodies (custom_uc_workflow kind). Use when the user has edited `spec/architecture.yml` and wants the loop closed (render → seed → agent → re-render).
---

# /archascode:apply

Close the **render → implement → re-render** loop for an archascode consuming
project. On invocation:

1. Render the spec (calls the cloud `/render` endpoint via the local CLI).
2. Seed `.env` from `.env.example` once-ever, if not already present
   (ADR 070 Amendment A2) — silent unless it acts.
3. Inspect the pending hand-offs returned by the cloud.
4. For each pending hand-off, spawn a sub-agent to fill in the impl stub
   in `spec/src/...`, then record the resolution.
5. Re-render so the overlay copy-on-render places the agent's body at
   `src/...`.
6. Print a summary.

The plumbing is in `archascode-core`; this skill is the orchestration layer
that decides when to spawn agents.

## Preconditions

- `cwd` is a consuming project — it has `spec/architecture.yml`.
- The user is logged in (`archascode login`).
- The `archascode` CLI is on the Bash PATH — the plugin's `bin/` provides it.
  If `command -v archascode` fails, the plugin install is broken:
  re-enable/reinstall per INSTALL.md and check the wrapper's executable bit
  (`chmod +x <kit>/marketplace/plugins/archascode/bin/archascode`).

If any precondition is missing, stop and report what's missing — don't try
to install or start services on the user's behalf.

## Procedure

### Step 1 — initial render

Invoke the CLI with `--json` for a machine-readable response. The
default output directory is the consuming project root (`.`), which is
what every downstream entry point — `aac up`, the dual-tree
`src/` / `spec/src/` layout, the manifest under `.archascode/` — expects.

```bash
archascode render --json
```

Parse stdout as JSON. The shape on success:

```json
{
  "ok": true,
  "filesWritten": ["src/...", "spec/src/...", ...],
  "filesRemoved": [...],
  "handoff": {
    "resolved": [...HandoffItem],
    "pending":  [...HandoffItem]
  }
}
```

Each `HandoffItem` has: `id`, `kind`, `contract_file`, `contract_symbol`,
`impl_target_file`, `impl_target_symbol`, `contract_hash`.

On `ok: false`, print the errors and exit. Do not proceed.

Exit **2** with no JSON on stdout means not logged in, not a render
failure. Report `not logged in — run archascode login` and stop.

### Step 1a — seed `.env` from `.env.example`, once-ever (ADR 070 Amendment A2)

Every render unconditionally writes `.env.example` at the project root
(ADR 070 Decision 1) — true after Step 1 above, on every invocation. If a
live `.env` does not exist yet, copy it once-ever, tracked by the same
marker `/archascode:init` used before this responsibility moved here:

```bash
mkdir -p .archascode
if [ -f .archascode/aac-init-env-seeded ]; then
  : # already handled in a prior run; no-op every time after
elif [ -f .env ]; then
  : > .archascode/aac-init-env-seeded  # record done, without copying —
    # a later deliberate deletion of .env must not trigger a stale re-copy
else
  cp .env.example .env
  : > .archascode/aac-init-env-seeded
  echo "SEEDED_ENV=1"
fi
```

If `SEEDED_ENV=1` was printed, print exactly one line:

```
✓ .env seeded from .env.example (dev CORS defaults)
```

Otherwise print **nothing** for this step — silent whether the marker
was already set, or `.env` already existed. `/archascode:apply`'s summary is
already dense (a line per hand-off); this step must never add noise on
the common case where there is nothing to do.

### Step 2 — handle resolved hand-offs

For each item in `handoff.resolved`: nothing to do — `archascode-core`
already copied the overlay onto `src/`. Just include it in the final summary.

### Step 3 — handle each pending hand-off

For each item in `handoff.pending`:

1. **Capture the overlay's mtime** before spawning, so the sub-agent
   completion check can confirm the file changed:

   ```bash
   stat -f '%m' <impl_target_file>   # macOS
   # or: stat -c '%Y' <impl_target_file>  # linux
   ```

2. **Spawn a sub-agent** (foreground, `subagent_type: "general-purpose"`)
   with a brief built from the item's `kind` and `id`. Supported kinds:

   - `entity_adapter` — the per-adapter hand-off for an ejected entity.
     **First check for stubs**: if the overlay file contains no
     `NotImplementedError`, the engine seeded a complete, runnable adapter
     (a `readonly` entity with no `repo_port_extensions` has nothing to
     fill — eject still emits the hand-off to pull it into the overlay
     tree). Skip dispatch, record + re-render as in Step 3.4–3.5. Otherwise
     route on the **adapter id** parsed from `item.id`
     (format `entity_adapter:<Entity>:<adapter_id>`):
     - `memory` → see "Brief: entity_adapter (memory)" below.
     - `sqlserver` → see "Brief: entity_adapter (sqlserver)" below.
     - `postgres` → see "Brief: entity_adapter (postgres)" below.

   - `entity_method` — the domain-method body hand-off (ADR 039). One
     hand-off per declared entity method, promoted or not. The `item.id`
     format is `entity_method:<Entity>:<method_snake>`. Route to:
     - see "Brief: entity_method" below.

   - `custom_port_adapter` — the per-backend custom-port adapter hand-off
     (ADR 042). `item.id` format is `custom_port_adapter:<Port>:<backend>`
     — parse `<Port>` and `<backend>`. Route to "Brief: custom_port_adapter"
     below.

   - `custom_uc_workflow` — the custom use-case workflow body hand-off (ADR
     043). `item.id` format is `custom_uc_workflow:<UCName>` — parse
     `<UCName>`. Route to "Brief: custom_uc_workflow" below.

   - `domain_service_body` — the domain service body hand-off (ADR 046).
     `item.id` format is `domain_service_body:<ServiceName>` — parse
     `<ServiceName>`. Route to "Brief: domain_service_body" below.

   - `auth_claims_mapper` — the jwt_bearer claims-to-CurrentUser mapper
     hand-off (ADR 024 amended). `item.id` is the fixed
     `auth_claims_mapper:jwt_bearer` (one per app, no second axis). Route
     to "Brief: claims_mapper" below — but **gate dispatch on the Step 3a
     `DISPATCH/SKIP` check**: only dispatch the customization brief when
     Step 3a says `DISPATCH` (active env uses jwt_bearer and the seed
     marker is still present). On `SKIP` the mapper is already customized
     (or the env doesn't use jwt_bearer); record it resolved and re-render
     without dispatching. Unlike the other kinds, this hand-off resolves
     even with its seed marker present — the marker is a dispatch hint,
     not a promotion gate.

   Any unknown `kind` is a bug in the cloud/CLI version pairing — print
   `PENDING — unknown kind <kind>`, skip dispatch, continue to the next
   item. Unknown adapter ids for a known kind print
   `PENDING — unknown adapter id <id>` and continue.

   **Seed vs. re-open — decide before building the brief.** A pending
   hand-off is one of two cases, and the brief differs (see "Shared:
   re-opened hand-offs" below):

   - **Fresh seed** — the overlay still carries the engine's stub marker
     for the symbol (`# archascode: …stub — remove this line when you
     implement`) and/or raises `NotImplementedError`. The seeded
     signature is authoritative; the per-kind "signature is already
     correct" wording applies as written.
   - **Re-open** — the overlay exists, the stub marker is **gone** (a body
     was written in a prior run), yet the item is back in `pending`. The
     only thing that re-opens a marker-free overlay is a `contract_hash`
     change, i.e. the spec moved the contract after the body was written
     (a method param added/renamed/removed or retyped — ADR 060/061 — a
     port Protocol or input DTO reshaped). The overlay's own `def` line is
     now **stale**: it reflects the signature at seed time, not the
     current contract. Build the brief with the **re-open addendum** from
     "Shared: re-opened hand-offs" appended.

   Detect it deterministically from the overlay captured in Step 3.1: if
   the file exists and contains **no** stub marker for the dispatched
   symbol, treat it as a re-open. (A `custom_port_adapter` /
   `domain_service_body` overlay with *some* markers gone and *some*
   present is a partial fill, not a re-open — handle it as Step 3.5
   already describes.)

3. **Verify the agent edited the file** by re-reading the mtime and
   asserting it changed. If it did *not* change, print
   `PENDING — sub-agent did not edit <impl_target_file>; manual
   implementation required` and continue to the next item (no retry).
   (This step is skipped for any hand-off that was seeded-complete and
   never dispatched — e.g. a stub-free `entity_adapter` above.)

4. **Record the resolution**:

   ```bash
   archascode record-handoff --id "<item.id>" --hash "<item.contract_hash>"
   ```

5. **Re-render once** so copy-on-render runs with the now-matching hash:

   ```bash
   archascode render --json
   ```

   The item should now appear in `handoff.resolved`. If it still appears
   in `pending`:

   - **For `kind == custom_port_adapter`:** this is a legitimate partial
     fill — the file mtime changed, at least one method was implemented,
     but at least one stub marker survives (ADR 042 #3 — any method still
     carrying `# archascode: custom-port adapter method stub — remove this
     line when you implement` keeps the hand-off pending). Re-dispatch the
     same hand-off item so the agent fills the remaining methods. A
     multi-method port may take several passes; this is by design, not an
     error.

   - **For `kind == domain_service_body`:** this is a legitimate partial
     fill — the file mtime changed, at least one function was implemented,
     but at least one stub marker survives (ADR 046 Decision #3 — any
     function still carrying
     `# archascode: domain-service function body stub — remove this line when you implement`
     keeps the hand-off pending). Re-dispatch the same hand-off item so
     the agent fills the remaining functions. A multi-function service
     module may take several passes; this is by design, not an error.

   - **For all other kinds:** something is wrong (likely the agent saved a
     file with no body change — the mtime check at Step 3.3 above should
     have caught a genuine no-edit, so reaching here means the overlay
     changed but the hash didn't match). Surface the situation rather than
     re-spawning.

### Step 3a — claims-mapper hand-off (ADR 024)

After processing the cloud-returned hand-offs but before printing the
summary, check whether the **active environment's** auth adapter is
`jwt_bearer`. The auth adapter is project-specific scaffolding that
lives in `spec/src/`, not a normal hand-off item — the seed is written
once on render and the engine never overwrites it, so the apply skill
takes responsibility for deciding when to invite an agent to customize
it.

Trigger conditions (all three must hold):

1. The active environment's auth adapter is `jwt_bearer`. The active
   environment is `.archascode/environments.json`'s `defaultEnvironment`
   (camelCase) unless the user passed `--env`; its adapter is
   `environments[<env>].appAdapters.auth.id`.
2. `spec/src/adapter/auth/jwt_bearer/claims_mapper.py` exists on disk
   (the seed was written on a previous render).
3. The file still contains the seed marker comment
   `# archascode: seeded by jwt_bearer adapter renderer`.

Evaluate all three with one command — do not hand-write ad-hoc
`environments.json` readers (`environments.json` is **camelCase**
throughout: `defaultEnvironment`, `appAdapters`, not snake_case).
Substitute `ENV` only if the user passed `--env`; otherwise leave it
empty to use `defaultEnvironment`:

```bash
python3 - "$PWD" "${ENV:-}" <<'PY'
import json, os, sys
root, env_override = sys.argv[1], sys.argv[2]
m = json.load(open(os.path.join(root, ".archascode", "environments.json")))
env = env_override or m.get("defaultEnvironment")
auth = (((m.get("environments") or {}).get(env) or {})
        .get("appAdapters") or {}).get("auth") or {}
mapper = os.path.join(root, "spec", "src", "adapter", "auth",
                      "jwt_bearer", "claims_mapper.py")
seeded = (os.path.exists(mapper)
          and "# archascode: seeded by jwt_bearer adapter renderer"
              in open(mapper).read())
fire = auth.get("id") == "jwt_bearer" and seeded
print(f"env={env} auth.id={auth.get('id')} seeded={seeded} -> "
      f"{'DISPATCH' if fire else 'SKIP'}")
PY
```

A single line of output settles it: `DISPATCH` or `SKIP`. On `SKIP`,
move to Step 4 without further inspection. On `DISPATCH`, dispatch a
sub-agent (`subagent_type:
"general-purpose"`) with the brief in "Brief: claims_mapper" below.
Verify the agent edited the file using the same mtime check as other
hand-offs.

The claims mapper **is** a contract-tracked hand-off (`kind ==
auth_claims_mapper`, id `auth_claims_mapper:jwt_bearer`, ADR 024 amended)
— it appears in the cloud-returned `pending` list like any other. Record
its resolution and re-render exactly as in Step 3.4–3.5, using the
`contract_hash` from its pending hand-off item:

```bash
archascode record-handoff --id "auth_claims_mapper:jwt_bearer" --hash "<item.contract_hash>"
archascode render --json
```

The re-render's `applyOverlay` then copies the customized overlay over
`src/adapter/auth/jwt_bearer/claims_mapper.py`, and the item moves to
`handoff.resolved`. Unlike the stub-bearing kinds, the seed marker does
**not** keep it pending — the claims-mapper seed is runnable code, so the
overlay resolves whether or not the agent left the marker in place (the
DISPATCH gate above, not the marker, decides whether to invite
customization). If you process the cloud hand-offs by `kind` in Step 2/3,
you may instead let `auth_claims_mapper` flow through that normal loop and
treat this Step 3a `DISPATCH/SKIP` check purely as the gate for whether to
dispatch the customization brief; either path records and re-renders the
same way.

On `SKIP`, this step is done — `SKIP` is the common case (most projects
don't use `jwt_bearer`, or have already customized the mapper). State it
in one line in the Step 4 summary and move on; do not re-derive it with
further manifest reads.

### Step 4 — final summary

Print, in order:

- `RESOLVED <item.id>` for each newly-resolved item.
- `PENDING  <item.id> — <reason>` for each item left pending.
- A one-line totals row.
- Final line, exactly:

  ```
  Done. Next: /archascode:seed to populate data, or use the plugin's API Explorer to drive the app.
  ```

Exit non-zero if any item is still pending.

## Shared: re-opened hand-offs

Every per-kind brief below asserts "the signature is already correct — do
not change it." That assertion holds **only on a fresh seed**. On a
**re-open** (Step 3: overlay present, stub marker gone, item back in
`pending`), it is false — the overlay's `def` line is frozen at seed time
while the engine-generated contract has moved on. The engine deliberately
never rewrites the overlay's body, so nothing reconciles its signature; that
is the orchestrator's job here.

When you detected a re-open in Step 3, **append the addendum below to the
per-kind brief** (and drop the per-kind "signature is already correct"
sentence — it is the line being corrected). Provide the two paths it needs;
both are already on disk at dispatch time:

- the **current generated signature** — the engine-owned shim/Protocol that
  reflects the live spec. For `entity_method` it is the delegating shim's
  `def` line in `src/domain/entities/<entity_snake>.py`; for
  `custom_port_adapter` / `entity_adapter` it is the port/repo Protocol `def`
  in `src/application/.../ports.py`; for `custom_uc_workflow` it is the
  generated UC `execute` signature; for `domain_service_body` it is the
  sibling/own generated `def` lines.
- the **existing overlay** — the project-owned file being re-dispatched,
  whose `def` line may be stale.

Addendum text (substitute the two paths):

```
This hand-off has RE-OPENED: a body was written here in a prior run, then
the spec changed the method's contract (a parameter added, renamed, removed,
or retyped — or a DTO/Protocol reshaped), which moved the contract hash and
re-surfaced this hand-off.

The authoritative signature is the engine-generated one — shown here:
<ABS_PATH to the generated shim/Protocol/UC file that declares the live def>

Your existing overlay (below / in the file you are editing) was written
against the OLD contract, so its `def` line may be stale. Reconcile BOTH:

1. Make the overlay's `def` line match the generated signature exactly —
   parameter names, order, keyword-only markers, and optional/default
   markers (ADR 061: an optional or defaulted param renders `param=<default>`
   or `param: <type> | None = None`). Names + arity drift causes a call-time
   TypeError; this is the case that fails loudly.
2. Re-verify the body against the current parameter TYPES. A type-only change
   keeps the names and arity identical, so it is name-stable — nothing else
   will flag it, and the body can keep running while doing the wrong thing
   (e.g. integer math on a value that is now a string). Read the generated
   signature's annotations and confirm the body still honors them.

Treat the generated signature as ground truth and reconcile the overlay to
it — do not assume the overlay's existing `def` line is current.
```

This addendum reconciles **to the engine-generated signature**, not to some
independent judgement. That matters: when the engine's own derivation is
itself wrong (a known class of codegen signature-instability bug —
[[aac-apply-underspecified-method-hash-drift]]), reconciling to the shim
surfaces the wrong signature *visibly* at the next call/typecheck rather than
hiding it behind a stale-but-plausible overlay. Reconcile to the contract;
let an engine-side wrong contract fail loudly.

## Brief: entity_adapter (memory)

For a pending `entity_adapter` item whose `id` ends in `:memory`, dispatch
a sub-agent with a prompt along these lines (substitute concrete values).
The brief targets the seeded overlay at `<cwd>/<impl_target_file>`. **On a
re-open** (Step 3 detected the overlay's stub marker is gone — a repo-port
extension method's signature moved in the spec), drop the "signature is
already correct" sentence and append the "Shared: re-opened hand-offs"
addendum, pointing at the repo Protocol `def` in
`src/application/<entity_snake>/ports.py`.

```
You are implementing an in-memory repository extension method for
archascode.

File to edit: <ABS_PATH to spec/src/.../{snake_entity}_repository.py>
Class: <impl_target_symbol> (e.g. MemoryCustomerRepository)

The file uses an injected `MemoryStore[<Entity>State]` instance passed
as the `store` argument to `__init__`. All CRUD methods access data
through `self._store.get(id)`, `self._store.put(id, state)`,
`self._store.values()`, and `self._store.delete(id)`. The store is
shared with any custom-port adapters reading this entity's data — do
not replace it with a `ClassVar` or any other private field.

Replace the body of every method that currently raises
`NotImplementedError(...)` with a real in-memory implementation.

For each NotImplementedError stub:
- The method signature is already correct — do not change it.
- The intended behavior is documented in the consuming project's
  `spec/architecture.yml` under
  `domain.entities.<Entity>.repo_port_extensions.methods.<method>.description`.
  Read that file (path: <ABS_PATH to spec/architecture.yml>) for intent.
- Mirror the style of the existing find_by_* methods in this file:
  call `self._store.values()` (each is a frozen State), filter, and
  return `Entity(state)` hydrations.
- Do not add imports unless strictly necessary; stdlib only.

Constraints:
- Edit ONLY the file listed above.
- Do not change the class name, constructor, or any other method's
  signature.
- Save the file when done. Do not modify spec/architecture.yml or any
  file under src/.
```

The sub-agent's job is purely to fill in bodies. Do not include
"verify by running the app" or "add tests" in the brief — that's out of
scope for v1 and would slow the loop down for no benefit.

## Brief: entity_adapter (sqlserver)

For a pending `entity_adapter` item whose `id` ends in `:sqlserver`,
dispatch a sub-agent with a prompt along these lines. The brief targets
the seeded overlay at `<cwd>/<impl_target_file>` — same dual-tree shape
as the memory case, but the file is a real SQL Server adapter rather
than an in-memory dict. **On a re-open** (Step 3 detected the stub marker
is gone — a repo-port extension method's signature moved in the spec),
drop the "signature is already correct" sentence and append the "Shared:
re-opened hand-offs" addendum, pointing at the repo Protocol `def` in
`src/application/<entity_snake>/ports.py`.

```
You are implementing a SQL Server repository extension method for
archascode.

File to edit: <ABS_PATH to spec/src/.../{snake_entity}_repository.py>
Class: <impl_target_symbol> (e.g. SqlServerCustomerRepository)

The file already contains working CRUD methods (find_all, find_by_id,
save, delete, plus any unique/FK lookups) implemented over a
`get_connection()` contextmanager that yields a `pymssql.Connection`.
Hydration goes through `_to_entity(row)`, dehydration through
`_to_params(entity)`, and SQL Server integrity errors funnel into
`_handle_integrity_error(e)`. Replace the body of every method that
currently raises `NotImplementedError(...)` with a real SQL
implementation.

For each NotImplementedError stub:
- The method signature is already correct — do not change it.
- The intended behavior is documented in the consuming project's
  `spec/architecture.yml` under
  `domain.entities.<Entity>.repo_port_extensions.methods.<method>.description`.
  Read that file (path: <ABS_PATH to spec/architecture.yml>) for intent.
- Mirror the style of the existing CRUD methods in this file: open a
  `with get_connection() as conn:` block, run parametrized queries with
  `%s` placeholders (NOT f-string interpolation of user values), and
  use `_row_to_dict` / `_rows_to_dicts` plus `_to_entity` to hydrate
  results.
- Pass UUID values as `str(value)` in parameter tuples — pymssql expects
  `UNIQUEIDENTIFIER` columns to receive strings. Decimal values go via
  `float(...)`. Hydration takes care of the reverse.
- Catch `pymssql.IntegrityError` only when the method's docstring
  expects to translate it to a domain error; otherwise let it propagate.

Constraints:
- Edit ONLY the file listed above.
- Do not change the class name, constructor, or any other method's
  signature.
- Use parametrized queries (`%s` placeholders + tuple of values). Never
  build SQL strings by string-concatenating user input.
- Save the file when done. Do not modify spec/architecture.yml or any
  file under src/.
```

## Brief: entity_adapter (postgres)

For a pending `entity_adapter` item whose `id` ends in `:postgres`,
use the sqlserver brief above with the postgres substitutions — the
seeded overlay has the same dual-tree shape and the same CRUD/hydration
skeleton (ADR 092's repository is written from the SQL Server one):

- Opening line: `You are implementing a Postgres repository extension
  method for archascode.`
- Class: `Postgres<Entity>Repository`; `get_connection()` yields a
  `psycopg.Connection`.
- Placeholders are the same `%s` DBAPI paramstyle (ADR 092 C5).
- Pass UUID values as `str(value)` in parameter tuples. Decimal values
  pass through natively — psycopg adapts `Decimal` to `NUMERIC`
  directly, so the pymssql `float(...)` accommodation line is dropped.
- Integrity errors: catch `psycopg.errors` via the file's
  `_handle_integrity_error(e)` funnel, which branches on `e.sqlstate`
  (`23505` duplicate-key, `23503` FK-violation) — only when the
  method's docstring expects a domain-error translation; otherwise let
  it propagate.

Everything else (spec-description intent lookup, re-open addendum,
constraints block) is identical to the sqlserver brief.

## Brief: claims_mapper (ADR 024)

For the ADR 024 jwt_bearer claims-mapper hand-off, dispatch a sub-agent
with a prompt along these lines. The brief targets the seeded overlay
at `<cwd>/spec/src/adapter/auth/jwt_bearer/claims_mapper.py` —
project-specific scaffolding that lives only in the overlay tree (no
src/ counterpart until copy-on-render).

```
You are customizing the JWT claims-to-CurrentUser mapping for an
archascode consuming project.

File to edit: <ABS_PATH to spec/src/adapter/auth/jwt_bearer/claims_mapper.py>
Function: claims_to_current_user(claims: dict[str, Any]) -> CurrentUser

The file was seeded by the engine with a default OIDC mapping (sub →
user_id, email, name, roles, plus all other claims under metadata).
The engine will not overwrite this file again — it's now project-owned
overlay code.

Tasks:
- Read the project spec at <ABS_PATH to spec/architecture.yml> for any
  clues about which claims the project's identity provider issues —
  custom claim names (e.g. "tenantId", "https://acme.com/roles"),
  non-standard role claim path, organization identifiers.
- If the spec gives no hints (no custom auth shape declared), the
  seeded default OIDC mapping is correct. Replace the seed marker
  comment `# archascode: seeded by jwt_bearer adapter renderer` with
  a project-specific comment noting the OIDC defaults were kept, and
  save. That removes the marker so future renders see the file as
  customized.
- If the spec hints at custom claims, edit the function body to map
  them into `CurrentUser` fields (or `metadata` for anything that
  doesn't fit the baseline). Remove the seed marker comment so future
  renders see the file as customized.

Constraints:
- Edit ONLY the file listed above.
- Do not change the function name or signature.
- Remove the seed marker comment (`# archascode: seeded by jwt_bearer
  adapter renderer`) so /archascode:apply doesn't re-dispatch this hand-off
  next time.
- Save the file when done.
```

## Brief: entity_method

For a pending `entity_method` item, dispatch a sub-agent with a prompt
along these lines (substitute concrete values). The `item.id` format is
`entity_method:<Entity>:<method_snake>` — parse `<Entity>` and
`<method_snake>` from it. The brief targets the seeded overlay at
`<cwd>/<impl_target_file>`. **On a re-open** (Step 3 detected the stub
marker is gone — the spec moved the method's parameters, e.g. an
ADR 060/061 param add/rename/retype/default change), drop the "signature
is already correct" sentence and append the "Shared: re-opened hand-offs"
addendum, pointing at the delegating shim's `def` line in
`src/domain/entities/<entity_snake>.py`. This is the exact scenario where
a forgotten param leaves the overlay's `def` stale against the shim.

```
You are implementing a domain method body for an archascode entity.

File to edit: <ABS_PATH to spec/src/domain/entities/<entity_snake>_methods/<method_snake>.py>
Function: <method_snake> (the module-level function in that file)

The file was seeded by the engine with a stub that raises
``NotImplementedError``. Replace the stub body with a real implementation.

The function signature is already correct — do not change it. Its shape is:

  def <method_snake>(self, *, <params>[, now: datetime]) -> "<Entity>":  # mutable
  def <method_snake>(self, *, <params>) -> <returns>:                   # non-mutable

Where ``self`` is the entity instance (passed in by the delegating shim
on the entity class). ``now`` appears only for mutable methods (declared
``mutable: true`` in the spec); it is provided by the use-case clock.

Context to read:
- `spec/architecture.yml` (path: <ABS_PATH to spec/architecture.yml>)
  under `domain.entities.<Entity>.methods.<method_snake>`:
  - ``description`` — the intent of the method.
  - ``workflow`` — the ordered steps the implementation should follow.
  - ``depends_on_attributes`` — entity attributes the body reads.
- The entity class at `src/domain/entities/<entity_snake>.py` — for the
  accessors and ``with_changes(changes, *, now)`` API available on the
  entity instance passed as ``self``. A mutable method should call
  ``return self.with_changes({...}, now=now)`` to produce an updated
  entity (frozen entities cannot be mutated in-place).

Implementation rules:
- Remove the stub-marker comment line (``# archascode: entity-method body
  stub — remove this line when you implement``) as part of implementing the
  body. ``/archascode:apply`` treats an overlay still carrying that line as
  unresolved and will re-dispatch this hand-off (ADR 040), so leaving it in
  loops the loop.
- Do not import the entity type at module top — only use it via the
  ``self`` parameter (the shim already handles the import).
- If the workflow needs an entity attribute that is NOT listed in
  ``depends_on_attributes``, add that attribute name to
  ``depends_on_attributes`` in ``spec/architecture.yml`` and ask the user
  to re-render before proceeding — do not guess or silently reference
  undeclared attributes. Declared dependencies are what the engine uses
  to detect when the hand-off needs re-confirmation (ADR 039 #8).
- stdlib and project domain imports are fine; do not add third-party
  dependencies.
- Do not change the function name, signature, or any other method in the
  file.

Constraints:
- Edit ONLY the file listed above (and ``spec/architecture.yml`` if you
  need to add a ``depends_on_attributes`` entry as described above).
- Save the file when done. Do not modify anything under ``src/``.
```

The sub-agent's job is purely to fill in the body function. The
``record-handoff`` + re-render loop is handled by the orchestrator (Step 3
above), not the sub-agent.

## Brief: custom_port_adapter

For a pending `custom_port_adapter` item, dispatch a sub-agent with a
prompt along these lines (substitute concrete values). The `item.id`
format is `custom_port_adapter:<Port>:<backend>` — parse `<Port>` and
`<backend>` from it. The brief targets the seeded overlay at
`<cwd>/<impl_target_file>`. **On a re-open** (Step 3 detected every stub
marker is already gone — distinct from a partial fill where *some* remain —
and the port Protocol's method signatures moved in the spec), drop the
"signatures are already correct" sentence and append the "Shared: re-opened
hand-offs" addendum, pointing at the port Protocol `def` lines in
`src/application/<port_snake>/ports.py`.

```
You are implementing a custom-port adapter for an archascode consuming
project.

File to edit: <ABS_PATH to spec/src/adapter/<port_snake>/<backend>/<port_snake>_adapter.py>
Class: <impl_target_symbol> (e.g. MemoryProductReadModelAdapter /
SqlServerProductReadModelAdapter)

The file was seeded by the engine with one stub method per port method,
each raising ``NotImplementedError``. Implement every method that still
raises ``NotImplementedError``.

The method signatures are already correct — do not change them. The port
protocol is the abstract base; this file is the concrete adapter for the
``<backend>`` backend.

Context to read:
- ``spec/architecture.yml`` (path: <ABS_PATH to spec/architecture.yml>)
  under ``application.ports.<Port>.methods.<method>.description`` — the
  intent of each method.
- The port Protocol at ``src/application/<port_snake>/ports.py`` — for the
  method signatures, DTO types, and return shapes the adapter must satisfy.

Implementation rules:
- Remove the stub-marker comment line
  (``# archascode: custom-port adapter method stub — remove this line when you implement``)
  from **each** method you implement. ``/archascode:apply`` treats an overlay where
  **any** method still carries that line as unresolved and will re-dispatch
  this hand-off (ADR 042), so leaving the marker in loops the loop. A
  method you leave unimplemented (still raises ``NotImplementedError``) must
  keep its marker — the overlay stays pending until all methods are filled.
- For a ``sqlserver`` backend, import the shared connection via
  ``from adapter.persistence.sqlserver.config import get_connection``
  (and any other helpers you need from that module). Mirror the import
  form already emitted at the top of this file — the engine writes
  cross-layer imports by bare top-level name. This import resolves
  regardless of the adapter's directory location (Decision #2, ADR 042).
- For a ``memory`` backend, the entity stores your adapter reads are
  injected by an engine-owned base class (``Memory<Port>AdapterBase`` in
  ``src/adapter/<port_snake>/memory/_base.py``) that your adapter
  **already subclasses** — you have a ``self._<entity>_store`` (a
  ``MemoryStore[<EntityState>]``) for each entity declared in
  ``adapters.memory.reads``. Query them via
  ``self._<entity>_store.values()``, ``.get(id)``, etc. You do **not**
  write or own a constructor — the file you edit has **no ``__init__``**;
  the base supplies it, and it is regenerated from the spec on every
  render. If your implementation needs a store that is **not** declared,
  you **cannot** wire it from here: stop and report
  ``NEEDS SPEC: ports.<Port>.adapters.memory.reads must include <Entity>``,
  then let the user update the spec and re-render. Do **not** add an
  ``__init__``, do **not** edit ``composition/port_bindings.py`` or
  anything under ``src/`` (including ``_base.py``).
- stdlib and project imports are fine; do not add third-party dependencies.
- Do not change the class name, method signatures, or any DTOs in the file.

Constraints:
- Edit ONLY the file listed above.
- Save the file when done.
- Do not modify ``spec/architecture.yml`` or any file under ``src/``.
```

The sub-agent's job is to fill in the method bodies. Because resolution
aggregates over methods (any surviving marker ⇒ pending), the agent may
implement a subset of methods in one pass; the orchestrator re-dispatches
the hand-off until all markers are gone. The ``record-handoff`` + re-render
loop is handled by the orchestrator (Step 3 above), not the sub-agent.

## Brief: custom_uc_workflow

For a pending `custom_uc_workflow` item, dispatch a sub-agent with a
prompt along these lines (substitute concrete values). The `item.id`
format is `custom_uc_workflow:<UCName>` — parse `<UCName>` from it. The
brief targets the seeded overlay at `<cwd>/<impl_target_file>`. **On a
re-open** (Step 3 detected the stub marker is gone — the UC's `execute`
input DTO or return type was reshaped in the spec), drop the "signatures
are already correct" sentence and append the "Shared: re-opened hand-offs"
addendum, pointing at the generated `execute` signature in the file's own
class header.

```
You are implementing a custom use-case workflow body for an archascode
consuming project.

File to edit: <ABS_PATH to spec/src/application/<uc_snake>/<uc_snake>.py>
Class: <impl_target_symbol> (the UC class, e.g. GetProductPage)

The file was seeded by the engine with a stub whose ``execute`` method
raises ``NotImplementedError``. Replace the stub body with a real
implementation.

The class and method signatures are already correct — do not change them.
The ``execute`` method's shape is:

  def execute(self, input: <InputDTO>) -> <ReturnType>:  # when input is present
  def execute(self) -> <ReturnType>:                     # when there is no input

Context to read:
- The generated UC class already contains a docstring with the UC's
  ``description`` and ``workflow_steps`` — read them to understand the
  intended behavior. The docstring is in the file you are editing.
- The port interfaces for each depended-on port (read the INTERFACE, not
  the adapter implementation):
  - For a custom port named ``<Port>``: read
    ``src/application/<port_snake>/ports.py`` — the ``Protocol`` there
    declares every method signature and return type the adapter must
    satisfy.
  - For an entity repository named ``<Entity>Repository``: read
    ``src/application/<entity_snake>/ports.py`` — the repository
    ``Protocol`` there declares the CRUD and extension methods.
  Do NOT read the adapter implementation files (e.g.
  ``src/adapter/<port_snake>/memory/...`` or
  ``spec/src/adapter/...``). The apply loop is single-pass and the
  adapters may not yet be applied to ``src/`` when this agent runs; the
  interface is always generated regardless of adapter resolution state.
- ``spec/architecture.yml`` (path: <ABS_PATH to spec/architecture.yml>)
  under ``application.use_cases.<UCName>`` — for the ``description``,
  ``workflow_steps``, and ``port_dependencies`` declared in the spec.

Implementation rules:
- Remove the stub-marker comment line
  (``# archascode: custom use-case workflow body stub — remove this line when you implement``)
  when you implement the body. ``/archascode:apply`` treats an overlay still
  carrying that line as unresolved and will re-dispatch this hand-off
  (ADR 043), so leaving the marker in loops the loop.
- Call each depended-on port through its port interface — use
  ``self._<port_snake>.<method>(...)`` as the constructor already wires
  the port instance. Do not instantiate adapters directly.
- To get the current time use ``self._clock.now()``; to generate a new
  entity id use ``self._id_generator.new()``. Both are always available
  on the UC instance — do not call ``datetime.now()`` or ``uuid4()`` directly.
- Mirror the import form already emitted at the top of this file (the
  engine writes cross-layer imports by bare top-level name, e.g.
  ``from domain.…`` / ``from application.…``). stdlib and project imports
  are fine; do not add third-party dependencies.
- Do not change the class name, constructor, or method signatures.

Constraints:
- Edit ONLY the file listed above.
- Save the file when done.
- Do not modify ``spec/architecture.yml`` or any file under ``src/``.
```

The sub-agent's job is to fill in the `execute` body. Because a custom UC
has one body per file (unlike `custom_port_adapter`'s many-methods-per-file),
a single pass suffices — there is no per-method partial-fill aggregation.
The ``record-handoff`` + re-render loop is handled by the orchestrator
(Step 3 above), not the sub-agent.

## Brief: domain_service_body

For a pending `domain_service_body` item, dispatch a sub-agent with a
prompt along these lines (substitute concrete values). The `item.id`
format is `domain_service_body:<ServiceName>` — parse `<ServiceName>`
from it. The brief targets the seeded overlay at
`<cwd>/<impl_target_file>`. **On a re-open** (Step 3 detected every stub
marker is already gone — distinct from a partial fill — and a service
function's parameters moved in the spec), drop the "signatures are already
correct" sentence and append the "Shared: re-opened hand-offs" addendum,
pointing at the regenerated `def` lines in
`src/domain/services/<service_snake>.py`.

```
You are implementing a domain service module for an archascode consuming
project.

File to edit: <ABS_PATH to spec/src/domain/services/<service_snake>.py>

The file was seeded by the engine with one stub function per declared
service function, each raising ``NotImplementedError``. Implement every
function that still raises ``NotImplementedError``.

The function signatures are already correct — do not change them. A
domain service is a module of module-level free functions (no class, no
``self``, no injected dependencies).

Context to read:
- The generated docstrings in the file you are editing — each function's
  docstring contains the function's ``description`` and the overlay path.
  Read them to understand the intended behavior per function.
- ``spec/architecture.yml`` (path: <ABS_PATH to spec/architecture.yml>)
  under ``domain.services.<ServiceName>`` — for the service's
  ``description``, per-function intent, and ``depends_on`` (the list of
  sibling domain services this service calls).
- For each sibling service named in ``depends_on``: read its generated
  module at ``src/domain/services/<dep_snake>.py`` — the ``def``
  signatures there tell you which functions to call and their parameter
  shapes. Read the interface (the ``def`` lines + docstrings), not an
  adapter or application-layer file.

Implementation rules:
- Remove the stub-marker comment line
  (``# archascode: domain-service function body stub — remove this line when you implement``)
  from **each** function you implement. ``/archascode:apply`` treats an overlay
  where **any** function still carries that line as unresolved and will
  re-dispatch this hand-off (ADR 046 Decision #3), so leaving the marker
  in loops the loop. A function you leave unimplemented (still raises
  ``NotImplementedError``) must keep its marker — the overlay stays
  pending until all function markers are removed.
- Mirror the import form already emitted at the top of this file — the
  engine writes cross-layer imports by bare top-level name. When you add
  imports for symbols your function *bodies* newly use, follow that same
  form: ``from domain.services.<dep_snake> import <function>`` (or
  ``from domain.services import <dep_snake>`` then
  ``<dep_snake>.<function>(...)``), ``from domain.entities.<snake> import …``,
  ``from domain.services.dtos import …``, and so on. Call a depended-on
  sibling service through its generated function signature. The engine
  seeds **no** sibling-service import in the stub (an empty stub calls
  nothing) — when you write a call into a sibling, **add the import
  yourself**. Call the function directly — no runtime injection, no class
  instantiation. The ``depends_on`` edge is declared in the spec; the
  import is yours to write alongside the call.
- Construct and mutate domain entities and their DTOs as needed — all
  imports must be domain-layer symbols (domain entities from
  ``domain.entities.<snake>``, top-level value objects, enums,
  service-scoped DTOs from the shared ``domain.services.dtos`` module, and
  sibling domain services). The engine already imports the entity and
  service-DTO types your function *signatures* reference; you add imports
  only for symbols your function *bodies* newly use.
- **Construct entities through the generated ``Entity.create(...)`` /
  ``entity.with_changes(...)`` factories — never build ``EntityState``
  directly.** The factory is the validated birth/change path; bypassing it
  skips invariant checks. Two of its keyword-only parameters look like they
  need injected dependencies a pure service does not have — they do not:
  - ``new_id``: **omit it.** The factory signature is
    ``create(input, *, now, new_id: UUID | None = None)`` — when you pass no
    ``new_id`` the factory self-mints a fresh ``uuid4()`` internally
    (ADR-046 amendment 2026-06-08). A pure domain service must **not** call
    ``uuid4()`` itself or pass an id; just call ``create(input, now=...)``.
  - ``now``: the factory still requires it. **If the entity has no
    ``created_at``/``updated_at`` field, ``now`` is inert** (the ``create``
    body never stores it — check the generated ``EntityState`` dataclass for a
    ``datetime`` field): pass the sentinel ``now=datetime.min``
    (``from datetime import datetime``) to satisfy the keyword. **If the entity
    *does* store a timestamp**, ``now`` is load-bearing and ``datetime.min`` is
    wrong — the service must then declare ``now: datetime`` in its own spec
    ``input`` and the caller forwards it (the "time is a declared parameter"
    rule; ADR 046). **Never call ``datetime.now()`` / ``datetime.utcnow()`` in
    a service body** — a domain service takes time as data, never ambient.
- **Never import from ``application.*``** — no use cases, no application
  ports, no repository interfaces. A domain service lives in the domain
  layer; importing the application layer is an architecture violation
  (ADR 046 Decision #6). The layering contract test is the backstop if
  this rule is broken.
- Do not change any function name, signature, or other functions in the
  file.
- stdlib and domain-layer imports are fine; do not add third-party
  dependencies.

Constraints:
- Edit ONLY the file listed above.
- Save the file when done.
- Do not modify ``spec/architecture.yml`` or any file under ``src/``.
- Do not touch composition, bundle, or binding files — a domain service
  has no backend axis, no adapter, and no binding (ADR 046 Decision #2).
```

The sub-agent's job is to fill in the function bodies. Because resolution
aggregates over functions (any surviving marker ⇒ pending), the agent may
implement a subset of functions in one pass; the orchestrator re-dispatches
the hand-off until all markers are gone. A multi-function service module may
legitimately take several passes — "still pending after an apply pass" is
correct behavior for this kind, not an error. The ``record-handoff`` +
re-render loop is handled by the orchestrator (Step 3 above), not the
sub-agent.

## Failure modes (v1)

| Symptom                                            | Behavior                                                                                |
| -------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Cloud returns non-2xx                              | Surface the error; abort.                                                               |
| Spec invalid (`ok: false` with errors)             | Print errors; abort. The user fixes the spec and re-invokes.                            |
| Pending hand-off's `kind` is unknown               | `PENDING — unknown kind`; continue with other items.                                    |
| Sub-agent returns but mtime unchanged              | `PENDING — sub-agent did not edit`; continue. No retries.                               |
| Sub-agent fails / throws                           | `PENDING — sub-agent failed: <message>`; continue.                                      |
| Re-render after recording still shows the item pending | `PENDING — re-render did not resolve <id>`; surface and abort. Likely contract drift. |

There are no retries in v1 — the user can re-invoke the skill after
inspecting whatever the sub-agent did (or didn't) do.

## Notes for future hand-off kinds

Implemented kinds (as of ADR 046):
- `entity_adapter` — per-adapter hand-off for an ejected entity (with
  `memory`, `sqlserver`, and `postgres` adapter-id variants). A `readonly`
  entity with no `repo_port_extensions` is seeded complete (no
  `NotImplementedError`): record + re-render without dispatching — same
  shape as the claims-mapper SKIP path. See "Brief: entity_adapter
  (memory/sqlserver/postgres)" above.
- `entity_method` — domain-method body hand-off (ADR 039). One hand-off
  per declared entity method; the pending/resolved/record loop is reused
  as-is. See "Brief: entity_method" above.
- `custom_port_adapter` — per-backend custom-port adapter hand-off (ADR
  042). One hand-off per (port, backend) pair; uses per-method stub markers
  so a partially-filled port legitimately stays pending across multiple
  passes. See "Brief: custom_port_adapter" above.
- `custom_uc_workflow` — custom use-case workflow body hand-off (ADR 043).
  One hand-off per custom UC; single body per file so a single pass
  suffices (no per-method aggregation). See "Brief: custom_uc_workflow"
  above.
- `domain_service_body` — domain service module hand-off (ADR 046). One
  hand-off per service module; uses per-function stub markers so a
  partially-filled service legitimately stays pending across multiple
  passes (the `custom_port_adapter` shape, NOT the single-body
  `custom_uc_workflow` shape). A module with some functions implemented
  and others still stubbed is correctly still pending — re-dispatch until
  all function markers are removed. See "Brief: domain_service_body" above.

When new kinds land:

- Add a brief template below this one with the same shape.
- The pending/resolved/record loop above is reusable as-is — only the
  brief content changes per kind.
- A future hand-off shape may grow a `read_also: string[]` field
  (paths the brief should mention as reading material). The current wire
  doesn't carry it, so today's brief lists only `impl_target_file` and
  `spec/architecture.yml`.
