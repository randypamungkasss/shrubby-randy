export type RepoContext = {
  readonly repoRoot: string;
  readonly projectName: string;
  readonly protectedBranch: string;
  readonly worktreeRoot: string;
  readonly defaultBranch: string;
};

export type WorktreeEntry = {
  readonly path: string;
  readonly branch: string | undefined;
  readonly head: string | undefined;
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
  readonly isDirty: boolean;
  readonly isPrunable: boolean;
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
  readonly context: RepoContext;
  readonly errorMessage?: string;
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
  readonly onDelete?: (worktree: WorktreeEntry) => void;
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
