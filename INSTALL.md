# archascode — installation

Welcome to the archascode invite-only evaluation. archascode ships as a
Claude Code plugin (skills + CLI) and a VS Code/Cursor extension, both
distributed from the `ArchAsCode-org/marketplace` GitHub repository.

The client software is licensed under Apache 2.0 (see the bundled
`LICENSE.txt` and `NOTICE`). Use of the hosted archascode service is
governed separately by the Terms of Service at
<https://archascode.com/terms> *(placeholder — not yet published)*.

## 1. Prerequisites

- **Node.js 20+**
- **uv** (the Python package manager — <https://docs.astral.sh/uv/>)
- **Claude Code**
- **VS Code or Cursor**
- **Docker** — only needed for `sqlserver` environments; skip it for the
  in-memory first run
- **A provisioned archascode account** — you'll have received credentials
  separately
- **GitHub access to `ArchAsCode-org/marketplace`** (you've been added as
  a collaborator), with git authentication working on your machine —
  either the `gh` CLI (`gh auth login`) or SSH keys, so cloning private
  repositories works

## 2. Install the Claude Code plugin

From any Claude Code session, run these two commands **one at a time**:

```
/plugin marketplace add ArchAsCode-org/marketplace
```

```
/plugin install archascode@archascode
```

Choose **user scope** ("Install for you") when prompted. Then restart the
Claude Code session — plugin skills and the CLI load at session start.

That installs the eight `aac-*` skills and puts the `archascode` CLI on
the Claude Code Bash tool's PATH.

## 3. Install the editor extension

Download `archascode-plugin.vsix` from the repository (open the file on
GitHub and use "Download raw file"), then:

```
code --install-extension archascode-plugin.vsix
```

(or `cursor --install-extension archascode-plugin.vsix` for Cursor.)
Reload the editor window afterwards.

## 4. Log in

Run `archascode login` **in a real terminal only** — the CLI requires a
TTY for its prompts, so it cannot run inside a Claude Code session.

The plugin's `bin/` directory is on the *Claude Code Bash tool's* PATH,
not your shell PATH. Put the CLI on your shell PATH with a one-time
symlink — the target path is stable across plugin updates:

```sh
ln -s ~/.claude/plugins/marketplaces/archascode/plugins/archascode/bin/archascode ~/.local/bin/archascode
```

If `~/.local/bin` isn't on your PATH, either link into a directory that
is, or create `~/.local/bin` and add it to your PATH.

Then, from your terminal:

```sh
archascode login
```

Enter the credentials you received. On first login you'll be asked to set
a new password.

## 5. First run

From your project in Claude Code, run the skills by their namespaced
names, in order:

1. `/archascode:aac-analyze` — draft `spec/architecture.yml` from your PRD
2. `/archascode:aac-init` — set up the project environment
3. `/archascode:aac-apply` — render and resolve hand-offs
4. `aac up` — serve the API locally

Open the spec in VS Code/Cursor to see the architecture graph (the
extension renders `spec/architecture.yml`).

## 6. Updating

When a new version is announced, from any Claude Code session:

1. `/plugin marketplace update archascode`
2. `/reload-plugins`

If the extension was updated too, re-download the `.vsix` and repeat
step 3.
