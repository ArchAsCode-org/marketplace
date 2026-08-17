---
name: deploy
description: Provision and reconcile deployment-platform environments for a rendered archascode consuming project — an interview + plan/confirm/apply reconcile over the Railway CLI that creates environments and DB services, wires APP_ENV and reference variables, seeds the local .env.<env>, writes the pre-deploy schema-apply hook, and smoke-checks /health per environment. Accepts a declared environment name as an argument (e.g. `/archascode:deploy qa`) to scope the whole run to that single environment. Railway is the only v1 platform. Use when the user wants the app on a platform; this skill owns deploy-time schema apply (the platform runs the hook), `/archascode:db` stays the local plan/apply verb, and `apply` resolves hand-offs.
allowed-tools: Bash(railway whoami:*), Bash(railway login:*), Bash(railway status:*), Bash(railway init:*), Bash(railway link:*), Bash(railway add:*), Bash(railway environment list:*), Bash(railway environment config:*), Bash(railway environment link:*), Bash(railway environment new:*), Bash(railway variable:*), Bash(railway variables:*), Bash(railway domain:*), Bash(railway tcp-proxy list:*), Bash(railway deployment:*), Bash(railway redeploy:*), Bash(railway volume -e:*), Bash(archascode targets:*)
---

# /archascode:deploy

Put the rendered app on a deployment platform, and keep it in sync with
`spec/architecture.yml`'s environment table on every later run. **`deploy`
provisions and reconciles the platform, and owns deploy-time schema apply:
the platform itself runs a pre-deploy hook that applies schema before any
new code takes traffic (see Pre-deploy schema apply, below).
`/archascode:db` stays the local plan/apply verb — preview or apply schema
from a laptop, against a database you can reach directly — and
`/archascode:apply` resolves hand-offs.** The two schema-apply lanes never
invoke each other, and this skill never resolves a hand-off — that stays a
separate, explicit step in the chain.

Every run of this skill is a **reconcile**: it reads the project's declared
environments, asks which of them should exist on the platform, compares that
desired state against what the platform actually has, and applies only what
the user confirms. The first run is this same flow starting from empty
platform state — there is no separate "first deploy" mode.

## Arguments

- `$ARGUMENTS` (optional) — a declared environment name, free-text
  steering, or both. Resolution runs **after** the Desired State read
  (the declared table is what a name resolves against), in this order:
  - **First token exactly equals a declared environment name** → this is
    a **scoped run**: only that environment is in scope (see Run scope,
    below), and any remaining text is prose steering for it.
  - **`$ARGUMENTS` is a single token matching no declared environment
    name** → never guess and never silently fall through to a
    whole-project run: ask via `AskUserQuestion` — the near-matching
    declared name (if one is close), "treat as steering", or cancel —
    and proceed only on the answer. A typo'd environment name must not
    quietly deploy everything.
  - **Anything else** is free-text steering that pre-answers interview
    questions, mirroring `/archascode:analyze` (e.g.
    `"skip the Explorer question"`, a platform name). A question the free
    text already answers is skipped; everything else is still asked.

```
/archascode:deploy
/archascode:deploy prod
/archascode:deploy qa skip the Explorer question this time
/archascode:deploy use the qa branch for the new environment
```

## Run scope

Every rule below is written over "in-scope environments"; this section
defines that set once. Scope is **per-channel**, mirroring
`spec/deploy_targets.yml`'s two grants (Desired state, above). The
mechanical source is `archascode targets scope --json`: run it and read,
per declared environment, whether it is in reconcile scope and/or verify
scope, plus its reason. Its two aggregate signals govern the run's
consequences:

- These are independent: a `verify: true, reconcile: false` target gets
  exactly what it granted — probed and reported, **never written**. A
  declared environment with **no** hosting target row stays
  interview-visible as a `not configured — add?` line (Step 2) rather
  than silently dropping out of reach the moment the file gains its
  first row.
- An environment **present on Railway but declared out of reconcile
  scope** (a `local` hosting target, or `reconcile: false`) is *reported
  as fact* — an informational, surplus-style line (Step 3) — and never
  reconciled: presence-on-platform does not, by itself, put an
  environment in scope.
- When **every** described hosting target is out of reconcile scope
  (e.g. all `local`) and no declared environment is left undescribed,
  the run reports `no environments in reconcile scope — see
  spec/deploy_targets.yml` and stops cleanly rather than presenting an
  empty plan.
- **Scoped run** (`/archascode:deploy <env>`): exactly the named
  environment is in scope, **within** the target-derived base above —
  naming an environment still preselects its creation question (explicit
  intent, unchanged), but naming an environment whose hosting target
  withholds `reconcile` (or names a provider this skill does not drive)
  produces a **stop** naming the target row and the file edit that would
  grant it — explicit run-time intent never outranks declared consent.
  Two further scoped-run specifics, unchanged by targets:
  - If the named environment is missing on Railway, the creation
    question is still asked (confirmation gates every mutation) but
    **preselected yes** — naming the environment is explicit intent and
    overrides the axis heuristics' defaults.
  - The **global surplus sweep is skipped**: orphan-environment lines,
    the default-`production` line, and Step 1's every-environment
    volume read are unscoped-run features. The named environment's
    **own** surplus lines (a no-longer-needed DB service, a surplus
    proxy or domain, an orphaned volume inside it) still report, and
    the final report notes that a bare `/archascode:deploy` prints the
    full surplus report.
- Scoping is per-run steering, recorded nowhere — the other declared
  environments simply re-enter scope on the next unscoped run, the same
  "not this run" semantics as unchecking a plan bundle. Targets scope is
  the opposite: it is declared, durable consent, read fresh every run
  from `spec/deploy_targets.yml`.

## Permission posture

This skill's frontmatter carries an `allowed-tools` grant covering the
railway commands it runs, so a default auto-mode run needs zero permission
setup. The grant applies on invocation, covers the reconcile lane
end-to-end, and survives only while the run stays inside the invocation
turn.

**This skill executes no resource-destroying platform verb at all.**
Deletion of environments, services, volumes, proxies, and domains is done
in the Railway dashboard — never by this skill — and every surplus this
reconcile finds is reported as an informational plan line pointing there
(Step 3). Its worst-case wrong action is creating or mis-wiring something,
visible on the plan screen and reversible in the dashboard.

**The carve-out.** One destructive-at-the-wrong-layer spelling is
deliberately **not** granted: `railway service source connect`. It is not a
delete, but it is the **wrong layer** for a per-environment write —
live-observed to reset every environment's branch mapping and redeploy
(Branch posture) — so the harness's own prompt (manual mode) or classifier
judgment (auto mode) stacks with this skill's own ban on it, friction the
design wants on any stray execution. A denial there enters the
fallback lane below, never a workaround. Variable *removal* — the
`APP_DATA` flip — is granted whatever the installed CLI spells it: it is an
update-lane action by design, not a deletion.

**The second accepted-friction seam.** Beyond the Step 6/7 `.env.<env>`
secret pipe (below), the reconcile-time stdin patch to `railway environment
edit` is a second named seam the grant deliberately does not cover — Step
5's "Branch mapping writes" subsection and the pre-deploy hook write
(Pre-deploy schema apply, above) both ride it. Unlike the secret pipe, the
patch carries only identity and configuration — a branch name, a service
ID, and (for the hook write) the pinned schema-apply command — no secret —
so the transcript-hygiene rule is not in play; the seam exists because the
pipe's leading `echo` defeats the grant's prefix match (below), not for
hygiene. It may prompt (manual mode) or be classifier-judged (auto mode); a
denial enters the fallback lane with the exact `!`-prefixed one-liner. The
skill does **not** route around this seam by writing the patch to a file
and redirecting it in with `<` — that is equally outside the grant and
leaves an artifact to clean up, so it buys nothing.

**The stdin-priority trap.** `railway environment edit` is deliberately
**not** granted, and its **flag form is never used** as an instruction
anywhere in this skill. Under an agent harness, piped stdin takes priority
over flags — an unattended `--service-config` flag call reads empty stdin,
prints "No changes to apply", and exits 0, silently doing nothing. The
stdin-JSON patch pipe above is the CLI's actual non-interactive spelling for
this write, and it is the **only** form this skill executes. A future editor
must not "simplify" the pipe into the flag form — that reintroduces the
silent no-op it exists to avoid. Granting `environment edit` outright would
make exactly that silent-no-op flag form the frictionless spelling, inverting
the incentive; leaving it ungranted keeps the friction on the form that
would otherwise fail invisibly.

**Every interview question and confirmation uses `AskUserQuestion`** —
never a "reply yes to continue" prose prompt. This is load-bearing, not a
UX preference: the grant survives an answered `AskUserQuestion` but dies
at the next typed user message, so a prose confirm would silently
reintroduce a denial at apply time. `$ARGUMENTS` free-text steering is
unaffected — it arrives with the invocation turn itself.

If the user does type a message mid-run (their prerogative), keep working
but treat the grant as gone from that point on: any subsequent denial
enters the fallback lane, and the final report may recommend re-invoking
`/archascode:deploy` — re-invocation re-establishes the grant, and the
reconcile model makes the rerun idempotent by construction.

**Granted railway commands run bare.** Output is consumed from the tool
result, never captured via `>`/`>>`; pipes are avoided on reconcile-lane
railway calls — redirection defeats the grant's prefix match. Two
interpretation pins:

- The secret-bearing reads (`railway variable list --json`, `railway
  environment config --json`) run bare under the grant. Tool-result
  content is not "echoing into the transcript" in the hygiene rule's
  sense below — that rule bans *re-printing* values in this skill's own
  output and *writing* them anywhere but gitignored files. Do not "fix"
  these reads with a secret-stripping pipe; that defeats the grant to
  solve a non-violation.
- The Step 6 BYO channel and the Deployed auth posture's `AUTH_API_KEY`
  seed pipe or redirect secrets into the gitignored `.env.<env>` on
  purpose, so the values never transit the transcript. Those compound
  commands are *expected* to fall outside the grant and may prompt or
  be classifier-judged; that is accepted — hygiene outranks the
  no-prompt goal, and the write targets a workspace file. On a denial
  there, hand the user the exact one-liner to run via the `!` prefix.
  Both are named members of one accepted class — same gitignored
  target, same expected-outside-the-grant runtime behavior, same
  fallback one-liner on denial.

### On any permission denial

Any permission denial — classifier or a user-declined prompt — on any
command in this skill is handled the same way:

1. **Stop that action.** Never re-phrase, re-route through another tool,
   or otherwise engineer around the denial — the permission system is
   the user's, not the skill's.
2. **Offer exactly two exits:**
   - The verbatim command as a `!`-prefixed one-liner the user runs
     in-session — output lands in the conversation, so the run can
     continue immediately. For a secret-bearing command this is the
     same exposure class as a tool result and is accepted for the same
     reason.
   - The settings-rule route below, with the plain statement that
     written rules take effect from the **next** session — the current
     run resumes via re-invocation.
3. **Park, don't fail.** Steps depending on the denied action are parked
   and appear in the final report as `blocked (permissions)`. A later
   rerun picks parked work up by reconcile construction.

**The settings-rule offer** is lazy and **reactive-only**: it appears only
after an actual denial — a default run with no denials never sees it (with
no delete lane, there is no delete-confirmation moment to trigger it
proactively). Before offering, best-effort
preflight: read
`~/.claude/settings.json`, `<project>/.claude/settings.json`, and
`<project>/.claude/settings.local.json` (a missing file means no rules;
the user-scope read sits outside the workspace and may itself prompt for
file access — expected, harmless, read-only), and prefix-match the
needed prefixes against each file's `permissions.allow`. Deny/ask rules
and managed settings are outside this check — it is best-effort, and a
false skip is still caught by the reactive arm after an actual denial.
If covered, skip the offer.

When offered, ask **one** `AskUserQuestion` with four scopes, each with
its one-line posture guidance:

- **user** (`~/.claude/settings.json`) — follows the person across
  projects; the solo-dev default.
- **project, tracked** (`.claude/settings.json`) — the only scope a
  teammate inherits via the repo; a licensed exception to this skill's
  zero-tracked-repo-writes rule (see "What this skill does NOT do") —
  write only under this explicit choice, show the exact JSON diff
  first, and never commit it.
- **project, local** (`.claude/settings.local.json`) — this machine,
  this project only.
- **skip** — proceed under the grant plus the fallback lane alone.

The write merges into existing JSON (never clobbers), and writes only
the denied command's prefix — never a blanket `Bash(railway:*)`. The
harness will itself prompt on the settings-file write; name that prompt as
the consent mechanism, not an error.

**Sequencing pin**: a rule written now helps no command in this session.
So the offer never blocks or reorders the work — offer, then write or
skip, then **proceed to attempt the confirmed action regardless**, under
prompt-or-classifier with the fallback lane above as the net. Never
attempt the denied action "under" a just-written rule expecting coverage;
always state that the rules apply from the next session.

If the settings write itself is denied, relay the exact rules as text
and name the two hand routes — the `/permissions` in-session UI, or a
hand edit of the chosen file (hand-edited rules apply from the next
session; whether `/permissions` additions apply live is deliberately not
asserted here). No retry.

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
4. **GitHub integration present**, needed for `railway add --repo`. If
   the CLI or API reports the integration missing, relay the dashboard
   install step (Railway's project settings → GitHub) and stop — this
   skill cannot install the integration itself.
5. **Plan-limit refusals are a first-class outcome, not a crash.** A Free
   plan may refuse project or environment creation at its resource cap.
   Surface the refusal verbatim and offer the user's real options: free up
   space (delete an unused Railway project/environment), upgrade the plan,
   or link into an existing project instead of creating one.
6. **Confirmation gates every mutation.** Every create and update below is
   proposed on a plan screen first and only applied once the user confirms.
   A precondition failure never silently retries into a mutation.

## Desired state

Desired state comes from exactly three reads — never from any other spec
field, and never inferred from `compute`/`data` alone (they are heuristics
for interview *defaults*, not decisions):

- **`.archascode/environments.json`**, read directly (this skill is a
  fourth reader of its version semantics, alongside core's
  `readEnvironments`, the emitted `aac.py`, and `bootstrap.py`).
  Restate the tolerance rule here, verbatim:
  - **Absent** → stop: `no .archascode/environments.json — render first
    (/archascode:apply)`. Absence means "never rendered or cleaned."
  - **`schemaVersion` present but not `1`** → **fatal**, same stop message
    — never resolve against a stale table.
  - **Present with `environments: {}`** → its own outcome, not an error:
    `no environments declared — nothing to deploy`, stop.
  - Otherwise: the environment table — name, `portBinding`, `compute?`,
    `data`, `persistenceBackends`, `appAdapters.auth.id` (absent →
    `noop`, the `/archascode:apply` reader fallback — Deployed auth
    posture, below) — is the desired-state input.
- **`spec/deploy_targets.yml`**, read directly. This file is the
  deploy-layer skills' declared intent and interview memory — **never**
  "state": the platform stays the record of actuals, and this file is
  never reconciled *toward* it. A row here carries identity and grants
  only, **never values** — the env-key seam (below) keeps sole custody of
  every runtime value. Tolerance, four arms:
  - **Absent** → legal, and means exactly today's scope behavior in
    full: every declared environment is in scope on both channels (Run
    scope, below).
  - **`schemaVersion: 1`** → proceed.
  - **`schemaVersion` absent, malformed, or any other value** → stop:
    `spec/deploy_targets.yml does not carry schemaVersion: 1 — fix the
    file or remove it (absence is legal)`, naming the file and the
    expected version.
  - **Unparseable YAML** → the same stop.
  - Otherwise: per environment, up to three target rows keyed `hosting` /
    `persistence` / `auth`, each an identity (`provider`, plus
    provider-specific keys) plus the two independent grants `reconcile`
    and `verify`. This read feeds Run scope and Step 3's coherence
    checks, below.
- **One `spec/architecture.yml` read**: the declared env-key names under
  `adapters.persistence.<backend>.env` (for postgres, the single `url` key).
  This supplies the variable *name* to wire, never a value.

**Plus one advisory-only spec read** — the declared auth posture (the
app-wide `api.auth.type` default cascade and explicit
`entity.api.auth` overrides, plus entity enumeration for list routes,
the per-op `entity.api.disabled` skip, and `api.base_path`). This read
feeds **two** consumers: the protected-anonymous advisory line (Step 3)
and Step 7's auth-probe route selection (Deployed auth posture, below)
— **never** desired state, never a reconcile/apply decision input,
never a gate on an apply (a failed smoke ⚠s the report; it gates
nothing). The read stays declaration-level, not route-level — no
per-route derivation of relationship or promoted-method
routes; a false "all quiet" on exotic combinations is accepted and
neither consumer's absence is a security claim.

### The interview: which NEW environments to create is asked, every run

Railway is the durable record of platform reality; the repo never caches
an answer of its own accord — but `spec/deploy_targets.yml`'s grants are
declared consent, not a cache, and they now gate what "in-scope" means
(Run scope, above). Presence-on-platform no longer implies scope by
itself: an environment already on Railway but declared **out** of
reconcile scope (a `local` hosting target, or `reconcile: false`) is
reported as fact on the plan screen — an informational, surplus-style
line — and never reconciled, never asked about. An environment **in**
reconcile scope is reconciled every run (variables, `APP_ENV`, branch
verification, domain/proxy existence) with its state shown on the plan
screen, and no existence question is asked about it. So on **every**
run, list **only the reconcile-scope declared environments not present
on Railway** (Run scope) and ask which of them to **create** this run,
with defaults layered in this order:

1. **Axis heuristics** (suggestions only — the user's answer is what
   counts):
   - `persistenceBackends` non-empty **and** `compute: external` →
     suggested **yes**.
   - `compute: docker` → suggested **no** (this env is a local rehearsal
     loop, not a platform target).
   - Memory-only (`persistenceBackends` empty) → preselected **no**,
     annotated **"(demo candidate)"** — a memory env is a legitimate
     platform target (a stateless demo), just not the default guess.

2. **A scoped run's named environment** is preselected **yes** regardless
   of the heuristics above — naming it is explicit intent (Run scope).

A **declined** creation candidate is recorded **nowhere in the repo** —
unchecking it means "not this run", nothing more: it is recorded nowhere
and offered again next run. Omission can no longer route anything toward
deletion, because nothing routes toward deletion. A
`compute: docker` environment the user opts into anyway is reconciled
identically to any other SQL environment: the `compute` axis describes the
*local* dev loop, and on the platform every database is external by
construction.

An **accepted** creation candidate is different: its "yes" lands on disk
in `spec/deploy_targets.yml` as a full hosting target row with **both
grants written explicitly** — `reconcile: true, verify: true` — per
Step 3's write discipline, below. Grants are consent; writing them
explicitly on creation is what lets a later run's scope derivation trust
the file at all.

## Branch posture

Railway builds from GitHub, not the working tree, so branch identity is
checked before planning:

- The skill deploys **the branch the repository is currently on** — never
  a hardcoded `main`. This is what keeps the invariant "the spec that
  declares environment X travels on the branch that deploys X" true
  without any extra bookkeeping (bootstrap resolution reads the deployed
  checkout's `environments.json`).
- Verify the current branch tracks a pushed remote (`git rev-parse
  --abbrev-ref --symbolic-full-name @{u}`, then compare `git rev-parse
  HEAD` against the remote ref). If local `HEAD` is ahead of or diverged
  from the tracked remote, warn — Railway will build whatever is on
  GitHub, not the uncommitted or unpushed state of the working tree.
- **Detached `HEAD` or an untracked branch degrades to asking** the user
  which branch to deploy, rather than guessing.
- Parse the `<owner>/<repo>` slug from the tracked remote's URL (for
  `railway add --repo`). The remote may use an **SSH host alias**
  (an ssh-config `Host` entry standing in for `github.com`) — resolve
  the alias to its real host (`ssh -G <alias>`, read `hostname`) before
  judging GitHub-ness; an alias resolving to `github.com` is a GitHub
  remote (verified live with a private repo behind an alias). A
  genuinely non-GitHub remote (Railway's repo integration is
  GitHub-only) or an ambiguous multi-remote setup is a stop-and-explain
  outcome — never a guess.
- **The plan/confirm screen always names the branch** being deployed, so
  an inferred default is never invisible at confirm time.
- **Per-environment branch mapping is owned vocabulary, adopted from
  Railway.** The per-environment source branch lives in Railway's
  environment-config document (`services.<id>.source.branch`), not in this
  repo — there is no spec field and no state file for it. On **every** run,
  each in-scope environment's current mapping is **read** from `railway
  environment config --json` and shown on the plan screen as a **fact**,
  never a divergence to correct. A mapping **change** happens only on
  explicit request — `$ARGUMENTS` steering, or an interview answer at
  environment creation (Step 2) — and rides the normal update-lane
  confirmation; this skill never proposes changing an existing mapping on
  its own initiative. An environment with **no** per-env branch in its
  config document (hand-created, or predating this mechanism) has nothing
  to adopt: its **deploy-truth** branch (Step 1's `deployment list` read) is
  reported annotated `(service default; no per-env mapping)`, that observed
  branch is used as B for the spec-travels-with-branch check (Step 3), and
  an explicit mapping is offered only on request. A **requested** branch is
  verified against `git ls-remote --heads <remote> <branch>` before it
  enters the plan — **existing remote branches only, never created**. See
  Step 3's spec-travels-with-branch check and Step 5's "Branch mapping
  writes" subsection for the mechanics of reading and writing this mapping.
- **This skill never creates a branch** — repo topology has another owner,
  and no per-branch desired-state derivation is attempted: the run always
  derives desired state from its own checkout (Step 3 refuses, rather than
  reconciles, when a mapped branch's table disagrees with the checkout's).

## Explorer access posture

The API Explorer's entity CRUD runs as a webview-side `fetch`, so a deployed
environment must explicitly admit that origin before the Explorer can reach
it at all. `CORS_ORIGIN_REGEX` on the **app service** joins this skill's
owned per-environment vocabulary, carrying exactly one skill-written value:

```
^vscode-webview://.*$
```

This is deliberately narrower than the local dev seed (no
`http://localhost:<port>` alternative) — a deployed environment has no
reason to admit arbitrary localhost web pages; the local dev surface stays
`aac up`. It admits VS Code / Cursor webviews and nothing else. This is a
**tool-context gate against operator error** (a teammate pointing a live
CRUD editor at prod), **not a security boundary** — the auth posture
(`api.auth`) plus the fail-closed `APP_DATA=protected` default remain the
data boundary. Absence is the default, so every pre-104 deployment is
Explorer-blocked until explicitly enabled.

**The three-state read.** On every run, each in-scope environment's
app-service variables are read (Step 1's fenced block — see there for the
read, not restated here), and the CORS variable family
(`CORS_ORIGIN_REGEX`, `CORS_ORIGINS`, `CORS_CREDENTIALS`) classifies:

- **absent** — no CORS variable of any name present → Explorer-disabled
  (the default).
- **skill-owned** — `CORS_ORIGIN_REGEX` equals the pinned value above and
  no other CORS variable is present → Explorer-enabled.
- **hand-managed** — anything else: a non-pinned regex value, or any
  `CORS_ORIGINS` / `CORS_CREDENTIALS` present (with or without the skill's
  own variable).

The whole-family trigger is deliberate: the rendered app mounts **one**
CORSMiddleware, and `CORS_CREDENTIALS=1` applies middleware-globally — a
skill-written regex on such an environment would grant *credentialed* CORS
to every VS Code webview, a composition this skill must never create.
**This skill never sets `CORS_ORIGINS` or `CORS_CREDENTIALS`** — the
Explorer authenticates with a bearer header, not cookies.

**Hand-managed handling.** A hand-managed state is reported as a **fact**
on the plan screen and never read-modify-written, "corrected," merged, or
deleted (the ownership boundary's existing rule — Step 3 — applies here
too; a hand-managed CORS family is its worked example). A request to
enable or disable Explorer access on a hand-managed environment is a
**stop-and-explain** — the skill won't merge, overwrite, or reason about a
user's CORS surface — never a rewrite.

**Adopt-and-change-on-request**, mirroring Branch posture's own paragraph:
an environment's adopted Explorer state is shown on the plan screen as a
fact, never a divergence to correct. An enable/disable **change** on an
existing environment happens only on explicit request (`$ARGUMENTS`
steering, or a direct ask), rides the normal update-lane confirmation, and
is never proposed by the skill on its own initiative — Railway's current
state *is* the desired state between explicit requests (zero repo writes;
no spec-derived reconcile).

**Enable/disable writes and converge.** Four arms:

1. **Enable, environment created this run**: the variable joins Step 6's
   batched writes. For a **SQL** environment every write in that batch
   passes `--skip-deploys` (Step 6, below) and the variable rides the
   **pre-deploy hook write's** triggered deploy (or the decline arm's
   plain `redeploy` — Pre-deploy schema apply, above); for a
   **memory** environment the batch keeps its existing rule (final
   write without `--skip-deploys`) and that write's own auto-redeploy
   carries it. Either way, no extra converge.
2. **Enable, existing environment** (explicit request): one
   ```
   railway variable set 'CORS_ORIGIN_REGEX=^vscode-webview://.*$' --service <appService> --environment <env>
   ```
   — **without** `--skip-deploys`, so the set's own auto-redeploy converges
   it (~45 s to serving).
3. **Disable** (explicit request):
   ```
   railway variable delete CORS_ORIGIN_REGEX --service <appService> --environment <env>
   ```
   **followed in the same confirmed plan line by**
   ```
   railway redeploy --yes --environment <env> --service <appService> --json
   ```
   (plain — no `--from-source`, no rebuild). The chained redeploy is part
   of the disable action's **definition**, not a separate confirmation:
   `variable delete` never triggers a deploy — config-truth clears while
   the serving deployment keeps admitting webviews indefinitely, silent in
   the unsafe direction. A disable line's text names both halves.
4. **Enable fallback**: if Step 7's poll expires with **no deployment in
   flight** (`deployment list` read), converge with the plain
   `railway redeploy` under the **same** confirmation as the enable (the
   confirmed action's defined behavior is a redeploy; the fallback
   completes it). Only a post-fallback mismatch ⚠s.

Plus the **steady-state arm**, scoped to **absent and skill-owned
environments only** — a hand-managed environment carries no skew judgment
and no converge offer: a config-truth/deploy-truth skew found by Step 7's
probe is always **reported**; its converge (plain `railway redeploy`)
enters the plan only as its **own separately-confirmed line** (the Step
7.4 arm-2 pattern — confirming triggers a deploy the user didn't otherwise
ask for); declining leaves a re-shown (not re-asked) report line. Variable
removal stays update-lane — the Permission posture's existing "variable
removal is granted" pin already covers the `variable delete` spelling
above; no Permission-posture edit is needed for it.

## Deployed auth posture

A jwt- or api_key-declared environment can deploy "successfully" —
`/health` green, report table clean — and still be silently broken: the
verifying adapter's lazy config read raises the first time a real
request needs it. The resolved auth adapter's env keys join this
skill's owned per-environment vocabulary to close that gap.

**The gate and the vocabulary.** For each in-scope environment, the
resolved auth adapter is read from `appAdapters.auth.id` on the
**existing** `environments.json` desired-state read (camelCase; an
absent field resolves `noop` — the `/archascode:apply` reader
fallback, since older cloud builds may not populate it) — never a hand
re-derivation from the spec. The resolved id selects the vocabulary:

- **`noop`** → no auth vocabulary for this environment; the report
  column shows `n/a`. A spec declaring `api.auth.type: jwt` whose
  binding resolves `noop` gets no auth wiring — the binding lens is
  the truth, deliberately.
- **`jwt_bearer`** → `AUTH_JWKS_URL` + `AUTH_ISSUER`, a **required
  pair**, on the app service.
- **`api_key`** → `AUTH_API_KEY`, on the app service, as a secret (see
  Generation, below).

A missing required key is a broken deployment, not a preference — it
is proposed every run, unlike `CORS_ORIGIN_REGEX` or the branch
mapping. The key names are **adapter-fixed literals**: they are never
spec-read (unlike the postgres `url` key), so there is no new spec
read to license here — the desired-state read-count stays
untouched.

**Per-key ownership** (per key, not whole-family — the family is
heterogeneous: a derived public pair, a never-written optional key,
and a minted secret):

- A required key **missing on the platform** → missing wiring,
  proposed every run (from whatever source exists — see Plan arms,
  below).
- A required key **present on the platform with no local
  counterpart** → adopted, reported as fact, never rewritten.
- A required key present **both sides with differing values** → a
  skew (see Plan arms, below).
- **`AUTH_AUDIENCE` is never written, never deleted.** Platform-present
  → reported as fact. A **non-empty** local `.env.<env>` value → one
  report line stating it is *not* carried to the platform, naming the
  hand lane (`railway variable set`). An **empty** seeded
  `AUTH_AUDIENCE=` line is silently ignored. Do not "complete" the jwt
  pair into a triple — this is a decision (the provider's tokens carry
  no `aud`; an Auth0 fork is the named reopen), not an omission.
- **`CLERK_SECRET_KEY`**, and any other AUTH-adjacent local key
  outside the resolved adapter's key set, is **never** written
  platform-side — it is provider-automation credential, not app
  vocabulary; the deployed app never reads it.

The Step 3 ownership boundary gains "the resolved auth adapter's env
keys (app service, this section)".

**Value sources and hygiene.** jwt values are **read** from local
`.env.<env>` — the auth skill's output, and the only local record.
This skill **reads**, never derives: no publishable-key math, no
provider CLI, no `/archascode:auth` invocation — the dependency
direction is one-way, and this skill stays clerk-free. The read is
**keyed, not whole-file** (e.g. a keyed grep of the resolved adapter's
`AUTH_*` lines only), so `CLERK_SECRET_KEY` and every other line in
the file never enters a tool result via this skill; values are
compared and piped, never re-printed.

`AUTH_JWKS_URL` and `AUTH_ISSUER` are **pinned non-secret** — public
URLs, a JWKS endpoint and an issuer, both served openly by the
provider. They ride the ordinary **bare, granted, batched** Step 6
`railway variable set` writes (the `--skip-deploys` batching rule,
unchanged) — deliberately *not* the secret pipe, which would spend
ungranted friction on values with no hygiene need.

**`AUTH_API_KEY` generation.** `AUTH_API_KEY` is generated by this
skill, per environment, as a secret, and **only** when the key exists
on **neither** side (platform absent, local absent):

- **Generate**: `openssl rand -hex 32` — boring, 256-bit, paste-safe.
  The generation and the local seed are **one compound command**
  writing the `AUTH_API_KEY=<value>` line **directly into the
  gitignored `.env.<env>`** — never through the transcript. It
  executes at apply time with the confirmed bundle, **before** that
  environment's Step 6 variable batch (the platform write below reads
  the file, so the file line must exist first) — this is its own write
  site: this skill's only skill-initiated `.env.<env>` write, beside
  the user-driven Step 6 BYO channel. The same
  `git check-ignore -q .env.<env>` guard rule applies at this site (not
  ignored → stop the seed, point at `/archascode:init`). This is the
  first `.env.<env>` write this skill makes for a **memory-only**
  environment.
- **Platform write**: the value is piped from the file into
  `railway variable set "AUTH_API_KEY=$(…)" --service <appService>
  --environment <env>` — the existing Step 6/7 secret-pipe seam, same
  acceptance (expected to fall outside the grant's prefix match at
  runtime; may prompt or be classifier-judged; a denial takes the
  fallback lane with the `!`-prefixed one-liner). Not a new seam
  member — the BYO channel with this skill, rather than the user,
  producing the file line.
- **Per-environment distinct, always**: a key is never copied between
  environments, and never regenerated once a value exists on **either**
  side — a re-run adopts the platform value when the platform has one,
  and pushes the local value when only local has one (Plan arms,
  below); generation fires only when both sides are absent.
- The value is **never echoed** into the transcript, the plan text, or
  the report.

**Rotation is out of scope for v1.** The hand lane, named in the
report when relevant: edit the `.env.<env>` line and
`railway variable set` the new value (or ask for it explicitly — a
requested rotation is an explicit update, not reconcile drift).

**Plan arms.** Per environment, after the gate above resolves a
verifying adapter, the plan arm is chosen by where values exist.
**Presence is judged over the adapter's whole required key set**: a
half-present jwt pair (one key platform-side, the other nowhere)
counts as platform-missing for the arms below — the present key is
adopted per the ownership rules above, the absent one is what the arm
proposes or parks on.

- **Platform has all required keys** → adopted; nothing proposed
  (values may still skew against local — below).
- **Platform missing keys, local `.env.<env>` has them — either
  adapter** → ordinary missing-wiring **bundle lines** (preselected,
  the Step 3 bundle-confirmation pattern): a bare batched set for the
  jwt pair, the secret pipe (above) for `AUTH_API_KEY` — the push-local
  case (e.g. a key generated last run onto a since-recreated Railway
  environment).
- **Platform missing, local missing, adapter `jwt_bearer`** → the
  environment **parks `blocked (auth)`**, with exactly the
  `blocked (branch)` mechanics: its create/update lines drop from the
  plan, other environments proceed unaffected, and the report row
  names the fix — run `/archascode:auth` (which seeds `.env.<env>`),
  then re-run `/archascode:deploy`. If **every** in-scope environment
  parks this way, the run reports and stops with that instruction
  rather than presenting an all-parked plan (the
  spec-travels-with-branch precedent). This skill checks the
  precondition; it never provisions the provider.
- **Platform missing, local missing, adapter `api_key`** → **never a
  park**: the generation (above) rides that environment's bundle as a
  named line ("generate `AUTH_API_KEY` — written to `.env.<env>` and
  the service variable; value never shown"). Consent is the bundle
  confirmation itself — deliberately **no extra interview question**:
  unlike the Explorer axis there is no real choice to ask about (the
  binding requires the key; the only alternative is a broken
  environment).
- **Differing values** (platform ≠ local, either adapter) → a **skew**:
  always **reported**, never auto-rewritten (the value may encode a
  deliberate hand re-point of the deployed environment at a different
  provider instance). The converge (push the local value — the pipe
  for `AUTH_API_KEY`, a bare set for the jwt pair) enters the plan only
  as its **own separately-confirmed line**, the same pattern as the
  branch- and Explorer-converge lines. Declining leaves a re-shown
  (not re-asked) report line. Skew detection compares values inside
  tool results and never re-prints them.

**Skip vs. decline.** Unchecking a bundle carries the skill's standing
semantics, unchanged and adapter-symmetric: "skip this environment
this run," recorded nowhere, every line re-proposed next run — the
report row simply shows the platform fact (`missing`, annotated that
the wiring was skipped this run). The `unset (declined)` state is
reserved for an **explicit** decline of the auth wiring itself —
`$ARGUMENTS` steering, or a typed mid-run request under the skill's
standing typed-message rule (this is not a new typed-message channel)
— with the runtime consequence named on the row (jwt: token
verification will 500; api_key: key-bearing requests will 500).

**Creation candidates** resolve the same arms at plan time: a jwt
creation candidate with no local values parks *before* creation (never
create a known-broken environment); its api_key sibling carries the
generation line in its creation bundle; confirmed values join Step 6's
batched writes. A creation candidate has no app service at plan time
and is trivially platform-missing.

## Pre-deploy schema apply

A deploy that finishes booting proves nothing about its schema: the
generated app degrades gracefully when a table is missing, so `/health`
and every entity route can answer `200` against a database with no
tables at all. The only gate that catches this **before** it goes live
is one that runs inside the deploy itself, ahead of traffic — Railway's
`deploy.preDeployCommand`, a per-environment, per-service hook. This
skill owns it as the fourth member of its per-environment vocabulary
(after the branch mapping, `CORS_ORIGIN_REGEX`, and the resolved auth
adapter's keys), pinned to exactly one value:

```
uv run python aac.py --env <spec environment name> migrate
```

with the environment name baked in as a **literal** — the hook always
runs inside its own environment, so there is no shell to expand a
variable in, and this skill never writes one. The vocabulary applies
**only** to environments whose `persistenceBackends` is non-empty (the
same `environments.json` read Desired state already performs) — a
memory environment has no schema to apply and `migrate` refuses a
non-database-bound environment outright, so it never gets a hook. Both
a provisioned-Postgres environment and a BYO one are in scope: the hook
runs in the built image, with the same platform variables Step 6 wires
already present, so a BYO backend's schema now applies **in-container**
— there is no laptop-reachable-coordinates requirement left for schema
apply at all.

**What the hook is.** It runs pre-traffic, in the built image, with the
environment already resolved. A non-zero exit **fails the deployment**
while the previous one keeps serving — so a refused apply (a protected
database that has diverged from what the cuts expect) becomes a failed
deploy with the old code still up, which is the correct failure mode.
Nothing new is emitted to produce this: the hook runs exactly the
command `/archascode:db`'s `apply` verb has always spawned locally
(`aac.py migrate`), one layer closer to where the database actually
lives.

**Classification (config-truth, three states).** Every run reads each
in-scope environment's app-service `deploy` block via `environment
config --json` (the same read Branch posture already performs) — the
config document is **sparse**, so the key being **absent** (not `null`)
is the unset shape:

- **Absent** — missing wiring. Proposed **every run**, with the plan
  line stating plainly that confirming it **triggers a deployment of
  that environment** — the user is confirming a deploy, not a quiet
  config edit. For an environment **created this run**, the line rides
  that environment's per-environment bundle (a deploy is happening
  regardless of this write). For an **existing** environment
  (retrofit), it is its own **separately-confirmed** line, the same
  pattern as every other deploy-triggering converge in this skill. One
  further gate for BYO environments: the hook is proposed only once the
  environment's declared connection keys are **present platform-side**
  — proposing it earlier would manufacture a failed deploy by
  construction (`migrate` dies the moment it can't find the connection
  variable). Until then, the row reports `hook: withheld (BYO values
  unset)` and the proposal returns automatically once the keys land.
- **Skill-owned** — the stored value, after **normalization**, equals
  the pinned value. The platform coerces a written string into a
  one-element array on both read surfaces, so normalization means:
  unwrap a one-element array and compare the single string. Nothing to
  do, and **no write is issued** — adoption here is free, by comparison
  alone, never by re-sending a same-value write. This is exactly how a
  pre-existing known-good hook (left behind by an earlier manual setup,
  say) gets absorbed on the first post-merge reconcile.
- **Hand-managed** — any other non-absent value (a different command, a
  multi-element array). Reported as a **fact**, never rewritten; a
  request to change it is stop-and-explain, the same posture this skill
  takes with a hand-managed CORS family.

**The write.** The only write path is the reconcile-time stdin pipe, keyed by
the app service's **ID**, patching `deploy.preDeployCommand` alongside
whatever else the same patch carries:

```bash
echo '{"services":{"<appServiceId>":{"deploy":{"preDeployCommand":"uv run python aac.py --env <name> migrate"}}}}' | railway environment edit --environment <env> --json
```

The flag form is never used here either — see the stdin-priority trap
in Permission posture. Verify by read-back of **both** surfaces: the
config document (did the write take), and — on the deploy the write
triggers — the deployment manifest (`deployment list --json` →
`meta.serviceManifest.deploy.preDeployCommand`), never by exit code or
`committed:true` (a pipe write reports `committed:true` even on a
no-op). This is a **reconcile-channel** action under the hosting
target's `reconcile` grant — the same accepted-friction seam the branch
write already uses (Permission posture's "second accepted-friction
seam", above), so no grant change is needed for it.

**No removal lane.** There is no verified CLI path that clears
`preDeployCommand` — an empty or `null` value piped through silently
does nothing, and the flag form is blind to every value. A request to
remove the hook gets an informational line naming the Railway dashboard
as the place to clear it, plus the consequence (no deploy-time schema
apply from then on). Every skill-side recovery this section describes
writes a **working** value; none of them ever attempts removal.

**Claims discipline.** This section — and the report — say nothing
about whether the hook runs once per deploy or once per replica, and
nothing about multi-replica migration safety. That is unverified, and
staying silent about it is deliberate, not an oversight.

## Procedure

### Step 1 — query current Railway state

Every run, gather current state with `--json` throughout, so nothing below
relies on link-state or memory:

```bash
railway status --json
railway status --json | archascode targets adopt - --json   # target-row proposals (Adopting deployments, below)
railway environment list --json
railway environment config --environment <name> --json   # per environment
railway variable list --environment <name> --json         # per environment
railway domain list --service <app-service> --environment <name> --json
railway tcp-proxy list --service <db-service> --environment <name> --json
railway deployment list --environment <name> --service <app-service> --json   # per environment
railway volume -e <name> list --json   # per Railway environment
railway variable list --service <app-service> --environment <name> --json   # app service — Explorer CORS + auth wiring classification
```

`deployment list` is service-scoped and **defaults to the linked service** —
in a two-service environment (app + DB) that may be the wrong one, so the
explicit `--service <app-service>` flag above is load-bearing, not
decorative. This read supplies **deploy-truth** (the branch actually
deployed), which both the no-mapping arm of Branch posture and the
converge-verification semantics of Step 5/Step 7's deployed-branch
verification (item 3) consume.

**The last line is a second, app-service-scoped `variable list` read**,
added for Explorer CORS classification (Explorer access posture, above):
the existing unscoped `variable list` line carries no `--service` flag,
and Railway's linked-service default makes an unscoped read liable to
return the DB service's variables in a two-service environment — the same
trap `deployment list`'s note above documents. App-service identification
(Step 5's "Branch mapping writes" subsection — the `source.repo`
case-insensitive match) therefore runs **here**, at state-gathering time,
before classification, not only at write time; that identification rule
stays single-homed in Step 5. The platform side of Deployed auth
posture's (below) per-key classification rides this same
app-service-scoped read — the unscoped `variable list` line above is
liable to return the DB service's variables in a two-service
environment, the same documented trap.

**Volumes are read for the orphan report only, never written.**
The env selector rides the `volume` noun, not `list` — putting `-e
<name>` after `list` instead errors, live-verified — so the
always-explicit `-e` form immediately after `volume` is this skill's
standing CLI-scoping pattern (below) applied to the one verb whose
selector sits before the subcommand. **On an unscoped run the loop
domain is every environment on Railway's environment list**, not only
in-scope environments — an orphaned volume can live in an environment
this run otherwise ignores, and this read is delta detection over
current state, not a scoped convenience. A **scoped run** (Run scope)
reads only the named environment's volumes; the full sweep is what the
next unscoped run is for.

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
`railway environment link <name>` switch immediately before it (the
environment name is **positional** — a `--environment` flag form errors
with a usage message; verified live), so the executor never drifts
between the two styles.

### Step 2 — run the interview

Ask every question via the `AskUserQuestion` tool (see Permission
posture), once, up front (skipping any question `$ARGUMENTS` already
answered):

1. **Platform.** Only v1 answer: Railway. (Additional platforms will fork
   here in a future version — no per-platform skill.)
2. **Which new environments to create**, per Desired State's rescoped
   defaults above.
3. **Branch mapping, for every environment this run creates.** Every
   environment this interview lists is by definition a creation candidate
   (Desired State's rescoping), so this question rides each one the user
   elects to create. For each such environment, ask which branch it
   should build, via `AskUserQuestion`, options in this order:
   1. **The deploy branch** (the branch this checkout is on) —
      preselected default.
   2. **The name-matching remote branch** — suggested (not preselected)
      only when `git ls-remote --heads <remote> <name>` shows a branch
      named exactly like the environment (the qa→qa convention).
   3. **Other existing remote branches**, as the option budget allows.

   These heuristics **suggest, never decide** — the user's answer is what
   counts. A typed "Other" free-text answer is accepted but treated as
   potentially ending the `allowed-tools` grant (Permission posture); if a
   denial follows, proceed under the fallback lane. **Steady-state runs —
   no environment this run creates — ask no branch question at all**; every
   later run adopts the mapping from Railway (Branch posture) instead of
   re-asking it.
4. **"Enable API Explorer access?", for every environment this run
   creates.** Asked immediately after that environment's branch question
   (item 3), as its own `AskUserQuestion` with binary options. Defaults are
   suggestions only — the user's answer is what counts:
   - `data: ephemeral` (SQL) and memory-only environments → suggested
     **yes** (demo/qa shapes; memory demos are the Explorer's primary
     remote target).
   - `data: protected` → suggested **no**.

   **Steady-state runs ask no Explorer question at all** — an existing
   environment's Explorer state is adopted as a fact and changed only on
   explicit request (Explorer access posture, above).
5. **Project linking**, if unlinked (Step 1).
6. **BYO coordinates**, only for environments whose persistence backend
   Railway cannot provision (Step 6 below) — see the BYO note there for
   exactly what is (and is not) asked.

Auth wiring asks **no** interview question: its consent rides the plan
bundles (Deployed auth posture, above), and a jwt creation candidate
without local values parks at plan time instead of being asked
about — the same "steady-state runs ask no Explorer question" cadence
above, applied to auth.

### Step 3 — build and present the plan

Diff desired state (Step 2's answers) against current state (Step 1) and
present **one** plan covering every environment in scope. Every
confirmation below uses `AskUserQuestion` (see Permission posture) — never
a prose "reply yes to continue."

Plan lines come from **two independent sources**: the desired-vs-current
diff, and the `spec/deploy_targets.yml` adoption lines (Adopting
deployments, below). A run where every environment is already fully
converged on the platform still builds and presents the plan whenever an
adoption line exists — convergence and adoption are separate questions,
and an adoption line is real, confirmable plan content on its own.

#### The spec-travels-with-branch check (run before the plan is shown)

For every in-scope environment X mapped to branch B (the deploy branch
included — an environment with no adopted mapping uses its observed
deploy-truth branch as B, per Branch posture), verify the boot-resolution
contract against **what Railway will actually build** — the committed
state of `origin/B`, not this checkout's working tree:

```bash
git fetch <remote> B   # quiet
git show <remote>/B:.archascode/environments.json
```

This is **read-only git** — no Railway call, no write of any kind — and
runs at plan time so a finding lands on the plan screen, never mid-apply.
Four findings block **that environment only** (it parks as
`blocked (branch)`, its create/update lines drop from the plan, and
other environments proceed unaffected):

- **B does not exist on the remote** (the fetch fails, or `ls-remote`
  returns nothing — an adopted mapping can point at a since-deleted
  branch). Fix: remap the environment (an explicit request, Branch
  posture) or restore the branch.
- **The file is absent on B, or its `schemaVersion != 1`** — the
  environments-file tolerance rule, applied to a git ref instead of the
  working tree.
- **Environment X is not declared in B's table** — the exact condition
  boot resolution makes fatal.
- **X's entry on B differs from X's entry in this checkout's table** (a
  JSON compare of the single entry — desired state is always derived from
  the checkout, never from B, so a disagreement here is refused rather
  than silently resolved one way or the other):
  - **When B is a branch other than the deploy branch**: finish the
    promotion (merge/cherry-pick the entry across), or run
    `/archascode:deploy` from a checkout of B.
  - **When B *is* the deploy branch** (by far the most common trigger —
    the rendered `environments.json` is uncommitted, or committed but
    unpushed): commit and push the rendered `.archascode/environments.json`
    on the deploy branch, then re-run. **For this one file**, this
    supersedes the general local-ahead *warning* posture (Branch posture)
    with a hard park — a warned-through run would derive desired state
    from a table Railway will never build, which for a newly declared
    environment is exactly the boot-fatal condition above. General code-ahead of
    remote remains a warning; only an `environments.json` divergence
    hard-parks the affected environment.

If **every** in-scope environment parks this way, the run reports and
**stops** with the commit/push (or remap/restore) instruction rather than
presenting an all-parked plan — this is the first-deploy case: a first
deploy requires the rendered `.archascode/environments.json` **committed
and pushed** on the deploy branch before its environments can enter a plan
at all (committing itself stays the user's job, never this skill's).

The `blocked (auth)` park (Deployed auth posture, above) — a jwt
environment with no value source anywhere — uses these exact same
mechanics and the same all-parked stop shape: an affected environment's
create/update lines drop, other environments proceed, and an
every-in-scope-environment park reports and stops rather than
presenting an all-parked plan.

#### The cuts-travel-with-branch check

With the laptop apply lane retired, the pre-deploy hook (Pre-deploy
schema apply, above) is the **only** remaining apply path — and a hook
running against an empty committed chain doesn't fail: it bootstraps
`schema_version`, applies nothing, and boots the app into the
green-and-empty state **permanently**. This check exists to keep that
from happening silently.

For every in-scope environment X with a non-empty `persistenceBackends`,
mapped to branch B (the same B the spec-travels-with-branch check
above resolves), use the **same fetch** already performed there to list
the committed schema chain on `origin/B`:

```bash
git fetch <remote> B   # quiet, likely already run above
git ls-tree -r --name-only <remote>/B -- spec/locked | grep 'schema/migrations/.*\.sql$'
```

- **Zero cuts for X's backend on B** — park **`blocked (cuts)`**, with
  exactly the `blocked (branch)` mechanics: X's create/update lines
  drop from the plan, other environments proceed unaffected, and an
  every-in-scope-environment park reports and stops rather than
  presenting an all-parked plan. The row offers `archascode
  cut-schema-migration` — naming plainly that it is a **network verb**
  needing archascode-cloud login (relay `/archascode:login` on a 401)
  — then **stops for the user to commit and push the cut**: this skill
  still never commits. The fix pointer names the full sequence: cut →
  commit → push to `<mapped branch>` → re-run.
- **The local-vs-origin divergence line.** Sealed cuts are immutable,
  so this is a **file-list comparison**, not a content diff: compare
  the working tree's `spec/locked/**/schema/migrations/*.sql` chain
  against `origin/B`'s, per in-scope SQL environment. A difference
  produces one **report-level** line naming the unpushed or
  uncommitted cut files — never a park, since the deployed environment
  is internally consistent either way. The line exists so "my new cut
  silently isn't live yet" is surfaced rather than discovered later.

#### Adopting deployments that predate `spec/deploy_targets.yml`

A project that deployed before this file existed has real Railway
environments with no corresponding target row. `archascode targets
adopt` (run at Step 1, above, over the `railway status --json` output)
derives the fix mechanically: for every declared environment it proposes
`propose-hosting`/`propose-persistence` entries, fills a drifted adopted
key (`fill-adopted-key`), or reports `noop`, `skip`,
`no-candidate`/`ambiguous` (candidate lists, no proposed row), or
`inaccessible`. **Adoption is independent of reconcile convergence by
construction** — a fully converged environment with no target row still
yields its proposal, so there is no "nothing to reconcile" path that
skips the offer.

Render every actionable entry (`propose-hosting`, `propose-persistence`,
`fill-adopted-key`) as a plan line inside its environment's bundle — one
confirmation per environment, the same per-environment bundle
confirmation described below. An `ambiguous` entry becomes an interview
question (which candidate is the app/DB service); a `no-candidate`
finding is reported, no row proposed. Declining an environment's bundle
writes nothing for it; it is offered again next run.

After the bundle confirmation, apply the confirmed proposals with
`archascode targets adopt - --apply --expect <digest> --env
<selected-envs>`, passing back the plan's digest and the confirmed
environment subset; resolve any `ambiguous` answers via `archascode
targets set` (below) before this apply call. **Ordering pin**: run the
targets apply first, then any `ambiguous`-resolving `targets set`
writes, then the Railway mutations for the same environments (Step 4
onward) — the digest re-derivation the apply call performs must see the
same targets file and status document the plan saw, so nothing that
could change either may run before it.

#### The per-key write discipline (stated once, applies to every target write)

Writes to `spec/deploy_targets.yml` ride the `archascode targets`
verbs (`set`/`adopt --apply`), which enforce the write discipline in
code — declared keys refuse on mismatch rather than rewrite, adopted
keys fill/update only via their own kind, and grants apply only when a
write names them. Confirmations stay `AskUserQuestion`-shaped: every
write this skill makes is either same-value-inert or rides a confirmed
plan line, never silent.

#### Coherence checks (a pure local read, every plan phase)

Before the plan is shown, run `archascode targets check --json` — a
pure local read, no platform call — and park each finding's environment
as `blocked (targets)`, with exactly the `blocked (branch)` mechanics
above: its create/update lines drop from the plan, other environments
proceed unaffected, and the report row names the fix. The offer for an
orphaned row or a renamed environment is a **pointer**, not a write —
name the plugin's Adapter rail environment editor or a hand edit of
`spec/deploy_targets.yml` as the fix; this skill has no removal or
carry-over verb. Safety never depends on this check running: every plan
line derives from the *join* of the spec and the targets file, so a
grant sitting on an incoherent target produces no plan line by
construction.

**Per-environment confirmation.** One `AskUserQuestion` **multi-select**
over per-environment apply bundles: each in-scope environment's creates
and updates (new environment, DB services, missing or drifted wiring
variables, `APP_ENV`, missing domain, missing auth wiring or an
`AUTH_API_KEY` generation line — Deployed auth posture, above — the
pre-deploy hook write for a created SQL environment — Pre-deploy schema
apply, above — and the environment's `spec/deploy_targets.yml` adoption
row when it has no target row yet — Adopting deployments, above) as
**one selectable line, all preselected**. Unselecting a bundle means
exactly "skip this environment this run" — nothing is recorded, nothing
is deleted, and the environment re-enters the plan next run.
Informational lines (below) carry no checkbox — they are report, not
action.

Three lines ride **outside** the bundles, each with its **own** separate
confirmation:

- The steady-state branch-converge line (Step 7's deployed-branch
  verification, item 3, arm 2) — unchanged.
- **The steady-state Explorer-converge line** (Explorer access posture,
  above) — a config-truth/deploy-truth Explorer skew on an absent or
  skill-owned environment is always reported, but its converge
  (`railway redeploy`) is confirmed on its own line, the same pattern as
  the branch-converge line just above.
- **Setting `APP_DATA=ephemeral` on an environment that already exists on
  Railway** — the one data-destroying write left in this skill: a spec
  flip turning on boot-time clear-and-load against a database
  that may hold data. On an environment **created this run**, this write
  rides the bundle instead, with both consequences (the boot-time
  clear-and-load, and the admin save route mounting on a public URL)
  named in the bundle text — the database is fresh and empty, so the
  extra confirmation buys nothing there.
- **The auth value-skew converge** (Deployed auth posture, above) — a
  differing `AUTH_*` value between local `.env.<env>` and the platform
  is always reported, but its converge (push the local value) is
  confirmed on its own line, the same pattern as the branch- and
  Explorer-converge lines above it.

**Surpluses are informational pointer lines, never a delete lane.**
Each reappears on every unscoped run while its surplus exists
(a scoped run reports only the named environment's own surpluses — Run
scope), with no
offer, no confirmation, no warning tone, and — per Pin 4 — every pointer
names the dashboard **action**, never a CLI spelling:

- **Orphan environment** (a Railway environment matching no declared
  environment): "To delete the `<name>` environment, open the Railway
  dashboard → Project Settings → Environments and delete it there." When
  the orphan carries a DB service, the line adds a data note: deleting the
  environment destroys its database data — and if this orphan is a
  rename's old name, the data did not move to the new environment; export
  first if needed. The note keys on the DB service's presence, never on
  rename detection (there is none — see Rename, below).
- **The auto-created default `production` environment**: the same line,
  same pointer — no softer framing, since no deletion is ever offered by
  this skill either way. Note this case exists on **every first run**, not
  only pre-existing projects — `railway init` auto-creates `production` —
  so the plan screen names it up front rather than surfacing it at run
  end.
- **Established DB service an environment no longer needs** (the spec
  flipped this environment from SQL to memory): a pointer to delete the
  service in the dashboard, **plus the volume caveat** — deleting a
  service strands its volume (Step 1's volume read exists for exactly
  this), so the pointer also names deleting the volume in the dashboard,
  where Railway's 48-hour undo window applies.
- **Orphaned volume** (`serviceName: null` in Step 1's volume read — e.g.
  left by a pre-103 cleanup or a hand deletion): the same dashboard
  pointer.
- **Surplus domain**: the same pattern. (A **missing** domain is still
  created — creation verbs are unaffected.) An existing TCP proxy on a
  DB service is likewise never touched — it stays surplus-reported with
  the dashboard pointer, never deleted (this skill's deletion-free
  posture, unchanged).
  **Laptop database access is a named hand lane, not a skill job**: a
  user who wants it creates a proxy in the dashboard and hand-maintains
  `.env.<env>` — `/archascode:db` stays the local plan/apply verb for
  whoever does that.

**Rename** — no rename-detection machinery at all: a rename simply *is* an
ordinary scratch create (the new name, under the normal creation
confirmation) plus an ordinary orphan line (the old name, with the
dashboard pointer above). The **data-does-not-move** fact is stated
unconditionally right here, and again in the orphan line's data note
above wherever it applies — neither needs detection.

**Ownership boundary** — the plan only ever proposes changes within this
closed vocabulary: environments, the DB services this skill provisioned,
the wiring variables it set, `APP_ENV`, `APP_DATA`, `CORS_ORIGIN_REGEX`
(app service, Explorer access posture, above), the resolved auth
adapter's env keys (app service, Deployed auth posture, above), domain
existence, and the pre-deploy schema-apply hook (`deploy.preDeployCommand`,
app service — Pre-deploy schema apply, above). Everything
else on a service — scaling, regions, healthchecks, dashboard experiments,
the service-level GitHub source settings, any variable this skill did not
set — is user-owned and is never read-modify-written, "corrected," or
deleted, no matter how it compares to desired state. A hand-managed CORS
family is the worked example (Explorer access posture, above).

**Explorer state, shown as a fact.** Each in-scope environment's Explorer
state (absent / skill-owned / hand-managed — Explorer access posture) is
shown on the plan screen as a fact, never a divergence to correct. A
protected-environment **enable** line is consequence-named (the `APP_DATA`
precedent): the Explorer is a live CRUD tool; CORS admits any VS Code
webview on any machine (the per-panel-UUID granularity ceiling); auth
posture, not CORS, protects the data. It rides the normal bundle — **no**
separate confirmation gate, since it destroys nothing by itself.

**The protected-anonymous advisory line.** For every in-scope
`data: protected` environment whose declared posture exposes anonymous
writes, the plan gains one informational line (no checkbox — report, not
action), independent of Explorer enablement: advisory prose naming the
environment, the posture found, and the fix location (`api.auth` /
`entity.api.auth` in `spec/architecture.yml`). It never gates, parks, or
refuses anything — see Desired state's advisory-only spec read, above.

**Auth plan-screen facts.** The `AUTH_AUDIENCE` not-carried line and the
explicit-decline (`unset (declined)`) semantics — both Deployed auth
posture, above — surface on this plan screen where relevant: a
non-empty local `AUTH_AUDIENCE` prints its not-carried line beside the
affected environment's bundle, and an explicit auth-wiring decline
shows the runtime consequence named on that environment's line.

**`APP_DATA` flip semantics** — if an environment's entry is now `data:
protected` but its service still carries `APP_DATA=ephemeral`, the plan
offers **removing** that variable (restoring the fail-closed default).
Removal is the safe direction, so it rides the normal update
confirmation.

**Owned-DB identification** — there is no state file, so on later runs the
skill identifies "its" DB service per environment as **the one named by
the app service's own wiring reference variable**
(`${{<svc>.DATABASE_URL}}`, read from `environment config --json`). A
database the user added by hand is invisible to reconcile by construction
— it was never referenced, so it's never touched.

**Named exclusions — detect, stop, explain; never migrate:**

- **SQL backend switch** — a spec whose declared backend changed since the
  last deploy is a hand edit (the same backend exclusivity switch handled
  by a hand edit or `/archascode:analyze`), not something this skill
  resolves.
- **Data migration**, of any kind — this skill provisions and wires; it
  never moves data between databases.

### Step 4 — apply what was confirmed

Apply the confirmed per-environment bundles. There is no delete arm —
informational lines are never applied.

### Step 5 — topology: scratch-create environments

For a created SQL environment, this step's `add` and branch-converge
arms complete **first** — including whichever deploys they fire — before
Step 6's variable batch and the pre-deploy hook write that follows it
(Pre-deploy schema apply, above, states the full ordering and why).

- **Railway environment name == spec environment name**, always — this is
  what keeps `APP_ENV`, `RAILWAY_ENVIRONMENT_NAME`, and the spec in visible
  agreement. The default `production` environment is left alone (Step 3).
- **Scratch creation is the only creation flow, first environment or
  subsequent — there is no duplicate in this skill.**
  Create the named environment, `railway environment new <name> --json`,
  then `railway environment link <name>` (positional — Step 1's scoping
  pattern), then create services directly into it:
  - App service: `railway add --repo <owner>/<repo> --branch <mapped
    branch> --service <repo>-<env>` — the explicit `--service` name is
    **always** passed, uniformly `<repo>-<env>` (e.g. `crm-lite-demo`, for
    the `crm-lite` repo's `demo` environment). There is deliberately **no
    plain-name special case for a "first" environment**: "first" has no
    stable definition (a single run may create several environments at
    once), and capture-never-assume applies to the CLI's default name too
    — the `add` flag-blindness gotcha below makes an unpassed default
    unverifiable by intent. `<repo>` is the repo half of the parsed
    `<owner>/<repo>` slug (Branch posture). The mapped branch is Step 2's
    interview answer, not unconditionally the deploy branch (they
    coincide when the interview took the default). The initial deploy
    after `add` builds the repo's **default** branch regardless of
    `--branch` (a Railway platform behavior, not a flag bug), so when the
    mapped branch differs from the repo default this converges per the
    "Branch mapping writes" subsection below / Step 7's deployed-branch
    verification (item 3), arm 1.
  - DB service: `railway add --database postgres --json`, **only when**
    the environment's `persistenceBackends` names a Railway-provisionable
    backend. A memory-only environment gets no DB-shaped resource at all
    — its whole footprint is `APP_ENV` + domain. The name is captured from
    the JSON output — never assumed (Railway's project-scoped auto-suffix
    behavior re-observed live, `Postgres-E14U`).
  - **Verify every `add` by read-back, never by flag acceptance.** On
    CLI 5.34.2, `add` can drop into interactive prompts and **silently
    ignore flags it lists in `--help`** (observed live: `--branch`
    accepted then unapplied — the deployment built `main`; `--database`
    prompting). After each `add`, read the result back — `railway
    status --json` for the service name and the deployed branch — and
    reconcile or report a mismatch; a flag that "took" is a claim, the
    read-back is the fact. (The same rule generalizes: a Railway CLI
    failure may exit 0 — observed on the retired branch carrier — so
    exit codes are not proof either.)
- **A scratch-created environment inherits nothing** — no wrong `APP_ENV`,
  no unneeded DB, no copied variables — so there is nothing to reconcile
  away: this structurally retires the inherited-`APP_ENV` overwrite, the
  fresh-duplicate DB removal lane, the stranded-volume class, and the
  copied non-owned-variables report that a duplicate-based flow would
  otherwise need.
- **Adopted mixed topology.** Existing projects (shared-service
  duplicate-era shapes, plain-named app services) are adopted as-is,
  **never restructured** — every read and write this skill performs is
  already environment-scoped, so reconcile handles both shapes
  identically. Converting topology would be a data migration, a named
  exclusion (below).
- **Names are always captured, never assumed.** Every created service's
  `serviceName`/`serviceId` is read from the `add`/`status` `--json`
  output and threaded into reference variables. This is load-bearing:
  Railway's project-scoped auto-suffix behavior (a second Postgres coming
  back named `Postgres-Qurn`, for example) makes an assumed name silently
  wrong.
- **Creation-time target rows.** Immediately after capturing the created
  app service's name and (when provisioned) the DB service's name from
  the `add`/`status` output above, write this environment's hosting row
  and — when a DB service was provisioned — its persistence row with one
  `archascode targets set` invocation each:
  ```bash
  archascode targets set <env> hosting provider=railway project=<project> environment=<env> service=<appService> reconcile=true verify=true
  archascode targets set <env> persistence provider=railway service=<dbService> reconcile=true verify=true
  ```
  The row shape (which keys are legal, which are required) is enforced by
  the verb's grammar, not restated here. This closes the class of run
  that provisions a service but never records the row: a missed
  invocation self-heals on the next run's `targets adopt`.
- **`railway service source connect` stays banned — wrong layer, not a
  dead carrier.** Do not attempt it as a way to set or change a
  per-environment branch: it operates at the *service* level, and is
  live-observed to **reset every environment's branch mapping to the
  flag value and redeploy** — a destructive, cross-environment side
  effect, not a per-environment write. The correct layer is the
  environment-config document, written via `--service-config` (above) or
  the reconcile-time patch (below). This spelling is deliberately listed
  in full here — it is licensed by the Permission posture carve-out entry
  (above), which is what keeps this ban bullet from silently failing the
  A1-D6 coverage check while still spelling the command it forbids.
- **Verb-spelling hedge** (standing instruction, not a one-time check):
  verbs this section spells that the live run has not yet exercised are
  verified against the installed CLI's own `--help` output **before
  first use** — and `--help` listing a flag is *not* proof it applies
  (see the `add` read-back rule above; read state back after every
  mutation). If a verb is missing or renamed in the installed CLI,
  degrade to a reported manual dashboard step for that one action —
  never guess at a replacement spelling.

#### Branch mapping writes

This subsection is the single home for the mechanics of reading and
writing a per-environment branch mapping; other sections point here
rather than restating it.

- **Identify the app service, never assume it.** In each environment,
  the app service is the service instance whose `source.repo` equals the
  run's parsed `<owner>/<repo>` slug (Branch posture), compared
  **case-insensitively** — Railway's stored casing need not match the
  remote URL's. Zero or multiple matches is a stop-and-explain outcome,
  never a guess.
- **Reconcile-time write: a JSON patch piped to `environment edit`'s
  stdin**, keyed by the app service's **ID** (not name — stdin validation
  accepts names but does not remap them, so the ID is unambiguous):

  ```bash
  echo '{"services":{"<appServiceId>":{"source":{"branch":"<b>"}}}}' | railway environment edit --environment <env> --json
  ```

  Expected output shape: `{"staged":true,"committed":true,…}`. This is
  the **only** form this skill executes for this write — see the
  stdin-priority trap in Permission posture for why the flag form is
  never used instead. Same-value writes are inert (committed, no
  deployment) — adoption is free, and reconcile passes are idempotent.
- **Write-verify by read-back, never by flag acceptance or exit code**:
  `railway environment config --json` for config-truth (did the mapping
  take), and — where a deploy is expected — `railway deployment list
  --environment <env> --service <appService> --json`'s `meta.branch` for
  deploy-truth (did the build follow).
- **Converge semantics — two distinct arms** (conflating them
  creates a wrong extra write). After `add --branch` on a newly created
  environment, read back **both** truths:
  - **Config-truth wrong** (`environment config --json` does not show the
    mapped branch — whether `add --branch` reliably writes config-truth on
    a scratch-created environment was deliberately not re-tested by the
    spike, so this arm is not assumed unreachable): write the mapping via
    the stdin pipe above (the sole branch-write path), then redeploy.
  - **Config-truth right, deploy-truth skewed** (the expected post-`add`
    case — the initial deploy built the repo default): converge with
    `redeploy --from-source` **alone** — no `environment edit` write,
    which would be a same-value patch spending the pipe's ungranted
    friction for nothing:
    ```bash
    railway redeploy --from-source --yes --environment <env> --service <appService> --json
    ```
  Both arms ride the **already-confirmed** creation — no separate
  confirmation needed, since creating this environment on this branch *is*
  the confirmed intent. Verify either arm by read-back; only a
  **post-converge** mismatch ⚠s (Step 7's deployed-branch verification,
  item 3, arm 1). **Branch-change writes
  auto-redeploy.** The patch commit triggers a build from the new branch
  on its own (~10 s, spike-observed) — do not immediately declare "not
  observed" from a single read. Poll `deployment list` over **~60
  seconds** before concluding the auto-redeploy didn't fire; only on a
  confirmed timeout does `redeploy --from-source` fire as the fallback,
  under the **same** confirmation as the mapping change itself (the user
  already confirmed a branch change whose defined behavior is a redeploy;
  the fallback completes that, it doesn't start something new).

### Step 6 — per-environment configuration

For each in-scope environment, once its services exist:

- **`APP_ENV=<spec environment name>`** on the app service. Nothing else
  selects the environment — there is no start command to override,
  since the container now goes direct to uvicorn.
- **Variable writes batch, with `--skip-deploys`.** `railway variable
  set` accepts multiple KV pairs per call and a `--skip-deploys` flag;
  batch several variables together. For a **memory** environment, pass
  `--skip-deploys` on all but the final write, so configuration doesn't
  trigger a rebuild per variable. For a **SQL** environment, pass
  `--skip-deploys` on **every** write in the batch, with no final
  exception — the pre-deploy hook write that follows the batch
  (Pre-deploy schema apply, above) is what carries the configuring
  deploy for these environments.
- **Postgres wiring is one reference variable**:
  `<urlKey>=${{<dbServiceName>.DATABASE_URL}}` (the private-network URL),
  set on the app service, where `<urlKey>` is the spec's declared
  `adapters.persistence.postgres.env.url` value and
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
    the file, never printed into the transcript. If the user prefers to
    paste values into chat anyway, that's their call; the skill never
    *asks* for a paste and never re-prints a value it received.
- **`APP_DATA=ephemeral`** — set **only** when the environment's
  `persistenceBackends` is non-empty **and** its `data` field is
  `ephemeral`, and only after the plan screen has named **both**
  consequences: the boot-time clear-and-load, and the admin
  save route mounting on a public URL. **Never** set for memory
  environments (their autoload is unconditional — and the
  fail-closed `protected` default is what keeps the admin router
  unmounted on a public URL). **Never** set for `protected` environments
  — the fail-closed default already *is* the semantics there.
- **Explorer access**: when Step 2's answer for a created environment was
  yes, `CORS_ORIGIN_REGEX` (the pinned value — Explorer access posture,
  above) joins the batched app-service writes under the `--skip-deploys`
  batching rule above.
- **Auth wiring**: confirmed jwt pairs (`AUTH_JWKS_URL` + `AUTH_ISSUER`)
  join the batched app-service writes under the same `--skip-deploys`
  batching rule; `AUTH_API_KEY` rides the secret pipe after its
  apply-time `.env.<env>` seed (mechanics single-homed in Deployed auth
  posture, above).
- **Domain**: list the app service's existing domains first; any existing
  one satisfies this step. `railway domain` runs **only** when none
  exists yet (its behavior on re-invocation is deliberately not relied
  on).
- **The pre-deploy hook write runs last, after the variable batch above**
  (mechanics single-homed in Pre-deploy schema apply, above — this
  bullet only sequences it). Its triggered deploy boots with every
  variable this step wired already present, so `migrate` runs with a
  fully configured environment. The guarantee this establishes: from
  the hook write onward, every deployment of this environment runs
  `migrate` pre-traffic — deliberately **not** "one deploy per
  creation" (the platform still fires several deploys during creation;
  Context, above). If the hook line was **declined or withheld** for a
  created SQL environment, issue a plain
  ```bash
  railway redeploy --yes --environment <env> --service <appService> --json
  ```
  after the batch, so the committed variables reach a running
  deployment instead of stranding the environment on the unconfigured
  `add`-build; that environment's consequence is then schema-only
  (Pre-deploy schema apply's `schema` column states, below). A
  **withheld** hook (BYO values not yet supplied) takes this same
  configuring-redeploy treatment as a decline, for the same reason:
  either way the variables need a running deployment to reach.

### Step 7 — smoke check and hook verification

**The probe family gates on verify scope.** The whole data-plane probe
family below — `/health`, the synthetic-Origin Explorer probe, and the
auth legs — runs only for environments in **verify scope** (Run scope,
above; a `verify: false` hosting target is the user's declared quiet for
that environment, never something this skill suggests). A
granted-but-structurally-impossible probe still runs whatever legs it
can and reports the rest `unverified` with the reason, exactly as
today — grant is consent, not capability, and the no-domain exclusion
and mint-degrade annotations (Step 8) are unchanged. **The hook write and
its verification (item 2, below) are reconcile-scope actions**, unaffected
by the verify grant — both reads are control-plane (`environment config`,
`deployment list`), the same reads Step 1 already performs for every
in-scope environment, so neither the hook write nor the `schema` column
waits on `verify: true`.

**For every in-scope environment** (memory environments included):

1. **Smoke check**: `GET /health` on the environment's generated domain.
   This probe is registered unprefixed and unauthenticated on every
   generated app (`api.base_path` only re-roots entity/application
   routers), so this step needs no auth, no `base_path`
   knowledge, and no spec read. Report reachability per environment.

   **A second, synthetic-Origin probe** runs for every in-scope
   environment **with a domain**: an unauthenticated `GET /health`
   carrying the pinned header
   `Origin: vscode-webview://archascode-explorer-probe`. Classify by the
   verified signatures — `access-control-allow-origin` echoing the probe
   origin → serving admits webviews; 200 with no ACAO header → serving
   does not. This probe is **serving-truth only**: the app echoes the
   request origin rather than publishing the pattern, so no header
   inspection short of a matching probe distinguishes the states, and it
   cannot tell skill-owned from a hand-managed pattern that happens to
   match — ownership is the Explorer access posture's config read, above.
   It is a plain read-only HTTP GET, the same lane as the `/health` call
   above, outside the railway grant by construction.

   **Poll rule.** After an Explorer-access-posture enable/disable
   on an environment that already had a running deployment, poll
   up to ~120 s before invoking the fallback/⚠ arms there. For an
   environment created this run, the variable rides Step 6's SQL-batch
   deploy — the pre-deploy hook write's triggered deploy, or the
   decline arm's plain `redeploy` (Pre-deploy schema apply, above) — or,
   for a memory environment, the batch's own final-write deploy
   (overlapping the first full build — unbounded), so the probe defers
   to `deployment list` status and never ⚠s while a deployment is in
   flight.

   **A third, auth leg** runs for every in-scope environment **with a
   domain** whose resolved adapter verifies (`jwt_bearer` or `api_key` —
   Deployed auth posture, above):

   - **Probe route derivation**: one entity list route whose
     declaration-level posture resolves `required`, per-op-disabled ops
     skipped, `api.base_path` concatenated per its projection rule — fed by Desired
     state's advisory-only spec read, above (exactly
     `/archascode:auth`'s app-tier recipe). **Zero routes resolving
     `required`** → skip the leg with the named state
     `no required routes to probe` — the 401 expectations below would be
     false negatives.
   - **jwt matrix, negative-only** (this skill holds no provider
     credential; the positive token-mint proof stays
     `/archascode:auth`'s job):
     - no token → expect **401**. A **200 is diagnosed, not just
       failed**: an older-engine fail-open (an app rendered by an older
       engine where `type: jwt` without `scheme` rendered no
       extraction); fix: re-render with a current engine.
     - garbage token (`Authorization: Bearer not-a-token`) → expect
       **401** (the adapter loaded its config and rejected the token).
       A **500 is the wiring signature, with exactly one cause**: the
       adapter's lazy config read raised on a missing env var
       (`AUTH_ISSUER` read first) — the platform variables are missing
       or not yet applied to the serving deployment. It is deliberately
       **not** a JWKS-reachability signal: the emitted adapter wraps
       verification in a PyJWT-error catch that folds fetch failures
       into the 401 arm, and a garbage token dies at header decode
       before any network I/O anyway.
     - **the JWKS value probe**: a plain GET of the `AUTH_JWKS_URL`
       value (pinned non-secret, the same ungranted-curl lane),
       expecting a JWKS-shaped JSON document — laptop-side value
       sanity only; it proves nothing about Railway egress.
     - **Named limitation**, stated here and in the report: JWKS
       reachability *from Railway egress* and real-token verification
       are invisible to this negative matrix (a broken-egress
       environment 401s every leg and reads healthy). The positive
       lane is `/archascode:auth`'s app-tier smoke, pointed at the
       deployed domain as its base URL.
   - **api_key matrix**: no key → **401**; wrong key (a fixed garbage
     value) → **401**. A **500 on any key-bearing leg** is the wiring
     signature: `AUTH_API_KEY` missing or empty on the serving
     deployment. The **correct-key leg** (expanded from `.env.<env>`
     into the curl header via shell substitution — never printed) →
     **200**, and runs **only** when a local value exists and no skew
     is open: an adopted platform-only key has no local value to
     expand — the positive leg is skipped with the named state
     `smoke: skipped — no local key` (the negative and wrong-key legs
     still run and still discriminate 401 from 500); an environment
     with a **declined skew** skips the positive leg and annotates the
     `⚠ skew` row instead — probing with the stale local key would
     401 and be misdiagnosed.
   - **Lane and poll**: plain HTTP GETs in the existing ungranted curl
     lane (the `/health` and synthetic-Origin precedent above,
     client-agnostic); after a same-run variable write, this leg
     respects the existing poll rule above before ⚠ing (variables
     apply on the write's redeploy).

   Item 3 below and the `AUTH_API_KEY` seed (Deployed auth posture,
   above — this skill's only skill-initiated `.env.<env>` write site,
   beside the user-driven Step 6 BYO channel) are **untouched** by this
   leg.
2. **Hook verification.** Two surfaces, mirroring the branch mapping's
   own config-truth/deploy-truth split (Step 5's "Branch mapping
   writes"):
   - **Config-truth**: `environment config --json` — the hook is set,
     with the same normalization the classification above applies
     (unwrap a one-element array, compare the single string).
   - **Deploy-truth**: the latest deployment's manifest
     (`deployment list --json` →
     `meta.serviceManifest.deploy.preDeployCommand` — a **dense**
     surface, `null` explicit when unset) plus that deployment's
     status.

   A **SUCCESS** deployment whose manifest carries the hook **is** the
   schema-applied proof — no log read, no new grant. Reading the
   deployment's build/runtime logs needs the full deployment UUID and
   is not granted; it stays a user-side diagnostic pointed at from the
   report on a failure — surface the deployment ID and name the
   dashboard's log viewer, never invoke a log-reading command from
   this skill.
3. **Deployed-branch verification**, two arms scoped by whether this run
   wrote the mapping (rescoped per Step 5's "Branch mapping writes" /
   converge semantics — the `dashboard-configured` informational lane from
   earlier versions is gone: a non-default branch is now the **adopted
   mapping**, not someone else's setting):
   - **Services this run created** (`add`): the expected post-`add` skew
     is **converged, then verified** via the two-arm read-back (Step 5's
     "Branch mapping writes"), so only a **post-converge** mismatch ⚠s
     here — a ⚠ row in the final report naming both branches and the
     manual dashboard fix, never silently absorbed.
   - **Steady-state environments** (mapping unchanged this run): compare
     config-truth (`environment config --json`) against deploy-truth
     (`deployment list … --service <appService> --json`). A skew is
     **always reported** — never silently absorbed and never assumed
     intentional — but the converge verb (`redeploy --from-source`)
     enters the plan only as its **own**, separately confirmed line (one
     `AskUserQuestion` naming the environment, both branches, and stating
     that confirming triggers a build); it is never bundled into, or run
     because of, the batch create/update confirmation. Declining leaves
     the skew as a report line, **re-shown** (not re-asked) on later runs.

### Step 8 — final report

Print one table, environment → URL, DB service, `APP_ENV`, deployed
branch — shown as **deploy-truth** (Step 7's read-back), annotated
`config: <b> (not yet deployed)` when config-truth differs from
deploy-truth, and `(service default; no per-env mapping)` for an
environment with no adopted branch mapping (Branch posture); ⚠-marked
only on a same-run, post-converge write mismatch (Step 7's
deployed-branch verification, item 3, arm 1).

The table also gains a **schema** column (Pre-deploy schema apply,
above, for the classification and write mechanics; Step 7 item 2 for
the verification this column reports). Its state set is **total**:

- `applied (pre-deploy)` — the latest deployment is SUCCESS and its
  manifest carries the owned hook;
- `set (not yet deployed)` — config-truth carries the owned hook, but
  the latest **completed** deployment's manifest does not and nothing
  is currently in flight (an adopted hook that predates classification
  but postdates its last deployment, or a dashboard-set one) — never
  forced by a same-value write, organic or converged only;
- `pending (deploying)` — a deployment is in flight (the existing poll
  rule applies before any ⚠);
- `⚠ deploy failed (pre-deploy)` — the latest deployment is FAILED with
  the hook in its manifest: the gate fired. The row names the previous
  deployment as still serving and points at that deployment's logs in
  the Railway dashboard;
- `hook: hand-managed` — the classification's third state: schema
  application is whatever the user's command does; reported, no
  judgment;
- `hook: absent (declined)` — the proposal was declined this run; the
  row names the consequence (no deploy-time schema apply) and
  re-proposes next run;
- `hook: withheld (BYO values unset)` — the BYO gate; re-proposed once
  the declared connection keys appear platform-side;
- `memory` — no hook exists or is proposed for this environment;
- `blocked (cuts)` / `blocked (branch)` / `blocked (targets)` /
  `blocked (permissions)` — as applicable, per their owning sections.

The table also gains an **explorer** column, whose primary value is
**config-truth** (Explorer access posture's three states: `enabled` /
`disabled` / `hand-managed`), annotated from probe-truth where they can
disagree:

- `pending (converging)` — poll expired (or creation build running) with
  a deployment in flight;
- `⚠ skew` — poll and fallback exhausted with no deployment in flight, or
  probe-truth contradicting config-truth in steady state (the
  separately-confirmed converge line, above, is the fix);
- `(unverified — no domain)` — no probe possible; such environments are
  **excluded from skew detection by construction**, and the report says
  so rather than implying verification.

**Skew scope rule**: skew is judged **only** for absent and skill-owned
environments — the two states with a computable expected serving state. A
hand-managed environment shows config state and probe fact side by side,
with no skew judgment and no converge offer.

The table also gains an **auth** column, whose primary value is
**config-truth** (platform key presence — Deployed auth posture,
above), annotated from the smoke leg (Step 7 item 3). The state set is
**total**:

- `n/a` — resolved adapter is `noop`;
- `wired` — all required keys present platform-side; annotated
  `(smoke: ok)`, `(smoke: skipped — no required routes)`,
  `(smoke: skipped — no local key)`, `(unverified — no domain)`, or
  `⚠ smoke failed` with the Step 7 diagnosis;
- `missing` — required keys absent platform-side, with the
  environment's bundle skipped or its wiring lines otherwise unapplied
  this run; annotated `(re-proposed next run)`;
- `blocked (auth)` — the jwt park (Deployed auth posture, above), fix
  pointer in the row;
- `unset (declined)` — an explicit decline of the auth wiring, either
  adapter, with the runtime consequence named;
- `⚠ skew` — differing values, converge declined (re-shown until
  resolved; carries the positive-leg annotation per Step 7 item 3).

The `AUTH_AUDIENCE`-not-carried line and the rotation hand lane
(Deployed auth posture, above) print beside the table when relevant.

Step 3's informational pointer lines (orphans, the
default `production` environment, stranded services/volumes, surplus
proxies/domains) re-print alongside the report for as long as their
surplus exists. On a scoped run the table covers the named environment
only, and the report ends with a note that a bare `/archascode:deploy`
reconciles every declared environment and prints the full surplus
report. If the permission grant died mid-run (a typed
interjection, Permission posture) or any work was parked as `blocked
(permissions)`, the report recommends re-invoking `/archascode:deploy`
to pick it up.

**Targets-derived report content is skew-only** — there is no full
targets column; the report only ever names a targets state where skew
needs naming (Run scope, Coherence checks, above):

- **Out-of-scope-on-Railway informational lines** (an environment
  present on the platform but declared out of reconcile scope) re-print
  alongside the surplus pointers above, for as long as the condition
  holds.
- **`blocked (targets)`** joins the `schema` column's state set (above)
  for any environment parked by a coherence finding, with the fix
  pointer (edit `spec/deploy_targets.yml` or the spec) named in the
  row.
- **File-update offers** (an adopted key's platform-side rename, or any
  other adopted-key skew — the per-key write discipline, Step 3, above)
  appear as their own **separately-confirmed** lines, the same pattern
  as the branch-, Explorer-, and auth-converge lines.

## What this skill does NOT do

- **Write any tracked repo file** — no `railway.json`, no state or ID
  cache file, no spec edits, no `.gitignore` edits. The only local write
  this skill makes is the gitignored `.env.<env>` seed, with two licensed
  exceptions: the Permission posture settings-rule offer may write
  `.claude/settings.json` (project-tracked scope), only under the user's
  explicit choice on that AskUserQuestion, and never commits it; and
  confirmed writes to `spec/deploy_targets.yml` (via the ordinary editing
  tools, never bash — adoption, creation, and adopted-key updates only,
  per the per-key write discipline, Step 3, above) — never silent, and
  never a grant written without a confirmation.
- **Commit anything, ever** — the `blocked (cuts)` park (Step 3, above)
  stops for the user to commit and push the sealed cut themselves.
- **Create branches** — repo topology has another owner.
- **Echo secret values into the transcript** — BYO credentials,
  connection URLs, variable values. This rule bans *re-printing* values
  in this skill's own output and *writing* them anywhere but gitignored
  files; it does **not** ban the bare reconcile reads whose tool results
  carry variables — see Permission posture's interpretation pin, which
  governs when a read runs bare versus when a value is piped to a file.
- **Touch non-owned service settings** — anything outside the ownership
  boundary (Procedure Step 3) is never read-modify-written, "corrected,"
  or deleted, regardless of what it looks like compared to desired state.
- **Migrate data or switch SQL backends** — each is detected and reported
  with a stop-and-explain, never resolved automatically. A renamed
  environment is **not** a stop: it is reported as a create-plus-orphan
  (the new name created normally, the old name an orphan line noting data
  does not move) rather than a delete/migrate case.
- **Invoke any resource-destroying platform verb, ever** — no environment,
  service, volume, proxy, or domain deletion. Surpluses are reported with
  dashboard pointers only. Nor does it apply anything at all
  on an unconfirmed run.
- **Fake a provision** for a backend Railway cannot supply — BYO mode or
  an unset-with-report line only.
- **Detect and heal deployments still on the old container entrypoint** — a
  stale start-command override or a once-seeded serve Dockerfile is fixed by
  hand; this skill
  carries no detect-and-heal machinery for them.
- **Run the wider chain on the user's behalf** — no `/archascode:apply`,
  no render, no `/archascode:init`. The optional `cut-schema-migration`
  offer (Step 3's `blocked (cuts)` park, above) is the only named
  exception, and it is its own explicit stop-and-offer, not an implicit
  call.
- **Engineer around a permission denial** — no re-phrasing a denied
  command, no re-routing it through another tool, no other workaround.
  A denial is stopped and handed to the fallback lane (Permission
  posture), never quietly evaded.
- **Set `CORS_ORIGINS` or `CORS_CREDENTIALS`, ever, in any arm** — and
  never merges, overwrites, "corrects," or deletes a hand-managed CORS
  value; an enable/disable request on a hand-managed environment is a
  stop-and-explain (Explorer access posture, above).
- **Write `AUTH_AUDIENCE` or `CLERK_SECRET_KEY` platform-side, ever** —
  nor any other AUTH-adjacent local key outside the resolved adapter's
  own key set (Deployed auth posture, above).
- **Invoke a provider CLI or `/archascode:auth`** — this skill reads
  auth's output; the dependency direction is one-way.
- **Print a generated or read auth key value, copy a key between
  environments, or regenerate an existing key unasked** — the
  absence properties (Deployed auth posture, above).
- **Write `verify: false` to silence a degrade** — a structural
  degrade (no domain, a Development-only mint, and the like) stays an
  *annotation within* a grant; setting `verify: false` for that reason
  is the user's declared quiet to give, never this skill's move to make
  on their behalf.
- **Auto-repair or auto-delete a `spec/deploy_targets.yml` row** — every
  coherence finding (Step 3, above) is reported with an offer; none is
  ever resolved without a confirmation.
- **Reconcile the platform *toward* `spec/deploy_targets.yml`** — the
  file is declared intent and interview memory, never state; the
  platform stays the record of actuals, and skew between the two is
  reported and converged only under the existing confirm discipline,
  never treated as an instruction to overwrite platform reality.
- **Claim once-per-deploy or multi-replica migration safety for the
  pre-deploy hook** — that behavior is unverified, and neither this
  skill's text nor its report states it (Pre-deploy schema apply,
  above).
- **Attempt to clear `preDeployCommand`** — no verified CLI path exists;
  a removal request gets an informational dashboard pointer, never an
  attempted write (Pre-deploy schema apply, above).
- **Rewrite a hand-managed pre-deploy hook** — reported as fact; a
  change request is stop-and-explain, the same posture as a
  hand-managed CORS family (Pre-deploy schema apply, above).

## Failure modes

| Symptom                                                    | Behavior                                                                                          |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| No `.archascode/environments.json`                          | Stop: "render first" (`/archascode:apply`).                                                       |
| `environments.json` `schemaVersion != 1`                     | Stop: "render first" — fatal, never resolved against a stale table.                               |
| `environments.json` present with `environments: {}`          | Stop: "no environments declared — nothing to deploy."                                              |
| Single-token `$ARGUMENTS` matching no declared environment name | Never guess, never silently run whole-project: `AskUserQuestion` — near-matching declared name, "treat as steering", or cancel. |
| Railway CLI not installed                                    | Print the install pointer; stop.                                                                   |
| Not authenticated                                             | Background `railway login --browserless`, relay the URL, re-check on completion.                    |
| GitHub integration missing                                    | Relay the dashboard install step; stop.                                                            |
| Free-plan resource cap reached                                | Report the refusal verbatim with options (free space / upgrade / link existing); stop.              |
| Detached `HEAD` or untracked branch                           | Ask which branch to deploy rather than guessing.                                                    |
| Non-GitHub or ambiguous multi-remote                          | Stop-and-explain; no guess at a slug.                                                               |
| SQL backend switch detected                                   | Report as a hand-edit case (backend exclusivity); stop, never migrate.                              |
| A declared environment's name looks like a rename of an existing one | No detection: the new name proceeds through the normal create flow; the old name is reported as an orphan line with the dashboard pointer, noting data does not move. |
| Zero committed cuts for an in-scope SQL environment's backend on its mapped branch | Park that environment `blocked (cuts)`; offer `archascode cut-schema-migration` (network verb, login relay on 401); stop for the user to commit and push, then re-run. |
| `.env.<env>` would be a tracked file                          | Stop the seed step for that environment; point at `/archascode:init`'s ignore rules.                |
| Pre-deploy hook proposed for a BYO environment before its connection keys exist platform-side | Report `hook: withheld (BYO values unset)`; re-propose automatically once the keys appear — not a failure. |
| Deployment FAILED with the pre-deploy hook in its manifest      | Report `⚠ deploy failed (pre-deploy)`; the previous deployment is still serving; point at that deployment's logs in the Railway dashboard — do not retry or fix on the user's behalf. |
| `/health` unreachable                                         | Report the environment as unreachable in the final table; do not retry indefinitely.                |
| Permission denial (classifier or declined prompt) on any command | Stop that action (never re-phrase or re-route); offer the verbatim !-prefixed one-liner and the settings-rule route (applies next session); park dependent steps as blocked (permissions). |
| Post-`add`/duplicate-override skew survives the converge attempt | ⚠ row in the final report naming both branches and the manual dashboard fix; never silently absorbed. |
| Steady-state config-truth vs. deploy-truth skew                 | Always reported (`config: <b> (not yet deployed)`); converge offered only as its own separately-confirmed line, never bundled; declining leaves a re-shown (not re-asked) report line. |
| Mapped branch B missing on the remote (`git fetch`/`ls-remote` empty) | Park that environment `blocked (branch)`; remap (explicit request) or restore the branch. |
| `environments.json` absent, or `schemaVersion != 1`, on branch B  | Park that environment `blocked (branch)`; the environments-file tolerance rule, applied to the git ref. |
| Environment undeclared in B's `environments.json` table          | Park that environment `blocked (branch)`; the exact condition boot resolution makes fatal. |
| Environment's entry on B differs from this checkout's entry      | Park that environment `blocked (branch)`; if B ≠ deploy branch, finish the promotion or run from a checkout of B; if B == deploy branch, commit and push the rendered `environments.json`, then re-run. |
| Explorer enable/disable requested on a hand-managed environment | Stop-and-explain: the skill never merges, overwrites, or reasons about a user's CORS surface; hand it back with the state found. |
| Steady-state Explorer skew (probe-truth contradicts config-truth, absent/skill-owned envs only) | Always reported (⚠ skew); converge offered only as its own separately-confirmed line; declining leaves a re-shown (not re-asked) report line. Hand-managed envs carry no skew judgment. |
| jwt environment with no `AUTH_JWKS_URL`/`AUTH_ISSUER` value source anywhere (platform and local both absent) | Park that environment `blocked (auth)`; fix = run `/archascode:auth`, then re-run `/archascode:deploy`; every-in-scope-environment park → report and stop rather than an all-parked plan. |
| Auth value skew (`AUTH_*` differs between local `.env.<env>` and the platform) | Always reported (⚠ skew); converge offered only as its own separately-confirmed line, never bundled; declining leaves a re-shown (not re-asked) report line. |
| Explicit auth-wiring decline (`$ARGUMENTS` steering or a typed mid-run request) | Report `unset (declined)` with the runtime consequence named (jwt: token verification will 500; api_key: key-bearing requests will 500). |
| An `archascode targets` verb exits non-zero (broken `spec/deploy_targets.yml`, a digest mismatch, a grammar refusal) | Stop, surfacing the verb's own message verbatim — it already names the file, the expected version, or the rule violated; absence of the file entirely is legal and produces no refusal. |
| Scoped run names an environment whose hosting target withholds `reconcile`, or names a provider this skill does not drive | Stop naming the target row and the file edit that would grant it; explicit run-time intent never outranks declared consent. |
| Coherence finding against `spec/deploy_targets.yml` (renamed/deleted spec env, memory/`noop`/`api_key` flip under a target, `db_runtime` vs. persistence-target-kind mismatch, platform hosting beside a `local`/`docker` persistence target, two envs' persistence targets naming one instance under conflicting `data:`) | Park that environment `blocked (targets)`, per `archascode targets check`'s finding; report with an offer that points at the plugin editor or a hand edit, never auto-repaired or auto-deleted. |
| Change requested against a hand-managed pre-deploy hook          | Stop-and-explain: the skill never merges, overwrites, or reasons about a user's schema-apply command; hand it back with the value found. |
| Removal requested for the pre-deploy hook                        | Informational line naming the Railway dashboard as the place to clear it, plus the consequence (no deploy-time schema apply); no CLI path is attempted. |

No retries beyond what is stated above. The user re-invokes after
addressing whatever a stop pointed at.

## Notes for future versions

- **Branch-mapped environments have landed** — the promotion workflow
  (e.g. a `qa` branch feeding a `qa` environment, `main` feeding `prod`)
  is the documented happy path for multi-environment projects; see Branch
  posture and Step 5's "Branch mapping writes".
- **Railway ephemeral PR environments remain the follow-on** — preview
  environments on PRs, `external + ephemeral` semantics, a create/destroy
  lifecycle, inheriting this version's spec-travels-with-branch invariant.
- **Promotion telemetry** — a future run could report "environment X's
  branch is N commits behind environment Y's" alongside the branch
  column, surfacing promotion lag without doing the promotion itself.
- **Remote API Explorer targets** — the server-side gate (Explorer-enable
  CORS vocabulary, above) has landed in this skill. What remains is the
  plugin-side Location axis: a Location dropdown, a remote `ExplorerState`
  fork, and blocked-state UX — consuming this skill's three Explorer
  states and the synthetic-Origin probe's ACAO-echo signatures — plus a
  warning when Start connects to an external `protected` database.
- **Platform-side demo reset** — a documented one-liner (or skill step)
  to reset an `external + ephemeral` demo environment to seed state
  without a laptop.
- **Additional platforms** — Render, Fly, Supabase — as interview forks
  inside this same skill, not new skills.
- **A `doctor`/`status` read-only reporting mode** — a bare invocation that
  prints the full delta report with dashboard pointers and applies
  nothing; the deletion-free reconcile makes this nearly free, and it is
  the natural home for the orphan/volume report.
- **`railway config` IaC migration** — revisit the `railway config`
  plan/apply surface once its runner and resource vocabulary mature.
- **Railway's own MCP server / agent skills** — an alternative substrate
  for the CLI calls, if it stabilizes.
- **Auth follow-ons** — key rotation stays an explicit-update lane (the
  hand `.env.<env>` edit + `railway variable set`, never automated); an
  Auth0 provider fork would activate the `AUTH_AUDIENCE` arm this
  version leaves never-written, with per-provider audience policy
  replacing the flat rule; a positive jwt smoke tier (a real minted
  token, not just the negative matrix) is possible only if a future
  provider skill records a smoke credential this skill may read.
- **Pre-deploy hook follow-ons** — once-per-deploy vs. per-replica
  execution and multi-replica migration safety need their own
  verification before this skill claims either; a Railway CLI update
  that adds a real clearing path for `preDeployCommand` would let a
  confirmed disable lane replace the current dashboard-only pointer;
  and a second deploy platform gets its own pre-deploy-hook equivalent
  verified from scratch before this vocabulary generalizes past
  Railway.
