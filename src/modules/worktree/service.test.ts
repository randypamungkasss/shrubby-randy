import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { promisify } from "node:util";
import {
  branchToSlug,
  createWorktree,
  getRepoContext,
  listWorktrees,
  removeWorktree,
  resolveWorktreeTarget,
} from "./service.js";
import type {
  GitResult,
  RepoContext,
  RepoFixture,
  WorktreeEntry,
} from "./types.js";

const execFileAsync = promisify(execFile);

test("detects repo context and parent .worktrees location", async () => {
  await withRepo(async ({ parentDir, repoRoot }) => {
    const context = await getRepoContext(repoRoot);

    assert.equal(context.repoRoot, repoRoot);
    assert.equal(context.projectName, "repo");
    assert.equal(context.protectedBranch, "main");
    assert.equal(context.worktreeRoot, path.join(parentDir, ".worktrees", "repo"));
    assert.equal(context.defaultBranch, "main");
  });
});

test("creates a new branch worktree under the managed root", async () => {
  await withRepo(async ({ parentDir, repoRoot }) => {
    const context = await getRepoContext(repoRoot);
    const result = await createWorktree(context, "feature/test");

    assert.equal(result.branch, "feature/test");
    assert.equal(result.baseRef, "main");
    assert.equal(result.mode, "new-branch");
    assert.equal(
      result.path,
      path.join(parentDir, ".worktrees", "repo", "feature--test"),
    );

    const branches = await git(repoRoot, ["branch", "--list", "feature/test"]);
    assert.match(branches.stdout, /feature\/test/);

    const worktrees = await listWorktrees(context);
    assert.equal(
      worktrees.some((worktree) => worktree.path === result.path),
      true,
    );
  });
});

test("blocks removal of dirty managed worktrees", async () => {
  await withRepo(async ({ repoRoot }) => {
    const context = await getRepoContext(repoRoot);
    const result = await createWorktree(context, "dirty-test");
    await writeFile(path.join(result.path, "dirty.txt"), "dirty\n");
    const worktree = await findWorktree(context, result.path);

    await assert.rejects(
      removeWorktree(context, worktree),
      /uncommitted changes/i,
    );
  });
});

test("blocks removal of the current worktree", async () => {
  await withRepo(async ({ repoRoot }) => {
    const context = await getRepoContext(repoRoot);
    const currentWorktree = await findWorktree(context, repoRoot);

    await assert.rejects(
      removeWorktree(context, currentWorktree),
      /current worktree/i,
    );
  });
});

test("blocks removal of protected branch worktrees", async () => {
  await withRepo(async ({ parentDir, repoRoot }) => {
    const context = await getRepoContext(repoRoot);
    await git(repoRoot, ["checkout", "-b", "feature"]);
    const mainPath = path.join(parentDir, "main-worktree");
    await git(repoRoot, ["worktree", "add", mainPath, "main"]);
    const mainWorktree = await findWorktree(context, mainPath);

    await assert.rejects(
      removeWorktree(context, mainWorktree),
      /protected branch 'main'/i,
    );
  });
});

test("blocks pruning protected branch worktree metadata", async () => {
  await withRepo(async ({ parentDir, repoRoot }) => {
    const context = await getRepoContext(repoRoot);
    await git(repoRoot, ["checkout", "-b", "feature"]);
    const mainPath = path.join(parentDir, "stale-main-worktree");
    await git(repoRoot, ["worktree", "add", mainPath, "main"]);
    await rm(mainPath, { force: true, recursive: true });
    const staleMainWorktree = await findWorktree(context, mainPath);

    assert.equal(staleMainWorktree.branch, "main");
    assert.equal(staleMainWorktree.isPrunable, true);

    await assert.rejects(
      removeWorktree(context, staleMainWorktree),
      /protected branch 'main'/i,
    );
  });
});

test("lists prunable worktrees without checking dirty state", async () => {
  await withRepo(async ({ repoRoot }) => {
    const context = await getRepoContext(repoRoot);
    const result = await createWorktree(context, "stale-test");

    await rm(result.path, { force: true, recursive: true });

    const worktrees = await listWorktrees(context);
    const staleWorktree = worktrees.find(
      (worktree) => worktree.path === result.path,
    );

    assert.equal(staleWorktree?.isPrunable, true);
    assert.equal(staleWorktree?.isDirty, false);
  });
});

test("lists worktrees with broken git metadata as prunable", async () => {
  await withRepo(async ({ repoRoot }) => {
    const context = await getRepoContext(repoRoot);
    const result = await createWorktree(context, "broken-gitdir-test");

    await writeFile(path.join(result.path, ".git"), "gitdir: /tmp/missing-gitdir\n");

    const worktrees = await listWorktrees(context);
    const brokenWorktree = worktrees.find(
      (worktree) => worktree.path === result.path,
    );

    assert.equal(brokenWorktree?.isPrunable, true);
    assert.equal(brokenWorktree?.isDirty, false);
  });
});

test("removes clean managed worktrees without deleting branches", async () => {
  await withRepo(async ({ repoRoot }) => {
    const context = await getRepoContext(repoRoot);
    const result = await createWorktree(context, "remove-test");
    const worktree = await findWorktree(context, result.path);

    await removeWorktree(context, worktree);

    const worktrees = await listWorktrees(context);
    assert.equal(
      worktrees.some((worktree) => worktree.path === result.path),
      false,
    );

    const branches = await git(repoRoot, ["branch", "--list", "remove-test"]);
    assert.match(branches.stdout, /remove-test/);
  });
});

test("removes clean external worktrees without deleting branches", async () => {
  await withRepo(async ({ parentDir, repoRoot }) => {
    const context = await getRepoContext(repoRoot);
    const externalPath = path.join(parentDir, "external-worktree");
    await git(repoRoot, ["worktree", "add", "-b", "external-test", externalPath]);
    const externalWorktree = await findWorktree(context, externalPath);

    assert.equal(externalWorktree.isManaged, false);

    await removeWorktree(context, externalWorktree);

    const worktrees = await listWorktrees(context);
    assert.equal(
      worktrees.some((worktree) => worktree.path === externalPath),
      false,
    );

    const branches = await git(repoRoot, ["branch", "--list", "external-test"]);
    assert.match(branches.stdout, /external-test/);
  });
});

test("prunes missing worktree entries", async () => {
  await withRepo(async ({ repoRoot }) => {
    const context = await getRepoContext(repoRoot);
    const result = await createWorktree(context, "prune-missing-test");
    await rm(result.path, { force: true, recursive: true });
    const staleWorktree = await findWorktree(context, result.path);

    assert.equal(staleWorktree.isPrunable, true);

    await removeWorktree(context, staleWorktree);

    const worktrees = await listWorktrees(context);
    assert.equal(
      worktrees.some((worktree) => worktree.path === result.path),
      false,
    );
  });
});

test("deletes broken worktree directories and prunes metadata", async () => {
  await withRepo(async ({ repoRoot }) => {
    const context = await getRepoContext(repoRoot);
    const result = await createWorktree(context, "delete-broken-test");
    await writeFile(path.join(result.path, ".git"), "gitdir: /tmp/missing-gitdir\n");
    const brokenWorktree = await findWorktree(context, result.path);

    assert.equal(brokenWorktree.isPrunable, true);

    await removeWorktree(context, brokenWorktree);

    const worktrees = await listWorktrees(context);
    assert.equal(
      worktrees.some((worktree) => worktree.path === result.path),
      false,
    );
  });
});

test("resolves worktree targets by branch, path, and basename", async () => {
  await withRepo(async ({ repoRoot }) => {
    const context = await getRepoContext(repoRoot);
    const result = await createWorktree(context, "feature/resolve-target");

    const branchMatch = await resolveWorktreeTarget(
      context,
      "feature/resolve-target",
      { cwd: repoRoot },
    );
    const pathMatch = await resolveWorktreeTarget(context, result.path, {
      cwd: repoRoot,
    });
    const basenameMatch = await resolveWorktreeTarget(
      context,
      path.basename(result.path),
      { cwd: repoRoot },
    );

    assert.equal(branchMatch.path, result.path);
    assert.equal(pathMatch.path, result.path);
    assert.equal(basenameMatch.path, result.path);
  });
});

test("rejects missing and ambiguous worktree targets", async () => {
  await withRepo(async ({ parentDir, repoRoot }) => {
    const context = await getRepoContext(repoRoot);
    const firstParent = path.join(parentDir, "first");
    const secondParent = path.join(parentDir, "second");
    const firstPath = path.join(firstParent, "same-name");
    const secondPath = path.join(secondParent, "same-name");

    await mkdir(firstParent);
    await mkdir(secondParent);
    await git(repoRoot, ["worktree", "add", "-b", "same-one", firstPath]);
    await git(repoRoot, ["worktree", "add", "-b", "same-two", secondPath]);

    await assert.rejects(
      resolveWorktreeTarget(context, "missing-target", { cwd: repoRoot }),
      /No worktree matches 'missing-target'/,
    );
    await assert.rejects(
      resolveWorktreeTarget(context, "same-name", { cwd: repoRoot }),
      /Ambiguous worktree basename 'same-name'/,
    );
  });
});

test("converts branch names to stable path slugs", () => {
  assert.equal(branchToSlug("feature/add tree"), "feature--add-tree");
  assert.equal(branchToSlug("release/2026.06"), "release--2026.06");
});

async function withRepo(
  callback: (fixture: RepoFixture) => Promise<void>,
): Promise<void> {
  const parentDir = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "shrubby-")),
  );
  const repoRoot = path.join(parentDir, "repo");

  try {
    await git(parentDir, ["init", "-b", "main", repoRoot]);
    await git(repoRoot, ["config", "user.email", "test@example.com"]);
    await git(repoRoot, ["config", "user.name", "Manage Tree Test"]);
    await writeFile(path.join(repoRoot, "README.md"), "# repo\n");
    await git(repoRoot, ["add", "README.md"]);
    await git(repoRoot, ["commit", "-m", "initial"]);

    await callback({ parentDir, repoRoot });
  } finally {
    await rm(parentDir, { force: true, recursive: true });
  }
}

async function findWorktree(
  context: RepoContext,
  worktreePath: string,
): Promise<WorktreeEntry> {
  const worktrees = await listWorktrees(context);
  const worktree = worktrees.find((entry) => entry.path === worktreePath);

  if (worktree === undefined) {
    throw new Error(`Expected worktree not found: ${worktreePath}`);
  }

  return worktree;
}

async function git(
  cwd: string,
  args: readonly string[],
): Promise<GitResult> {
  const { stdout, stderr } = await execFileAsync("git", [...args], { cwd });

  return { stdout, stderr };
}
