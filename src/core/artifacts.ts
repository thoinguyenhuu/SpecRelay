import fs from "node:fs/promises";
import path from "node:path";

import { parseConfig, type SpecRelayConfig } from "./config.js";
import { SpecRelayError } from "./errors.js";
import { getRunPaths, getSpecRelayPaths, type RunPaths } from "./paths.js";
import { artifactEventSchema, runRecordSchema, type ArtifactEvent, type RunRecord } from "./run.js";

const runIdPattern = /^run-[a-z0-9-]+$/u;

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

export function assertRunId(runId: string): void {
  if (!runIdPattern.test(runId)) {
    throw new SpecRelayError("RUN_NOT_FOUND", `Run '${runId}' does not exist.`);
  }
}

export async function readInitializedConfig(repositoryRoot: string): Promise<SpecRelayConfig> {
  const paths = getSpecRelayPaths(repositoryRoot);

  let raw: string;
  try {
    raw = await fs.readFile(paths.configPath, "utf8");
  } catch (error) {
    if (isMissingFile(error)) {
      throw new SpecRelayError(
        "INVALID_CONFIG",
        "SpecRelay is not initialized in this repository. Run 'specrelay init' first."
      );
    }
    throw error;
  }

  try {
    return parseConfig(JSON.parse(raw));
  } catch (error) {
    if (error instanceof SpecRelayError) {
      throw error;
    }
    throw new SpecRelayError("INVALID_CONFIG", "SpecRelay configuration is not valid JSON.");
  }
}

export async function requireRunPaths(repositoryRoot: string, runId: string): Promise<RunPaths> {
  assertRunId(runId);
  const runPaths = getRunPaths(repositoryRoot, runId);

  try {
    const stat = await fs.stat(runPaths.runDirectory);
    if (!stat.isDirectory()) {
      throw new SpecRelayError("RUN_NOT_FOUND", `Run '${runId}' does not exist.`);
    }
  } catch (error) {
    if (isMissingFile(error)) {
      throw new SpecRelayError("RUN_NOT_FOUND", `Run '${runId}' does not exist.`);
    }
    throw error;
  }

  return runPaths;
}

export async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
  await writeTextAtomically(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function writeTextAtomically(filePath: string, content: string): Promise<void> {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporaryPath, content, {
    encoding: "utf8",
    mode: 0o600
  });

  try {
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true });
    throw error;
  }
}

export async function appendArtifactEvent(eventsPath: string, event: ArtifactEvent): Promise<void> {
  const parsed = artifactEventSchema.safeParse(event);
  if (!parsed.success) {
    throw new SpecRelayError("INTERNAL_ERROR", "Attempted to write an invalid artifact event.", {
      issues: parsed.error.issues
    });
  }

  await fs.appendFile(eventsPath, `${JSON.stringify(parsed.data)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
}

export async function readRunRecord(runPaths: RunPaths): Promise<RunRecord> {
  let raw: string;
  try {
    raw = await fs.readFile(runPaths.statePath, "utf8");
  } catch (error) {
    if (isMissingFile(error)) {
      throw new SpecRelayError("RUN_NOT_FOUND", "Run state artifact does not exist.");
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new SpecRelayError("INVALID_PLAN", "Run state artifact is not valid JSON.");
  }

  const validation = runRecordSchema.safeParse(parsed);
  if (!validation.success) {
    throw new SpecRelayError("INVALID_PLAN", "Run state artifact is invalid.", {
      issues: validation.error.issues
    });
  }
  return validation.data;
}

export async function withRunLock<T>(runPaths: RunPaths, action: () => Promise<T>): Promise<T> {
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(runPaths.lockPath, "wx", 0o600);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST") {
      throw new SpecRelayError("RUN_LOCKED", "Another SpecRelay command is changing this run.", {
        runDirectory: runPaths.runDirectory
      });
    }
    throw error;
  }

  try {
    return await action();
  } finally {
    await handle.close();
    await fs.rm(runPaths.lockPath, { force: true });
  }
}

export function createRunId(timestamp: Date): string {
  const date = timestamp.toISOString().replace(/[-:.]/gu, "").toLowerCase();
  const entropy = Math.random().toString(36).slice(2, 8);
  return `run-${date}-${entropy}`;
}

export function createRequestDocument(objective: string): string {
  return `# Yêu cầu\n\n${objective.trim()}\n`;
}

export async function createRunDirectory(repositoryRoot: string, runId: string): Promise<RunPaths> {
  const runPaths = getRunPaths(repositoryRoot, runId);
  try {
    await fs.mkdir(runPaths.runDirectory, { recursive: false });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST") {
      throw new SpecRelayError("RUN_LOCKED", `A run with ID '${runId}' already exists.`);
    }
    throw error;
  }
  return runPaths;
}

export async function writeInitialRunArtifacts(
  runPaths: RunPaths,
  request: string,
  plan: string,
  record: RunRecord
): Promise<void> {
  await fs.writeFile(runPaths.requestPath, request, { encoding: "utf8", mode: 0o600 });
  await fs.writeFile(runPaths.planPath, plan, { encoding: "utf8", mode: 0o600 });
  await writeJsonAtomically(runPaths.statePath, record);
  await fs.writeFile(runPaths.eventsPath, "", { encoding: "utf8", mode: 0o600 });
}

export function getRepositoryRootFromRun(record: RunRecord): string {
  return path.resolve(record.repositoryRoot);
}
