import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";

import {
  appendArtifactEvent,
  readRunRecord,
  requireRunPaths,
  writeJsonAtomically
} from "../core/artifacts.js";
import {
  buildClaudeArguments,
  buildClaudeEnvironment,
  isExecutionTerminal,
  readExecutionRecord,
  redactExecutorText,
  sha256,
  type ExecutionPolicy,
  writeExecutionRecord,
  MAX_EXECUTOR_OUTPUT_BYTES
} from "../core/execution.js";
import { SpecRelayError } from "../core/errors.js";
import type { RunPaths } from "../core/paths.js";
import { executorSummarySchema, type ExecutionRecord, type ExecutorSummary } from "../core/run.js";
import { transition } from "../core/state.js";

export interface ExecutorWorkerOptions {
  readonly repositoryRoot: string;
  readonly runId: string;
  readonly claudeBinary: string;
  readonly claudeArgumentsPrefix?: readonly string[];
}

interface StreamResult {
  readonly valid: boolean;
  readonly sessionId?: string;
  readonly success: boolean;
}

function now(): string {
  return new Date().toISOString();
}

async function readPolicy(runPaths: RunPaths): Promise<ExecutionPolicy> {
  const raw = await fs.readFile(runPaths.policyPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  const { executionPolicySchema } = await import("../core/execution.js");
  const validation = executionPolicySchema.safeParse(parsed);
  if (!validation.success) {
    throw new SpecRelayError("INVALID_EXECUTION", "Execution policy artifact is invalid.", {
      issues: validation.error.issues
    });
  }
  return validation.data;
}

async function updateExecution(
  runPaths: RunPaths,
  update: (current: ExecutionRecord) => ExecutionRecord
): Promise<ExecutionRecord> {
  const current = await readExecutionRecord(runPaths);
  const next = update(current);
  await writeExecutionRecord(runPaths, next);
  return next;
}

async function appendOutput(
  runPaths: RunPaths,
  value: string,
  output: { bytes: number; truncated: boolean }
): Promise<void> {
  const redacted = redactExecutorText(value);
  const bytes = Buffer.byteLength(redacted, "utf8");
  if (output.bytes + bytes > MAX_EXECUTOR_OUTPUT_BYTES) {
    output.truncated = true;
    return;
  }
  output.bytes += bytes;
  await fs.appendFile(runPaths.executorEventsPath, redacted, { encoding: "utf8", mode: 0o600 });
}

function changedFiles(worktreePath: string, baseCommit: string): string[] {
  try {
    return execFileSync("git", ["-C", worktreePath, "diff", "--name-only", baseCommit], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    })
      .split(/\r?\n/u)
      .filter((line) => line.length > 0);
  } catch {
    return [];
  }
}

async function finalizeWorker(options: {
  readonly runPaths: RunPaths;
  readonly execution: ExecutionRecord;
  readonly exitCode: number | null;
  readonly reason: "succeeded" | "failed" | "interrupted" | "cancelled";
  readonly sessionId?: string;
  readonly errorCode?: string;
  readonly output: { readonly bytes: number; readonly truncated: boolean };
}): Promise<void> {
  const finishedAt = now();
  const finalExecution: ExecutionRecord = {
    ...options.execution,
    state: options.reason,
    heartbeatAt: finishedAt,
    finishedAt,
    exitCode: options.exitCode,
    outcome: options.reason,
    outputBytes: options.output.bytes,
    outputTruncated: options.output.truncated
  };
  await writeExecutionRecord(options.runPaths, finalExecution);

  const run = await readRunRecord(options.runPaths);
  const event =
    options.reason === "succeeded"
      ? "implementation_succeeded"
      : options.reason === "cancelled"
        ? "cancel"
        : options.reason === "failed"
          ? "implementation_failed"
          : "execution_interrupted";
  const finalRun = transition(run, event);
  await writeJsonAtomically(options.runPaths.statePath, { ...finalRun, updatedAt: finishedAt });

  const summary: ExecutorSummary = {
    schemaVersion: 1,
    runId: finalExecution.runId,
    executionId: finalExecution.executionId,
    outcome: options.reason,
    startedAt: finalExecution.startedAt,
    finishedAt,
    durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(finalExecution.startedAt)),
    exitCode: options.exitCode,
    changedFiles: changedFiles(finalExecution.worktreePath, finalExecution.baseCommit),
    ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
    ...(options.errorCode === undefined ? {} : { errorCode: options.errorCode })
  };
  const validatedSummary = executorSummarySchema.parse(summary);
  await writeJsonAtomically(options.runPaths.executorSummaryPath, validatedSummary);
  await appendArtifactEvent(options.runPaths.eventsPath, {
    schemaVersion: 1,
    runId: finalExecution.runId,
    timestamp: finishedAt,
    type: "executor_finished",
    details: { outcome: options.reason, exitCode: options.exitCode, errorCode: options.errorCode }
  });
}

export async function runExecutorWorker(options: ExecutorWorkerOptions): Promise<void> {
  const runPaths = await requireRunPaths(options.repositoryRoot, options.runId);
  const [policy, prompt, initialExecution] = await Promise.all([
    readPolicy(runPaths),
    fs.readFile(runPaths.executorPromptPath, "utf8"),
    readExecutionRecord(runPaths)
  ]);

  if (isExecutionTerminal(initialExecution.state)) {
    return;
  }
  if (policy.promptSha256 !== sha256(prompt)) {
    throw new SpecRelayError(
      "INVALID_EXECUTION",
      "Executor prompt does not match its policy digest."
    );
  }

  let execution = await updateExecution(runPaths, (current) => ({
    ...current,
    state: "running",
    workerPid: process.pid,
    heartbeatAt: now()
  }));
  const output = { bytes: execution.outputBytes, truncated: execution.outputTruncated };
  let cancellationRequested = execution.cancellationRequestedAt !== undefined;
  let timedOut = false;
  let malformedStream = false;
  let streamResult: StreamResult = { valid: false, success: false };
  let buffer = "";
  let queue = Promise.resolve();
  let heartbeatQueue = Promise.resolve();
  let stopping = false;

  const child = spawn(
    options.claudeBinary,
    [...(options.claudeArgumentsPrefix ?? []), ...buildClaudeArguments(policy, prompt)],
    {
      cwd: execution.worktreePath,
      env: buildClaudeEnvironment(),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    }
  );
  execution = await updateExecution(runPaths, (current) => ({
    ...current,
    claudePid: child.pid,
    heartbeatAt: now()
  }));

  const inspectCancellation = async (): Promise<void> => {
    if (stopping) {
      return;
    }
    const current = await readExecutionRecord(runPaths);
    if (current.cancellationRequestedAt !== undefined && !cancellationRequested) {
      cancellationRequested = true;
      child.kill("SIGTERM");
    }
    if (!stopping && !isExecutionTerminal(current.state)) {
      await updateExecution(runPaths, (latest) => ({ ...latest, heartbeatAt: now() }));
    }
  };
  const heartbeat = setInterval(() => {
    heartbeatQueue = heartbeatQueue.then(inspectCancellation).catch(() => undefined);
  }, 1000);
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
  }, policy.timeoutMs);

  const consumeLine = async (line: string): Promise<void> => {
    if (line.length === 0) {
      return;
    }
    await appendOutput(runPaths, `${line}\n`, output);
    try {
      const parsed = JSON.parse(line) as {
        readonly type?: string;
        readonly subtype?: string;
        readonly is_error?: boolean;
        readonly session_id?: string;
      };
      if (parsed.type === "result") {
        streamResult = {
          valid: true,
          success: parsed.subtype === "success" && parsed.is_error !== true,
          ...(parsed.session_id === undefined ? {} : { sessionId: parsed.session_id })
        };
      }
    } catch {
      malformedStream = true;
    }
  };

  child.stdout.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    const lines = buffer.split(/\r?\n/u);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      queue = queue.then(() => consumeLine(line));
    }
  });
  child.stderr.on("data", (chunk: Buffer) => {
    queue = queue.then(() =>
      appendOutput(
        runPaths,
        JSON.stringify({ type: "stderr", text: chunk.toString("utf8") }) + "\n",
        output
      )
    );
  });

  const exitCode = await new Promise<number | null>((resolve) => {
    child.once("error", () => resolve(null));
    child.once("close", (code) => resolve(code));
  });
  stopping = true;
  clearInterval(heartbeat);
  clearTimeout(timeout);
  await heartbeatQueue;
  if (buffer.length > 0) {
    await consumeLine(buffer);
  }
  await queue;

  const latest = await readExecutionRecord(runPaths);
  cancellationRequested ||= latest.cancellationRequestedAt !== undefined;
  const outcome = cancellationRequested
    ? "cancelled"
    : timedOut || malformedStream || !streamResult.valid
      ? "interrupted"
      : exitCode === 0 && streamResult.success
        ? "succeeded"
        : "failed";
  const errorCode = cancellationRequested
    ? "CANCELLED"
    : timedOut
      ? "EXECUTOR_TIMEOUT"
      : malformedStream || !streamResult.valid
        ? "EXECUTOR_STREAM_INVALID"
        : undefined;
  await finalizeWorker({
    runPaths,
    execution: latest,
    exitCode,
    reason: outcome,
    ...(streamResult.sessionId === undefined ? {} : { sessionId: streamResult.sessionId }),
    ...(errorCode === undefined ? {} : { errorCode }),
    output
  });
}
