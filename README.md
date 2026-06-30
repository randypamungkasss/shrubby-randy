# shrubby

Local CLI for managing git worktrees while working across branches.

Use it to create, list, remove, and copy git worktree paths from a terminal UI
or scriptable commands.

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

Inside the list screen, press `c` to copy a selected worktree path. Press `d` to
delete a selected clean, non-current worktree after confirmation; stale entries
are pruned. The current checkout and protected default branch, usually `main`,
cannot be deleted.

Command usage:

```sh
shrubby --help
shrubby list
shrubby list --json
shrubby create feature/auth
shrubby path feature/auth
shrubby copy feature/auth
shrubby remove feature/auth
shrubby remove feature/auth --yes
```

Targets for `path`, `copy`, and `remove` resolve by exact branch, exact path,
then unique path basename. Human output is the default; supported commands also
accept `--json` for scripts. `remove` prompts with `y/N` in an interactive
terminal and requires `--yes` when stdin is not interactive.

Copy uses available clipboard targets for the current environment: `pbcopy` on
macOS, `wl-copy`/`xclip`/`xsel` on Linux desktops, `clip.exe`/`powershell.exe`
on Windows or WSL, and `tmux set-buffer` inside tmux.
