import { execFile } from "node:child_process";
import { access, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type {
  CommandNotFoundFailure,
  CreateWorktreeResult,
  GitCommandFailure,
  GitResult,
  ParsedWorktree,
  RepoContext,
  ResolveWorktreeTargetOptions,
  WorktreeEntry,
  WorktreeState,
} from "./types.js";

const execFileAsync = promisify(execFile);

export async function getRepoContext(cwd = process.cwd()): Promise<RepoContext> {
  const repoRoot = await getRepoRoot(cwd);
  const projectName = path.basename(repoRoot);
  const worktreeRoot = path.join(path.dirname(repoRoot), ".worktrees", projectName);
  const defaultBranch = await getDefaultBaseRef(repoRoot);
  const protectedBranch = normalizeBranchName(defaultBranch);

  return {
    repoRoot,
    projectName,
    protectedBranch,
    worktreeRoot,
    defaultBranch,
  };
}

export async function createWorktree(
  context: RepoContext,
  branchName: string,
): Promise<CreateWorktreeResult> {
  const branch = branchName.trim();

  await validateBranchName(context.repoRoot, branch);

  const targetPath = path.join(context.worktreeRoot, branchToSlug(branch));

  if (await pathExists(targetPath)) {
    throw new Error(`Worktree path already exists: ${targetPath}`);
  }

  await mkdir(context.worktreeRoot, { recursive: true });

  if (await hasLocalBranch(context.repoRoot, branch)) {
    await git(context.repoRoot, ["worktree", "add", targetPath, branch]);
    return {
      path: targetPath,
      branch,
      baseRef: branch,
      mode: "existing-local",
    };
  }

  const remoteRef = `origin/${branch}`;

  if (await hasRemoteBranch(context.repoRoot, branch)) {
    await git(context.repoRoot, [
      "worktree",
      "add",
      "-b",
      branch,
      targetPath,
      remoteRef,
    ]);
    return {
      path: targetPath,
      branch,
      baseRef: remoteRef,
      mode: "existing-remote",
    };
  }

  await git(context.repoRoot, [
    "worktree",
    "add",
    "-b",
    branch,
    targetPath,
    context.defaultBranch,
  ]);

  return {
    path: targetPath,
    branch,
    baseRef: context.defaultBranch,
    mode: "new-branch",
  };
}

export async function listWorktrees(
  context: RepoContext,
): Promise<readonly WorktreeEntry[]> {
  const { stdout } = await git(context.repoRoot, ["worktree", "list", "--porcelain"]);
  const entries = parseWorktreePorcelain(stdout);

  return Promise.all(
    entries.map(async (entry) => {
      const state = await getWorktreeState(entry);

      return {
        path: entry.path,
        branch: entry.branch,
        head: entry.head,
        isCurrent: path.resolve(entry.path) === path.resolve(context.repoRoot),
        isManaged: isManagedWorktreePath(context, entry.path),
        isDirty: state.isDirty,
        isPrunable: state.isPrunable,
      };
    }),
  );
}

export async function resolveWorktreeTarget(
  context: RepoContext,
  targetName: string,
  {
    cwd = process.cwd(),
    worktrees,
  }: ResolveWorktreeTargetOptions = {},
): Promise<WorktreeEntry> {
  const target = targetName.trim();

  if (target.length === 0) {
    throw new Error("Worktree target is required.");
  }

  const entries = worktrees ?? (await listWorktrees(context));
  const branchMatch = getSingleMatch(
    target,
    entries.filter((entry) => entry.branch === target),
    "branch",
  );

  if (branchMatch !== undefined) {
    return branchMatch;
  }

  const absoluteTarget = path.resolve(cwd, target);
  const pathMatch = getSingleMatch(
    target,
    entries.filter((entry) => path.resolve(entry.path) === absoluteTarget),
    "path",
  );

  if (pathMatch !== undefined) {
    return pathMatch;
  }

  const basenameMatch = getSingleMatch(
    target,
    entries.filter((entry) => path.basename(entry.path) === target),
    "basename",
  );

  if (basenameMatch !== undefined) {
    return basenameMatch;
  }

  throw new Error(`No worktree matches '${target}'.`);
}

export async function removeWorktree(
  context: RepoContext,
  worktree: WorktreeEntry,
): Promise<void> {
  if (worktree.isCurrent) {
    throw new Error("Cannot remove the current worktree.");
  }

  if (isProtectedBranch(context, worktree)) {
    throw new Error(`Cannot remove protected branch '${context.protectedBranch}'.`);
  }

  if (worktree.isPrunable) {
    await rm(worktree.path, { force: true, recursive: true });
    await git(context.repoRoot, ["worktree", "prune"]);
    return;
  }

  const removeArgs = (await isWorktreeDirty(worktree.path))
    ? ["worktree", "remove", "--force", worktree.path]
    : ["worktree", "remove", worktree.path];

  await git(context.repoRoot, removeArgs);
}

export function isProtectedBranch(
  context: RepoContext,
  worktree: Pick<WorktreeEntry, "branch">,
): boolean {
  return (
    worktree.branch !== undefined &&
    normalizeBranchName(worktree.branch) === context.protectedBranch
  );
}

export function branchToSlug(branch: string): string {
  const slug = branch
    .trim()
    .replace(/[\\/]+/g, "--")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug.length > 0 ? slug : "worktree";
}

function getSingleMatch(
  target: string,
  matches: readonly WorktreeEntry[],
  kind: string,
): WorktreeEntry | undefined {
  if (matches.length === 0) {
    return undefined;
  }

  if (matches.length === 1) {
    return matches[0];
  }

  throw new Error(
    `Ambiguous worktree ${kind} '${target}'. Matches: ${matches
      .map((entry) => entry.path)
      .join(", ")}`,
  );
}

async function getRepoRoot(cwd: string): Promise<string> {
  const { stdout } = await git(cwd, ["rev-parse", "--show-toplevel"]);

  return stdout.trim();
}

async function getDefaultBaseRef(repoRoot: string): Promise<string> {
  const originHead = await gitMaybe(repoRoot, [
    "symbolic-ref",
    "--quiet",
    "--short",
    "refs/remotes/origin/HEAD",
  ]);

  if (originHead !== undefined) {
    return originHead.trim();
  }

  if (await hasLocalBranch(repoRoot, "main")) {
    return "main";
  }

  const { stdout } = await git(repoRoot, ["branch", "--show-current"]);
  const currentBranch = stdout.trim();

  if (currentBranch.length > 0) {
    return currentBranch;
  }

  throw new Error("Could not detect a default base branch.");
}

async function validateBranchName(repoRoot: string, branch: string): Promise<void> {
  if (branch.length === 0) {
    throw new Error("Branch name is required.");
  }

  await git(repoRoot, ["check-ref-format", "--branch", branch]);
}

async function hasLocalBranch(repoRoot: string, branch: string): Promise<boolean> {
  return (await gitMaybe(repoRoot, ["rev-parse", "--verify", `refs/heads/${branch}`])) !==
    undefined;
}

async function hasRemoteBranch(repoRoot: string, branch: string): Promise<boolean> {
  return (
    (await gitMaybe(repoRoot, [
      "rev-parse",
      "--verify",
      `refs/remotes/origin/${branch}`,
    ])) !== undefined
  );
}

async function isWorktreeDirty(worktreePath: string): Promise<boolean> {
  const { stdout } = await git(worktreePath, ["status", "--porcelain"]);

  return stdout.trim().length > 0;
}

async function getWorktreeState(
  entry: ParsedWorktree,
): Promise<WorktreeState> {
  if (entry.isPrunable || !(await pathExists(entry.path))) {
    return {
      isDirty: false,
      isPrunable: true,
    };
  }

  try {
    return {
      isDirty: await isWorktreeDirty(entry.path),
      isPrunable: false,
    };
  } catch {
    return {
      isDirty: false,
      isPrunable: true,
    };
  }
}

function isManagedWorktreePath(context: RepoContext, worktreePath: string): boolean {
  const relativePath = path.relative(context.worktreeRoot, worktreePath);

  return (
    relativePath.length > 0 &&
    !relativePath.startsWith("..") &&
    !path.isAbsolute(relativePath)
  );
}

function normalizeBranchName(branch: string): string {
  return branch.replace(/^origin\//, "").replace(/^refs\/heads\//, "");
}

function parseWorktreePorcelain(output: string): readonly ParsedWorktree[] {
  const entries: ParsedWorktree[] = [];
  const blocks = output.trim().length === 0 ? [] : output.trim().split(/\n{2,}/);

  for (const block of blocks) {
    let worktreePath: string | undefined;
    let branch: string | undefined;
    let head: string | undefined;
    let isPrunable = false;

    for (const line of block.split("\n")) {
      if (line.startsWith("worktree ")) {
        worktreePath = line.slice("worktree ".length);
        continue;
      }

      if (line.startsWith("HEAD ")) {
        head = line.slice("HEAD ".length);
        continue;
      }

      if (line.startsWith("branch ")) {
        const ref = line.slice("branch ".length);
        branch = ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : ref;
        continue;
      }

      if (line.startsWith("prunable")) {
        isPrunable = true;
      }
    }

    if (worktreePath !== undefined) {
      entries.push({
        path: worktreePath,
        branch,
        head,
        isPrunable,
      });
    }
  }

  return entries;
}

async function git(cwd: string, args: readonly string[]): Promise<GitResult> {
  try {
    return await runGit(cwd, args);
  } catch (error) {
    if (!isCommandNotFound(error)) {
      throw formatGitError(error);
    }
  }

  try {
    return await runGitViaLoginShell(cwd, args);
  } catch (error) {
    throw formatGitError(error);
  }
}

async function runGit(cwd: string, args: readonly string[]): Promise<GitResult> {
  try {
    const { stdout, stderr } = await execFileAsync("git", [...args], {
      cwd,
      maxBuffer: 10 * 1024 * 1024,
    });

    return { stdout, stderr };
  } catch (error) {
    throw error;
  }
}

async function runGitViaLoginShell(
  cwd: string,
  args: readonly string[],
): Promise<GitResult> {
  const shell = process.env.SHELL ?? "/bin/zsh";

  const { stdout, stderr } = await execFileAsync(
    shell,
    ["-lc", 'git "$@"', "git", ...args],
    {
      cwd,
      maxBuffer: 10 * 1024 * 1024,
    },
  );

  return { stdout, stderr };
}

function formatGitError(error: unknown): Error {
  const failure = error as GitCommandFailure;

  if (isCommandNotFound(failure)) {
    return new Error("Git executable was not found on PATH.");
  }

  const message = failure.stderr?.trim() || failure.message;

  return new Error(message);
}

function isCommandNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }

  const failure = error as CommandNotFoundFailure;

  return (
    failure.code === "ENOENT" &&
    failure.syscall === "spawn git" &&
    failure.path === "git"
  );
}

async function gitMaybe(
  cwd: string,
  args: readonly string[],
): Promise<string | undefined> {
  try {
    const { stdout } = await git(cwd, args);

    return stdout;
  } catch {
    return undefined;
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}
