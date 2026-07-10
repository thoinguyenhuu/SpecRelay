import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";

import { z } from "zod";

import { writeJsonAtomically } from "./artifacts.js";
import { SpecRelayError } from "./errors.js";
import type { RunPaths } from "./paths.js";
import { executionRecordSchema, type ExecutionRecord } from "./run.js";

export const DEFAULT_MAX_TURNS = 10;
export const MAX_MAX_TURNS = 10;
export const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;
export const MAX_TIMEOUT_MS = 20 * 60 * 1000;
export const HEARTBEAT_STALE_MS = 30 * 1000;
export const MAX_EXECUTOR_OUTPUT_BYTES = 10 * 1024 * 1024;

export const executionPolicySchema = z
  .object({
    schemaVersion: z.literal(1),
    maxTurns: z.number().int().min(1).max(MAX_MAX_TURNS),
    timeoutMs: z.number().int().positive().max(MAX_TIMEOUT_MS),
    permissionMode: z.literal("acceptEdits"),
    allowedTools: z.array(z.string().min(1)).min(1),
    disallowedTools: z.array(z.string().min(1)).min(1),
    promptSha256: z.string().regex(/^[a-f0-9]{64}$/)
  })
  .strict();

export type ExecutionPolicy = z.infer<typeof executionPolicySchema>;

export function parseMaxTurns(value: string | number | undefined): number {
  if (value === undefined) {
    return DEFAULT_MAX_TURNS;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_MAX_TURNS) {
    throw new SpecRelayError(
      "USAGE",
      `max-turns must be an integer between 1 and ${MAX_MAX_TURNS}.`
    );
  }
  return parsed;
}

export function parseTimeout(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_TIMEOUT_MS;
  }
  const match = /^(\d+)(s|m)$/u.exec(value.trim());
  if (match === null) {
    throw new SpecRelayError(
      "USAGE",
      "timeout must use a whole-number s or m suffix, such as 90s or 5m."
    );
  }
  const amount = Number(match[1]);
  const unit = match[2];
  const milliseconds = unit === "m" ? amount * 60 * 1000 : amount * 1000;
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 1000 || milliseconds > MAX_TIMEOUT_MS) {
    throw new SpecRelayError("USAGE", "timeout must be between 1s and 20m.");
  }
  return milliseconds;
}

export function formatDuration(milliseconds: number): string {
  return milliseconds % 60000 === 0 ? `${milliseconds / 60000}m` : `${milliseconds / 1000}s`;
}

export function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function createExecutionPolicy(options: {
  readonly maxTurns: number;
  readonly timeoutMs: number;
  readonly prompt: string;
}): ExecutionPolicy {
  return {
    schemaVersion: 1,
    maxTurns: options.maxTurns,
    timeoutMs: options.timeoutMs,
    permissionMode: "acceptEdits",
    allowedTools: [
      "Read",
      "Edit",
      "Write",
      "Glob",
      "Grep",
      "Bash(git status:*)",
      "Bash(git diff:*)",
      "Bash(git log:*)",
      "Bash(git grep:*)"
    ],
    disallowedTools: [
      "Bash(git commit:*)",
      "Bash(git push:*)",
      "Bash(gh auth:*)",
      "Bash(gh repo:*)",
      "Bash(npm publish:*)",
      "Bash(pnpm publish:*)",
      "Bash(yarn publish:*)",
      "Bash(curl:*)",
      "Bash(wget:*)",
      "Bash(rm -rf:*)"
    ],
    promptSha256: sha256(options.prompt)
  };
}

export function buildClaudeArguments(policy: ExecutionPolicy, prompt: string): readonly string[] {
  return [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--max-turns",
    String(policy.maxTurns),
    "--permission-mode",
    policy.permissionMode,
    "--allowedTools",
    policy.allowedTools.join(" "),
    "--disallowedTools",
    policy.disallowedTools.join(" "),
    prompt
  ];
}

export function buildClaudeEnvironment(
  environment: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const names =
    process.platform === "win32"
      ? [
          "PATH",
          "PATHEXT",
          "SystemRoot",
          "ComSpec",
          "TEMP",
          "TMP",
          "USERPROFILE",
          "APPDATA",
          "LOCALAPPDATA"
        ]
      : ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL"];
  const result: NodeJS.ProcessEnv = {};
  for (const name of names) {
    const value = environment[name];
    if (value !== undefined) {
      result[name] = value;
    }
  }
  return result;
}

export function redactExecutorText(value: string): string {
  return value
    .replace(
      /(ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|AWS_SECRET_ACCESS_KEY|GITHUB_TOKEN)\s*=\s*[^\s"']+/giu,
      "$1=[REDACTED]"
    )
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/gu, "[REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._-]{12,}\b/giu, "Bearer [REDACTED]");
}

export function createExecutionRecord(options: {
  readonly runId: string;
  readonly baseCommit: string;
  readonly branchName: string;
  readonly worktreePath: string;
  readonly timeoutMs: number;
  readonly now?: Date;
}): ExecutionRecord {
  const now = options.now ?? new Date();
  return {
    schemaVersion: 1,
    runId: options.runId,
    executionId: randomUUID(),
    state: "prepared",
    baseCommit: options.baseCommit,
    branchName: options.branchName,
    worktreePath: options.worktreePath,
    startedAt: now.toISOString(),
    heartbeatAt: now.toISOString(),
    timeoutAt: new Date(now.getTime() + options.timeoutMs).toISOString(),
    outputBytes: 0,
    outputTruncated: false
  };
}

export async function readExecutionRecord(runPaths: RunPaths): Promise<ExecutionRecord> {
  let content: string;
  try {
    content = await fs.readFile(runPaths.executionPath, "utf8");
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      throw new SpecRelayError(
        "INVALID_EXECUTION",
        "Execution artifact does not exist for this run."
      );
    }
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new SpecRelayError("INVALID_EXECUTION", "Execution artifact is not valid JSON.");
  }
  const validated = executionRecordSchema.safeParse(parsed);
  if (!validated.success) {
    throw new SpecRelayError("INVALID_EXECUTION", "Execution artifact is invalid.", {
      issues: validated.error.issues
    });
  }
  return validated.data;
}

export async function writeExecutionRecord(
  runPaths: RunPaths,
  execution: ExecutionRecord
): Promise<void> {
  const validation = executionRecordSchema.safeParse(execution);
  if (!validation.success) {
    throw new SpecRelayError(
      "INVALID_EXECUTION",
      "Attempted to write an invalid execution artifact.",
      {
        issues: validation.error.issues
      }
    );
  }
  await writeJsonAtomically(runPaths.executionPath, validation.data);
}

export function isExecutionTerminal(state: ExecutionRecord["state"]): boolean {
  return ["succeeded", "failed", "interrupted", "cancelled"].includes(state);
}
