export type CopyMethod = "pbcopy" | "tmux";

export type CopyFailure = {
  readonly method: CopyMethod;
  readonly message: string;
};

export type CopyPathResult = {
  readonly path: string;
  readonly copiedTo: readonly CopyMethod[];
  readonly failures: readonly CopyFailure[];
};

export type RunCommandOptions = {
  readonly input?: string;
};

export type RunCommand = (
  command: string,
  args: readonly string[],
  options?: RunCommandOptions,
) => Promise<void>;

export type CopyPathOptions = {
  readonly env?: NodeJS.ProcessEnv;
  readonly runCommand?: RunCommand;
};

export type TryCopyOptions = {
  readonly args: readonly string[];
  readonly command: string;
  readonly copiedTo: CopyMethod[];
  readonly failures: CopyFailure[];
  readonly input?: string;
  readonly method: CopyMethod;
  readonly runCommand: RunCommand;
};

export type CommandCall = {
  readonly args: readonly string[];
  readonly command: string;
  readonly input: string | undefined;
};

export type CreateRunnerOptions = {
  readonly calls?: CommandCall[];
  readonly failures?: Partial<Record<string, Error>>;
};
