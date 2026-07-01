# shrubby

Local CLI for managing git worktrees while working across branches.

Use it to create, list, remove, copy, open, and clean up git worktrees from a
terminal UI or scriptable commands.

By default, worktrees are created next to the project group:

```text
/parent/.worktrees/<project>/<branch-slug>
```

For example:

```text
/Volumes/indrazm/github/.worktrees/review-this/feature--auth
```

```sh
pnpm install
pnpm dev
```

Install the CLI command locally:

```sh
./install.sh
```

Run it from inside the git repository you want to manage.

Inside the list screen, press `/` to search, `c` to copy a selected worktree
path, and `d` to delete a selected non-current worktree after confirmation.
Dirty and external worktrees require a second confirmation. The current checkout
and protected default branch, usually `main`, cannot be deleted.

Command usage:

```sh
shrubby --help
shrubby list
shrubby list --json
shrubby create feature/auth
shrubby create feature/auth --fetch
shrubby path feature/auth
shrubby copy feature/auth
shrubby open feature/auth
shrubby remove feature/auth
shrubby remove feature/auth --yes
shrubby remove feature/auth --yes --force-dirty
shrubby cleanup --dry-run --merged --stale
shrubby cleanup --merged --stale --yes
shrubby shell-init zsh
```

Targets for `path`, `copy`, `open`, and `remove` resolve by exact branch, exact
path, then unique path basename. Human output is the default; supported commands
also accept `--json` for scripts. `remove` prompts with `y/N` in an interactive
terminal and requires `--yes` when stdin is not interactive. Dirty worktrees
require `--force-dirty`.

Copy uses available clipboard targets for the current environment: `pbcopy` on
macOS, `wl-copy`/`xclip`/`xsel` on Linux desktops, `clip.exe`/`powershell.exe`
on Windows or WSL, and `tmux set-buffer` inside tmux.

Fast shell workflow:

```sh
eval "$(shrubby shell-init zsh)"
swd feature/auth
sopen feature/auth
```

`open` uses `--editor`, `editorCommand` config, `SHRUBBY_EDITOR`, `VISUAL`,
`EDITOR`, then `code`.

Optional config can live in `.shrubby.json` in a repo or
`~/.config/shrubby/config.json`. Repo config overrides user config.

```json
{
  "worktreeRoot": "../.worktrees/my-project",
  "protectedBranches": ["main", "release"],
  "defaultBaseRef": "main",
  "copyOnCreate": true,
  "fetchBeforeCreate": false,
  "editorCommand": "code -n"
}
```

Relative `worktreeRoot` values resolve from the repository root. `~` expands to
your home directory.
