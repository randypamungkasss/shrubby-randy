import { spawn } from "node:child_process";

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

type RunCommandOptions = {
  readonly input?: string;
};

type RunCommand = (
  command: string,
  args: readonly string[],
  options?: RunCommandOptions,
) => Promise<void>;

type CopyPathOptions = {
  readonly env?: NodeJS.ProcessEnv;
  readonly runCommand?: RunCommand;
};

export class CopyPathError extends Error {
  readonly result: CopyPathResult;

  constructor(result: CopyPathResult) {
    super(formatCopyError(result.failures));
    this.name = "CopyPathError";
    this.result = result;
  }
}

export async function copyPath(
  targetPath: string,
  {
    env = process.env,
    runCommand = runCommandDefault,
  }: CopyPathOptions = {},
): Promise<CopyPathResult> {
  const copiedTo: CopyMethod[] = [];
  const failures: CopyFailure[] = [];

  await tryCopy({
    args: [],
    command: "pbcopy",
    copiedTo,
    failures,
    input: targetPath,
    method: "pbcopy",
    runCommand,
  });

  if (env.TMUX !== undefined && env.TMUX.length > 0) {
    await tryCopy({
      args: ["set-buffer", "-w", targetPath],
      command: "tmux",
      copiedTo,
      failures,
      method: "tmux",
      runCommand,
    });
  }

  const result: CopyPathResult = {
    path: targetPath,
    copiedTo,
    failures,
  };

  if (copiedTo.length === 0) {
    throw new CopyPathError(result);
  }

  return result;
}

async function tryCopy({
  args,
  command,
  copiedTo,
  failures,
  input,
  method,
  runCommand,
}: {
  readonly args: readonly string[];
  readonly command: string;
  readonly copiedTo: CopyMethod[];
  readonly failures: CopyFailure[];
  readonly input?: string;
  readonly method: CopyMethod;
  readonly runCommand: RunCommand;
}): Promise<void> {
  try {
    await runCommand(command, args, { input });
    copiedTo.push(method);
  } catch (error) {
    failures.push({
      method,
      message: getErrorMessage(error),
    });
  }
}

function runCommandDefault(
  command: string,
  args: readonly string[],
  options: RunCommandOptions = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
      stdio: ["pipe", "ignore", "pipe"],
    });
    const stderrChunks: Buffer[] = [];

    child.stderr.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
      reject(
        new Error(stderr.length > 0 ? stderr : `${command} exited with ${code}`),
      );
    });

    child.stdin.end(options.input ?? "");
  });
}

function formatCopyError(failures: readonly CopyFailure[]): string {
  if (failures.length === 0) {
    return "Could not copy path.";
  }

  return `Could not copy path: ${failures
    .map((failure) => `${failure.method}: ${failure.message}`)
    .join("; ")}`;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
