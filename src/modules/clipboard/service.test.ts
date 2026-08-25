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
    platform: "darwin",
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
    platform: "darwin",
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
    platform: "darwin",
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

test("uses wl-copy without trying X11 fallbacks", async () => {
  const calls: CommandCall[] = [];
  const result = await copyPath("/tmp/repo", {
    env: { DISPLAY: ":0", WAYLAND_DISPLAY: "wayland-0" },
    platform: "linux",
    runCommand: createRunner({ calls }),
  });

  assert.deepEqual(result.copiedTo, ["wl-copy"]);
  assert.deepEqual(result.failures, []);
  assert.deepEqual(calls, [
    {
      args: [],
      command: "wl-copy",
      input: "/tmp/repo",
    },
  ]);
});

test("falls back from wl-copy to xclip without warning", async () => {
  const calls: CommandCall[] = [];
  const result = await copyPath("/tmp/repo", {
    env: { DISPLAY: ":0", WAYLAND_DISPLAY: "wayland-0" },
    platform: "linux",
    runCommand: createRunner({
      calls,
      failures: {
        "wl-copy": new Error("wl-copy unavailable"),
      },
    }),
  });

  assert.deepEqual(result.copiedTo, ["xclip"]);
  assert.deepEqual(result.failures, []);
  assert.deepEqual(calls, [
    {
      args: [],
      command: "wl-copy",
      input: "/tmp/repo",
    },
    {
      args: ["-selection", "clipboard"],
      command: "xclip",
      input: "/tmp/repo",
    },
  ]);
});

test("falls back from xclip to xsel without warning", async () => {
  const calls: CommandCall[] = [];
  const result = await copyPath("/tmp/repo", {
    env: { DISPLAY: ":0" },
    platform: "linux",
    runCommand: createRunner({
      calls,
      failures: {
        xclip: new Error("xclip unavailable"),
      },
    }),
  });

  assert.deepEqual(result.copiedTo, ["xsel"]);
  assert.deepEqual(result.failures, []);
  assert.deepEqual(calls, [
    {
      args: ["-selection", "clipboard"],
      command: "xclip",
      input: "/tmp/repo",
    },
    {
      args: ["--clipboard", "--input"],
      command: "xsel",
      input: "/tmp/repo",
    },
  ]);
});

test("reports every Linux clipboard failure when no fallback works", async () => {
  await assert.rejects(
    copyPath("/tmp/repo", {
      env: { DISPLAY: ":0", WAYLAND_DISPLAY: "wayland-0" },
      platform: "linux",
      runCommand: createRunner({
        failures: {
          "wl-copy": new Error("wl-copy unavailable"),
          xclip: new Error("xclip unavailable"),
          xsel: new Error("xsel unavailable"),
        },
      }),
    }),
    (error) => {
      assert.equal(error instanceof CopyPathError, true);
      assert.match((error as Error).message, /wl-copy unavailable/);
      assert.match((error as Error).message, /xclip unavailable/);
      assert.match((error as Error).message, /xsel unavailable/);
      return true;
    },
  );
});

test("copies to Windows clipboard tools on Windows", async () => {
  const calls: CommandCall[] = [];
  const result = await copyPath("/tmp/repo", {
    env: {},
    platform: "win32",
    runCommand: createRunner({ calls }),
  });

  assert.deepEqual(result.copiedTo, ["clip.exe", "powershell.exe"]);
  assert.deepEqual(calls, [
    {
      args: [],
      command: "clip.exe",
      input: "/tmp/repo",
    },
    {
      args: ["-NoProfile", "-Command", "$input | Set-Clipboard"],
      command: "powershell.exe",
      input: "/tmp/repo",
    },
  ]);
});

test("copies to Windows clipboard tools in WSL", async () => {
  const calls: CommandCall[] = [];
  const result = await copyPath("/tmp/repo", {
    env: { WSL_DISTRO_NAME: "Ubuntu" },
    platform: "linux",
    runCommand: createRunner({ calls }),
  });

  assert.deepEqual(result.copiedTo, ["clip.exe", "powershell.exe"]);
  assert.deepEqual(calls.map((call) => call.command), [
    "clip.exe",
    "powershell.exe",
  ]);
});

test("fails when every copy destination fails", async () => {
  await assert.rejects(
    copyPath("/tmp/repo", {
      env: { TMUX: "/tmp/tmux" },
      platform: "darwin",
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
