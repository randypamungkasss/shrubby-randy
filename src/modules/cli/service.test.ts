import { execFile } from "node:child_process";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import assert from "node:assert/strict";
import { promisify } from "node:util";
import {
  runCliCommand,
  shouldLaunchTui,
  type CliInput,
  type RunCliCommandOptions,
} from "./service.js";
import type {
  CommandCall,
  CreateRunnerOptions,
  RunCommandOptions,
} from "../clipboard/types.js";
import type {
  CreateWorktreeResult,
  GitResult,
  RepoFixture,
} from "../worktree/types.js";

const execFileAsync = promisify(execFile);

test("routes no args to the TUI and explicit args to commands", () => {
  assert.equal(shouldLaunchTui([]), true);
  assert.equal(shouldLaunchTui(["--help"]), false);
  assert.equal(shouldLaunchTui(["list"]), false);
});

test("prints global and command help", async () => {
  const globalHelp = await runCli(["--help"]);
  const listHelp = await runCli(["help", "list"]);

  assert.equal(globalHelp.code, 0);
  assert.match(globalHelp.stdout, /Usage:\n  shrubby/);
  assert.match(globalHelp.stdout, /shrubby list \[--json\]/);
  assert.equal(globalHelp.stderr, "");
  assert.equal(listHelp.code, 0);
  assert.match(listHelp.stdout, /Usage: shrubby list \[--json\]/);
});

test("reports unknown commands as usage errors", async () => {
  const result = await runCli(["unknown"]);

  assert.equal(result.code, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Unknown command 'unknown'/);
  assert.match(result.stderr, /Run `shrubby --help`/);
});

test("lists worktrees as JSON", async () => {
  await withRepo(async ({ repoRoot }) => {
    const result = await runCli(["list", "--json"], { cwd: repoRoot });
    const parsed = JSON.parse(result.stdout) as {
      readonly context: { readonly projectName: string };
      readonly worktrees: readonly unknown[];
    };

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "");
    assert.equal(parsed.context.projectName, "repo");
    assert.equal(parsed.worktrees.length, 1);
  });
});

test("creates a worktree as JSON and prints its path", async () => {
  await withRepo(async ({ repoRoot }) => {
    const createResult = await runCli(["create", "cli-create", "--json"], {
      cwd: repoRoot,
    });
    const created = JSON.parse(createResult.stdout) as CreateWorktreeResult;
    const pathResult = await runCli(["path", "cli-create"], { cwd: repoRoot });

    assert.equal(createResult.code, 0);
    assert.equal(created.branch, "cli-create");
    assert.equal(created.mode, "new-branch");
    assert.equal(pathResult.code, 0);
    assert.equal(pathResult.stdout, `${created.path}\n`);
  });
});

test("copies a resolved worktree path as JSON", async () => {
  await withRepo(async ({ repoRoot }) => {
    const calls: CommandCall[] = [];
    const createResult = await runCli(["create", "cli-copy", "--json"], {
      cwd: repoRoot,
    });
    const created = JSON.parse(createResult.stdout) as CreateWorktreeResult;
    const copyResult = await runCli(["copy", "cli-copy", "--json"], {
      copyRunCommand: createRunner({ calls }),
      cwd: repoRoot,
      env: {},
      platform: "darwin",
    });
    const copied = JSON.parse(copyResult.stdout) as {
      readonly copiedTo: readonly string[];
      readonly path: string;
    };

    assert.equal(copyResult.code, 0);
    assert.deepEqual(copied.copiedTo, ["pbcopy"]);
    assert.equal(copied.path, created.path);
    assert.deepEqual(calls, [
      {
        args: [],
        command: "pbcopy",
        input: created.path,
      },
    ]);
  });
});

test("removes a worktree with --yes", async () => {
  await withRepo(async ({ repoRoot }) => {
    const created = await createWithCli(repoRoot, "cli-remove-yes");
    const removeResult = await runCli(["remove", "cli-remove-yes", "--yes"], {
      cwd: repoRoot,
    });
    const worktreeList = await git(repoRoot, ["worktree", "list", "--porcelain"]);

    assert.equal(removeResult.code, 0);
    assert.match(removeResult.stdout, /Removed cli-remove-yes\./);
    assert.equal(worktreeList.stdout.includes(created.path), false);
  });
});

test("prompts before removing in an interactive terminal", async () => {
  await withRepo(async ({ repoRoot }) => {
    const created = await createWithCli(repoRoot, "cli-remove-prompt-yes");
    const removeResult = await runCli(["remove", "cli-remove-prompt-yes"], {
      cwd: repoRoot,
      stdin: createInput("y\n", true),
    });
    const worktreeList = await git(repoRoot, ["worktree", "list", "--porcelain"]);

    assert.equal(removeResult.code, 0);
    assert.match(removeResult.stdout, /Remove cli-remove-prompt-yes\? y\/N /);
    assert.match(removeResult.stdout, /Removed cli-remove-prompt-yes\./);
    assert.equal(worktreeList.stdout.includes(created.path), false);
  });
});

test("cancels prompted removal when the answer is no", async () => {
  await withRepo(async ({ repoRoot }) => {
    const created = await createWithCli(repoRoot, "cli-remove-prompt-no");
    const removeResult = await runCli(["remove", "cli-remove-prompt-no"], {
      cwd: repoRoot,
      stdin: createInput("n\n", true),
    });
    const worktreeList = await git(repoRoot, ["worktree", "list", "--porcelain"]);

    assert.equal(removeResult.code, 0);
    assert.match(removeResult.stdout, /Cancelled\./);
    assert.equal(worktreeList.stdout.includes(created.path), true);
  });
});

test("refuses non-interactive remove without --yes", async () => {
  await withRepo(async ({ repoRoot }) => {
    const created = await createWithCli(repoRoot, "cli-remove-no-tty");
    const removeResult = await runCli(["remove", "cli-remove-no-tty"], {
      cwd: repoRoot,
      stdin: createInput("", false),
    });
    const worktreeList = await git(repoRoot, ["worktree", "list", "--porcelain"]);

    assert.equal(removeResult.code, 1);
    assert.match(removeResult.stderr, /Refusing to remove without --yes/);
    assert.equal(worktreeList.stdout.includes(created.path), true);
  });
});

async function createWithCli(
  repoRoot: string,
  branch: string,
): Promise<CreateWorktreeResult> {
  const result = await runCli(["create", branch, "--json"], { cwd: repoRoot });

  assert.equal(result.code, 0);
  return JSON.parse(result.stdout) as CreateWorktreeResult;
}

async function runCli(
  args: readonly string[],
  options: RunCliCommandOptions = {},
): Promise<{
  readonly code: number;
  readonly stderr: string;
  readonly stdout: string;
}> {
  const stdout = new OutputCollector();
  const stderr = new OutputCollector();
  const code = await runCliCommand(args, {
    env: {},
    platform: "darwin",
    stdin: createInput("", false),
    ...options,
    stderr,
    stdout,
  });

  return {
    code,
    stderr: stderr.value,
    stdout: stdout.value,
  };
}

function createInput(text: string, isTTY: boolean): CliInput {
  const input = Readable.from(text.length > 0 ? [text] : []) as CliInput & {
    isTTY?: boolean;
  };

  input.isTTY = isTTY;

  return input;
}

class OutputCollector {
  value = "";

  write(chunk: string): boolean {
    this.value += chunk;
    return true;
  }
}

function createRunner({
  calls = [],
  failures = {},
}: CreateRunnerOptions = {}) {
  return async (
    command: string,
    args: readonly string[],
    options: RunCommandOptions = {},
  ): Promise<void> => {
    calls.push({
      args: [...args],
      command,
      input: options.input,
    });

    const failure = failures[command];

    if (failure !== undefined) {
      throw failure;
    }
  };
}

async function withRepo(
  callback: (fixture: RepoFixture) => Promise<void>,
): Promise<void> {
  const parentDir = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "shrubby-cli-")),
  );
  const repoRoot = path.join(parentDir, "repo");

  try {
    await git(parentDir, ["init", "-b", "main", repoRoot]);
    await git(repoRoot, ["config", "user.email", "test@example.com"]);
    await git(repoRoot, ["config", "user.name", "Shrubby CLI Test"]);
    await writeFile(path.join(repoRoot, "README.md"), "# repo\n");
    await git(repoRoot, ["add", "README.md"]);
    await git(repoRoot, ["commit", "-m", "initial"]);

    await callback({ parentDir, repoRoot });
  } finally {
    await rm(parentDir, { force: true, recursive: true });
  }
}

async function git(
  cwd: string,
  args: readonly string[],
): Promise<GitResult> {
  const { stdout, stderr } = await execFileAsync("git", [...args], { cwd });

  return { stdout, stderr };
}
