---
name: auth
description: Auth-value reconcile for a project declaring api.auth.type — writes the real values a declared auth mode needs into gitignored .env.<env> files and (for jwt) the identity provider itself. For jwt, an interview + plan/confirm/apply loop over the Clerk CLI that adopts or creates the Clerk application, converges session-token claims so the seeded claims mapper populates email/name/roles, derives and writes AUTH_JWKS_URL/AUTH_ISSUER, and proves the loop with a headlessly minted token (Clerk is the only v1 provider). For api_key, a local key seed — generate or adopt AUTH_API_KEY per environment, no provider involved. Accepts a declared environment name as an argument to scope the run.
allowed-tools: Bash(npx -y clerk@3 whoami:*), Bash(npx -y clerk@3 auth:*), Bash(npx -y clerk@3 api:*), Bash(npx -y clerk@3 env pull:*), Bash(archascode targets:*)
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

### Coherence and mixed `spec/deploy_targets.yml` targets

**No fact in `spec/deploy_targets.yml` is auto-repaired or
auto-deleted.** An orphaned or incoherent `auth:` target — the spec's
environment was renamed or deleted, or the environment's resolved
auth adapter flipped away from `jwt_bearer` (to `noop` or, per The
api_key arm above, to `api_key`) while a `provider: clerk` row still
names it — is detected by `archascode targets check --json` at plan
time, reported as fact with the file-edit offer that would fix it, and
the affected environment **parks as `blocked (targets)`** (the
`blocked (branch)` mechanics: named, reported, picked up automatically
once the row is fixed and the skill re-run). A renamed environment
presents as an orphaned row plus a new undescribed one — offered as a
single carry-the-row-over confirmation, not two separate edits.

**`provider: generic` auth targets never enter the Clerk lane.** A
`generic` row means bring-your-own-provider — this skill's discovery,
instance mapping, claims ownership, and smoke leg are all Clerk-CLI
mechanics and simply do not apply. A `generic`-targeted environment
informs `/archascode:deploy`'s `AUTH_*` value-source parking and gets,
at most, a reachability verification; it is otherwise invisible to
everything above.

**Under mixed targets** (some environments `provider: clerk`, some
`provider: generic`, some undescribed), this skill's Clerk lane — workspace discovery, the
one-application fence, claims convergence, the smoke leg — scopes to
exactly two groups: environments with a `provider: clerk` target, and
target-absent in-scope environments still entering enrollment (Desired
state and provenance, item 2). Every `generic`-targeted environment
sits outside both groups.

## Permission posture

This skill's frontmatter carries an `allowed-tools` grant covering
four npx-clerk verb families (`whoami` / `auth` / `api` / `env pull`),
so a default auto-mode run needs no permission setup for the Clerk CLI
calls it makes.

**Invocation form is pinned to the npx-clerk `@3` prefix** uniformly — no
install step, and every grant entry shares one stable, version-pinned
prefix family. The `@3` pin is what makes the invocation form actually
major-safe: the invocation without a version pin follows npm's
`latest` dist-tag across majors, silently and fleet-wide, at exactly
the moment the pin should instead force a deliberate look. A Clerk major
bump is
therefore a **deliberate re-verify-then-edit-everywhere change** — the
carrier and grant semantics get re-verified against the new major, then
every spelling in this body and the grant moves together in one edit;
the assembly guard (C1) fails the kit if that rename is ever partial.
The bare clerk binary (no `npx -y` prefix) is a rejected alternative
(it would require an install step and double every grant entry for
zero capability). **Granted invocations run bare** — no redirection, no
capture via `>`/`>>`; redirection defeats the grant's prefix match (the
`env pull` fetch lane below writes via its own `--file` flag, not
redirection, so it stays within this rule).

**The layered-control statement.** `Bash(npx -y clerk@3 api:*)` knowingly
covers a verb that *could* spell destructive calls — Clerk's CLI is
effectively single-verb (every Platform API call rides
`npx -y clerk@3 api --platform <path>`), which defeats a railway-style
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

- **The workspace CLI session** (`npx -y clerk@3 auth login`, browser
  PKCE, loopback — run in the background with the URL relayed the
  moment it appears, the `/archascode:login` UX class) backs every
  `npx -y clerk@3 api --platform` read and write. Its blast radius is the
  **whole workspace** — every application the logged-in account can
  see — which is exactly why every claims/env write below is
  plan/confirm-gated.
- **The per-instance secret key** backs only the smoke calls (see The
  smoke leg). It
  enters **only** via the gitignored `.env.<env>` (the seeded
  `# CLERK_SECRET_KEY=` comment line), is **never typed into chat** (a
  typed reply kills the `allowed-tools` grant — spiked harness
  physics — and a secret does not belong in a transcript), is never
  persisted anywhere else by this skill — **sole exception: the fetch
  lane's scratch file** (see The smoke leg) — outside the repo, spliced
  from, deleted in the same confirmed action — and is never echoed. An
  absent key means the fetch lane's plan-time question (see The smoke
  leg); declined → **skipped** with a fill-in instruction, not blocked.
  `env pull` is itself a read verb with disclosure consequences
  (fetch-not-mint, spiked) — granted as the fourth npx-clerk family.
  `CLERK_BAPI_SCOPES`-scoped keys are a narrowing option a
  user may set up on their own; this skill neither requires nor gates
  on them.

**The ungranted-curl seam** (the `/archascode:deploy` `environment
edit` pattern): the Backend API smoke calls (see The smoke leg) ride plain `curl`,
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
only after an actual denial, mirroring `/archascode:deploy`'s
settings-rule-offer posture. Before offering, best-effort preflight: read
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
   Absent → stop: "render first" (`/archascode:apply`) — the
   environments-file rule restated: absence means "never rendered or cleaned."
   `schemaVersion != 1` → the same stop, fatal — never resolve against
   a stale table.
2. **Mode dispatch on the spec's declared `api.auth.type`.** This gate
   deliberately does **not** require a top-level `adapters.auth`
   block — a binding-level `app_adapters.auth` selection alone is
   render-legal and must pass. On failure the message derives from
   what is actually missing:
   - **`jwt`** → the Clerk provider lane (below): in scope iff the
     resolved binding can see it and at least one environment resolves
     `jwt_bearer` (item 2a).
   - **`api_key`** → the local key-seed arm (below): in scope iff the
     resolved binding can see it and at least one environment resolves
     `api_key` (item 2b).
   - **No `api.auth.type` anywhere** → name the posture keys
     (`api.auth.type`) and the editing lanes: `/archascode:analyze`,
     the plugin's Adapter rail, or a hand edit of
     `spec/architecture.yml`.
   - **Any other `api.auth.type` value** → the same not-applicable
     stop, naming the value found.
   2a. **`type: jwt` present but zero environments resolve to
       `jwt_bearer`** → list each declared environment's resolved
       `appAdapters.auth.id` so the user sees *why* nothing is in
       scope.
   2b. **`type: api_key` present but zero environments resolve to
       `api_key`** (every mapped environment is `noop`) → the same
       resolved-adapter listing, naming the fix: pick a
       `noop`-mapped environment back onto `api_key`, or there is
       nothing this run can seed.
3. **Degenerate scopes are first-class outcomes, never silent no-ops:**
   - Empty `environments` table → "no environments declared" —
     render seeds one, or declare them (`/archascode:deploy`'s arm).
   - A gate-passing spec with **zero** in-scope environments → the
     same resolved-adapter listing as item 2a/2b.
   - A scoped run naming a declared but out-of-scope (e.g. noop-bound)
     environment → the same explanation, scoped to it.
4. **Authenticated (jwt mode only).** `npx -y clerk@3 whoami` succeeds. If not, run
   `npx -y clerk@3 auth login` **in the background** (the
   `/archascode:login` pattern: the activation URL prints as soon as
   the flow starts), relay the activation URL to the user the moment
   it appears, poll until the background task exits, then re-check.

## The api_key arm

This arm runs instead of everything from "Desired state and
provenance" through "Smoke" below — those sections are the jwt/Clerk
lane. There is no provider to reconcile for `api_key`: the engine owns
the adapter, and this arm's whole job is a local secret seed, per
in-scope environment.

For each in-scope environment (Preconditions item 2b already narrowed
the set):

1. **Read the gitignored `.env.<env>`.**
   - **`AUTH_API_KEY` present** → adopt it: report it, never
     overwrite it, never echo the value.
   - **Absent** → generate one. `openssl rand -hex 32` — boring,
     256-bit, paste-safe. Generation and the local write are **one
     compound command** piping `AUTH_API_KEY=<value>` **directly into
     `.env.<env>`** — the value never enters the transcript. Guard the
     write with `git check-ignore -q .env.<env>` first: **not
     ignored** → stop the write for that environment, point at
     `/archascode:init`'s gitignore step, and report it rather than
     writing an unprotected secret.
   - Values are **per-environment distinct** — a fresh generation for
     each absent environment, never copied from another environment's
     value.
2. **No interview questions beyond the existing confirm posture** —
   there is no real choice to ask about (adopt-if-present,
   generate-if-absent is the whole rule), so this arm asks nothing new.
3. **No smoke leg.** The 401/401/200 matrix already exists on the
   platform side (`/archascode:deploy`'s Deployed auth posture
   section); a local variant is a possible future addition, not built
   here.
4. **No grant changes.** `openssl` and `git check-ignore` run
   ungranted here and may prompt or be classifier-judged — accepted
   friction for this arm; a permission prompt is not a typed reply, so
   the Clerk grant above is unaffected either way.
5. **Orphaned Clerk target check.** `api_key` mode has no provider
   instance — **no `auth:` row in `spec/deploy_targets.yml` exists for
   it, ever**, and this arm never writes one. If the file still
   carries a `provider: clerk` `auth:` target for this environment (a
   mode switch away from `jwt` orphaned it), report it as fact —
   "this environment's `auth:` target names a Clerk instance, but it
   now resolves `api_key`" — and offer the file edit that would
   remove the stale row. Never auto-delete it; a report with an offer
   is the whole obligation.

### api_key report

One table, one row per in-scope environment:

| env | AUTH_API_KEY | .env |
|-----|--------------|------|

- **AUTH_API_KEY** — state only, never the value: `adopted` (found,
  left as-is) / `generated` (written this run) / `skipped` (the
  gitignore stop above).
- **.env** — `present` / `written` / `not gitignored`.

Below the table, the deploy pointer: seeding the platform's copy of
`AUTH_API_KEY` is `/archascode:deploy`'s job (its Deployed auth
posture section), not this skill's.

## Desired state and provenance

**`spec/deploy_targets.yml` is the declared-intent record** — per
environment, an `auth:` target names the mapped Clerk instance (and,
once adopted, the application) plus the `reconcile`/`verify` grants
this skill runs under. **The platform remains the record of
actuals** — Clerk's own application/instance/claims state is never
reconciled *toward* the file; skew between the two is reported and
converged only under the existing confirm discipline. `.env.<env>`'s
`AUTH_ISSUER` line survives unchanged as the **runtime carrier** —
the value the rendered app actually reads — but it is no longer the
record: with a declared target in play it becomes the thing being
*verified* against declared intent, not the source of it (see The
application resolution ladder, below). The spec itself still never
grows a `provider:` key — the adapter-versus-provider fence stays
load-bearing: `jwt_bearer` names an adapter, not Clerk.

**Targets-file tolerance** (the same four-arm shape `/archascode:deploy`
uses): file **absent** → legal — the ladder below runs exactly as it
did before this file existed, and an in-scope environment reaching
enrollment writes the target back (item 2, below). `schemaVersion: 1`
→ proceed. `schemaVersion` **absent, malformed, or any other value**
→ **stop**, naming `spec/deploy_targets.yml` and the expected version
(`1`) — never resolve against a stale or unreadable file. Unparseable
YAML → the same stop.

### The application resolution ladder (run at plan time)

This environment's row in `spec/deploy_targets.yml`, if any, decides
which of two shapes this ladder takes:

1. **Target exists.** Adopt-from-values (the old step below) is
   **dead for resolution here** — it would be circular: the `.env`
   issuer is the pointer this run is about to *verify*, and it must
   never be allowed to select the application that defines
   "expected."
   - **`application` present on the target** → the ladder is skipped
     entirely; a workspace fetch confirms the named application still
     exists (a miss is reported as fact, stop-and-ask).
   - **`application` absent** → resolve via the workspace inventory
     plus name-match/interview (the same discovery this skill always
     ran when no target existed — `npx -y clerk@3 api --platform
     /platform/applications`, a project-directory name match
     preselected, plus a create-new option), **never** the `.env`
     values. The resolved application id then **rides a confirmed
     plan line** — "record application `acct_…` for `<env>`" — as a
     first-value fill on the target row; from that point on it arms
     the wrong-application drift check on every later run.
   - Either way, the run then derives the expected issuer for the
     **declared** instance of the **resolved** application and
     compares it against `.env`'s live `AUTH_ISSUER` — a genuine
     three-way intent/pointer/actuals check, with no path back to
     self-validation. A mismatch is the standard skew report;
     converging it (rewriting `.env`) rides its own confirmed plan
     line, same as any other owned-vocabulary skew.
2. **Target absent, environment in scope.** The ladder runs exactly as
   it always has:
   1. **Adopt-from-values.** Read `AUTH_ISSUER` from every in-scope
      `.env.<env>` present locally; derive each instance domain from
      it; match against the workspace inventory (`npx -y clerk@3 api
      --platform /platform/applications`, which returns applications
      and their instances including publishable keys — publishable
      keys decode to instance domains, so discovery needs no prior
      knowledge). A match **adopts the application silently** — no
      existence question.
   2. **No values found anywhere** → `AskUserQuestion` listing the
      workspace's applications, a project-directory name match
      preselected as the suggestion, plus a create-new option. The
      creation verb rides the same Platform API; its exact spelling
      is verified against the installed CLI at run time (its precise
      form is unspiked and is audited on first live use — the
      `/archascode:deploy` verb-spelling-hedge pattern: never guess
      at a replacement spelling if the installed CLI's `--help`
      doesn't show it, degrade to a reported manual dashboard step
      instead).
   3. **Conflicting derivations** — two in-scope environments' values
      pointing at different applications → report the conflict as
      fact and stop-and-ask.

   The instance-mapping interview (below) then runs its ask-once
   question, and the answer — instance, application once adopted, and
   the consent just given — is **written back** as this environment's
   `auth:` target row with one `archascode targets set` invocation:
   ```bash
   archascode targets set <env> auth provider=clerk instance=<instance> [application=<application>] reconcile=true verify=true
   ```
   (including for Production-mapped targets — see Grants, below): this
   skill is a legitimate first creator of `spec/deploy_targets.yml` —
   the verb creates the file lazily on first write, no `init` scaffold
   needed. The row's one required identity key is `instance:`; naming
   `application=` fills it on first contact per item 1 above, and the
   verb enforces the row shape and the write discipline (declared keys
   verified not rewritten, adopted keys filled without touching grants,
   same-value invocations inert).

**v1 fence: one Clerk application per project.** A second-application
QA-isolation shape is a named deferral (Notes, below) — this skill
never proposes it.

## Instance mapping

A Clerk application has exactly **two instances** — Development and
Production. The mapping from N declared environments onto them is
owned by whichever source applies per environment:

- **Target exists** → the instance question **disappears** — the
  target row's `instance:` key answers it directly, and every run
  simply verifies the derived issuer against `.env` (Desired state
  and provenance, item 1, above). What used to be "adopted thereafter
  via issuer, suspicious mismatch flagged report-only" **inverts into
  the same three-way verification**: a mismatch between the target's
  declared instance and what `.env` actually resolves to is reported
  as the standard skew, not a special suspicious-mismatch flag.
- **Target absent** → the interview below runs, once per environment,
  and its answer is **written back** as the target row (Desired state
  and provenance, item 2).

The interview itself, asked **once per environment** at first mapping
via `AskUserQuestion` (the `/archascode:deploy` branch-mapping
ask-once precedent):

- **Development is preselected** for every environment except one
  whose *name* is exactly `prod` or `production`, where Production is
  the suggestion instead. The name is the honest heuristic — the
  `data` axis is deliberately **not** used as a signal (a `qa`
  environment is routinely `protected`; posture does not imply
  instance).
- **Every mapping — adopted-by-target or freshly interviewed — is a
  plan-screen fact**, shown, never re-asked while the target stands.
  Changing a mapping is only ever an explicit user request, now
  expressed as either a `spec/deploy_targets.yml` edit or a confirmed
  row update this skill proposes.
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

### Grants

Each target row's two boolean flags scope what this skill may do
against that environment's Clerk instance:

- **`reconcile`** gates **platform writes only** — the `session.claims`
  merge below (claims config, the PATCH/read-back cycle). It never
  gates the local `.env.<env>` seam: those writes (the derived
  `AUTH_JWKS_URL`/`AUTH_ISSUER` pair, the `# CLERK_SECRET_KEY=` seed
  line) are check-ignore-guarded exactly as today and are **never
  grant-gated** — they are the runtime carrier, not a platform action.
- **`verify`** gates the probe family — the JWKS/issuer confirmation
  fetch and the smoke leg. Both run on any in-use instance regardless
  of Development/Production; the Production mint leg's structural
  degrade (`configured (smoke unverified)`, above) is an *annotation
  within* a granted probe, never the spelling of `verify: false` — a
  user who wants quiet from a structurally-degraded leg sets the flag
  themselves, this skill never writes it for that reason.
- Enrollment (Desired state and provenance, item 2) writes both flags
  `true` for the target it creates, Production-mapped targets
  included — the consent just given, recorded plainly.
- **File writes ride the `archascode targets set` verb**, which
  enforces the same discipline as every other write this skill makes.
  Every write to `spec/deploy_targets.yml` is either same-value-inert
  (an adopted key matching what's already on disk) or confirmed (a
  first-value fill, an update, or a fresh row) — declared keys
  (`instance:`) are verified, never rewritten; adopted keys
  (`application:`) fill and update only via the verb's own kind;
  grants are consent and only ever ride a confirmation.

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
convergence line.

**The claims-config carrier path is pinned** (live-verified on Clerk
CLI 3.1.0). All claims spellings ride `npx -y clerk@3 api --platform`
against

```
/platform/applications/{application_id}/instances/{environment_type}/config
```

nested under the application and keyed by the instance's
`environment_type` value (`development` / `production`) as the path
segment — both values come from the `/platform/applications`
inventory, and the `ins_…` instance id is an inventory field, never a
path segment. Read with `?keys=session`; the config vocabulary's JSON
Schema lives at `…/config/schema`; the dry-run plan surface is
`PATCH …/config?dry_run=true`; the applied write is `PATCH …/config`
with `--yes`. Platform paths are invoked directly: the endpoint table
behind `npx -y clerk@3 api ls` covers the Backend API only, so an `ls`
miss on `platform`/`claims` says nothing about this carrier — treat
the pinned path above, not `ls` discovery, as the existence check.

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
`AUTH_AUDIENCE=` line — the common case for a seeded env on a current
engine — is harmless and draws no warning.

The write also seeds a commented `# CLERK_SECRET_KEY=` line — the
smoke-leg key channel, left for the user to fill in by hand (the
consented fetch lane, Development-mapped instances only, may later
replace this comment in place with a live value — see The smoke leg;
hand fill-in remains the lane for a declined fetch and for Production).

**Before any `.env.<env>` write**: `git check-ignore -q .env.<env>`.
Not ignored → **stop** and point at `/archascode:init`'s gitignore
step — never create a trackable file destined to hold a secret.

**Railway-side `AUTH_*` values are explicitly not this skill's
vocabulary.** They belong to `/archascode:deploy`'s Deployed auth
posture section, which *reads* this skill's output; this
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
instance → stop-and-ask. Absent → the fetch lane below (Development) or
the fill-in instruction (Production, or a declined fetch).

### The fetch lane

When the smoke leg is wanted and the mapped instance's
`CLERK_SECRET_KEY` is absent across every in-scope `.env.<env>` file,
this skill can pull the key itself rather than always falling back to
a hand fill-in. **Scope: Development-mapped instances only** — a
Production-mapped instance's absent key always takes the fill-in hand
lane below, no fetch option offered (a production secret key is the
highest-blast-radius credential in this whole surface, and the
Production smoke already degrades gracefully on its own).

**Trigger and question.** At plan time, beside the smoke plan line (so
apply stays one confirmed batch), a new `AskUserQuestion` offers three
options:

- **Fetch via the workspace session** (suggested) — pull the key using
  the same CLI session already backing every other Platform API call.
- **I'll fill it by hand** — skip this run's smoke leg and print the
  fill-in instruction (the declined-fetch shape; this is also what a
  Production-mapped instance always gets, unasked).
- **Skip the smoke leg** — proceed without the smoke leg this run.

**The dependency park.** The fetch depends on its environment's
`.env.<env>` value write (the derived `AUTH_JWKS_URL`/`AUTH_ISSUER`
pair, above) having already applied this run. If the user skip-omitted
that write from the plan, the fetch parks with the dependency named —
it never creates a key-only `.env.<env>` that no later
adopt-from-values read could map back to an application.

**Mechanics — scratch-then-splice, never a direct write.** On consent,
pull into a `mktemp`-shaped scratch file **outside the repo**:

```
npx -y clerk@3 env pull --app <id> --instance dev --file <scratch> --mode agent
```

`--mode agent` is carried **verbatim** — the non-interactive mode; the
`whoami`/`auth`/`api` families are unchanged and gain no `--mode` flag
of their own, they were verified without one. Read exactly the
`CLERK_SECRET_KEY` line out of the scratch file, then write it into
**every mapped in-scope environment's** gitignored `.env.<env>` (the
same `git check-ignore -q` guard as every other `.env.<env>` write in
this skill) — when one instance maps several in-scope environments
(the ordinary `dev` + `qa` shape), the splice writes all of them, the
self-consistent choice given secret-key resolution's first-non-empty
rule above, which would otherwise leave sibling files permanently
unfilled. The splice **replaces the seeded `# CLERK_SECRET_KEY=`
comment line in place** (uncommented, valued) when present, and
appends the line otherwise — it never leaves an unfilled-looking
comment sitting above a live key. The scratch file is deleted
immediately, in the same confirmed action, and the pulled value never
appears in the transcript (shell redirection/splice, the same pattern
the smoke recipe's `curl` calls already use for `CLERK_SECRET_KEY`)
— **sole exception: the scratch file** — outside the repo, spliced
from, deleted in the same confirmed action.

**The rejections, stated.** Pulling directly into the target
`.env.<env>` (pointing `env pull`'s own `--file` flag straight at it,
skipping the scratch file entirely) is rejected outright: `env pull`'s
merge-with-replace behavior would **clobber** a hand-set
`CLERK_SECRET_KEY` (the splice above only ever fires on the absent
arm, making overwrite structurally impossible), and it also writes
`CLERK_PUBLISHABLE_KEY` into the target file — a key this skill does
not own and must **never write to any `.env.<env>`** (the frontend
axis may want it someday; that is a
provider-fork or frontend-handoff question, not a side effect of a
backend-key fetch). Fetch-as-compare is rejected too: **a present key
is adopted blind, never pulled to check** — pulling a present key would
mean fetching a secret with no write purpose, disclosure without
benefit.

`CLERK_SECRET_KEY` stays a **channel, not owned vocabulary** even
through the fetch lane — seeded only on consent, never rewritten,
never compared, never echoed (the same generate-only-when-absent
posture `/archascode:deploy`'s `AUTH_API_KEY` uses, applied here to a
fetched rather than generated value).

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
   per-op-disabled ops), with `api.base_path` concatenated per its
   projection rule. Assert the matrix: no token → 401, garbage token → 401, live
   token → 200.
   - **A 200 on the no-token leg is diagnosed, not just failed**: name
     the likely cause — an app rendered by an older engine, where
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

The run: **preflight** (Preconditions; `npx -y clerk@3 whoami` / login) →
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

This is the jwt-mode report (the api_key arm's own report is above,
"api_key report"). One table, one row per in-scope environment:

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
  per-instance SPA configuration, for projects using spec-
  declared UI serving.

## What this skill does NOT do

- **Write any tracked repo file** — two licensed exceptions: the
  settings-rule project-tracked write (Permission posture), only under
  the user's explicit choice on that `AskUserQuestion`, never
  committed; and confirmed writes to `spec/deploy_targets.yml`
  (Desired state and provenance / Grants) — enrollment write-back and
  adopted-key fills only, always via the ordinary editing tools
  (Write/Edit), never bash, and always either same-value-inert or
  riding a confirmed plan line.
- **Write or edit the spec** — the mode-dispatch gate parks and points
  at editing lanes instead of writing `spec/architecture.yml` itself.
- **Write any `session.claims` key outside the owned three**, or
  rewrite a hand-managed value — a "fix it" request on a collision is
  a stop-and-explain.
- **Write `AUTH_AUDIENCE` for Clerk**, ever.
- **Persist or echo the secret key** anywhere — not to a file, not
  into the transcript, not into the final report — **sole exception:
  the fetch lane's scratch file** (The smoke leg) — outside the repo,
  spliced from, deleted in the same confirmed action.
- **Propose an instance-mapping change unprompted** — a target's
  `instance:` is verified, never rewritten, without an explicit user
  request.
- **Auto-repair or auto-delete a `spec/deploy_targets.yml` row** —
  every orphan/incoherence is reported with a file-edit offer only
  (Run scope's Coherence and mixed targets).
- **Write an `auth:` target row for `api_key` mode** — api_key has no
  provider instance; that arm seeds `.env` only (The api_key arm).
- **Drive DNS** — Production domain setup is dashboard-referenced.
- **Write Railway variables** — that is `/archascode:deploy`'s job
  (its Deployed auth posture section); this skill never
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
| Spec has no `api.auth.type` (or an unrecognized value) | Stop: name the posture keys and the editing lanes (`/archascode:analyze`, the plugin's Adapter rail, hand edit). |
| `type: jwt` present but nothing resolves to `jwt_bearer` | Stop: list each environment's resolved auth adapter id. |
| `type: api_key` present but nothing resolves to `api_key` | Stop: list each environment's resolved auth adapter id; the fix is picking a `noop`-mapped environment back onto `api_key`. |
| Empty `environments` table | Stop: "no environments declared." |
| Scoped run names an out-of-scope environment | Stop: the same resolved-adapter explanation, scoped to it. |
| Unknown single-token `$ARGUMENTS` | `AskUserQuestion`: near-match, treat-as-steering, or cancel. |
| `api_key` mode, this environment's key already present locally | Adopt and report it; never overwritten, never echoed. |
| Not authenticated with Clerk | Background `npx -y clerk@3 auth login`, relay the URL, re-check on completion. |
| Conflicting `AUTH_ISSUER` derivations across environments | Report the conflict as fact; stop-and-ask. |
| Hand-managed claims collision + a "fix" request | Stop-and-explain; never rewritten. |
| Existing non-empty `AUTH_AUDIENCE` | Report with a warning; never deleted. An empty line draws no warning. |
| Differing existing `.env.<env>` values | Reported, stop-and-ask (may be another provider or hand-managed). |
| Multiple differing `CLERK_SECRET_KEY` values for one instance | Stop-and-ask. |
| `CLERK_SECRET_KEY` absent for a Development-mapped in-use instance | `AskUserQuestion`: fetch via the workspace session (suggested) / fill by hand / skip the smoke leg. |
| `CLERK_SECRET_KEY` absent for a Production-mapped in-use instance | No fetch offered; skipped with the fill-in instruction, not blocked. |
| Fetch consented but its environment's `.env.<env>` value write was skip-omitted | Fetch parks, naming the dependency; never writes a key-only `.env.<env>`. |
| Production headless mint fails | Report `configured (smoke unverified)`; never blocks the run. |
| No-token app-tier probe returns 200 | Diagnose as a likely older-engine fail-open; name the re-render fix. |
| Permission denial (classifier or declined prompt) | Stop that action; offer the `!`-prefixed one-liner and the settings-rule route; park dependents `blocked (permissions)`. |
| `.env.<env>` not gitignored | Stop the write; point at `/archascode:init`'s gitignore step. |
| `archascode targets check`/`targets set` exits non-zero against `spec/deploy_targets.yml` | Stop, surfacing the verb's own message verbatim — it already names the file and the expected version; never resolve against a broken file. |
| Target orphaned or incoherent (spec env renamed/deleted; auth flipped `noop`/`api_key` under a Clerk row) | Report as fact per `archascode targets check`'s finding, with a file-edit offer; never auto-repaired or auto-deleted; the environment parks `blocked (targets)`. |
| `provider: clerk` auth target on an environment resolving `api_key` (The api_key arm) | Report the stale row; offer the file edit that removes it; never auto-deleted. |

No retries beyond what is stated above. The user re-invokes after
addressing whatever a stop pointed at.

## Notes for future versions

- **Auth0 provider fork** — spike first (claims namespacing, headless
  mint path), then fork inside this skill's interview.
- **An api_key local smoke leg** — the arm above is deliberately
  seed-and-report only; a local 401/401/200 matrix mirroring the
  platform-side one is a future addition if api_key usage grows enough
  to justify it.
- **The deploy-side amendment has landed** — `AUTH_*` Railway
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
- **`GET /auth/config` — a future decision** — only if the documented `ui/`
  pattern proves insufficient for per-instance SPA configuration.
- **Re-verify triggers** — a Clerk CLI major-version bump, or
  `platform/beta.yml` leaving beta, per the spike docs' clauses. A
  major-version bump is an **enforced edit, not a comment**: the `@3`
  pin plus the assembly guard (C1) fail the kit on a partial re-pin, so
  the re-verify-then-edit-everywhere procedure above (Permission
  posture) cannot be silently skipped.
- **The second-application QA-isolation shape** — deferred; its
  reopen trigger is a user actually asking for stronger QA isolation
  than the Development instance's shared issuer provides.
