# archascode — installation

Welcome to the archascode invite-only evaluation. archascode ships as a
Claude Code plugin (skills + CLI) and a Cursor/VS Code extension, both
distributed from the `ArchAsCode-org/marketplace` GitHub repository. Use
is covered by the bundled `LICENSE.txt`.

## 1. Prerequisites

- **Node.js 20+**
- **uv** (the Python package manager — <https://docs.astral.sh/uv/>)
- **Claude Code**
- **Cursor or VS Code**
- **A provisioned archascode account** — your username and a temporary
  password are in the invite email that linked you here

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

That installs the ten skills (`analyze`, `init`, `apply`, `seed`, `wire`,
`clean`, `cut-schema-migration`, `db`, `login`, `logout`) and puts the
`archascode` CLI on the Claude Code Bash tool's PATH.

## 3. Install the editor extension

Download `archascode-plugin.vsix` from the repository (open the file on
GitHub and use "Download raw file"), then:

```
cursor --install-extension archascode-plugin.vsix
```

(or `code --install-extension archascode-plugin.vsix` for VS Code.)
Reload the editor window afterwards.

## 4. Log in

From your Claude Code session, ask to log in:

```
/archascode:login
```

(or just tell Claude Code "log me in to archascode"). This opens your
system browser at the sign-in page — enter the credentials you received.
On first login you'll be asked to set a new password there, in the
browser.

**Optional (but recommended): put the CLI on your shell PATH.** The plugin's `bin/`
directory is on the *Claude Code Bash tool's* PATH, not your shell PATH.
If you'd like to run `archascode` commands directly from a terminal too,
link it once — the target path is stable across plugin updates:

```sh
ln -s ~/.claude/plugins/marketplaces/archascode/plugins/archascode/bin/archascode ~/.local/bin/archascode
```

If `~/.local/bin` isn't on your PATH, either link into a directory that
is, or create `~/.local/bin` and add it to your PATH.

On SSH/headless machines, the browser flow can't reach your machine —
run `archascode login --password` in a real terminal instead.

## 5. Do the tutorial

Start with the CRM-lite tutorial. It takes a realistic PRD to a running
FastAPI app in about 15–20 minutes, then iterates it twice — once through
the visual editor, once through natural language — so you've seen the
whole loop before you point it at your own work:

```sh
git clone https://github.com/ArchAsCode-org/tutorial-crm-lite
```

Open the clone in Cursor/VS Code and follow its `README.md`.

## 6. Applying to your project

From your project in Claude Code, run the skills by their namespaced
names, in order:

1. `/archascode:analyze` — draft `spec/architecture.yml` from your PRD
2. `/archascode:init` — set up the project environment
3. `/archascode:apply` — render and resolve hand-offs
4. `/archascode:seed` — to seed your rendered model 

Open the spec in Cursor/VS Code to see the architecture graph (the
extension renders `spec/architecture.yml`).
From inside the plugin, you can run API Explorer to see launch and explore the API.

## 7. Updating

When a new version is announced, from any Claude Code session:

1. `/plugin marketplace update archascode`
2. `/reload-plugins`

If the extension was updated too, re-download the `.vsix` and repeat
step 3.
