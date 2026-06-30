import { spawn } from "node:child_process";
import type {
  CopyCommandCandidate,
  CopyFailure,
  CopyMethod,
  CopyPathOptions,
  CopyPathResult,
  RunCommand,
  RunCommandOptions,
  TryCopyOptions,
} from "./types.js";

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
    platform = process.platform,
    runCommand = runCommandDefault,
  }: CopyPathOptions = {},
): Promise<CopyPathResult> {
  const copiedTo: CopyMethod[] = [];
  const failures: CopyFailure[] = [];
  const candidates = getCopyCommandCandidates(targetPath, env, platform);

  for (const candidate of candidates) {
    await tryCopy({
      args: candidate.args,
      command: candidate.command,
      copiedTo,
      failures,
      input: candidate.input,
      method: candidate.method,
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

function getCopyCommandCandidates(
  targetPath: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): readonly CopyCommandCandidate[] {
  const candidates: CopyCommandCandidate[] = [];

  if (platform === "darwin") {
    candidates.push({
      args: [],
      command: "pbcopy",
      input: targetPath,
      method: "pbcopy",
    });
  }

  if (platform === "linux") {
    if (env.WAYLAND_DISPLAY !== undefined && env.WAYLAND_DISPLAY.length > 0) {
      candidates.push({
        args: [],
        command: "wl-copy",
        input: targetPath,
        method: "wl-copy",
      });
    }

    if (env.DISPLAY !== undefined && env.DISPLAY.length > 0) {
      candidates.push(
        {
          args: ["-selection", "clipboard"],
          command: "xclip",
          input: targetPath,
          method: "xclip",
        },
        {
          args: ["--clipboard", "--input"],
          command: "xsel",
          input: targetPath,
          method: "xsel",
        },
      );
    }
  }

  if (platform === "win32" || isWsl(env)) {
    candidates.push(
      {
        args: [],
        command: "clip.exe",
        input: targetPath,
        method: "clip.exe",
      },
      {
        args: ["-NoProfile", "-Command", "$input | Set-Clipboard"],
        command: "powershell.exe",
        input: targetPath,
        method: "powershell.exe",
      },
    );
  }

  if (env.TMUX !== undefined && env.TMUX.length > 0) {
    candidates.push({
      args: ["set-buffer", "-w", targetPath],
      command: "tmux",
      method: "tmux",
    });
  }

  return candidates;
}

function isWsl(env: NodeJS.ProcessEnv): boolean {
  return (
    (env.WSL_DISTRO_NAME !== undefined && env.WSL_DISTRO_NAME.length > 0) ||
    (env.WSL_INTEROP !== undefined && env.WSL_INTEROP.length > 0)
  );
}

async function tryCopy({
  args,
  command,
  copiedTo,
  failures,
  input,
  method,
  runCommand,
}: TryCopyOptions): Promise<void> {
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
