---
name: ui
description: Build a served single-page application for a rendered archascode project — full CRUD over every entity in the API contract, or reconcile an existing UI against the current contract. Routes both "build me a UI" / "give this project a frontend" requests and "update the UI to the new shape" / drift-fix requests. Accepts an optional free-text request to steer shape and priority or to describe a modification.
---

# /archascode:ui

A scaffolder and contract reconciler for a project's served frontend,
not a UI-authoring interview. This skill owns four things: the two
spec keys that make a frontend and the API coexist cleanly, a Vite +
React + TypeScript + Tailwind scaffold, a typed client hand-written
from the project's real generated routes, and a build/boot proof that
the result actually serves.

**The scaffold's default output is a working application over the
whole contract, not a proof page.** Every entity the extracted schema
carries gets its full CRUD surface, every custom operation gets a
place to be invoked from, and the client covers every operation in the
schema. A bare invocation builds all of it; the free-text request
steers shape and priority, it does not unlock scope. What the skill
does *not* do is interview the user about page design — it derives the
surface mechanically from the contract, and leaves taste, product
judgment, and anything the contract cannot imply to the request
argument and to ordinary follow-on coding sessions in the project's
own UI directory.

Throughout, **`<ui-dir>`** means the parent directory of the spec's
declared `ui.dist` path (default `ui/dist`, so `<ui-dir>` defaults to
`ui/`). Every path below written as `<ui-dir>/...` follows whatever
the spec actually declares.

## Arguments

- `$ARGUMENTS` (optional) — free-text steering, e.g. "lead with the
  pipeline view" or "add a bulk-import screen" or "update the UI to
  the new shape". Presence of a request, not any keyword, selects the
  lane (see Dispatch, below) — there is no positional verb to type.

  A request **steers** the build; it does not gate it. The scaffold
  covers the whole contract either way (see The application), and a
  request shapes emphasis, layout, and priority on top of that
  coverage — it is never the thing that unlocks building more than one
  page.

```
/archascode:ui
/archascode:ui add a page that lists orders
/archascode:ui update the UI to the new shape
```

## Dispatch

Two observables decide the lane: whether `<ui-dir>` already exists,
and whether `$ARGUMENTS` carries a request.

| | no request | request |
|---|---|---|
| **`<ui-dir>` absent** | **scaffold**: full app over the whole contract | **scaffold**: the same full app, its shape and priorities steered by the request |
| **`<ui-dir>` exists** | **status-and-ask**: contract check, state report, offered options | **modify**: apply the request |

Two rules bind the exists-row:

- Every invocation where `<ui-dir>` exists runs the contract check
  (see Contract marker and drift, below) **first**, and surfaces its
  result — as the body of a status report, or as a fact line stated
  ahead of a modify's own work.
- The update lane (render → extract → diff → reconcile) is entered
  only by user intent: it is one of status-and-ask's offered options
  when drift is found, or it runs because the request itself asks for
  it, or because the user confirms an offer made on a drift fact line.
  A request that asks for unrelated work while drift happens to exist
  gets that work done, plus the drift fact reported — the fix is its
  own separately confirmed step, never bundled in silently.

Scaffolding happens once. The scaffold lane never runs over an
existing `<ui-dir>` — status-and-ask owns that cell, and re-scaffolding
is not one of its offered options. A fresh start is the user's own
call: delete `<ui-dir>` and invoke again. This skill never deletes
`<ui-dir>` or anything inside it, beyond the two `.gitignore` lines
named under Gitignore fix, below.

## Preconditions and stop lanes

Check in this order; the first miss stops the run with the stated
message and pointer.

1. **Rendered project.** `.archascode/environments.json` exists. If
   absent: print `no .archascode/environments.json — render first`
   and point at `/archascode:apply`, then stop. A spec with nothing
   rendered behind it has no routes to build a client against and no
   mount to serve from.
2. **Current schema version.** If the file's `schemaVersion` is
   present but not `1`, stop — fatal, do not guess at a translation:
   print the mismatch and point at re-rendering with a current
   toolchain.
3. **Initialized project.** A `.venv` exists and `uv run` succeeds
   against it. If not, stop and point at `/archascode:init`.
4. **Logged in** (scaffold and update lanes only — both re-render,
   which is a network call). Run the render (see Spec suggestion,
   below); if it exits non-zero with no JSON on stdout, read its
   stderr. When the message is the CLI's own not-logged-in text, stop,
   point at `/archascode:login`, and park the rest of the run for a
   re-invocation after sign-in. A non-zero exit whose stderr says
   something else is its own factual stop — surface the CLI's message
   verbatim, do not guess a login problem where there is none.
5. **Node toolchain** (any lane that will touch `<ui-dir>`). `node`
   and `npm` are both on PATH. If either is missing, stop and state
   plainly: serving the built dist needs no node at all (it ships
   committed), but building or scaffolding it does — install Node and
   re-invoke.

## The spec suggestion

When the spec declares neither key, the scaffold lane proposes exactly
this two-key block:

```yaml
api:
  base_path: /api
ui:
  dist: ui/dist
```

Present it with the two facts that justify it: a single-page app's own
client-side routes can be named the same as this project's generated
business routes (e.g. a `/customers` page next to a generated
`/customers` endpoint), and moving the API under `/api` removes that
collision; the reserved system routes — `/health`, `/docs`,
`/openapi.json`, the seed-admin route — are unaffected by the prefix,
so nothing that already depends on them moves.

Confirm the write with `AskUserQuestion` before touching the file.
Apply it as a comment-preserving edit using the same round-trip
mechanism `/archascode:init` and `/archascode:analyze` already use:
`uv run --no-project --with 'ruamel.yaml' python -` reading and
rewriting the spec through `ruamel.yaml`'s round-trip loader, so
existing comments, key order, and formatting elsewhere in the file
survive untouched.

Adopt rather than author, per key, when a key is already present:

- **`api.base_path` already set** (any value, including the empty
  string) → keep it verbatim, never rewrite it. State the collision
  fact only when the existing value is empty or absent-equivalent —
  a real prefix already does the job silently.
- **`ui:` already declared** → keep it. Target `<ui-dir>` as the
  spec already defines it (its declared `dist`'s parent directory,
  which may not be `ui/`), and pin the build output to the declared
  `dist` tail so the mount and the build always agree.

This skill's spec-write license is exactly these two keys, in the
scaffold lane only, and only after the confirmation above. It never
touches the auth stratum — `api.auth`, `adapters.auth`, or any
environment's auth pick stay with the plugin's Adapter panel and with
`/archascode:analyze`; writing `api.auth.type` as an unrelated side
effect would flip the whole project's default endpoint posture, which
this skill has no business doing. The modify and update lanes write no
spec keys at all.

**The scaffold lane renders unconditionally after this step, whether
or not it wrote anything** — even full adoption (both keys already
declared) can predate the last render, and both extraction and the
boot probe below need the mount and the prefixed routes to actually
exist. The render carrier is the bare CLI verb:

```bash
archascode render --json
```

run directly, never a delegation to `/archascode:apply` (which also
dispatches hand-off resolution agents — heavier than this lane needs).
The update lane's render (see Contract marker and drift) uses the same
carrier.

## Stack and scaffold

The stack is pinned: Vite + React + TypeScript, matching the plugin's
own webview stack, plus Tailwind for styling and a client-side router.
Scaffold non-interactively — the
`npm create vite@latest <dir> -- --template react-ts` spelling class,
run from a shell that never waits on a prompt — then add the pinned
dependencies in the same lane.

**Tailwind is pinned, not optional.** Install it and its Vite plugin,
wire the plugin into `vite.config.ts`, and put the single import line
in the app's root stylesheet. Install whatever the current major of
Tailwind sets up — read the version you actually installed rather than
assuming a config shape, since the v3 (`tailwind.config.js` +
PostCSS + three `@tailwind` directives) and v4 (`@tailwindcss/vite`
plugin + one `@import "tailwindcss"`) spellings differ and a
half-applied mix of the two silently produces an unstyled build. If
Tailwind cannot be installed, that is a reportable failure, not a
reason to hand-roll CSS instead.

**A router is pinned too.** A multi-page app needs real client-side
routes, and the deep-link probe (see Build, boot, probe) needs a route
the router owns. Use an established router rather than hand-rolling
`popstate` — a hand-rolled one costs the same to write, and every
follow-on session pays for it again.

Three further obligations ride the scaffold:

- Set `build.outDir` in the generated `vite.config.ts` to the declared
  `dist` tail (relative to `<ui-dir>`, default `dist`) — a stock
  scaffold building to `dist/` under an adopted `ui.dist: ui/build`
  would serve nothing, since the mount reads the spec's `dist` value
  verbatim.
- Add a `server.proxy` entry mapping the `base_path` prefix to the
  local app's origin, so `npm run dev` works against a locally running
  app. The proxy **must also include `/auth/config` and `/health`**:
  both are unprefixed system routes that sit outside `base_path`, and
  an unproxied `/auth/config` under `npm run dev` hits Vite's own SPA
  fallback and answers `200` with `index.html` — neither a 404 nor a
  fetch error, and exactly the shape the boot-fetch fallback (see Auth
  posture and the 401 app) is built to catch. This proxy is a
  development convenience; the supported proof loop is the built dist
  served by FastAPI itself (see Build, boot, probe). State both loops
  in the report.
- Delete the stock scaffold's demo surface — the counter `App.tsx`,
  its CSS, and the bundled logo assets — rather than building the real
  app around it. Leaving Vite's placeholder content in a delivered
  application is a defect, not a neutral leftover.

## Contract extraction

The contract source is the project's own served OpenAPI schema,
extracted without booting a server — importing the app and calling its
`openapi()` builds the full schema, security defaults included, with
no port bound:

```bash
APP_PORT_BINDING=memory uv run python -c \
  "from api.main import app; import json; print(json.dumps(app.openapi(), sort_keys=True))"
```

Run this from the project root, always **after** the lane's render (so
extracted paths carry the `base_path` prefix), and write its output to
a scratch file — never straight to the marker path; the marker is
written only at the specific events named under Contract marker and
drift. `APP_PORT_BINDING=memory` pins environment resolution so the
import never tries to file-resolve a real environment; it relies on
the rendered adapters reading their configuration lazily rather than
at import time, so extraction itself has no side effects. If the
import fails, that is a real finding — report it plainly rather than
working around it.

## The client

Hand-write the client from the extracted JSON — a typed fetch layer
under `<ui-dir>/src/api/`. No codegen toolchain: the agent reads the
local JSON file directly and writes the functions and types itself.

**The scaffold's client covers every operation in the extracted
schema** — one exported function per `operationId`, with request and
response types written from the referenced component schemas, and
enums written as TypeScript unions from the schema's enum members.
Coverage is mechanical and complete: an operation the schema carries
but the pages do not yet call still gets its client function, because
the client is a typed mirror of the contract, not a bag of helpers the
current pages happen to need. Route the whole layer through one
`request` helper that owns the `base_path` prefix, JSON handling, and
error shaping, so the update lane has a single place to reconcile.

Model the error shape on what the API actually returns rather than on
`response.statusText`: the engine answers with an RFC 7807-style body
carrying `title`, `detail`, and a machine-readable `code`. Parse it
and expose those fields — pages need the `detail` string to show a
useful validation message, and `422` bodies carry per-field errors
worth surfacing on the form that caused them.

## The application

The scaffold builds a working application over the whole contract. The
surface is **derived from the extracted schema, not invented**: read
the schema's paths and tags, group operations by the entity they
belong to, and build the surface each group's operations imply.

Per entity, the default surface is:

- **List page** — the collection `GET`, rendered as a table over the
  entity's own scalar fields, with the empty and error states below.
- **Detail page** — the by-id `GET`, showing the full record,
  including its related-collection sub-routes (a
  `/companies/{id}/contacts`-shaped path is the related list on the
  Company detail page, not a page of its own).
- **Create** and **edit** forms — the `POST` and `PUT`/`PATCH`
  operations, with inputs typed from the input schema: enums as
  selects over their real members, optional fields actually optional,
  numeric and date formats using the matching input types, and
  required-field validation matching the schema's `required` list.
- **Delete** — the `DELETE` operation, behind an in-page confirmation.
  Never a `window.confirm`.

Beyond the per-entity CRUD, three rules cover what is left:

- **Custom operations get a home.** An operation that is not standard
  CRUD — a state transition like `move-stage`, an application-level
  read like a dashboard — is surfaced where its subject lives: the
  transition as a control on that entity's detail page, driven by the
  operation's own input schema; the application-level read as its own
  page. Do not leave a contract operation with no way to reach it.
- **Batch operations are client-covered but need no page.** They get
  their client functions like everything else; a UI for them is
  request-driven, not default.
- **Navigation ties it together.** A persistent nav lists every entity
  and every standalone page. The app's index route is the dashboard
  when the contract carries one, and otherwise the first entity's
  list.

Shared surface — layout, nav, table, form field, empty state, error
state, loading state — belongs in components under `<ui-dir>/src/`,
written once and reused, not copied per page. A follow-on session
editing one page should not have to find six copies of the same table.

Two scope limits hold. The skill does not invent surface the contract
does not imply: no analytics the API cannot answer, no settings pages
for settings that do not exist, no fictional workflows. And it does
not interview the user about design — the request argument steers
shape and priority, and everything else follows from the schema.

## Auth posture and the 401 app

The full application is built **whether or not any route resolves
anonymous**. When the contract requires a bearer everywhere, the
scaffold still builds every page, every form, and every client
function — and every request answers `401` until the project's auth is
wired.

This skill implements no sign-in flow, no token storage, and no
token-entry affordance. What it does implement is an honest display of
the state it is in:

- The client exposes a single seam for supplying a bearer — one
  exported setter, unused by the scaffold's own code — so a follow-on
  session or the auth skill has an obvious place to connect.
- **The client fetches `/auth/config`** (same-origin) once at boot and
  exposes the result through a second exported accessor, placed beside
  the bearer setter — the runtime discovery point a follow-on sign-in
  wiring session (`clerk/skills`, or hand-written) reads instead of
  hardcoding a posture. **The fallback is pinned fail-closed**: any
  response that is not a JSON object carrying a boolean `verifies`
  field — a 404, a fetch error, or an HTML page from an unproxied dev
  server alike — is treated exactly as if the endpoint does not exist,
  and the accessor reports the posture the extracted schema already
  implies (the pre-existing, build-time behavior). Absence of the
  endpoint must never make the app read as more open than the schema
  says.
- **This is display, not gating.** The reactive `401` handling below
  is unchanged — anonymous-resolving routes keep working tokenless
  even when `/auth/config` reports `verifies: true`, per the entity
  auth cascade. What the fetched posture changes is language: under
  `verifies: false`, the app has nothing to be honest about, so the
  auth-gap language (the `401` state and the `/archascode:auth`
  pointer) is suppressed — every request already succeeds. Under
  `verifies: true`, the "not signed in" state may go further than a
  generic gap notice and name the runtime posture it read — the
  adapter `kind`, and for a jwt posture, the issuer it found or its
  absence. The api_key row is unchanged either way: a browser bundle
  cannot hold the key, so posture is reported and nothing is gated.
- A `401` renders as a distinct, app-wide "not signed in" state
  naming the gap and pointing at `/archascode:auth`, not as a generic
  error and never as an empty list. Distinguishing `401` from other
  failures is a display concern; it is not auth-aware client
  behavior.

**Because a bearer-required contract makes runtime success
unobservable, the scaffold's correctness bar is contract fidelity
rather than a live `200`.** Before the build, verify against the
marker JSON that: every `operationId` in the schema has a client
function; every client function's path, method, and parameters match
its operation; and every referenced component schema has a
corresponding type. Report the result as a covered-count. A mismatch
is a real finding to fix, not a note to pass along — this check is
what stands in for the round-trip the auth posture denies.

## Contract marker and drift

The marker is the extracted schema written canonicalized (the
extraction one-liner's `sort_keys=True` output, verbatim) to
**`<ui-dir>/src/api/openapi.json`** — inside the committed UI tree,
beside the client it was built against.

Every invocation where `<ui-dir>` exists opens with a drift check:
extract fresh, then byte-compare against the marker.

- **Equal** → the tree was built against the current API shape; state
  this plainly.
- **Different** → read both JSON documents and summarize the changed
  paths and schemas as a drift report.
- **No marker present** (`<ui-dir>` exists but
  `<ui-dir>/src/api/openapi.json` does not — a hand-built UI, or a
  deleted marker) → report "unmanaged UI — no contract marker" instead
  of a verdict.

The status-and-ask lane's check compares against the last render, and
its report says so plainly — a spec edit made since then would not yet
show up. The update lane closes that gap by construction: it always
renders first, so the comparison always includes whatever the user
just changed.

**The marker is written at exactly three events**: the end of a
successful scaffold, the end of a successful update (see Build, boot,
probe for what "successful" gates on), and a confirmed adoption over
an unmanaged tree (extract and write the marker only — no client
edits, since adoption records the contract as of now and leaves the
question of whether the existing UI matches it to the next run's drift
check). Offer adoption as its own explicit, separately confirmed step
from status-and-ask.

**Client-surface changes are licensed by a marker diff** — only the
update lane may change an existing client function's path, parameters,
types, or presence, driven by the old-marker/new-extraction diff:
touch the changed surface first, then walk `<ui-dir>/src` for usages
of the changed operations and fields, fixing call sites and types.
Leave everything the diff doesn't implicate alone — no wholesale
client rewrite, ever. A cosmetic modify request never rides a drift
fix in on its own, whether or not drift happens to exist.

Because the scaffold covers the whole contract, the update lane's diff
carries page-level consequences too, and they follow the same
diff-scoped discipline:

- **An operation added** to the contract gets its client function, and
  the page surface its kind implies under The application — a new
  entity gets its pages and its nav entry; a new custom operation gets
  its control on the subject it belongs to.
- **An operation removed** has its client function and the surface
  that existed only to call it removed with it.
- **A schema field changed** propagates to the types, and to the
  tables, forms, and detail views that render it.

The diff is still the license and still the limit: the update lane
reconciles what changed and leaves the rest of the app alone. A large
diff means a large reconcile, never a regeneration of pages the diff
does not touch — an update must not discard hand-written work in
untouched pages.

**Client additions are licensed in the modify lane** for operations
the committed marker already carries — "add an orders page" against an
endpoint the contract already lists is ordinary modify work, and may
add the client function it needs. A modify that needs a client change
that is not covered — a change to existing surface, or a wholly new
operation the marker doesn't carry — proceeds for every other part of
the request and parks the client-license-gated part, naming the update
(or adoption, if the tree is unmanaged) that would unlock it.

**The marker refreshes only after a successful build and boot probe**
(see Build, boot, probe) — never at extraction or detection time — so
a failed or abandoned update leaves drift still detectable on the next
run.

## Gitignore fix

The stock Vite scaffold's generated `.gitignore` ignores `dist`. Since
this project's served UI ships as a committed dist (the engine mounts
whatever is on disk at boot, and a build-from-repo deploy needs the
built files present), that default would silently strip the UI from
every such deploy while local dev kept working fine. The scaffold lane
edits the generated `<ui-dir>/.gitignore` in place immediately after
scaffolding: keep the `node_modules` rule, delete the dist-ignoring
rule and its comment. State this fix, and why, in the report.

`/archascode:init`'s own gitignore step already carries a matching
check that repairs a `ui/.gitignore` if it drifts back to ignoring
dist later — that stays the recurring safety net for hand-created or
later-broken states. This skill fixes the file at the moment it
generates it; the two texts describe the same rule without editing
each other.

## Build, boot, probe

Because the dist ships committed, an unbuilt edit is invisible locally
and stale in every deploy. So every lane that touched `<ui-dir>`
(scaffold, modify, update) ends with:

1. `npm install` in `<ui-dir>`, when `node_modules` is absent.
2. The contract-fidelity check (see Auth posture and the 401 app) —
   client coverage against the marker, reported as a covered-count.
3. `npm run build`. The pinned template typechecks as part of its
   build; a type error is a build failure, and a full-contract client
   makes that check load-bearing rather than incidental.
4. A background boot: `uv run uvicorn api.main:app` with
   `APP_PORT_BINDING=memory`, bound to an ephemeral local port.
5. Probes against that running instance:
   - `GET /` resolves to the SPA's `index.html` — proves the mount and
     the built dist are present and wired.
   - **Every** client-side deep-link path the app's router owns — one
     per entity list, one detail path, and each standalone page —
     resolves to `index.html`. A full app has many routes and the
     fallback must cover all of them; probing one is no longer enough.
   - One generated business route under the prefix, checked
     posture-aware: read the extracted schema's per-operation
     `security` field — `security: [{}]` means the route resolves
     anonymous, anything requiring a bearer means it resolves
     required. Pick the first anonymous-resolving route and assert it
     answers `200`. When no route resolves anonymous anywhere in the
     schema, assert `401` on any generated route instead — that still
     proves the mount and the prefix are wired correctly — and name
     the auth-shaped gap in the report rather than treating it as a
     failure. In that posture the contract-fidelity check above, not
     this probe, is what establishes the client is right.
   - `GET /auth/config` — assert `200` with a boolean `verifies`
     field. A `404` here is a **report line, never a failure**, and it
     has two distinct causes the report must not conflate: either this
     lane did not actually render (a modify run against an already-up
     project, for instance), or the render carrier hit a serving
     engine that predates this route — re-rendering again fixes
     nothing until that engine ships it. Report it plainly: "this
     render carries no `/auth/config` — the serving engine predates
     it; the SPA falls back to build-time posture" — and continue; do
     not stop the run over this probe.
6. Tear the background server down.

Exact port selection, readiness-wait mechanics, and process teardown
are left to the agent's judgment at run time; they are not part of
this skill's pinned contract.

A build or boot-probe failure stops the run without refreshing the
marker (see Contract marker and drift) and is reported under Failure
modes, below — leaving drift detectable on the next invocation is the
point, not a gap to work around.

## Report

Every lane's report, in this order:

1. What was written: spec keys (if any, scaffold lane only), the
   scaffold itself, client files touched or added, and whether the
   marker was refreshed. For the scaffold lane, state the surface
   built as counts — entities covered, pages, and operations the
   client covers out of the schema's total.
2. The gitignore-fix statement (scaffold lane) or its absence (other
   lanes never touch it again).
3. The contract-check result: built-against-current, a drift summary,
   or unmanaged. On a project whose UI predates the `/auth/config`
   route, the first post-upgrade drift naturally includes that route
   (and `/health`'s now-marked anonymous posture) — name this as
   expected one-time noise from the serving engine catching up, not a
   change worth investigating, and let the update lane reconcile it
   like any other drift.
4. Both dev loops: the proxied `npm run dev` loop, and the supported
   built-dist-plus-FastAPI proof loop.
5. Build, boot, and probe outcomes: the contract-fidelity
   covered-count, the build, every deep-link probe, and the
   posture-aware business-route probe's result.
6. The commit obligation, stated as a fact, never performed by this
   skill: commit `<ui-dir>/` **including its built `dist/`**, plus the
   spec edit if one was made. If the project has deployed environments,
   the UI ships to them only once the dist is pushed on the branch
   that environment deploys from.
7. The posture-dispatched tail:
   - `api.auth.type: jwt` → point at the `clerk/skills` repository as
     the frontend sign-in handoff, and note that `/archascode:auth`
     owns wiring the provider side. State plainly that the full app is
     built and served but every request answers `401` until auth is
     wired, and name the client's token seam as the connection point.
     Where the boot probe reached `/auth/config`, the tail may name
     the runtime posture it read back — the resolved adapter `kind`
     and, when present, the issuer — rather than only the spec-level
     `jwt` declaration.
   - `api_key` → state plainly that a browser bundle cannot hold a
     shared secret safely, so the UI serves anonymous-resolving routes
     only; the rest of the app is built and reports its `401` state.
   - no `api.auth.type` declared → nothing further to say.

   In every posture, state the scope plainly: this skill implements no
   sign-in flow, no token storage, and no auth-aware client behavior.

Also state two facts once, in any lane's report: `archascode clean`
never touches `<ui-dir>` and a render never writes to it (it's a
user-owned tree), and same-origin serving means there is no CORS
surface to configure — the deploy skill needs no changes to ship this.

## Failure modes

| Situation | Response |
|---|---|
| `.archascode/environments.json` absent | Stop: "render first", point at `/archascode:apply`. |
| `environments.json` `schemaVersion != 1` | Stop, fatal — never guess a translation. |
| No `.venv` / `uv run` fails | Stop, point at `/archascode:init`. |
| Render exits non-zero with the CLI's not-logged-in stderr text | Stop, point at `/archascode:login`, park the run. |
| Render exits non-zero for another reason | Stop, surface the CLI's message verbatim. |
| `node`/`npm` missing | Stop: serving needs no node, building does — install and re-invoke. |
| Contract extraction fails on import | Report the failure plainly; do not work around it. |
| Tailwind or the router fails to install | Stop; report it. Do not hand-roll a substitute — the stack is pinned. |
| Contract-fidelity check finds a gap | Fix it before building; an uncovered operation or mismatched signature is a defect, not a note. |
| `npm run build` fails | Stop; report the build error; marker is not refreshed. |
| Boot or a probe fails | Stop; report which probe and why; marker is not refreshed. |
| `<ui-dir>` exists with no marker (unmanaged) | Report "unmanaged UI — no contract marker"; offer adoption as its own confirmed step; non-client modify work proceeds, client-license work parks. |
| Modify needs a client change outside the license | Do the rest of the request; park the licensed-gated part, naming what would unlock it (update, or adoption). |
