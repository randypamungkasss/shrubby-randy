#!/usr/bin/env node
import process from "node:process";
import { render } from "ink";
import { App } from "./app/app.js";
import { planTuiLaunch, runCliCommand } from "./modules/cli/service.js";

const args = process.argv.slice(2);
const launch = planTuiLaunch(args);

if (launch.kind === "error") {
  console.error(launch.message);
  console.error("Run `shrubby --help` for usage.");
  process.exit(1);
}

if (launch.kind === "cli") {
  const exitCode = await runCliCommand(args);
  process.exit(exitCode);
}

if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) {
  console.error("shrubby must be run in an interactive terminal.");
  process.exit(1);
}

const instance = render(
  <App
    initialCreateBranch={launch.create?.branch}
    shouldAutoCreate={launch.create?.autoCreate}
  />,
  {
    alternateScreen: true,
    exitOnCtrlC: true,
    interactive: true,
  },
);

await instance.waitUntilExit();
