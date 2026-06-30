import test from "node:test";
import assert from "node:assert/strict";
import { CopyPathError, copyPath } from "./service.js";
import type {
  CommandCall,
  CreateRunnerOptions,
  RunCommandOptions,
} from "./types.js";

test("copies to pbcopy by default", async () => {
  const calls: CommandCall[] = [];
  const result = await copyPath("/tmp/repo", {
    env: {},
    runCommand: createRunner({ calls }),
  });

  assert.deepEqual(result.copiedTo, ["pbcopy"]);
  assert.deepEqual(result.failures, []);
  assert.deepEqual(calls, [
    {
      args: [],
      command: "pbcopy",
      input: "/tmp/repo",
    },
  ]);
});

test("copies to pbcopy and tmux when inside tmux", async () => {
  const calls: CommandCall[] = [];
  const result = await copyPath("/tmp/repo", {
    env: { TMUX: "/tmp/tmux" },
    runCommand: createRunner({ calls }),
  });

  assert.deepEqual(result.copiedTo, ["pbcopy", "tmux"]);
  assert.deepEqual(calls, [
    {
      args: [],
      command: "pbcopy",
      input: "/tmp/repo",
    },
    {
      args: ["set-buffer", "-w", "/tmp/repo"],
      command: "tmux",
      input: undefined,
    },
  ]);
});

test("succeeds when tmux copy works and pbcopy fails", async () => {
  const result = await copyPath("/tmp/repo", {
    env: { TMUX: "/tmp/tmux" },
    runCommand: createRunner({
      failures: {
        pbcopy: new Error("pbcopy missing"),
      },
    }),
  });

  assert.deepEqual(result.copiedTo, ["tmux"]);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0]?.method, "pbcopy");
});

test("fails when every copy destination fails", async () => {
  await assert.rejects(
    copyPath("/tmp/repo", {
      env: { TMUX: "/tmp/tmux" },
      runCommand: createRunner({
        failures: {
          pbcopy: new Error("pbcopy missing"),
          tmux: new Error("tmux unavailable"),
        },
      }),
    }),
    (error) => {
      assert.equal(error instanceof CopyPathError, true);
      assert.match((error as Error).message, /pbcopy missing/);
      assert.match((error as Error).message, /tmux unavailable/);
      return true;
    },
  );
});

function createRunner({
  calls = [],
  failures = {},
}: CreateRunnerOptions = {}) {
  return async (
    command: string,
    args: readonly string[],
    options: RunCommandOptions = {},
  ): Promise<void> => {
    calls.push({
      args: [...args],
      command,
      input: options.input,
    });

    const failure = failures[command];

    if (failure !== undefined) {
      throw failure;
    }
  };
}
