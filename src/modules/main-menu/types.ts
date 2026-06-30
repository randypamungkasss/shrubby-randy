import type { RepoContext } from "../worktree/types.js";

export type MainMenuItemId = "create" | "list" | "refresh";

export type MainMenuItem = {
  readonly id: MainMenuItemId;
  readonly label: string;
  readonly description: string;
};

export type MainMenuProps = {
  readonly context: RepoContext;
  readonly onChoose: (item: MainMenuItem) => void;
  readonly statusMessage?: string;
};
