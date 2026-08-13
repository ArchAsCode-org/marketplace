---
name: auth
description: Identity-provider reconcile for a jwt-declared archascode project — an interview + plan/confirm/apply loop over the Clerk CLI that adopts or creates the Clerk application, converges session-token claims so the seeded claims mapper populates email/name/roles, derives and writes AUTH_JWKS_URL/AUTH_ISSUER into gitignored .env.<env> files, and proves the loop with a headlessly minted token. Clerk is the only v1 provider. Accepts a declared environment name as an argument to scope the run.
allowed-tools: Bash(npx -y clerk whoami:*), Bash(npx -y clerk auth:*), Bash(npx -y clerk api:*)
---

# /archascode:auth

Converge a real identity provider's state — application, instance
configuration, local env values — with a project's declared `jwt`
auth need. This skill is standalone and parallel to `/archascode:db`:
skills are named by what they reconcile, and `db` reconciles actual
schema state while `auth` reconciles actual provider state. **Clerk is
the only v1 provider**; additional providers (Auth0 first candidate)
fork inside this skill's interview later, each preceded by its own
spike — no new skill, no structural change expected.

Every run of this skill is a **reconcile**: it reads the project's
declared jwt need, resolves which environments are in scope, compares
desired state against the provider's real state, and applies only what
the user confirms. There is no separate first-run mode — the first run
is this same flow starting from an empty local `.env.<env>`.

## Arguments

- `$ARGUMENTS` (optional) — a declared environment name, free-text
  steering, or both. Resolution mirrors `/archascode:deploy`'s grammar:
  - **First token exactly equals a declared environment name** → a
    **scoped run**: only that environment narrows the run (see Run
    scope, below); any remaining text is prose steering for it.
  - **`$ARGUMENTS` is a single token matching no declared environment
    name** → never guess and never silently fall through to a
    whole-project run: ask via `AskUserQuestion` — the near-matching
    declared name (if one is close), "treat as steering", or cancel —
    and proceed only on the answer.
  - **Anything else** is free-text steering that pre-answers interview
    questions (e.g. "skip the smoke leg", "use the Development
    instance"). A question the free text already answers is skipped;
    everything else is still asked.

```
/archascode:auth
/archascode:auth prod
/archascode:auth qa skip the smoke leg this time
/archascode:auth skip the smoke leg this time
```

## Run scope

Every rule below is written over "in-scope environments"; this section
defines that set once. An environment is **in scope** iff its
`.archascode/environments.json` entry's engine-resolved
`appAdapters.auth.id` equals `jwt_bearer` (absent field → `noop`, the
`/archascode:apply` reader fallback — `environments.json` is
**camelCase throughout**: `appAdapters`, not `app_adapters`). This
skill **never re-derives binding resolution from the spec** — the file
already carries the engine's own answer, the same reader precedent
`/archascode:apply` uses for the claims-mapper hand-off trigger. When
the spec's `api.auth` stratum visibly disagrees with what the file
resolved (the stratum was edited since the last render), the answer is
**"render first"** (`/archascode:apply`), never a hand re-derivation.

Memory-bound environments qualify — a memory port binding with
`jwt_bearer` resolved is exactly as in scope as a SQL-bound one.

**Scoped-run semantics**: naming an environment narrows the
environment *set*, but a shared per-instance resource (an in-use Clerk
instance) may still be needed by an out-of-scope environment mapped to
the same instance — the plan still shows and confirms that shared line,
naming every mapped environment on it, in-scope or not (single-homed
under Procedure, below).

## Permission posture

This skill's frontmatter carries an `allowed-tools` grant covering
three npx-clerk verb families (`whoami` / `auth` / `api`), so a default
auto-mode run needs no permission setup for the Clerk CLI calls it
makes.

**Invocation form is pinned to the npx-clerk prefix** uniformly — no
install step, and every grant entry shares one stable prefix family.
The bare clerk binary (no `npx -y` prefix) is a rejected alternative
(it would require an install step and double every grant entry for
zero capability).
**Granted invocations run bare** — no redirection, no capture via
`>`/`>>`; redirection defeats the grant's prefix match.

**The layered-control statement.** `Bash(npx -y clerk api:*)` knowingly
covers a verb that *could* spell destructive calls — Clerk's CLI is
effectively single-verb (every Platform API call rides
`npx -y clerk api --platform <path>`), which defeats a railway-style
carve-out-by-verb-spelling (there is no second verb to carve out). The
compensating control is layered, and each layer is precise about what
it carries:

1. **The skill body contains no destructive spelling** — there is
   nothing in this body to faithfully execute that would delete
   provider state.
2. **The assembly scan enforces that absence for the known destructive
   vocabulary** — curl's DELETE-method spellings, with the single
   licensed smoke-teardown exception below (named in words here; the
   method token is never spelled in this section).
3. **Every write rides a confirmed plan line** — nothing in the claims
   or env-value vocabulary applies without an `AskUserQuestion`
   confirmation.

The Platform API's **destructive vocabulary is unobserved** — no spike
saw one. For that arm, the control is the confirm gates plus
first-live-use audit, **not** the scan: the scan cannot enforce absence
of a spelling nobody has seen yet.

**Two credential tiers, disjoint blast radii:**

- **The workspace CLI session** (`npx -y clerk auth login`, browser
  PKCE, loopback — run in the background with the URL relayed the
  moment it appears, the `/archascode:login` UX class) backs every
  `npx -y clerk api --platform` read and write. Its blast radius is the
  **whole workspace** — every application the logged-in account can
  see — which is exactly why every claims/env write below is
  plan/confirm-gated.
- **The per-instance secret key** backs only the D5 smoke calls. It
  enters **only** via the gitignored `.env.<env>` (the seeded
  `# CLERK_SECRET_KEY=` comment line), is **never typed into chat** (a
  typed reply kills the `allowed-tools` grant — spiked harness
  physics — and a secret does not belong in a transcript), is never
  persisted anywhere else by this skill, and is never echoed. An absent
  key means the smoke leg is **skipped** with a fill-in instruction,
  not blocked. `CLERK_BAPI_SCOPES`-scoped keys are a narrowing option a
  user may set up on their own; this skill neither requires nor gates
  on them.

**The ungranted-curl seam** (the `/archascode:deploy` `environment
edit` pattern): the Backend API smoke calls in D5 ride plain `curl`,
deliberately outside both the extraction grammar and the grant — the
harness's own prompt or classifier friction stacks on the already-
confirmed smoke plan line. The secret key expands from a shell variable
read out of `.env.<env>`, so the literal value never appears in a
command line or the transcript. A denial there takes the fallback lane
below (skip the leg, report it).

**Every question and confirmation uses `AskUserQuestion`** — never a
"reply yes to continue" prose prompt. This is load-bearing: the grant
survives an answered `AskUserQuestion` but dies at the next typed user
message. `$ARGUMENTS` free-text steering is unaffected — it arrives
with the invocation turn itself.

If the user types a message mid-run (their prerogative), keep working
but treat the grant as gone from that point on: any subsequent denial
enters the fallback lane, and the final report may recommend
re-invoking `/archascode:auth` — re-invocation re-establishes the
grant, and the reconcile model makes the rerun idempotent by
construction.

### On any permission denial

1. **Stop that action.** Never re-phrase, re-route through another
   tool, or otherwise engineer around the denial.
2. **Offer exactly two exits:**
   - The verbatim command as a `!`-prefixed one-liner the user runs
     in-session.
   - The settings-rule route below, with the plain statement that
     written rules take effect from the **next** session.
3. **Park, don't fail.** Steps depending on the denied action are
   parked and appear in the final report as `blocked (permissions)`. A
   later rerun picks parked work up by reconcile construction.

**The settings-rule offer** is lazy and **reactive-only** — it appears
only after an actual denial, mirroring `/archascode:deploy`'s A1-D5
posture. Before offering, best-effort preflight: read
`~/.claude/settings.json`, `<project>/.claude/settings.json`, and
`<project>/.claude/settings.local.json` (a missing file means no
rules), and prefix-match the denied command's prefix against each
file's `permissions.allow`. If covered, skip the offer.

When offered, ask **one** `AskUserQuestion` with four scopes:

- **user** (`~/.claude/settings.json`) — follows the person across
  projects.
- **project, tracked** (`.claude/settings.json`) — the only scope a
  teammate inherits via the repo; **the one licensed exception** to
  this skill's zero-tracked-writes rule (see "What this skill does NOT
  do") — write only under this explicit choice, show the exact JSON
  diff first, and never commit it.
- **project, local** (`.claude/settings.local.json`) — this machine,
  this project only.
- **skip** — proceed under the grant plus the fallback lane alone.

The write merges into existing JSON (never clobbers), and writes only
the denied command's prefix. Sequencing pin: a rule written now helps
no command in this session — offer, then write or skip, then proceed
to attempt the confirmed action regardless, under prompt-or-classifier
with the fallback lane above as the net.

## Preconditions

Checked in order; each is a stop-and-explain, never a stack trace.

1. **Rendered project.** `.archascode/environments.json` exists.
   Absent → stop: "render first" (`/archascode:apply`) — ADR 099's
   rule restated: absence means "never rendered or cleaned."
   `schemaVersion != 1` → the same stop, fatal — never resolve against
   a stale table.
2. **The spec declares a jwt need.** `api.auth.type: jwt` must be set
   somewhere the resolved binding can see it. This gate deliberately
   does **not** require a top-level `adapters.auth` block — a
   binding-level `app_adapters.auth: jwt_bearer` selection alone is
   render-legal and must pass. On failure the message derives from
   what is actually missing:
   - **No `type: jwt` anywhere** → name the posture keys
     (`api.auth.type`, `api.auth.scheme`) and the editing lanes:
     `/archascode:analyze`, or a hand edit of `spec/architecture.yml`.
     Note the planned `wire auth` mode as the future blessed entry —
     a pointer, not a dependency, since it has not landed.
   - **`type: jwt` present but zero environments resolve to
     `jwt_bearer`** → list each declared environment's resolved
     `appAdapters.auth.id` so the user sees *why* nothing is in scope.
3. **Degenerate scopes are first-class outcomes, never silent no-ops:**
   - Empty `environments` table → "no environments declared" —
     render seeds one, or declare them (`/archascode:deploy`'s arm).
   - A gate-passing spec with **zero** in-scope environments → the
     same resolved-adapter listing as item 2's second bullet.
   - A scoped run naming a declared but out-of-scope (e.g. noop-bound)
     environment → the same explanation, scoped to it.
4. **`api_key` mode is out of scope by construction.** It has no
   provider — nothing external to reconcile (ADR 107 owns the
   adapter; the completing `wire` mode is a future ADR, not this
   skill's job).
5. **Authenticated.** `npx -y clerk whoami` succeeds. If not, run
   `npx -y clerk auth login` **in the background** (the
   `/archascode:login` pattern: the activation URL prints as soon as
   the flow starts), relay the activation URL to the user the moment
   it appears, poll until the background task exits, then re-check.

## Desired state and provenance

**Platform-is-the-record.** There is no provider state file, no spec
field (`spec/architecture.yml` never grows a `provider:` key — the
adapter-versus-provider fence is load-bearing: `jwt_bearer` names an
adapter, not Clerk), and no tracked local record of any kind. The only
local pointer — because it already has to exist for the rendered app
to run — is the `AUTH_ISSUER=` line already present in each
`.env.<env>`.

### The application resolution ladder (run at plan time)

1. **Adopt-from-values.** Read `AUTH_ISSUER` from every in-scope
   `.env.<env>` present locally; derive each instance domain from it;
   match against the workspace inventory
   (`npx -y clerk api --platform /platform/applications`, which
   returns applications and their instances including publishable
   keys — publishable keys decode to instance domains, so discovery
   needs no prior knowledge). A match **adopts the application
   silently** — no existence question.
2. **No values found anywhere** → `AskUserQuestion` listing the
   workspace's applications, a project-directory name match
   preselected as the suggestion, plus a create-new option. The
   creation verb rides the same Platform API; its exact spelling is
   verified against the installed CLI at run time (its precise form is
   unspiked and is audited on first live use — the
   `/archascode:deploy` verb-spelling-hedge pattern: never guess at a
   replacement spelling if the installed CLI's `--help` doesn't show
   it, degrade to a reported manual dashboard step instead).
3. **Conflicting derivations** — two in-scope environments' values
   pointing at different applications → report the conflict as fact
   and stop-and-ask.

**v1 fence: one Clerk application per project.** A second-application
QA-isolation shape is a named deferral (Notes, below) — this skill
never proposes it.

## Instance mapping

A Clerk application has exactly **two instances** — Development and
Production. The mapping from N declared environments onto them is
interview-owned, asked **once per environment** at first mapping via
`AskUserQuestion` (the `/archascode:deploy` branch-mapping ask-once
precedent):

- **Development is preselected** for every environment except one
  whose *name* is exactly `prod` or `production`, where Production is
  the suggestion instead. The name is the honest heuristic — the
  `data` axis is deliberately **not** used as a signal (a `qa`
  environment is routinely `protected`; posture does not imply
  instance).
- **Mapping provenance is the issuer value.** An environment whose
  `.env.<env>` already carries an `AUTH_ISSUER` resolving to one of
  the adopted application's instances is mapped **by adoption** — no
  question asked. Only unmapped environments get the interview
  question.
- **Every adopted mapping is a plan-screen fact**, shown, never
  re-asked. A **suspicious mismatch** — an environment named
  `dev`/`qa` adopted onto Production, or `prod` onto Development — is
  flagged on that fact line as suspicious-but-adopted, **report-only**:
  adoption still stands (a stale hand-copied `.env` is exactly how a
  wrong-instance mapping arises, and the flag is how the user
  notices). Changing a mapping is only ever an explicit user request.
- **Multiple environments per instance is the expected shape** — `dev`
  and `qa` both sharing Development's issuer is normal, and Development
  is where `+clerk_test` addresses and fixed-OTP test mode live.

**Production is a full lane, not a park.** Claims config (below)
writes identically to Production — per-instance config, the same
carrier, instance-symmetric. Two Production-specific realities are
handled asymmetrically:

- **Domain/DNS** (Production requires a real domain; production
  issuers are `clerk.<domain>`-shaped) is **dashboard-referenced**: an
  informational plan line with a pointer. This skill never drives DNS.
- **The headless smoke mint** is spike-verified on Development only —
  production behavior (rate limits, whether session-minting stays
  enabled) is unverified. The Production smoke leg therefore
  **attempts and degrades**: on failure it reports
  `configured (smoke unverified)` rather than blocking the run or
  flagging a warning. First live production use is the audit moment.

## Owned vocabulary — claims

Per **in-use instance** (an instance mapped by at least one in-scope
environment), this skill owns exactly three `session.claims` keys,
pinned to the shape the seeded `claims_mapper` consumes with zero
customization:

```json
{
  "email": "{{user.primary_email_address}}",
  "name": "{{user.full_name}}",
  "roles": "{{user.public_metadata.roles}}"
}
```

**Ownership is per-key** — a stated divergence from
`/archascode:deploy`'s Explorer CORS whole-value model, because
Clerk's claims *merge*: a user may legitimately add sibling claims for
their own frontend, and whole-value ownership would de-own the surface
the moment they did. Per key:

- **absent** → the plan proposes adding it (the normal converge).
- **present with the pinned value** → owned, converged, no action.
- **present with a different value** → **hand-managed collision**:
  reported as fact, never rewritten — a request to "fix" it is a
  stop-and-explain, not a rewrite (the user's mapping is their
  contract with their own token consumers).
- **any other key** in `session.claims` → preserved verbatim, reported
  as hand-managed context, never touched.

**Write mechanics** are a read-modify-write: read the config (plus its
`config_version`), splice in only the owned keys, PATCH, then **read
back** — the load-bearing check. `If-Match` optimistic concurrency is
attempted; when the endpoint rejects or ignores it, degrade to
read-back-compare with one re-read-and-retry.

**The plan surface is the carrier's own `dry_run=true` before/after
diff** — the plan line shows the actual diff the API computes, never a
predicted one. A same-value write is a no-op by `config_version`
semantics — nothing changes, nothing to confirm beyond the normal
convergence line. All claims spellings ride
`npx -y clerk api --platform …`.

## Owned vocabulary — env values

Per **in-scope environment**, this skill owns two derived lines:

```
AUTH_JWKS_URL=https://<instance-domain>/.well-known/jwks.json
AUTH_ISSUER=https://<instance-domain>
```

derived from the mapped instance's publishable key, **confirmed** by a
`GET /.well-known/openid-configuration` fetch (issuer + JWKS) before
writing. Three-state classification per key, same shape as claims:

- **absent** → write.
- **matching the derived value** → adopted, no action.
- **different** → reported, stop-and-ask (it may be another provider,
  or a hand-managed setup).

**`AUTH_AUDIENCE` is never written for Clerk** — Clerk tokens carry no
`aud` claim, and the adapter's skip-arm already covers an unset value.
Do not "complete" the pair into a triple. An existing **non-empty**
`AUTH_AUDIENCE` value is reported with a warning (it would fail
verification against a Clerk token) but never deleted. An **empty**
`AUTH_AUDIENCE=` line — the common case for a post-ADR-107 seeded env —
is harmless and draws no warning.

The write also seeds a commented `# CLERK_SECRET_KEY=` line — the D5
smoke-leg key channel, left for the user to fill in by hand.

**Before any `.env.<env>` write**: `git check-ignore -q .env.<env>`.
Not ignored → **stop** and point at `/archascode:init`'s gitignore
step — never create a trackable file destined to hold a secret.

**Railway-side `AUTH_*` values are explicitly not this skill's
vocabulary.** They belong to `/archascode:deploy`'s Deployed auth
posture section (ADR 110), which *reads* this skill's output; this
skill never writes a Railway variable and never invokes
`/archascode:deploy`.

## The smoke leg

Per **in-use instance**, an optional-but-default smoke leg proves the
loop with a real minted token — the config-truth-versus-deploy-truth
gap: read-back proves the instance *should* mint the claims, only a
mint proves it *does*. This is a **per-instance plan line**, naming
every environment mapped to that instance.

**Secret-key resolution.** The instance's secret key is the first
non-empty `CLERK_SECRET_KEY` among the mapped in-scope environments'
`.env.<env>` files. Multiple differing non-empty values for one
instance → stop-and-ask. Absent → the leg is **skipped** with the
fill-in instruction (not blocked).

**The recipe**, verbatim from the spikes, over the Backend API via
ungranted `curl` (the key expands from a shell variable read out of
`.env.<env>` — see Permission posture's ungranted-curl seam):

1. **Create the throwaway user** — marker-named, local part beginning
   `archascode-smoke` with the `+clerk_test` tag
   (`archascode-smoke+clerk_test@example.com`-shaped — `+clerk_test`
   is Clerk's own sanctioned test-fixture lane), `public_metadata:
   {"roles": ["smoke"]}`, and a generated password (dev instances
   commonly require one — handle the password-required error rather
   than assuming the field set).
2. **Create a session**, mint a plain session token.
3. **Token tier (always)**: decode the token; assert issuer + the
   three owned claims present, with `roles` a real array.
4. **App tier (optional)**: `AskUserQuestion` for the base URL — a
   locally running `aac up` app, a deployed domain, or "token-only"
   (skip this tier). The probe route is **derived, not guessed**: one
   entity list route whose declaration-level posture resolves
   `required` (app-wide cascade default plus per-entity `api.auth`
   overrides, the same coarse declaration-level read
   `/archascode:deploy`'s protected-anonymous advisory uses, skipping
   ADR-059-disabled ops), with `api.base_path` concatenated per ADR
   098. Assert the matrix: no token → 401, garbage token → 401, live
   token → 200.
   - **A 200 on the no-token leg is diagnosed, not just failed**: name
     the likely cause — an app rendered by a pre-ADR-107 engine, where
     `type: jwt` without `scheme: bearer` rendered no extraction at
     all (fail-open) — and the fix: re-render with a current engine
     (which now defaults the scheme to bearer), or set
     `scheme: bearer` explicitly and re-render.
   - **Zero routes resolving `required`** (an all-anonymous posture is
     render-legal under `type: jwt`) → skip the app tier with the
     named state `token verified (no required routes to probe)` — the
     401 legs would be false negatives against a correctly configured
     app.
5. **Teardown**: the single licensed DELETE line (below), then a plain
   GET read-back confirming 404.

```
curl -s -X DELETE https://api.clerk.com/v1/users/$SMOKE_USER_ID -H "Authorization: Bearer $CLERK_SECRET_KEY"
```

**Frame the teardown as licensed fixture lifecycle**, not resource
deletion — the one destructive spelling in this skill, doubly gated:
the smoke leg is a plan line the user confirmed (skip available; a
skipped leg reports `configured (smoke skipped)`), and the assembly
guard enforces that no other curl DELETE-method spelling exists in
this body. A curl denial anywhere in the recipe takes the fallback
lane (skip the leg, report it).

## Procedure

The run: **preflight** (Preconditions; `npx -y clerk whoami` / login) →
**discovery + app resolution** (the application ladder) → **instance
mapping** (ask-once, adopt-thereafter) → **classification** (claims
`dry_run=true` diffs, `.env` three-state per environment) → **one
plan** with per-line confirmation (`AskUserQuestion` multi-select;
**skip is the only omission semantic** — nothing is recorded when a
line is left unchecked, and it simply re-enters the plan next run) →
**apply** (claims PATCH + read-back, `.env` writes) → **smoke** → →
**report**.

**Plan lines follow the resource, not the environment** — single-homed
here, pointed to from Run scope and elsewhere:

- **Instance-level actions** (a claims converge, a smoke leg) are
  **per-instance lines**, each naming every environment mapped to that
  instance — in-scope or not — so the blast radius of a shared
  resource is visible on the line the user confirms.
- **Environment-level actions** (`.env.<env>` writes) are
  **per-environment lines**.
- **A scoped run** (`/archascode:auth qa`) narrows the environment set
  but **still shows and confirms the shared-instance lines its
  environment's instance needs**, with any out-of-scope mapped
  environments named on the line — converging Development on behalf
  of `qa` also serves `dev`, and the plan says so rather than hiding
  it.
- **One confirmation covers one line exactly once** — a shared-instance
  line appears once, never duplicated per environment, so "confirm one
  environment's bundle, skip another's" cannot produce an ambiguous
  half-write.

## Final report

One table, one row per in-scope environment:

| env | instance | claims | .env | smoke |
|-----|----------|--------|------|-------|

- **claims** — the instance-level state: `owned` / `hand-managed
  collision` / `converged`.
- **smoke** — `verified` / `configured (smoke unverified)` /
  `configured (smoke skipped)` / `token verified (no required routes
  to probe)`.

Below the table:

- **The frontend handoff** — a pointer to Clerk's own agent-skills
  repo, `clerk/skills` (the frontend/UI axis: React patterns, custom
  UI, the Clerk CLI's own init flow), with a cheap existence check at report time and
  **no version pin** — the handoff is a pointer, not a dependency; on
  a failed check, print the pointer anyway without the check's
  blessing rather than hiding it.
- **The revocation advisory** — restating accepted JWT physics: a
  revoked session's already-minted tokens are not recalled; the
  window is at most ~120 seconds (60 s token lifetime + 60 s clock
  leeway).
- Optionally, a pointer to the documented `ui/` pattern for
  per-instance SPA configuration, for projects using ADR 096's spec-
  declared UI serving.

## What this skill does NOT do

- **Write any tracked repo file** — sole licensed exception: the
  settings-rule project-tracked write (Permission posture), only under
  the user's explicit choice on that `AskUserQuestion`, and it never
  commits the write.
- **Write or edit the spec** — the wire-first gate parks and points at
  editing lanes instead of writing `spec/architecture.yml` itself.
- **Write any `session.claims` key outside the owned three**, or
  rewrite a hand-managed value — a "fix it" request on a collision is
  a stop-and-explain.
- **Write `AUTH_AUDIENCE` for Clerk**, ever.
- **Persist or echo the secret key** anywhere — not to a file, not
  into the transcript, not into the final report.
- **Propose an instance-mapping change unprompted.**
- **Drive DNS** — Production domain setup is dashboard-referenced.
- **Write Railway variables** — that is `/archascode:deploy`'s job
  (its Deployed auth posture section, ADR 110); this skill never
  invokes `/archascode:deploy`.
- **Invoke any destructive platform action beyond the marker-named
  smoke fixture's teardown.**
- **Engineer around a permission denial** — no re-phrasing, no
  re-routing, no workaround.

## Failure modes

| Symptom | Behavior |
|---|---|
| No `.archascode/environments.json` | Stop: "render first" (`/archascode:apply`). |
| `environments.json` `schemaVersion != 1` | Stop: "render first" — fatal, never resolved against a stale table. |
| Spec has no `api.auth.type: jwt` | Stop: name the posture keys and the editing lanes (`/archascode:analyze`, hand edit); note the future `wire auth` mode. |
| `type: jwt` present but nothing resolves to `jwt_bearer` | Stop: list each environment's resolved auth adapter id. |
| Empty `environments` table | Stop: "no environments declared." |
| Scoped run names an out-of-scope environment | Stop: the same resolved-adapter explanation, scoped to it. |
| Unknown single-token `$ARGUMENTS` | `AskUserQuestion`: near-match, treat-as-steering, or cancel. |
| `api_key`-only project | Stop: no provider to reconcile; ADR 107 owns the adapter. |
| Not authenticated with Clerk | Background `npx -y clerk auth login`, relay the URL, re-check on completion. |
| Conflicting `AUTH_ISSUER` derivations across environments | Report the conflict as fact; stop-and-ask. |
| Hand-managed claims collision + a "fix" request | Stop-and-explain; never rewritten. |
| Existing non-empty `AUTH_AUDIENCE` | Report with a warning; never deleted. An empty line draws no warning. |
| Differing existing `.env.<env>` values | Reported, stop-and-ask (may be another provider or hand-managed). |
| Multiple differing `CLERK_SECRET_KEY` values for one instance | Stop-and-ask. |
| `CLERK_SECRET_KEY` absent for an in-use instance | Smoke leg skipped with the fill-in instruction, not blocked. |
| Production headless mint fails | Report `configured (smoke unverified)`; never blocks the run. |
| No-token app-tier probe returns 200 | Diagnose as a likely pre-ADR-107 fail-open engine; name the re-render fix. |
| Permission denial (classifier or declined prompt) | Stop that action; offer the `!`-prefixed one-liner and the settings-rule route; park dependents `blocked (permissions)`. |
| `.env.<env>` not gitignored | Stop the write; point at `/archascode:init`'s gitignore step. |

No retries beyond what is stated above. The user re-invokes after
addressing whatever a stop pointed at.

## Notes for future versions

- **Auth0 provider fork** — spike first (claims namespacing, headless
  mint path), then fork inside this skill's interview.
- **The `wire auth` mode** — amends `/archascode:wire`'s
  persistence-only fence; `api_key` completes there, `jwt` parks
  pointing here until this skill's own park lands as the blessed
  entry.
- **The deploy amendment has landed (ADR 110)** — `AUTH_*` Railway
  vocabulary, a `blocked (auth)` plan-time park, and a deployed auth
  smoke leg are now live in `/archascode:deploy`'s Deployed auth
  posture section, reading this skill's output. What remains is the
  positive-tier follow-on: that smoke leg stays negative-only (no
  provider credential); the positive lane — a real minted token —
  stays this skill's own app-tier smoke, pointed at the deployed
  domain.
- **The Explorer token axis** — its own future spike: a webview
  bearing a Clerk token.
- **The roles-source interview** — `{{org.role}}`-shaped claims when
  org-mode demand materializes.
- **`GET /auth/config` micro-ADR** — only if the documented `ui/`
  pattern proves insufficient for per-instance SPA configuration.
- **Re-verify triggers** — a Clerk CLI major-version bump, or
  `platform/beta.yml` leaving beta, per the spike docs' clauses.
- **The second-application QA-isolation shape** — deferred; its
  reopen trigger is a user actually asking for stronger QA isolation
  than the Development instance's shared issuer provides.
