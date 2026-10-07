import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  loadShrubbyConfig,
  resolveConfiguredPath,
} from "../config/service.js";
import type {
  CleanupEntry,
  CleanupWorktreesOptions,
  CleanupWorktreesResult,
  CommandNotFoundFailure,
  CreateWorktreeOptions,
  CreateWorktreeResult,
  GetRepoContextOptions,
  GitCommandFailure,
  GitResult,
  ParsedWorktree,
  RepoContext,
  RemoveWorktreeOptions,
  ResolveWorktreeTargetOptions,
  WorktreeEntry,
  WorktreeLastCommit,
  WorktreeState,
} from "./types.js";

const execFileAsync = promisify(execFile);

export async function getRepoContext(
  cwd = process.cwd(),
  { homeDir = getHomeDir(), now = new Date() }: GetRepoContextOptions = {},
): Promise<RepoContext> {
  const repoRoot = await getRepoRoot(cwd);
  const projectName = path.basename(repoRoot);
  const currentBranchOutput = await gitMaybe(repoRoot, [
    "branch",
    "--show-current",
  ]);
  const currentBranch = currentBranchOutput?.trim() || undefined;
  const suggestedBranch = await getSuggestedBranch(repoRoot, currentBranch, now);
  const rawConfig = await loadShrubbyConfig(repoRoot, { homeDir });
  const defaultBranch =
    rawConfig.defaultBaseRef ?? (await getDefaultBaseRef(repoRoot));
  const protectedBranches = (
    rawConfig.protectedBranches ?? [defaultBranch]
  ).map(normalizeBranchName);
  const protectedBranch = protectedBranches[0] ?? normalizeBranchName(defaultBranch);
  const worktreeRoot =
    rawConfig.worktreeRoot === undefined
      ? getDefaultWorktreeRoot(repoRoot, projectName)
      : resolveConfiguredPath(rawConfig.worktreeRoot, repoRoot, homeDir);
  const config = {
    copyOnCreate: rawConfig.copyOnCreate ?? true,
    defaultBaseRef: defaultBranch,
    editorCommand: rawConfig.editorCommand,
    fetchBeforeCreate: rawConfig.fetchBeforeCreate ?? false,
    protectedBranches,
    worktreeRoot,
  };

  return {
    config,
    repoRoot,
    projectName,
    protectedBranch,
    protectedBranches,
    suggestedBranch,
    worktreeRoot,
    defaultBranch,
  };
}

export async function createWorktree(
  context: RepoContext,
  branchName: string,
  { fetch = false }: CreateWorktreeOptions = {},
): Promise<CreateWorktreeResult> {
  const branch = branchName.trim();

  await validateBranchName(context.repoRoot, branch);

  if (fetch || context.config.fetchBeforeCreate) {
    await git(context.repoRoot, ["fetch", "--prune", "origin"]);
  }

  await mkdir(context.worktreeRoot, { recursive: true });
  const targetPath = await getAvailableWorktreePath(context, branch);

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
        upstream: state.upstream,
        ahead: state.ahead,
        behind: state.behind,
        lastCommit: state.lastCommit,
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
  { forceDirty = false }: RemoveWorktreeOptions = {},
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

  const isDirty = await isWorktreeDirty(worktree.path);

  if (isDirty && !forceDirty) {
    throw new Error(
      "Worktree has uncommitted changes. Use --force-dirty to remove it anyway.",
    );
  }

  const removeArgs = isDirty
    ? ["worktree", "remove", "--force", worktree.path]
    : ["worktree", "remove", worktree.path];

  await git(context.repoRoot, removeArgs);
}

export async function cleanupWorktrees(
  context: RepoContext,
  {
    dryRun = false,
    includeMerged = true,
    includeStale = true,
  }: CleanupWorktreesOptions = {},
): Promise<CleanupWorktreesResult> {
  const worktrees = await listWorktrees(context);
  const mergedBranches = includeMerged
    ? await getMergedBranches(context.repoRoot, context.defaultBranch)
    : new Set<string>();
  const entries = worktrees.flatMap((worktree): CleanupEntry[] => {
    if (worktree.isCurrent || isProtectedBranch(context, worktree)) {
      return [];
    }

    if (includeStale && worktree.isPrunable) {
      return [
        {
          action: "prune",
          reason: "stale",
          worktree,
        },
      ];
    }

    if (
      includeMerged &&
      worktree.isManaged &&
      !worktree.isDirty &&
      worktree.branch !== undefined &&
      mergedBranches.has(worktree.branch)
    ) {
      return [
        {
          action: "remove",
          reason: "merged",
          worktree,
        },
      ];
    }

    return [];
  });

  if (!dryRun) {
    for (const entry of entries) {
      await removeWorktree(context, entry.worktree);
    }
  }

  return {
    dryRun,
    entries,
    removed: !dryRun && entries.length > 0,
  };
}

export function isProtectedBranch(
  context: RepoContext,
  worktree: Pick<WorktreeEntry, "branch">,
): boolean {
  return (
    worktree.branch !== undefined &&
    context.protectedBranches.includes(normalizeBranchName(worktree.branch))
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

const BRANCH_ID_PATTERN = /^\d+$/;

async function getSuggestedBranch(
  repoRoot: string,
  currentBranch: string | undefined,
  now: Date,
): Promise<string | undefined> {
  if (currentBranch === undefined) {
    return undefined;
  }

  const separatorIndex = currentBranch.indexOf("/");
  const prefix =
    separatorIndex === -1 ? "" : `${currentBranch.slice(0, separatorIndex)}/`;
  const dateId = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("");
  const base = `${prefix}${dateId}`;
  const { stdout } = await git(repoRoot, [
    "for-each-ref",
    "--format=%(refname:short)",
    "refs/heads/",
  ]);
  let highestId = 0;

  for (const branch of stdout.split("\n")) {
    const name = branch.trim();

    if (!name.startsWith(`${base}-`)) {
      continue;
    }

    const suffix = name.slice(base.length + 1);

    if (BRANCH_ID_PATTERN.test(suffix)) {
      highestId = Math.max(highestId, Number(suffix));
    }
  }

  return `${base}-${highestId + 1}`;
}

async function getAvailableWorktreePath(
  context: RepoContext,
  branch: string,
): Promise<string> {
  const slug = branchToSlug(branch);
  const firstCandidate = path.join(context.worktreeRoot, slug);

  if (!(await pathExists(firstCandidate))) {
    return firstCandidate;
  }

  const hash = createHash("sha1").update(branch).digest("hex").slice(0, 8);
  let suffix = 0;

  while (true) {
    const candidateSlug =
      suffix === 0 ? `${slug}--${hash}` : `${slug}--${hash}-${suffix + 1}`;
    const candidatePath = path.join(context.worktreeRoot, candidateSlug);

    if (!(await pathExists(candidatePath))) {
      return candidatePath;
    }

    suffix += 1;
  }
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

function getDefaultWorktreeRoot(repoRoot: string, projectName: string): string {
  return path.join(path.dirname(repoRoot), ".worktrees", projectName);
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
  const { stdout } = await git(worktreePath, [
    "status",
    "--porcelain=v2",
    "--branch",
  ]);

  return parseStatusPorcelainV2(stdout).isDirty;
}

async function getWorktreeState(
  entry: ParsedWorktree,
): Promise<WorktreeState> {
  if (entry.isPrunable || !(await pathExists(entry.path))) {
    return {
      ahead: undefined,
      behind: undefined,
      isDirty: false,
      isPrunable: true,
      lastCommit: undefined,
      upstream: undefined,
    };
  }

  try {
    const { stdout } = await git(entry.path, [
      "status",
      "--porcelain=v2",
      "--branch",
    ]);
    const status = parseStatusPorcelainV2(stdout);

    return {
      ahead: status.ahead,
      behind: status.behind,
      isDirty: status.isDirty,
      isPrunable: false,
      lastCommit: await getLastCommit(entry.path),
      upstream: status.upstream,
    };
  } catch {
    return {
      ahead: undefined,
      behind: undefined,
      isDirty: false,
      isPrunable: true,
      lastCommit: undefined,
      upstream: undefined,
    };
  }
}

function parseStatusPorcelainV2(output: string): Pick<
  WorktreeState,
  "ahead" | "behind" | "isDirty" | "upstream"
> {
  let ahead: number | undefined;
  let behind: number | undefined;
  let upstream: string | undefined;
  let isDirty = false;

  for (const line of output.split("\n")) {
    if (line.length === 0) {
      continue;
    }

    if (line.startsWith("# branch.upstream ")) {
      upstream = line.slice("# branch.upstream ".length);
      continue;
    }

    if (line.startsWith("# branch.ab ")) {
      const match = /^# branch\.ab \+(\d+) -(\d+)$/.exec(line);

      if (match !== null) {
        ahead = Number.parseInt(match[1], 10);
        behind = Number.parseInt(match[2], 10);
      }
      continue;
    }

    if (!line.startsWith("# ")) {
      isDirty = true;
    }
  }

  return { ahead, behind, isDirty, upstream };
}

async function getLastCommit(
  worktreePath: string,
): Promise<WorktreeLastCommit | undefined> {
  const result = await gitMaybe(worktreePath, [
    "log",
    "-1",
    "--format=%h%x00%ct%x00%s",
  ]);

  if (result === undefined) {
    return undefined;
  }

  const [hash, epochSeconds, ...subjectParts] = result.trimEnd().split("\0");

  if (hash === undefined || epochSeconds === undefined) {
    return undefined;
  }

  const epoch = Number.parseInt(epochSeconds, 10);

  return {
    date: Number.isFinite(epoch) ? new Date(epoch * 1000).toISOString() : "",
    hash,
    subject: subjectParts.join("\0"),
  };
}

async function getMergedBranches(
  repoRoot: string,
  baseRef: string,
): Promise<Set<string>> {
  const { stdout } = await git(repoRoot, [
    "branch",
    "--merged",
    baseRef,
    "--format=%(refname:short)",
  ]);

  return new Set(
    stdout
      .split("\n")
      .map((branch) => branch.trim())
      .filter((branch) => branch.length > 0),
  );
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

function getHomeDir(): string | undefined {
  return process.env.HOME ?? os.homedir();
}
