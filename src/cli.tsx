#!/usr/bin/env node
import process from "node:process";
import { render } from "ink";
import { App } from "./app/app.js";

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error("shrubby must be run in an interactive terminal.");
  process.exit(1);
}

const instance = render(<App />, {
  alternateScreen: true,
  exitOnCtrlC: true,
  interactive: true,
});

await instance.waitUntilExit();
