import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  LoadShrubbyConfigOptions,
  ShrubbyConfig,
} from "./types.js";

const CONFIG_FILE_NAME = ".shrubby.json";

export async function loadShrubbyConfig(
  repoRoot: string,
  { homeDir = getHomeDir() }: LoadShrubbyConfigOptions = {},
): Promise<ShrubbyConfig> {
  const userConfigPath =
    homeDir === undefined
      ? undefined
      : path.join(homeDir, ".config", "shrubby", "config.json");
  const repoConfigPath = path.join(repoRoot, CONFIG_FILE_NAME);
  const userConfig =
    userConfigPath === undefined ? {} : await readConfigFile(userConfigPath);
  const repoConfig = await readConfigFile(repoConfigPath);

  return {
    ...userConfig,
    ...repoConfig,
  };
}

export function resolveConfiguredPath(
  configuredPath: string,
  repoRoot: string,
  homeDir = getHomeDir(),
): string {
  const expandedPath = expandHome(configuredPath, homeDir);

  return path.isAbsolute(expandedPath)
    ? path.normalize(expandedPath)
    : path.resolve(repoRoot, expandedPath);
}

async function readConfigFile(configPath: string): Promise<ShrubbyConfig> {
  let rawConfig: string;

  try {
    rawConfig = await readFile(configPath, "utf8");
  } catch (error) {
    if (isMissingFile(error)) {
      return {};
    }

    throw error;
  }

  let parsedConfig: unknown;

  try {
    parsedConfig = JSON.parse(rawConfig);
  } catch (error) {
    throw new Error(
      `Could not parse ${configPath}: ${getErrorMessage(error)}`,
    );
  }

  return validateConfig(configPath, parsedConfig);
}

function validateConfig(configPath: string, value: unknown): ShrubbyConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${configPath} must contain a JSON object.`);
  }

  const config = value as Record<string, unknown>;

  return omitUndefined({
    copyOnCreate: readOptionalBoolean(configPath, config, "copyOnCreate"),
    defaultBaseRef: readOptionalString(configPath, config, "defaultBaseRef"),
    editorCommand: readOptionalString(configPath, config, "editorCommand"),
    fetchBeforeCreate: readOptionalBoolean(
      configPath,
      config,
      "fetchBeforeCreate",
    ),
    protectedBranches: readOptionalStringArray(
      configPath,
      config,
      "protectedBranches",
    ),
    worktreeRoot: readOptionalString(configPath, config, "worktreeRoot"),
  });
}

function omitUndefined(config: ShrubbyConfig): ShrubbyConfig {
  return Object.fromEntries(
    Object.entries(config).filter(([, value]) => value !== undefined),
  ) as ShrubbyConfig;
}

function readOptionalBoolean(
  configPath: string,
  config: Record<string, unknown>,
  key: keyof ShrubbyConfig,
): boolean | undefined {
  const value = config[key];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new Error(`${configPath}: '${key}' must be a boolean.`);
  }

  return value;
}

function readOptionalString(
  configPath: string,
  config: Record<string, unknown>,
  key: keyof ShrubbyConfig,
): string | undefined {
  const value = config[key];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${configPath}: '${key}' must be a non-empty string.`);
  }

  return value;
}

function readOptionalStringArray(
  configPath: string,
  config: Record<string, unknown>,
  key: keyof ShrubbyConfig,
): readonly string[] | undefined {
  const value = config[key];

  if (value === undefined) {
    return undefined;
  }

  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string" || entry.trim().length === 0)
  ) {
    throw new Error(`${configPath}: '${key}' must be an array of strings.`);
  }

  return value;
}

function expandHome(configuredPath: string, homeDir: string | undefined): string {
  if (configuredPath === "~") {
    return homeDir ?? configuredPath;
  }

  if (configuredPath.startsWith("~/")) {
    return homeDir === undefined
      ? configuredPath
      : path.join(homeDir, configuredPath.slice(2));
  }

  return configuredPath;
}

function getHomeDir(): string | undefined {
  return process.env.HOME ?? os.homedir();
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { readonly code?: unknown }).code === "ENOENT"
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
