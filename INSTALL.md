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

Choose **user scope** ("Install for you") when prompted.

That installs the twelve skills (`analyze`, `init`, `apply`, `seed`,
`clean`, `cut-schema-migration`, `db`, `deploy`, `login`, `logout`,
`auth`, `ui`) and puts the `archascode` CLI on the Claude Code Bash tool's PATH.

**Quit Claude Code and start it again before using any of them** — skills
are loaded once, at session start, so they are not available in the
session you just installed from.

## 3. Install the editor extension

First download the `.vsix`:

<https://github.com/ArchAsCode-org/marketplace/raw/main/archascode-plugin.vsix>

It lands in your usual downloads folder. Then install it from the editor
UI — no terminal needed:

1. Open Cursor (or VS Code).
2. Open the Command Palette — `Cmd+Shift+P` (`Ctrl+Shift+P` on
   Windows/Linux).
3. Type `vsix` and choose **"Extensions: Install from VSIX..."**
4. Select the `archascode-plugin.vsix` you just downloaded.

Reload the editor window afterwards (`Cmd+Shift+P` → "Reload Window").

<details>
<summary>Prefer the command line?</summary>

If you've installed the `cursor` (or `code`) shell command, you can
install from a terminal instead — pass the real path to the download:

```sh
cursor --install-extension ~/Downloads/archascode-plugin.vsix
```

That command only exists if you've run **"Shell Command: Install 'cursor'
command in PATH"** from the Command Palette (`Cmd+Shift+P`); it is not on
your PATH by default. The UI steps above need no such setup.

</details>

## 4. Log in

**Quit Claude Code and start it again first.** Skills are loaded once, at
session start, so a session that was already running when you installed
the plugin in step 2 has no `/archascode:` commands in it — reloading the
editor window in step 3 does not reload them. If `/archascode:login`
below isn't recognised, this is why.

Then, from your Claude Code session:

```
/archascode:login
```

(or just tell Claude Code "log me in to archascode"). This opens your
system browser at the sign-in page — enter the username and temporary
password from your invite email. On first login you'll be asked to set a
new password there, in the browser.

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

Open the clone in Cursor/VS Code, and follow the instructions in the
README — best viewed in a browser, where the screenshots render:
[github.com/ArchAsCode-org/tutorial-crm-lite](https://github.com/ArchAsCode-org/tutorial-crm-lite/blob/main/README.md)

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

When a new version is announced (or a command reports "client too old /
update your archascode install"), from any Claude Code session:

1. `/plugin marketplace update archascode` — fetches the new version.
2. `/plugin update archascode@archascode` — **activates** it. (Or open
   `/plugins` → **Installed** → archascode → **Update now**.)
3. Start a new Claude Code session — sessions keep the version they
   started with.

Step 2 is required: the marketplace update alone only refreshes the
catalog — your installed plugin stays on the old version even after
`/reload-plugins` or a full restart, and the `/plugins` panel may show
the new version number while sessions still run the old one.

**If you still see old behavior in a new session**, do a clean
reinstall (this always works):

1. `/plugin uninstall archascode@archascode`
2. `/plugin marketplace update archascode`
3. `/plugin install archascode@archascode`

If the extension was updated too, re-download the `.vsix` and repeat
step 3 of the install instructions above.
