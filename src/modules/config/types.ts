export type ShrubbyConfig = {
  readonly copyOnCreate?: boolean;
  readonly defaultBaseRef?: string;
  readonly editorCommand?: string;
  readonly fetchBeforeCreate?: boolean;
  readonly protectedBranches?: readonly string[];
  readonly worktreeRoot?: string;
};

export type ResolvedShrubbyConfig = {
  readonly copyOnCreate: boolean;
  readonly defaultBaseRef: string;
  readonly editorCommand?: string;
  readonly fetchBeforeCreate: boolean;
  readonly protectedBranches: readonly string[];
  readonly worktreeRoot: string;
};

export type LoadShrubbyConfigOptions = {
  readonly homeDir?: string;
};
