import fs from "node:fs/promises";
import path from "node:path";

import { ARTIFACT_DIRECTORY, createInitialConfig, parseConfig } from "../core/config.js";
import { SpecRelayError } from "../core/errors.js";
import { getSpecRelayPaths } from "../core/paths.js";
import { getGitInfoExcludePath, requireGitRepository } from "./git.js";

export interface InitOptions {
  readonly repositoryPath: string;
  readonly dryRun: boolean;
}

export interface InitResult {
  readonly command: "init";
  readonly repositoryRoot: string;
  readonly initialized: boolean;
  readonly dryRun: boolean;
  readonly plannedChanges: readonly string[];
}

async function readExistingConfig(configPath: string): Promise<boolean> {
  try {
    const raw = await fs.readFile(configPath, "utf8");
    parseConfig(JSON.parse(raw));
    return true;
  } catch (error) {
    if (isMissingFile(error)) {
      return false;
    }

    if (error instanceof SpecRelayError) {
      throw error;
    }

    throw new SpecRelayError("INVALID_CONFIG", `Could not read '${configPath}' as valid JSON.`);
  }
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

async function directoryIsEmpty(directoryPath: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(directoryPath);
    return entries.length === 0;
  } catch (error) {
    if (isMissingFile(error)) {
      return true;
    }

    throw error;
  }
}

async function appendExcludeEntry(excludePath: string): Promise<boolean> {
  let current = "";

  try {
    current = await fs.readFile(excludePath, "utf8");
  } catch (error) {
    if (!isMissingFile(error)) {
      throw error;
    }
  }

  const entry = `${ARTIFACT_DIRECTORY}/`;
  const existingEntries = current.split(/\r?\n/).map((line) => line.trim());
  if (existingEntries.includes(entry)) {
    return false;
  }

  await fs.mkdir(path.dirname(excludePath), { recursive: true });
  const separator = current.length === 0 || current.endsWith("\n") ? "" : "\n";
  await fs.appendFile(excludePath, `${separator}${entry}\n`, "utf8");
  return true;
}

async function writeFileAtomically(filePath: string, content: string): Promise<void> {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, content, { encoding: "utf8", mode: 0o600 });
  await fs.rename(temporaryPath, filePath);
}

export async function initializeRepository(options: InitOptions): Promise<InitResult> {
  const repositoryRoot = requireGitRepository(options.repositoryPath);
  const paths = getSpecRelayPaths(repositoryRoot);
  const existingConfig = await readExistingConfig(paths.configPath);

  if (existingConfig) {
    return {
      command: "init",
      repositoryRoot,
      initialized: false,
      dryRun: options.dryRun,
      plannedChanges: []
    };
  }

  if (!(await directoryIsEmpty(paths.artifactDirectory))) {
    throw new SpecRelayError(
      "ARTIFACT_DIRECTORY_COLLISION",
      `Artifact directory '${paths.artifactDirectory}' exists without a valid SpecRelay config.`,
      { artifactDirectory: paths.artifactDirectory }
    );
  }

  const excludePath = getGitInfoExcludePath(repositoryRoot);
  const plannedChanges = [
    `create ${paths.configPath}`,
    `create ${paths.runsDirectory}`,
    `ensure ${ARTIFACT_DIRECTORY}/ is present in ${excludePath}`
  ];

  if (options.dryRun) {
    return {
      command: "init",
      repositoryRoot,
      initialized: false,
      dryRun: true,
      plannedChanges
    };
  }

  await fs.mkdir(paths.runsDirectory, { recursive: true });
  await writeFileAtomically(
    paths.configPath,
    `${JSON.stringify(createInitialConfig(), null, 2)}\n`
  );
  await appendExcludeEntry(excludePath);

  return {
    command: "init",
    repositoryRoot,
    initialized: true,
    dryRun: false,
    plannedChanges
  };
}
