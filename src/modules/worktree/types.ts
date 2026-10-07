import type { ResolvedShrubbyConfig } from "../config/types.js";

export type RepoContext = {
  readonly config: ResolvedShrubbyConfig;
  readonly repoRoot: string;
  readonly projectName: string;
  readonly protectedBranch: string;
  readonly protectedBranches: readonly string[];
  readonly suggestedBranch: string | undefined;
  readonly worktreeRoot: string;
  readonly defaultBranch: string;
};

export type GetRepoContextOptions = {
  readonly homeDir?: string;
  readonly now?: Date;
};

export type WorktreeEntry = {
  readonly path: string;
  readonly branch: string | undefined;
  readonly head: string | undefined;
  readonly upstream: string | undefined;
  readonly ahead: number | undefined;
  readonly behind: number | undefined;
  readonly lastCommit: WorktreeLastCommit | undefined;
  readonly isCurrent: boolean;
  readonly isManaged: boolean;
  readonly isDirty: boolean;
  readonly isPrunable: boolean;
};

export type CreateWorktreeResult = {
  readonly path: string;
  readonly branch: string;
  readonly baseRef: string;
  readonly mode: "existing-local" | "existing-remote" | "new-branch";
};

export type GitResult = {
  readonly stdout: string;
  readonly stderr: string;
};

export type ParsedWorktree = {
  readonly path: string;
  readonly branch: string | undefined;
  readonly head: string | undefined;
  readonly isPrunable: boolean;
};

export type WorktreeState = {
  readonly ahead: number | undefined;
  readonly behind: number | undefined;
  readonly isDirty: boolean;
  readonly isPrunable: boolean;
  readonly lastCommit: WorktreeLastCommit | undefined;
  readonly upstream: string | undefined;
};

export type WorktreeLastCommit = {
  readonly date: string;
  readonly hash: string;
  readonly subject: string;
};

export type CreateWorktreeOptions = {
  readonly fetch?: boolean;
};

export type RemoveWorktreeOptions = {
  readonly forceDirty?: boolean;
};

export type CleanupReason = "merged" | "stale";

export type CleanupEntry = {
  readonly action: "prune" | "remove";
  readonly reason: CleanupReason;
  readonly worktree: WorktreeEntry;
};

export type CleanupWorktreesOptions = {
  readonly dryRun?: boolean;
  readonly includeMerged?: boolean;
  readonly includeStale?: boolean;
};

export type CleanupWorktreesResult = {
  readonly dryRun: boolean;
  readonly entries: readonly CleanupEntry[];
  readonly removed: boolean;
};

export type ResolveWorktreeTargetOptions = {
  readonly cwd?: string;
  readonly worktrees?: readonly WorktreeEntry[];
};

export type GitCommandFailure = Error & {
  readonly code?: string;
  readonly stderr?: string;
  readonly stdout?: string;
};

export type CommandNotFoundFailure = {
  readonly code?: unknown;
  readonly path?: unknown;
  readonly syscall?: unknown;
};

export type CreateWorktreeScreenProps = {
  readonly copyFeedback?: CopyFeedback;
  readonly context: RepoContext;
  readonly errorMessage?: string;
  readonly initialBranch?: string;
  readonly isCreating: boolean;
  readonly onSubmit: (branch: string) => void;
  readonly result?: CreateWorktreeResult;
};

export type CopyFeedback = {
  readonly errorMessage?: string;
  readonly isCopying?: boolean;
  readonly message?: string;
  readonly warningMessage?: string;
};

export type WorktreeListScreenProps = {
  readonly context: RepoContext;
  readonly copyFeedback?: CopyFeedback;
  readonly deleteErrorMessage?: string;
  readonly deleteMessage?: string;
  readonly errorMessage?: string;
  readonly isDeleting: boolean;
  readonly isLoading: boolean;
  readonly onCopy?: (worktree: WorktreeEntry) => void;
  readonly onDelete?: (
    worktree: WorktreeEntry,
    options?: RemoveWorktreeOptions,
  ) => void;
  readonly title?: string;
  readonly worktrees: readonly WorktreeEntry[];
};

export type DeleteWarningLinesProps = {
  readonly context: RepoContext;
  readonly worktree: WorktreeEntry;
};

export type DeletePromptColor = "cyan" | "yellow";

export type MessageScreenProps = {
  readonly color?: "cyan" | "red" | "yellow";
  readonly detail?: string;
  readonly title: string;
};

export type CopyFeedbackViewProps = {
  readonly feedback?: CopyFeedback;
};

export type WorktreeRowProps = {
  readonly isSelected: boolean;
  readonly worktree: WorktreeEntry;
};

export type UseTextInputOptions = {
  readonly isEnabled: boolean;
  readonly onChange: (value: string) => void;
  readonly onSubmit: (value: string) => void;
  readonly value: string;
};

export type VisibleEntry<T> = {
  readonly index: number;
  readonly item: T;
};

export type VisibleEntries<T> = {
  readonly entries: readonly VisibleEntry<T>[];
  readonly end: number;
  readonly start: number;
};

export type RepoFixture = {
  readonly parentDir: string;
  readonly repoRoot: string;
};
