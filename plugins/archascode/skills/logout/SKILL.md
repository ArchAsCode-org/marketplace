---
name: logout
description: Log out of archascode cloud — runs archascode logout in the foreground and reports whether stored credentials were removed. Use when the user wants to sign out or clear a stale credential state.
---

# /archascode:logout

Thin wrapper over `archascode logout`. Unlike `/archascode:login`, this is a
synchronous one-liner: there is no browser flow to relay and no URL to wait
on, so it runs entirely in the foreground.

## Procedure

### Step 1 — run the logout in the foreground

Run `archascode logout` via the Bash tool **in the foreground** (synchronous
— no background run, no URL relay: there is nothing to wait on mid-flight).

### Step 2 — interpret the outcome

The CLI prints exactly one of two lines and exits 0 either way:

- **`logged out`** — stored credentials were found and removed.
- **`no credentials to remove`** — nothing was stored; the session was
  already signed out.

Report the outcome to the user in plain language.

### Step 3 — signing back in

To sign back in, run `/archascode:login`.

## Preconditions

The `archascode` CLI is on the Bash PATH — the plugin's `bin/` provides it.
If `command -v archascode` fails, the plugin install is broken:
re-enable/reinstall per INSTALL.md and check the wrapper's executable bit
(`chmod +x <kit>/marketplace/plugins/archascode/bin/archascode`).
