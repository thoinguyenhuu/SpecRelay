import { spawn } from "node:child_process";
import fs from "node:fs/promises";

import { z } from "zod";

import { writeJsonAtomically } from "./artifacts.js";
import { buildClaudeEnvironment, redactExecutorText } from "./execution.js";
import { SpecRelayError } from "./errors.js";
import type { RunPaths } from "./paths.js";
import { checkDefinitionSchema, type CheckDefinition } from "./plan.js";

export const DEFAULT_CHECK_TIMEOUT_MS = 5 * 60 * 1000;
export const MAX_CHECK_TIMEOUT_MS = 10 * 60 * 1000;
export const MAX_CHECK_OUTPUT_BYTES = 1024 * 1024;

export const checkResultSchema = z
  .object({
    id: z.string().min(1),
    preset: z.enum(["node", "python", "go"]),
    argv: z.array(z.string().min(1)).min(1),
    timeoutMs: z.number().int().positive().max(MAX_CHECK_TIMEOUT_MS),
    startedAt: z.string().datetime(),
    finishedAt: z.string().datetime(),
    durationMs: z.number().int().nonnegative(),
    exitCode: z.number().int().nullable(),
    output: z.string(),
    outputTruncated: z.boolean(),
    outcome: z.enum(["passed", "failed", "timed_out", "spawn_error"])
  })
  .strict();

export type CheckResult = z.infer<typeof checkResultSchema>;

export const checksRecordSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: z.string().min(1),
    startedAt: z.string().datetime(),
    finishedAt: z.string().datetime(),
    outcome: z.enum(["passed", "failed"]),
    results: z.array(checkResultSchema)
  })
  .strict();

export type ChecksRecord = z.infer<typeof checksRecordSchema>;

const allowedExecutables: Readonly<Record<CheckDefinition["preset"], readonly string[]>> = {
  node: ["node", "npm", "pnpm", "yarn"],
  python: ["python", "python3", "py"],
  go: ["go"]
};

const disallowedPackageActions = new Set([
  "add",
  "ci",
  "install",
  "i",
  "publish",
  "remove",
  "uninstall",
  "update"
]);

function executableName(value: string): string {
  return (
    value
      .replace(/\\/gu, "/")
      .split("/")
      .at(-1)
      ?.replace(/\.(?:cmd|exe)$/iu, "")
      .toLowerCase() ?? ""
  );
}

export function parseCheckTimeout(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_CHECK_TIMEOUT_MS;
  }
  const match = /^(\d+)(s|m)$/u.exec(value.trim());
  if (match === null) {
    throw new SpecRelayError(
      "INVALID_CHECK_COMMAND",
      "Check timeout must use a whole-number s or m suffix."
    );
  }
  const amount = Number(match[1]);
  const unit = match[2];
  const milliseconds = unit === "m" ? amount * 60_000 : amount * 1_000;
  if (
    !Number.isSafeInteger(milliseconds) ||
    milliseconds < 1_000 ||
    milliseconds > MAX_CHECK_TIMEOUT_MS
  ) {
    throw new SpecRelayError("INVALID_CHECK_COMMAND", "Check timeout must be between 1s and 10m.");
  }
  return milliseconds;
}

export function validateCheckDefinition(value: unknown): CheckDefinition {
  const parsed = checkDefinitionSchema.safeParse(value);
  if (!parsed.success) {
    throw new SpecRelayError("INVALID_CHECK_COMMAND", "Check definition is invalid.", {
      issues: parsed.error.issues
    });
  }
  const [command, ...arguments_] = parsed.data.argv;
  if (command === undefined) {
    throw new SpecRelayError("INVALID_CHECK_COMMAND", "Check argv must include an executable.");
  }
  const name = executableName(command);
  if (!allowedExecutables[parsed.data.preset].includes(name)) {
    throw new SpecRelayError(
      "INVALID_CHECK_COMMAND",
      `Check '${parsed.data.id}' does not use an executable allowed by preset '${parsed.data.preset}'.`,
      { preset: parsed.data.preset, argv: parsed.data.argv }
    );
  }
  if (
    parsed.data.preset === "node" &&
    ["npm", "pnpm", "yarn"].includes(name) &&
    arguments_.some((argument) => disallowedPackageActions.has(argument.toLowerCase()))
  ) {
    throw new SpecRelayError(
      "INVALID_CHECK_COMMAND",
      `Check '${parsed.data.id}' may not install, update, remove, or publish packages.`,
      { argv: parsed.data.argv }
    );
  }
  parseCheckTimeout(parsed.data.timeout);
  return parsed.data;
}

export async function runCheck(
  check: CheckDefinition,
  worktreePath: string,
  environment: NodeJS.ProcessEnv = process.env
): Promise<CheckResult> {
  const timeoutMs = parseCheckTimeout(check.timeout);
  const started = new Date();
  const startedAt = started.toISOString();
  let output = "";
  let outputBytes = 0;
  let outputTruncated = false;
  let timedOut = false;

  const appendOutput = (chunk: Buffer): void => {
    if (outputTruncated) {
      return;
    }
    const remaining = MAX_CHECK_OUTPUT_BYTES - outputBytes;
    if (remaining <= 0) {
      outputTruncated = true;
      return;
    }
    const accepted = chunk.subarray(0, remaining);
    output += accepted.toString("utf8");
    outputBytes += accepted.byteLength;
    if (accepted.byteLength !== chunk.byteLength) {
      outputTruncated = true;
    }
  };

  const result = await new Promise<{
    readonly exitCode: number | null;
    readonly spawnError: boolean;
  }>((resolve) => {
    const child = spawn(check.argv[0]!, check.argv.slice(1), {
      cwd: worktreePath,
      env: buildClaudeEnvironment(environment),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    const outputLimitTimer = setInterval(() => {
      if (outputTruncated) {
        child.kill();
      }
    }, 20);
    child.stdout.on("data", appendOutput);
    child.stderr.on("data", appendOutput);
    child.once("error", () => {
      clearTimeout(timer);
      clearInterval(outputLimitTimer);
      resolve({ exitCode: null, spawnError: true });
    });
    child.once("close", (exitCode) => {
      clearTimeout(timer);
      clearInterval(outputLimitTimer);
      resolve({ exitCode, spawnError: false });
    });
  });

  const finished = new Date();
  const outcome = timedOut
    ? "timed_out"
    : result.spawnError
      ? "spawn_error"
      : result.exitCode === 0 && !outputTruncated
        ? "passed"
        : "failed";
  return {
    id: check.id,
    preset: check.preset,
    argv: [...check.argv],
    timeoutMs,
    startedAt,
    finishedAt: finished.toISOString(),
    durationMs: finished.getTime() - started.getTime(),
    exitCode: result.exitCode,
    output: redactExecutorText(output),
    outputTruncated,
    outcome
  };
}

export async function readChecksRecord(runPaths: RunPaths): Promise<ChecksRecord> {
  let raw: string;
  try {
    raw = await fs.readFile(runPaths.checksPath, "utf8");
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      throw new SpecRelayError("INVALID_CHECKS", "Checks artifact does not exist for this run.");
    }
    throw error;
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new SpecRelayError("INVALID_CHECKS", "Checks artifact is not valid JSON.");
  }
  const parsed = checksRecordSchema.safeParse(data);
  if (!parsed.success) {
    throw new SpecRelayError("INVALID_CHECKS", "Checks artifact is invalid.", {
      issues: parsed.error.issues
    });
  }
  return parsed.data;
}

export async function writeChecksRecord(runPaths: RunPaths, record: ChecksRecord): Promise<void> {
  const parsed = checksRecordSchema.safeParse(record);
  if (!parsed.success) {
    throw new SpecRelayError("INTERNAL_ERROR", "Attempted to write an invalid checks artifact.", {
      issues: parsed.error.issues
    });
  }
  await writeJsonAtomically(runPaths.checksPath, parsed.data);
}
