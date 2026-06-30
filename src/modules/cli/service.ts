import process from "node:process";
import { copyPath } from "../clipboard/service.js";
import type { CopyPathResult, RunCommand } from "../clipboard/types.js";
import {
  createWorktree,
  getRepoContext,
  listWorktrees,
  removeWorktree,
  resolveWorktreeTarget,
} from "../worktree/service.js";
import type {
  CreateWorktreeResult,
  RepoContext,
  WorktreeEntry,
} from "../worktree/types.js";

type CommandName = "copy" | "create" | "help" | "list" | "path" | "remove";

type CliFlags = {
  readonly help: boolean;
  readonly json: boolean;
  readonly yes: boolean;
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
  readonly env?: NodeJS.ProcessEnv;
  readonly platform?: NodeJS.Platform;
  readonly stderr?: WritableLike;
  readonly stdin?: CliInput;
  readonly stdout?: WritableLike;
};

type CliRuntimeOptions = {
  readonly copyRunCommand?: RunCommand;
  readonly cwd: string;
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

export function shouldLaunchTui(args: readonly string[]): boolean {
  return args.length === 0;
}

export async function runCliCommand(
  args: readonly string[],
  {
    copyRunCommand,
    cwd = process.cwd(),
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
    case "copy":
      await handleCopyCommand(parsed, options);
      return;
    case "create":
      await handleCreateCommand(parsed, options);
      return;
    case "list":
      await handleListCommand(parsed, options);
      return;
    case "path":
      await handlePathCommand(parsed, options);
      return;
    case "remove":
      await handleRemoveCommand(parsed, options);
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
  { cwd, stdout }: CliRuntimeOptions,
): Promise<void> {
  requirePositionals(parsed, 0, "shrubby list [--json]");

  const context = await getRepoContext(cwd);
  const worktrees = await listWorktrees(context);

  if (parsed.flags.json) {
    writeJson(stdout, { context, worktrees });
    return;
  }

  write(stdout, formatWorktreeTable(worktrees));
}

async function handleCreateCommand(
  parsed: ParsedCommandArgs,
  { cwd, stdout }: CliRuntimeOptions,
): Promise<void> {
  requirePositionals(parsed, 1, "shrubby create <branch> [--json]");

  const context = await getRepoContext(cwd);
  const result = await createWorktree(context, parsed.positionals[0]);

  if (parsed.flags.json) {
    writeJson(stdout, result);
    return;
  }

  write(stdout, formatCreateResult(result));
}

async function handlePathCommand(
  parsed: ParsedCommandArgs,
  { cwd, stdout }: CliRuntimeOptions,
): Promise<void> {
  requirePositionals(parsed, 1, "shrubby path <target> [--json]");

  const { worktree } = await getResolvedWorktree(cwd, parsed.positionals[0]);

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

  const { worktree } = await getResolvedWorktree(cwd, parsed.positionals[0]);
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
    stdin,
    stdout,
  }: CliRuntimeOptions,
): Promise<void> {
  requirePositionals(parsed, 1, "shrubby remove <target> [--yes] [--json]");

  const { worktree } = await getResolvedWorktree(cwd, parsed.positionals[0]);

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

  const context = await getRepoContext(cwd);
  await removeWorktree(context, worktree);

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

async function getResolvedWorktree(
  cwd: string,
  target: string,
): Promise<{
  readonly context: RepoContext;
  readonly worktree: WorktreeEntry;
}> {
  const context = await getRepoContext(cwd);
  const worktrees = await listWorktrees(context);
  const worktree = await resolveWorktreeTarget(context, target, {
    cwd,
    worktrees,
  });

  return { context, worktree };
}

function parseCommandArgs(
  command: CommandName,
  args: readonly string[],
): ParsedCommandArgs {
  const allowedFlags = getAllowedFlags(command);
  const flags = {
    help: false,
    json: false,
    yes: false,
  };
  const positionals: string[] = [];
  let allowOnlyPositionals = false;

  for (const arg of args) {
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

    if (arg === "--json") {
      assertFlagAllowed(command, allowedFlags, "json", arg);
      flags.json = true;
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
    case "copy":
    case "create":
    case "list":
    case "path":
      return ["help", "json"];
    case "remove":
      return ["help", "json", "yes"];
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
  return ["copy", "create", "help", "list", "path", "remove"].includes(command);
}

function getGeneralHelp(): string {
  return `shrubby

Usage:
  shrubby
  shrubby --help
  shrubby help [command]
  shrubby list [--json]
  shrubby create <branch> [--json]
  shrubby path <target> [--json]
  shrubby copy <target> [--json]
  shrubby remove <target> [--yes] [--json]

Commands:
  list              List git worktrees for the current repository.
  create <branch>   Create or reuse a branch in the managed worktree root.
  path <target>      Print the selected worktree path.
  copy <target>      Copy the selected worktree path.
  remove <target>    Remove a clean, non-current, non-protected worktree.
  help [command]     Show help.

Targets resolve by exact branch, exact path, then unique path basename.
`;
}

function getCommandHelp(command: Exclude<CommandName, "help">): string {
  switch (command) {
    case "copy":
      return `Usage: shrubby copy <target> [--json]

Copy the selected worktree path. Targets resolve by exact branch, exact path,
then unique path basename.
`;
    case "create":
      return `Usage: shrubby create <branch> [--json]

Create a worktree under the managed root. Existing local and remote branches are
reused; otherwise a new branch is created from the detected default branch.
`;
    case "list":
      return `Usage: shrubby list [--json]

List worktrees for the current repository. Human output is a compact table;
--json emits the repository context and worktree entries.
`;
    case "path":
      return `Usage: shrubby path <target> [--json]

Print the selected worktree path. Human output is path-only for shell use.
`;
    case "remove":
      return `Usage: shrubby remove <target> [--yes] [--json]

Remove a worktree using the same dirty, current, and protected-branch safeguards
as the terminal UI. Without --yes, shrubby prompts in a terminal and refuses
non-interactive removal.
`;
  }
}

function formatWorktreeTable(worktrees: readonly WorktreeEntry[]): string {
  if (worktrees.length === 0) {
    return "No worktrees found.\n";
  }

  const rows = worktrees.map((worktree) => ({
    branch: worktree.branch ?? "(detached)",
    path: worktree.path,
    scope: getScope(worktree),
    state: getState(worktree),
  }));
  const branchWidth = Math.max("BRANCH".length, ...rows.map((row) => row.branch.length));
  const scopeWidth = Math.max("SCOPE".length, ...rows.map((row) => row.scope.length));
  const stateWidth = Math.max("STATE".length, ...rows.map((row) => row.state.length));
  const lines = [
    `${"BRANCH".padEnd(branchWidth)}  ${"SCOPE".padEnd(scopeWidth)}  ${"STATE".padEnd(stateWidth)}  PATH`,
    ...rows.map(
      (row) =>
        `${row.branch.padEnd(branchWidth)}  ${row.scope.padEnd(scopeWidth)}  ${row.state.padEnd(stateWidth)}  ${row.path}`,
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
