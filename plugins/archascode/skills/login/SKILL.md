---
name: login
description: Log in to archascode cloud from a Claude Code session — runs `archascode login` (browser PKCE flow) in the background, relays the sign-in URL, and reports the outcome. Use when the user needs to authenticate for /render (first run, expired session, 401 hints).
---

# /archascode:login

Thin wrapper over `archascode login`, the browser PKCE flow against our
Cognito Hosted UI. The CLI does all the real work — start a loopback
callback server, open the system browser at the authorize URL (and always
print that URL), wait for the redirect, exchange the code, and write
`~/.archascode/credentials.json`. This skill exists so the user can log in
without leaving the Claude session.

## Procedure

### Step 1 — run the login in the background

Run `archascode login` via the Bash tool **in the background**, then poll
the task's output. This is load-bearing, not a style choice: the authorize
URL prints to stderr as soon as the flow starts, and a foreground call
only returns output after the flow ends — after success or after the
flow's 5-minute internal timeout — which makes relaying the URL mid-flight
impossible.

As soon as the authorize URL appears in the output, relay it to the user
so they can click it themselves if the browser didn't open on their
machine.

### Step 2 — interpret the outcome

Keep polling until the background task exits, then interpret its output:

- **Success** (`logged in as …` or `logged in (` in the output) — report
  the signed-in identity to the user.
- **Timeout** — the flow gave up waiting for the browser round-trip;
  suggest re-running `/archascode:login`.
- **`EADDRINUSE`** — another login is already in flight on the fixed
  callback port; tell the user to finish or cancel that one first, then
  retry.
- **`not yet provisioned`** — the operator-side Cognito Hosted UI setup
  isn't done yet; point at `infra/README.md`.

### Step 3 — steer headless/SSH machines to the password flow

If the machine running the CLI can't receive a browser redirect on
`127.0.0.1` (SSH sessions without port forwarding, headless boxes), tell
the user to run `archascode login --password` in a real terminal instead
— that flow uses username/password prompts and needs no callback.
