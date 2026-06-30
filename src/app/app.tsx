import { useEffect, useState } from "react";
import { useWindowSize } from "ink";
import { FullscreenFrame } from "../components/fullscreen-frame.js";
import { MainMenu, type MainMenuItem } from "../modules/main-menu/view.js";
import {
  CopyPathError,
  copyPath,
  type CopyPathResult,
} from "../modules/clipboard/service.js";
import {
  createWorktree,
  getRepoContext,
  listWorktrees,
  removeWorktree,
  type CreateWorktreeResult,
  type RepoContext,
  type WorktreeEntry,
} from "../modules/worktree/service.js";
import {
  CreateWorktreeScreen,
  MessageScreen,
  WorktreeListScreen,
  type CopyFeedback,
} from "../modules/worktree/view.js";
import { useExitKeys } from "./use-exit-keys.js";

type Screen = "menu" | "create" | "list";

type RepoState =
  | {
      readonly status: "loading";
    }
  | {
      readonly status: "error";
      readonly message: string;
    }
  | {
      readonly status: "ready";
      readonly context: RepoContext;
      readonly worktrees: readonly WorktreeEntry[];
    };

type CreateState = {
  readonly errorMessage?: string;
  readonly isCreating: boolean;
  readonly result?: CreateWorktreeResult;
};

type RemoveState = {
  readonly errorMessage?: string;
  readonly isRemoving: boolean;
  readonly message?: string;
};

type CopyState = CopyFeedback;

export function App() {
  const { columns, rows } = useWindowSize();
  const [screen, setScreen] = useState<Screen>("menu");
  const [repoState, setRepoState] = useState<RepoState>({ status: "loading" });
  const [statusMessage, setStatusMessage] = useState<string | undefined>();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [createState, setCreateState] = useState<CreateState>({
    isCreating: false,
  });
  const [removeState, setRemoveState] = useState<RemoveState>({
    isRemoving: false,
  });
  const [copyState, setCopyState] = useState<CopyState>({
    isCopying: false,
  });

  useEffect(() => {
    void loadRepo();
  }, []);

  useExitKeys({
    onEscape:
      screen === "menu"
        ? undefined
        : () => {
            setScreen("menu");
            setCreateState({ isCreating: false });
            setRemoveState({ isRemoving: false });
            setCopyState({ isCopying: false });
          },
  });

  const footer = getFooter(repoState.status, screen);

  return (
    <FullscreenFrame columns={columns} rows={rows} footer={footer}>
      {repoState.status === "loading" ? (
        <MessageScreen title="Loading repository" detail="Reading git context..." />
      ) : repoState.status === "error" ? (
        <MessageScreen
          color="yellow"
          title={getRepoErrorTitle(repoState.message)}
          detail={repoState.message}
        />
      ) : screen === "menu" ? (
        <MainMenu
          context={repoState.context}
          onChoose={(item) => {
            void handleMenuChoose(item, repoState.context);
          }}
          statusMessage={statusMessage}
        />
      ) : screen === "create" ? (
        <CreateWorktreeScreen
          context={repoState.context}
          errorMessage={createState.errorMessage}
          isCreating={createState.isCreating}
          onSubmit={(branch) => {
            void handleCreate(repoState.context, branch);
          }}
          result={createState.result}
        />
      ) : (
        <WorktreeListScreen
          copyFeedback={copyState}
          context={repoState.context}
          deleteErrorMessage={removeState.errorMessage}
          deleteMessage={removeState.message}
          errorMessage={undefined}
          isDeleting={removeState.isRemoving}
          isLoading={isRefreshing}
          onCopy={(worktree) => {
            void handleCopy(worktree);
          }}
          onDelete={(worktree) => {
            void handleRemove(repoState.context, worktree);
          }}
          worktrees={repoState.worktrees}
        />
      )}
    </FullscreenFrame>
  );

  async function loadRepo(nextStatusMessage?: string): Promise<void> {
    setRepoState({ status: "loading" });
    setStatusMessage(undefined);

    try {
      const context = await getRepoContext();
      const worktrees = await listWorktrees(context);

      setRepoState({
        status: "ready",
        context,
        worktrees,
      });
      setStatusMessage(nextStatusMessage);
    } catch (error) {
      setRepoState({
        status: "error",
        message: getErrorMessage(error),
      });
    }
  }

  async function refreshWorktrees(
    context: RepoContext,
    nextStatusMessage?: string,
  ): Promise<void> {
    setIsRefreshing(true);
    setStatusMessage(undefined);

    try {
      const worktrees = await listWorktrees(context);

      setRepoState((state) =>
        state.status === "ready"
          ? {
              ...state,
              worktrees,
            }
          : state,
      );
      setStatusMessage(nextStatusMessage);
    } catch (error) {
      setStatusMessage(getErrorMessage(error));
    } finally {
      setIsRefreshing(false);
    }
  }

  async function handleMenuChoose(
    item: MainMenuItem,
    context: RepoContext,
  ): Promise<void> {
    setStatusMessage(undefined);
    setCreateState({ isCreating: false });
    setRemoveState({ isRemoving: false });
    setCopyState({ isCopying: false });

    if (item.id === "refresh") {
      await loadRepo("Refreshed repository state.");
      setScreen("menu");
      return;
    }

    if (item.id === "create") {
      setScreen("create");
      return;
    }

    if (item.id === "list") {
      setScreen("list");
      await refreshWorktrees(context);
      return;
    }
  }

  async function handleCreate(
    context: RepoContext,
    branch: string,
  ): Promise<void> {
    if (createState.isCreating) {
      return;
    }

    setCreateState({ isCreating: true });

    try {
      const result = await createWorktree(context, branch);
      const worktrees = await listWorktrees(context);

      setRepoState((state) =>
        state.status === "ready"
          ? {
              ...state,
              worktrees,
            }
          : state,
      );
      setCreateState({
        isCreating: false,
        result,
      });
      setStatusMessage(`Created ${result.branch}.`);
    } catch (error) {
      setCreateState({
        errorMessage: getErrorMessage(error),
        isCreating: false,
      });
    }
  }

  async function handleRemove(
    context: RepoContext,
    worktree: WorktreeEntry,
  ): Promise<void> {
    if (removeState.isRemoving) {
      return;
    }

    setRemoveState({ isRemoving: true });

    try {
      await removeWorktree(context, worktree);
      const worktrees = await listWorktrees(context);

      setRepoState((state) =>
        state.status === "ready"
          ? {
              ...state,
              worktrees,
            }
          : state,
      );
      const message = worktree.isPrunable
        ? `Pruned ${worktree.branch ?? worktree.path}.`
        : `Deleted ${worktree.branch ?? worktree.path}.`;

      setRemoveState({ isRemoving: false, message });
      setStatusMessage(message);
    } catch (error) {
      setRemoveState({
        errorMessage: getErrorMessage(error),
        isRemoving: false,
      });
    }
  }

  async function handleCopy(worktree: WorktreeEntry): Promise<void> {
    if (copyState.isCopying === true) {
      return;
    }

    setCopyState({ isCopying: true });

    try {
      const result = await copyPath(worktree.path);
      const message = formatCopySuccess(result);

      setCopyState({
        isCopying: false,
        message,
        warningMessage: formatCopyWarning(result),
      });
      setStatusMessage(message);
    } catch (error) {
      setCopyState({
        errorMessage: getCopyErrorMessage(error),
        isCopying: false,
      });
    }
  }
}

function getFooter(repoStatus: RepoState["status"], screen: Screen): string {
  if (repoStatus !== "ready") {
    return "q / Esc exit | shrubby";
  }

  if (screen === "create") {
    return "Type branch | Enter create | Esc back | q exit | shrubby";
  }

  if (screen === "list") {
    return "Up/Down | c copy | d delete | y/N confirm | Esc back | q exit";
  }

  return "Up/Down select | Enter choose | q / Esc exit | shrubby";
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getRepoErrorTitle(message: string): string {
  return message.includes("Git executable")
    ? "Git unavailable"
    : "Not a git repository";
}

function getCopyErrorMessage(error: unknown): string {
  if (error instanceof CopyPathError) {
    return error.message;
  }

  return getErrorMessage(error);
}

function formatCopySuccess(result: CopyPathResult): string {
  return `Copied ${result.path} via ${result.copiedTo.join(", ")}.`;
}

function formatCopyWarning(result: CopyPathResult): string | undefined {
  if (result.failures.length === 0) {
    return undefined;
  }

  return `Failed: ${result.failures
    .map((failure) => `${failure.method}: ${failure.message}`)
    .join("; ")}`;
}
