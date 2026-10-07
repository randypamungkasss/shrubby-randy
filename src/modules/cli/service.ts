import process from "node:process";
import { spawn } from "node:child_process";
import { copyPath } from "../clipboard/service.js";
import type { CopyPathResult, RunCommand } from "../clipboard/types.js";
import {
  cleanupWorktrees,
  createWorktree,
  getRepoContext,
  listWorktrees,
  removeWorktree,
  resolveWorktreeTarget,
} from "../worktree/service.js";
import type {
  CleanupEntry,
  CleanupWorktreesResult,
  CreateWorktreeResult,
  RepoContext,
  WorktreeEntry,
} from "../worktree/types.js";

type CommandName =
  | "cleanup"
  | "copy"
  | "create"
  | "help"
  | "list"
  | "open"
  | "path"
  | "remove"
  | "shell-init";

type CliFlags = {
  dryRun: boolean;
  editor: string | undefined;
  fetch: boolean;
  forceDirty: boolean;
  help: boolean;
  json: boolean;
  merged: boolean;
  stale: boolean;
  yes: boolean;
};

type ParsedCommandArgs = {
  readonly flags: CliFlags;
  readonly positionals: readonly string[];
};

type WritableLike = {
  write: (chunk: string) => unknown;
};

export type CliInput = NodeJS.ReadableStream & {
  readonly isTTY?: boolean;
  pause?: () => void;
  setEncoding?: (encoding: BufferEncoding) => void;
};

export type RunCliCommandOptions = {
  readonly copyRunCommand?: RunCommand;
  readonly cwd?: string;
  readonly editorRunCommand?: RunCommand;
  readonly env?: NodeJS.ProcessEnv;
  readonly platform?: NodeJS.Platform;
  readonly stderr?: WritableLike;
  readonly stdin?: CliInput;
  readonly stdout?: WritableLike;
};

type CliRuntimeOptions = {
  readonly copyRunCommand?: RunCommand;
  readonly cwd: string;
  readonly editorRunCommand?: RunCommand;
  readonly env: NodeJS.ProcessEnv;
  readonly platform: NodeJS.Platform;
  readonly stderr: WritableLike;
  readonly stdin: CliInput;
  readonly stdout: WritableLike;
};

class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

export type CreateBranchRequest = {
  readonly autoCreate: boolean;
  readonly branch: string;
};

export type TuiLaunchPlan =
  | {
      readonly create?: CreateBranchRequest;
      readonly kind: "tui";
    }
  | { readonly kind: "cli" }
  | { readonly kind: "error"; readonly message: string };

const CREATE_FLAG = "--create";
const PREFILL_FLAG = "--prefill";
const CREATE_USAGE = `Usage: shrubby ${CREATE_FLAG} <branch> [${PREFILL_FLAG}]`;

export function planTuiLaunch(args: readonly string[]): TuiLaunchPlan {
  if (args.length === 0) {
    return { kind: "tui" };
  }

  const hasCreateFlag = args.some(
    (arg) => arg === CREATE_FLAG || arg.startsWith(`${CREATE_FLAG}=`),
  );

  if (!hasCreateFlag) {
    if (args.includes(PREFILL_FLAG)) {
      return {
        kind: "error",
        message: `Option '${PREFILL_FLAG}' requires '${CREATE_FLAG} <branch>'.`,
      };
    }

    return { kind: "cli" };
  }

  let branch: string | undefined;
  let isPrefilled = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === PREFILL_FLAG) {
      if (isPrefilled) {
        return { kind: "error", message: CREATE_USAGE };
      }

      isPrefilled = true;
      continue;
    }

    if (arg === CREATE_FLAG) {
      const value = args[index + 1];

      if (branch !== undefined) {
        return { kind: "error", message: CREATE_USAGE };
      }

      if (value === undefined || value.startsWith("-")) {
        return {
          kind: "error",
          message: `Option '${CREATE_FLAG}' requires a branch name.`,
        };
      }

      branch = value;
      index += 1;
      continue;
    }

    if (arg.startsWith(`${CREATE_FLAG}=`)) {
      if (branch !== undefined) {
        return { kind: "error", message: CREATE_USAGE };
      }

      branch = arg.slice(`${CREATE_FLAG}=`.length);
      continue;
    }

    return { kind: "error", message: CREATE_USAGE };
  }

  const trimmedBranch = branch?.trim() ?? "";

  if (trimmedBranch === "") {
    return {
      kind: "error",
      message: `Option '${CREATE_FLAG}' requires a branch name.`,
    };
  }

  return {
    create: { autoCreate: !isPrefilled, branch: trimmedBranch },
    kind: "tui",
  };
}

export async function runCliCommand(
  args: readonly string[],
  {
    copyRunCommand,
    cwd = process.cwd(),
    editorRunCommand,
    env = process.env,
    platform = process.platform,
    stderr = process.stderr,
    stdin = process.stdin,
    stdout = process.stdout,
  }: RunCliCommandOptions = {},
): Promise<number> {
  try {
    await dispatchCommand(args, {
      copyRunCommand,
      cwd,
      editorRunCommand,
      env,
      platform,
      stderr,
      stdin,
      stdout,
    });
    return 0;
  } catch (error) {
    writeLine(stderr, getErrorMessage(error));

    if (error instanceof CliUsageError) {
      writeLine(stderr, "Run `shrubby --help` for usage.");
    }

    return 1;
  }
}

async function dispatchCommand(
  args: readonly string[],
  options: CliRuntimeOptions,
): Promise<void> {
  const [command, ...rest] = args;

  if (command === undefined) {
    throw new CliUsageError("A command is required.");
  }

  if (command === "--help" || command === "-h") {
    if (rest.length > 0) {
      throw new CliUsageError(`Unexpected argument '${rest[0]}'.`);
    }

    write(options.stdout, getGeneralHelp());
    return;
  }

  if (command === "help") {
    handleHelp(rest, options.stdout);
    return;
  }

  if (!isCommandName(command)) {
    throw new CliUsageError(`Unknown command '${command}'.`);
  }

  const parsed = parseCommandArgs(command, rest);

  if (parsed.flags.help) {
    if (command === "help") {
      write(options.stdout, getGeneralHelp());
      return;
    }

    write(options.stdout, getCommandHelp(command));
    return;
  }

  switch (command) {
    case "cleanup":
      await handleCleanupCommand(parsed, options);
      return;
    case "copy":
      await handleCopyCommand(parsed, options);
      return;
    case "create":
      await handleCreateCommand(parsed, options);
      return;
    case "list":
      await handleListCommand(parsed, options);
      return;
    case "open":
      await handleOpenCommand(parsed, options);
      return;
    case "path":
      await handlePathCommand(parsed, options);
      return;
    case "remove":
      await handleRemoveCommand(parsed, options);
      return;
    case "shell-init":
      handleShellInitCommand(parsed, options.stdout);
      return;
    case "help":
      handleHelp(rest, options.stdout);
      return;
  }
}

function handleHelp(args: readonly string[], stdout: WritableLike): void {
  const [command, ...extra] = args;

  if (extra.length > 0) {
    throw new CliUsageError(`Unexpected argument '${extra[0]}'.`);
  }

  if (command === undefined) {
    write(stdout, getGeneralHelp());
    return;
  }

  if (!isCommandName(command) || command === "help") {
    throw new CliUsageError(`Unknown help topic '${command}'.`);
  }

  write(stdout, getCommandHelp(command));
}

async function handleListCommand(
  parsed: ParsedCommandArgs,
  { cwd, env, stdout }: CliRuntimeOptions,
): Promise<void> {
  requirePositionals(parsed, 0, "shrubby list [--json]");

  const context = await getRepoContextForCli(cwd, env);
  const worktrees = await listWorktrees(context);

  if (parsed.flags.json) {
    writeJson(stdout, { context, worktrees });
    return;
  }

  write(stdout, formatWorktreeTable(worktrees));
}

async function handleCreateCommand(
  parsed: ParsedCommandArgs,
  { cwd, env, stdout }: CliRuntimeOptions,
): Promise<void> {
  requirePositionals(parsed, 1, "shrubby create <branch> [--fetch] [--json]");

  const context = await getRepoContextForCli(cwd, env);
  const result = await createWorktree(context, parsed.positionals[0], {
    fetch: parsed.flags.fetch,
  });

  if (parsed.flags.json) {
    writeJson(stdout, result);
    return;
  }

  write(stdout, formatCreateResult(result));
}

async function handlePathCommand(
  parsed: ParsedCommandArgs,
  { cwd, env, stdout }: CliRuntimeOptions,
): Promise<void> {
  requirePositionals(parsed, 1, "shrubby path <target> [--json]");

  const { worktree } = await getResolvedWorktree(cwd, env, parsed.positionals[0]);

  if (parsed.flags.json) {
    writeJson(stdout, worktree);
    return;
  }

  writeLine(stdout, worktree.path);
}

async function handleCopyCommand(
  parsed: ParsedCommandArgs,
  {
    copyRunCommand,
    cwd,
    env,
    platform,
    stdout,
  }: CliRuntimeOptions,
): Promise<void> {
  requirePositionals(parsed, 1, "shrubby copy <target> [--json]");

  const { worktree } = await getResolvedWorktree(cwd, env, parsed.positionals[0]);
  const result = await copyPath(worktree.path, {
    env,
    platform,
    runCommand: copyRunCommand,
  });

  if (parsed.flags.json) {
    writeJson(stdout, formatCopyJson(worktree, result));
    return;
  }

  writeLine(stdout, formatCopyResult(result));
}

async function handleRemoveCommand(
  parsed: ParsedCommandArgs,
  {
    cwd,
    env,
    stdin,
    stdout,
  }: CliRuntimeOptions,
): Promise<void> {
  requirePositionals(
    parsed,
    1,
    "shrubby remove <target> [--yes] [--force-dirty] [--json]",
  );

  const { context, worktree } = await getResolvedWorktree(
    cwd,
    env,
    parsed.positionals[0],
  );

  if (worktree.isDirty && !parsed.flags.forceDirty) {
    throw new CliUsageError(
      "Refusing to remove dirty worktree without --force-dirty.",
    );
  }

  if (!parsed.flags.yes) {
    if (stdin.isTTY !== true) {
      throw new CliUsageError(
        "Refusing to remove without --yes when stdin is not interactive.",
      );
    }

    const confirmed = await confirm(stdin, stdout, `Remove ${formatLabel(worktree)}? y/N `);

    if (!confirmed) {
      if (parsed.flags.json) {
        writeJson(stdout, {
          cancelled: true,
          removed: false,
          worktree,
        });
        return;
      }

      writeLine(stdout, "Cancelled.");
      return;
    }
  }

  await removeWorktree(context, worktree, {
    forceDirty: parsed.flags.forceDirty,
  });

  const action = worktree.isPrunable ? "pruned" : "removed";

  if (parsed.flags.json) {
    writeJson(stdout, {
      action,
      removed: true,
      worktree,
    });
    return;
  }

  writeLine(stdout, `${capitalize(action)} ${formatLabel(worktree)}.`);
}

async function handleOpenCommand(
  parsed: ParsedCommandArgs,
  {
    cwd,
    editorRunCommand = runCommandDefault,
    env,
    stdout,
  }: CliRuntimeOptions,
): Promise<void> {
  requirePositionals(
    parsed,
    1,
    "shrubby open <target> [--editor <command>] [--json]",
  );

  const { context, worktree } = await getResolvedWorktree(
    cwd,
    env,
    parsed.positionals[0],
  );
  const editorCommand =
    parsed.flags.editor ??
    context.config.editorCommand ??
    env.SHRUBBY_EDITOR ??
    env.VISUAL ??
    env.EDITOR ??
    "code";
  const [command, ...commandArgs] = parseCommandLine(editorCommand);

  if (command === undefined) {
    throw new CliUsageError("Editor command cannot be empty.");
  }

  const args = [...commandArgs, worktree.path];

  await editorRunCommand(command, args);

  if (parsed.flags.json) {
    writeJson(stdout, {
      command,
      args,
      path: worktree.path,
      target: worktree,
    });
    return;
  }

  writeLine(stdout, `Opened ${formatLabel(worktree)} in ${command}.`);
}

async function handleCleanupCommand(
  parsed: ParsedCommandArgs,
  { cwd, env, stdin, stdout }: CliRuntimeOptions,
): Promise<void> {
  requirePositionals(
    parsed,
    0,
    "shrubby cleanup [--dry-run] [--merged] [--stale] [--yes] [--json]",
  );

  const context = await getRepoContextForCli(cwd, env);
  const includeMerged = parsed.flags.merged || !parsed.flags.stale;
  const includeStale = parsed.flags.stale || !parsed.flags.merged;
  const preview = await cleanupWorktrees(context, {
    dryRun: true,
    includeMerged,
    includeStale,
  });

  if (parsed.flags.dryRun) {
    writeCleanupResult(stdout, parsed.flags.json, preview);
    return;
  }

  if (preview.entries.length === 0) {
    writeCleanupResult(stdout, parsed.flags.json, {
      ...preview,
      dryRun: false,
      removed: false,
    });
    return;
  }

  if (!parsed.flags.yes) {
    if (stdin.isTTY !== true) {
      throw new CliUsageError(
        "Refusing to clean up without --yes when stdin is not interactive.",
      );
    }

    const confirmed = await confirm(
      stdin,
      stdout,
      `Remove ${preview.entries.length} cleanup candidate(s)? y/N `,
    );

    if (!confirmed) {
      const cancelledResult = {
        ...preview,
        dryRun: false,
        removed: false,
      };

      if (parsed.flags.json) {
        writeJson(stdout, {
          ...formatCleanupJson(cancelledResult),
          cancelled: true,
        });
        return;
      }

      writeLine(stdout, "Cancelled.");
      return;
    }
  }

  const result = await cleanupWorktrees(context, {
    dryRun: false,
    includeMerged,
    includeStale,
  });

  writeCleanupResult(stdout, parsed.flags.json, result);
}

function handleShellInitCommand(
  parsed: ParsedCommandArgs,
  stdout: WritableLike,
): void {
  requirePositionals(parsed, 1, "shrubby shell-init <zsh|bash|fish>");
  write(stdout, formatShellInit(parsed.positionals[0]));
}

async function getResolvedWorktree(
  cwd: string,
  env: NodeJS.ProcessEnv,
  target: string,
): Promise<{
  readonly context: RepoContext;
  readonly worktree: WorktreeEntry;
}> {
  const context = await getRepoContextForCli(cwd, env);
  const worktrees = await listWorktrees(context);
  const worktree = await resolveWorktreeTarget(context, target, {
    cwd,
    worktrees,
  });

  return { context, worktree };
}

function getRepoContextForCli(
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<RepoContext> {
  return getRepoContext(cwd, { homeDir: env.HOME });
}

function parseCommandArgs(
  command: CommandName,
  args: readonly string[],
): ParsedCommandArgs {
  const allowedFlags = getAllowedFlags(command);
  const flags: CliFlags = {
    dryRun: false,
    editor: undefined,
    fetch: false,
    forceDirty: false,
    help: false,
    json: false,
    merged: false,
    stale: false,
    yes: false,
  };
  const positionals: string[] = [];
  let allowOnlyPositionals = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (allowOnlyPositionals) {
      positionals.push(arg);
      continue;
    }

    if (arg === "--") {
      allowOnlyPositionals = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      assertFlagAllowed(command, allowedFlags, "help", arg);
      flags.help = true;
      continue;
    }

    if (arg === "--dry-run") {
      assertFlagAllowed(command, allowedFlags, "dryRun", arg);
      flags.dryRun = true;
      continue;
    }

    if (arg === "--editor" || arg.startsWith("--editor=")) {
      assertFlagAllowed(command, allowedFlags, "editor", "--editor");
      const editor =
        arg === "--editor"
          ? args[index + 1]
          : arg.slice("--editor=".length);

      if (editor === undefined || editor.trim().length === 0) {
        throw new CliUsageError("Option '--editor' requires a value.");
      }

      if (arg === "--editor") {
        index += 1;
      }

      flags.editor = editor;
      continue;
    }

    if (arg === "--fetch") {
      assertFlagAllowed(command, allowedFlags, "fetch", arg);
      flags.fetch = true;
      continue;
    }

    if (arg === "--force-dirty") {
      assertFlagAllowed(command, allowedFlags, "forceDirty", arg);
      flags.forceDirty = true;
      continue;
    }

    if (arg === "--json") {
      assertFlagAllowed(command, allowedFlags, "json", arg);
      flags.json = true;
      continue;
    }

    if (arg === "--merged") {
      assertFlagAllowed(command, allowedFlags, "merged", arg);
      flags.merged = true;
      continue;
    }

    if (arg === "--stale") {
      assertFlagAllowed(command, allowedFlags, "stale", arg);
      flags.stale = true;
      continue;
    }

    if (arg === "--yes" || arg === "-y") {
      assertFlagAllowed(command, allowedFlags, "yes", arg);
      flags.yes = true;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new CliUsageError(`Unknown option '${arg}'.`);
    }

    positionals.push(arg);
  }

  return { flags, positionals };
}

function getAllowedFlags(command: CommandName): readonly (keyof CliFlags)[] {
  switch (command) {
    case "cleanup":
      return ["dryRun", "help", "json", "merged", "stale", "yes"];
    case "copy":
    case "list":
    case "path":
      return ["help", "json"];
    case "create":
      return ["fetch", "help", "json"];
    case "open":
      return ["editor", "help", "json"];
    case "remove":
      return ["forceDirty", "help", "json", "yes"];
    case "shell-init":
    case "help":
      return ["help"];
  }
}

function assertFlagAllowed(
  command: CommandName,
  allowedFlags: readonly (keyof CliFlags)[],
  flag: keyof CliFlags,
  arg: string,
): void {
  if (!allowedFlags.includes(flag)) {
    throw new CliUsageError(`Option '${arg}' is not valid for '${command}'.`);
  }
}

function requirePositionals(
  parsed: ParsedCommandArgs,
  expectedCount: number,
  usage: string,
): void {
  if (parsed.positionals.length === expectedCount) {
    return;
  }

  throw new CliUsageError(`Usage: ${usage}`);
}

function isCommandName(command: string): command is CommandName {
  return [
    "cleanup",
    "copy",
    "create",
    "help",
    "list",
    "open",
    "path",
    "remove",
    "shell-init",
  ].includes(command);
}

function getGeneralHelp(): string {
  return `shrubby

Usage:
  shrubby
  shrubby --create <branch> [--prefill]
  shrubby --help
  shrubby help [command]
  shrubby cleanup [--dry-run] [--merged] [--stale] [--yes] [--json]
  shrubby list [--json]
  shrubby create <branch> [--fetch] [--json]
  shrubby path <target> [--json]
  shrubby copy <target> [--json]
  shrubby open <target> [--editor <command>] [--json]
  shrubby remove <target> [--yes] [--force-dirty] [--json]
  shrubby shell-init <zsh|bash|fish>

Commands:
  cleanup          Remove safe cleanup candidates.
  list              List git worktrees for the current repository.
  create <branch>   Create or reuse a branch in the managed worktree root.
  path <target>      Print the selected worktree path.
  copy <target>      Copy the selected worktree path.
  open <target>      Open the selected worktree in an editor.
  remove <target>    Remove a non-current, non-protected worktree.
  shell-init         Print shell helpers for fast cd/open workflows.
  help [command]     Show help.

Targets resolve by exact branch, exact path, then unique path basename.

\`shrubby --create <branch>\` opens the terminal UI on the create screen and
creates the branch without prompting. Add \`--prefill\` to open the create screen
with the branch filled in for editing instead; press Enter there to create it.
`;
}

function getCommandHelp(command: Exclude<CommandName, "help">): string {
  switch (command) {
    case "cleanup":
      return `Usage: shrubby cleanup [--dry-run] [--merged] [--stale] [--yes] [--json]

Remove safe cleanup candidates. Stale metadata is pruned; clean, managed,
merged worktrees are removed. Without --merged or --stale, both are included.
Use --dry-run to preview. Without --yes, shrubby prompts in a terminal and
refuses non-interactive cleanup.
`;
    case "copy":
      return `Usage: shrubby copy <target> [--json]

Copy the selected worktree path. Targets resolve by exact branch, exact path,
then unique path basename.
`;
    case "create":
      return `Usage: shrubby create <branch> [--fetch] [--json]

Create a worktree under the managed root. Existing local and remote branches are
reused; otherwise a new branch is created from the detected default branch. Use
--fetch to run 'git fetch --prune origin' before resolving remote branches.
`;
    case "list":
      return `Usage: shrubby list [--json]

List worktrees for the current repository. Human output is a compact table;
--json emits the repository context and worktree entries.
`;
    case "open":
      return `Usage: shrubby open <target> [--editor <command>] [--json]

Open the selected worktree in an editor. The editor comes from --editor,
shrubby config, SHRUBBY_EDITOR, VISUAL, EDITOR, then 'code'.
`;
    case "path":
      return `Usage: shrubby path <target> [--json]

Print the selected worktree path. Human output is path-only for shell use.
`;
    case "remove":
      return `Usage: shrubby remove <target> [--yes] [--force-dirty] [--json]

Remove a worktree using the same current and protected-branch safeguards as the
terminal UI. Dirty worktrees require --force-dirty. Without --yes, shrubby
prompts in a terminal and refuses non-interactive removal.
`;
    case "shell-init":
      return `Usage: shrubby shell-init <zsh|bash|fish>

Print shell functions for fast personal workflows. Source the output from your
shell profile to add 'swd <target>' and 'sopen <target>'.
`;
  }
}

function formatWorktreeTable(worktrees: readonly WorktreeEntry[]): string {
  if (worktrees.length === 0) {
    return "No worktrees found.\n";
  }

  const rows = worktrees.map((worktree) => ({
    aheadBehind: formatAheadBehind(worktree),
    branch: worktree.branch ?? "(detached)",
    last: formatLastCommit(worktree),
    path: worktree.path,
    scope: getScope(worktree),
    state: getState(worktree),
    upstream: worktree.upstream ?? "-",
  }));
  const aheadBehindWidth = Math.max(
    "A/B".length,
    ...rows.map((row) => row.aheadBehind.length),
  );
  const branchWidth = Math.max("BRANCH".length, ...rows.map((row) => row.branch.length));
  const lastWidth = Math.max("LAST".length, ...rows.map((row) => row.last.length));
  const scopeWidth = Math.max("SCOPE".length, ...rows.map((row) => row.scope.length));
  const stateWidth = Math.max("STATE".length, ...rows.map((row) => row.state.length));
  const upstreamWidth = Math.max(
    "UPSTREAM".length,
    ...rows.map((row) => row.upstream.length),
  );
  const lines = [
    `${"BRANCH".padEnd(branchWidth)}  ${"SCOPE".padEnd(scopeWidth)}  ${"STATE".padEnd(stateWidth)}  ${"UPSTREAM".padEnd(upstreamWidth)}  ${"A/B".padEnd(aheadBehindWidth)}  ${"LAST".padEnd(lastWidth)}  PATH`,
    ...rows.map(
      (row) =>
        `${row.branch.padEnd(branchWidth)}  ${row.scope.padEnd(scopeWidth)}  ${row.state.padEnd(stateWidth)}  ${row.upstream.padEnd(upstreamWidth)}  ${row.aheadBehind.padEnd(aheadBehindWidth)}  ${row.last.padEnd(lastWidth)}  ${row.path}`,
    ),
  ];

  return `${lines.join("\n")}\n`;
}

function formatCreateResult(result: CreateWorktreeResult): string {
  return [
    "Created worktree",
    `Branch: ${result.branch}`,
    `Path: ${result.path}`,
    `Base: ${result.baseRef}`,
    `Mode: ${result.mode}`,
    "",
  ].join("\n");
}

function formatCopyJson(
  worktree: WorktreeEntry,
  result: CopyPathResult,
): {
  readonly copiedTo: readonly string[];
  readonly failures: CopyPathResult["failures"];
  readonly path: string;
  readonly target: WorktreeEntry;
} {
  return {
    copiedTo: result.copiedTo,
    failures: result.failures,
    path: result.path,
    target: worktree,
  };
}

function formatCopyResult(result: CopyPathResult): string {
  const warning =
    result.failures.length === 0
      ? ""
      : ` Failed: ${result.failures
          .map((failure) => `${failure.method}: ${failure.message}`)
          .join("; ")}`;

  return `Copied ${result.path} via ${result.copiedTo.join(", ")}.${warning}`;
}

function writeCleanupResult(
  stdout: WritableLike,
  asJson: boolean,
  result: CleanupWorktreesResult,
): void {
  if (asJson) {
    writeJson(stdout, formatCleanupJson(result));
    return;
  }

  write(stdout, formatCleanupResult(result));
}

function formatCleanupJson(result: CleanupWorktreesResult): {
  readonly dryRun: boolean;
  readonly entries: readonly CleanupEntry[];
  readonly count: number;
  readonly removed: boolean;
} {
  return {
    dryRun: result.dryRun,
    entries: result.entries,
    count: result.entries.length,
    removed: result.removed,
  };
}

function formatCleanupResult(result: CleanupWorktreesResult): string {
  if (result.entries.length === 0) {
    return "No cleanup candidates.\n";
  }

  const heading = result.dryRun ? "Cleanup candidates:" : "Cleaned up:";
  const lines = result.entries.map((entry) => {
    const label = formatLabel(entry.worktree);
    const action = entry.action === "prune" ? "prune" : "remove";

    return `  ${action} ${label} (${entry.reason}) ${entry.worktree.path}`;
  });

  return `${[heading, ...lines, ""].join("\n")}`;
}

function formatAheadBehind(worktree: WorktreeEntry): string {
  if (worktree.ahead === undefined && worktree.behind === undefined) {
    return "-";
  }

  return `+${worktree.ahead ?? 0}/-${worktree.behind ?? 0}`;
}

function formatLastCommit(worktree: WorktreeEntry): string {
  if (worktree.lastCommit === undefined) {
    return "-";
  }

  return `${worktree.lastCommit.hash} ${worktree.lastCommit.date.slice(0, 10)}`;
}

function getScope(worktree: WorktreeEntry): string {
  if (worktree.isCurrent) {
    return "current";
  }

  return worktree.isManaged ? "managed" : "external";
}

function getState(worktree: WorktreeEntry): string {
  if (worktree.isPrunable) {
    return "missing";
  }

  return worktree.isDirty ? "dirty" : "clean";
}

function formatLabel(worktree: WorktreeEntry): string {
  return worktree.branch ?? worktree.path;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function parseCommandLine(commandLine: string): readonly string[] {
  const parts: string[] = [];
  let current = "";
  let quote: "'" | "\"" | undefined;
  let isEscaped = false;

  for (const char of commandLine.trim()) {
    if (isEscaped) {
      current += char;
      isEscaped = false;
      continue;
    }

    if (char === "\\") {
      isEscaped = true;
      continue;
    }

    if (quote !== undefined) {
      if (char === quote) {
        quote = undefined;
      } else {
        current += char;
      }
      continue;
    }

    if (char === "'" || char === "\"") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current.length > 0) {
        parts.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (isEscaped) {
    current += "\\";
  }

  if (quote !== undefined) {
    throw new CliUsageError("Editor command has an unterminated quote.");
  }

  if (current.length > 0) {
    parts.push(current);
  }

  return parts;
}

function runCommandDefault(
  command: string,
  args: readonly string[],
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} exited with ${code}`));
    });
  });
}

function formatShellInit(shell: string): string {
  if (shell === "zsh" || shell === "bash") {
    return `swd() {
  if [ "$#" -ne 1 ]; then
    printf 'usage: swd <target>\\n' >&2
    return 2
  fi

  local target_path
  target_path="$(shrubby path "$1")" || return
  cd "$target_path"
}

sopen() {
  shrubby open "$@"
}
`;
  }

  if (shell === "fish") {
    return `function swd
  if test (count $argv) -ne 1
    echo 'usage: swd <target>' >&2
    return 2
  end

  set -l target_path (shrubby path $argv[1])
  or return
  cd "$target_path"
end

function sopen
  shrubby open $argv
end
`;
  }

  throw new CliUsageError(`Unsupported shell '${shell}'.`);
}

async function confirm(
  stdin: CliInput,
  stdout: WritableLike,
  prompt: string,
): Promise<boolean> {
  write(stdout, prompt);
  const answer = (await readLine(stdin)).trim().toLowerCase();

  return answer === "y" || answer === "yes";
}

function readLine(stdin: CliInput): Promise<string> {
  stdin.setEncoding?.("utf8");

  return new Promise((resolve, reject) => {
    let value = "";
    let isDone = false;

    const cleanup = (): void => {
      stdin.off("data", onData);
      stdin.off("end", onEnd);
      stdin.off("error", onError);
      stdin.pause?.();
    };
    const finish = (line: string): void => {
      if (isDone) {
        return;
      }

      isDone = true;
      cleanup();
      resolve(line);
    };
    const onData = (chunk: unknown): void => {
      value += String(chunk);

      const lineEnd = value.search(/\r?\n/);

      if (lineEnd !== -1) {
        finish(value.slice(0, lineEnd));
      }
    };
    const onEnd = (): void => {
      finish(value);
    };
    const onError = (error: Error): void => {
      if (isDone) {
        return;
      }

      isDone = true;
      cleanup();
      reject(error);
    };

    stdin.on("data", onData);
    stdin.on("end", onEnd);
    stdin.on("error", onError);
  });
}

function writeJson(stdout: WritableLike, value: unknown): void {
  writeLine(stdout, JSON.stringify(value, null, 2));
}

function writeLine(stdout: WritableLike, value: string): void {
  write(stdout, `${value}\n`);
}

function write(stdout: WritableLike, value: string): void {
  stdout.write(value);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
