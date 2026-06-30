# shrubby

Local CLI for managing git worktrees while working across branches.

Use it to create, list, remove, and copy git worktree paths from a terminal UI.

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
cannot be deleted. On macOS, copy uses `pbcopy`; inside tmux it also writes to
the tmux paste buffer.
