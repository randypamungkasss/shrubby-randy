#!/usr/bin/env node
import process from "node:process";
import { render } from "ink";
import { App } from "./app/app.js";
import { runCliCommand, shouldLaunchTui } from "./modules/cli/service.js";

const args = process.argv.slice(2);

if (!shouldLaunchTui(args)) {
  const exitCode = await runCliCommand(args);
  process.exit(exitCode);
}

if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) {
  console.error("shrubby must be run in an interactive terminal.");
  process.exit(1);
}

const instance = render(<App />, {
  alternateScreen: true,
  exitOnCtrlC: true,
  interactive: true,
});

await instance.waitUntilExit();
