import path from "node:path";
import { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { useMenuNavigation } from "../../lib/use-menu-navigation.js";
import type {
  CopyFeedback,
  CopyFeedbackViewProps,
  CreateWorktreeScreenProps,
  DeletePromptColor,
  DeleteWarningLinesProps,
  MessageScreenProps,
  RepoContext,
  UseTextInputOptions,
  VisibleEntries,
  WorktreeEntry,
  WorktreeListScreenProps,
  WorktreeRowProps,
} from "./types.js";
import { isProtectedBranch } from "./service.js";

const MAX_VISIBLE_WORKTREES = 4;

export function CreateWorktreeScreen({
  context,
  errorMessage,
  isCreating,
  onSubmit,
  result,
}: CreateWorktreeScreenProps) {
  const [branch, setBranch] = useState("");

  useTextInput({
    isEnabled: !isCreating && result === undefined,
    onChange: setBranch,
    onSubmit,
    value: branch,
  });

  return (
    <Box flexDirection="column" width={72} gap={1}>
      <Text color="cyan" bold>
        Create worktree
      </Text>

      <Box flexDirection="column">
        <Text dimColor wrap="truncate">
          Project: {context.projectName}
        </Text>
        <Text dimColor wrap="truncate">
          Base: {context.defaultBranch}
        </Text>
        <Text dimColor wrap="truncate">
          Root: {context.worktreeRoot}
        </Text>
      </Box>

      {result === undefined ? (
        <Box flexDirection="column">
          <Text>
            Branch: <Text color="cyan">{branch}</Text>
            {!isCreating ? <Text color="cyan">_</Text> : undefined}
          </Text>
          {isCreating ? <Text dimColor>Creating worktree...</Text> : undefined}
        </Box>
      ) : (
        <Box flexDirection="column">
          <Text color="green">Created worktree</Text>
          <Text wrap="truncate">Path: {result.path}</Text>
          <Text dimColor wrap="truncate">
            Branch: {result.branch} | Base: {result.baseRef} | Mode:{" "}
            {result.mode}
          </Text>
        </Box>
      )}

      {errorMessage !== undefined ? (
        <Text color="red" wrap="truncate">
          {errorMessage}
        </Text>
      ) : undefined}
    </Box>
  );
}

export function WorktreeListScreen({
  context,
  copyFeedback,
  deleteErrorMessage,
  deleteMessage,
  errorMessage,
  isDeleting,
  isLoading,
  onCopy,
  onDelete,
  title = "Worktrees",
  worktrees,
}: WorktreeListScreenProps) {
  const [deleteTargetPath, setDeleteTargetPath] = useState<string | undefined>();
  const { selectedIndex } = useMenuNavigation({
    isEnabled: !isDeleting && deleteTargetPath === undefined,
    itemCount: worktrees.length,
  });
  const selectedWorktree = worktrees[selectedIndex];
  const deleteTargetWorktree = worktrees.find(
    (worktree) => worktree.path === deleteTargetPath,
  );
  const visibleWorktrees = getVisibleEntries(worktrees, selectedIndex);

  useInput((input, key) => {
    if (isDeleting) {
      return;
    }

    if (deleteTargetWorktree !== undefined) {
      if (
        input.toLowerCase() === "y" &&
        canDeleteWorktree(context, deleteTargetWorktree)
      ) {
        onDelete?.(deleteTargetWorktree);
        setDeleteTargetPath(undefined);
        return;
      }

      if (input.toLowerCase() === "n" || key.return) {
        setDeleteTargetPath(undefined);
      }

      return;
    }

    if (input === "c" && selectedWorktree !== undefined) {
      onCopy?.(selectedWorktree);
      return;
    }

    if (input === "d" && selectedWorktree !== undefined) {
      setDeleteTargetPath(selectedWorktree.path);
    }
  });

  return (
    <Box flexDirection="column" width={82} gap={1}>
      <Text color="cyan" bold>
        {title}
      </Text>

      {isLoading ? <Text dimColor>Loading worktrees...</Text> : undefined}
      {errorMessage !== undefined ? (
        <Text color="red" wrap="truncate">
          {errorMessage}
        </Text>
      ) : undefined}
      <CopyFeedbackView feedback={copyFeedback} />
      {isDeleting ? <Text dimColor>Deleting worktree...</Text> : undefined}
      {deleteMessage !== undefined ? (
        <Text color="green" wrap="truncate">
          {deleteMessage}
        </Text>
      ) : undefined}
      {deleteErrorMessage !== undefined ? (
        <Text color="red" wrap="truncate">
          {deleteErrorMessage}
        </Text>
      ) : undefined}
      {!isLoading && worktrees.length === 0 ? (
        <Text dimColor>No worktrees found.</Text>
      ) : undefined}
      {worktrees.length > 0 ? (
        <Text dimColor>
          Showing {visibleWorktrees.start + 1}-{visibleWorktrees.end} of{" "}
          {worktrees.length}
        </Text>
      ) : undefined}

      <Box flexDirection="column" gap={1}>
        {visibleWorktrees.entries.map(({ index, item: worktree }) => (
          <WorktreeRow
            key={worktree.path}
            isSelected={
              deleteTargetPath === undefined
                ? selectedIndex === index
                : deleteTargetPath === worktree.path
            }
            worktree={worktree}
          />
        ))}
      </Box>

      {deleteTargetWorktree !== undefined ? (
        <Box flexDirection="column">
          {canDeleteWorktree(context, deleteTargetWorktree) ? (
            <Text color={getDeletePromptColor(context, deleteTargetWorktree)}>
              {deleteTargetWorktree.isPrunable ? "Prune" : "Delete"}{" "}
              {displayPath(deleteTargetWorktree.path)}? y/N
            </Text>
          ) : (
            <Text color="yellow" wrap="truncate">
              Cannot delete {displayPath(deleteTargetWorktree.path)}
            </Text>
          )}
          <DeleteWarningLines context={context} worktree={deleteTargetWorktree} />
        </Box>
      ) : selectedWorktree !== undefined ? (
        <Text dimColor wrap="truncate">
          c copy | d delete | Selected: {displayPath(selectedWorktree.path)}
        </Text>
      ) : undefined}
    </Box>
  );
}

function canDeleteWorktree(context: RepoContext, worktree: WorktreeEntry): boolean {
  return !worktree.isCurrent && !isProtectedBranch(context, worktree) && !worktree.isDirty;
}

function DeleteWarningLines({
  context,
  worktree,
}: DeleteWarningLinesProps) {
  return (
    <Box flexDirection="column">
      {worktree.isCurrent ? (
        <Text color="yellow" wrap="truncate">
          The current checkout cannot be deleted from itself.
        </Text>
      ) : undefined}
      {isProtectedBranch(context, worktree) ? (
        <Text color="yellow" wrap="truncate">
          Protected branch '{context.protectedBranch}' cannot be deleted.
        </Text>
      ) : undefined}
      {worktree.isDirty ? (
        <Text color="yellow" wrap="truncate">
          This worktree is dirty; deletion will be blocked until it is clean.
        </Text>
      ) : undefined}
      {worktree.isPrunable ? (
        <Text color="yellow" wrap="truncate">
          Stale worktree metadata will be pruned.
        </Text>
      ) : undefined}
      {!worktree.isManaged && !worktree.isCurrent && !worktree.isPrunable ? (
        <Text color="yellow" wrap="truncate">
          This external worktree path will be deleted.
        </Text>
      ) : undefined}
    </Box>
  );
}

function getDeletePromptColor(
  context: RepoContext,
  worktree: WorktreeEntry,
): DeletePromptColor {
  return worktree.isCurrent ||
    isProtectedBranch(context, worktree) ||
    worktree.isDirty ||
    worktree.isPrunable ||
    !worktree.isManaged
    ? "yellow"
    : "cyan";
}

export function MessageScreen({ color = "cyan", detail, title }: MessageScreenProps) {
  return (
    <Box flexDirection="column" width={72} gap={1}>
      <Text color={color} bold>
        {title}
      </Text>
      {detail !== undefined ? (
        <Text dimColor wrap="wrap">
          {detail}
        </Text>
      ) : undefined}
    </Box>
  );
}

function CopyFeedbackView({ feedback }: CopyFeedbackViewProps) {
  if (feedback === undefined) {
    return undefined;
  }

  if (
    feedback.isCopying !== true &&
    feedback.message === undefined &&
    feedback.warningMessage === undefined &&
    feedback.errorMessage === undefined
  ) {
    return undefined;
  }

  return (
    <Box flexDirection="column">
      {feedback.isCopying === true ? (
        <Text dimColor>Copying path...</Text>
      ) : undefined}
      {feedback.message !== undefined ? (
        <Text color="green" wrap="truncate">
          {feedback.message}
        </Text>
      ) : undefined}
      {feedback.warningMessage !== undefined ? (
        <Text color="yellow" wrap="truncate">
          {feedback.warningMessage}
        </Text>
      ) : undefined}
      {feedback.errorMessage !== undefined ? (
        <Text color="red" wrap="truncate">
          {feedback.errorMessage}
        </Text>
      ) : undefined}
    </Box>
  );
}

function WorktreeRow({ isSelected, worktree }: WorktreeRowProps) {
  const branch = worktree.branch ?? "(detached)";
  const state = worktree.isPrunable ? "missing" : worktree.isDirty ? "dirty" : "clean";
  const scope = worktree.isCurrent
    ? "current"
    : worktree.isManaged
      ? "managed"
      : "external";

  return (
    <Box flexDirection="column">
      <Text color={isSelected ? "cyan" : undefined} bold={isSelected}>
        {isSelected ? "> " : "  "}
        {branch} [{scope}, {state}]
      </Text>
      <Text dimColor wrap="truncate">
        {"     "}
        {displayPath(worktree.path)}
      </Text>
    </Box>
  );
}

function useTextInput({
  isEnabled,
  onChange,
  onSubmit,
  value,
}: UseTextInputOptions): void {
  useInput((input, key) => {
    if (!isEnabled) {
      return;
    }

    if (key.return) {
      onSubmit(value);
      return;
    }

    if (key.backspace || key.delete) {
      onChange(value.slice(0, -1));
      return;
    }

    if (input.length > 0 && !key.ctrl && !key.meta) {
      onChange(value + input);
    }
  });
}

function displayPath(worktreePath: string): string {
  const home = process.env.HOME;

  if (home !== undefined) {
    const relativeToHome = path.relative(home, worktreePath);

    if (!relativeToHome.startsWith("..") && !path.isAbsolute(relativeToHome)) {
      return path.join("~", relativeToHome);
    }
  }

  return worktreePath;
}

function getVisibleEntries<T>(
  items: readonly T[],
  selectedIndex: number,
): VisibleEntries<T> {
  if (items.length <= MAX_VISIBLE_WORKTREES) {
    return {
      entries: items.map((item, index) => ({ index, item })),
      end: items.length,
      start: 0,
    };
  }

  const halfWindow = Math.floor(MAX_VISIBLE_WORKTREES / 2);
  const maxStart = Math.max(0, items.length - MAX_VISIBLE_WORKTREES);
  const start = Math.min(Math.max(0, selectedIndex - halfWindow), maxStart);
  const end = Math.min(items.length, start + MAX_VISIBLE_WORKTREES);

  return {
    entries: items.slice(start, end).map((item, offset) => ({
      index: start + offset,
      item,
    })),
    end,
    start,
  };
}
