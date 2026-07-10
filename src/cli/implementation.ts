import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  appendArtifactEvent,
  readInitializedConfig,
  readRunRecord,
  requireRunPaths,
  withRunLock,
  writeJsonAtomically,
  writeTextAtomically
} from "../core/artifacts.js";
import { requireCurrentPlanApproval } from "../core/approval.js";
import {
  createExecutionPolicy,
  createExecutionRecord,
  formatDuration,
  HEARTBEAT_STALE_MS,
  isExecutionTerminal,
  parseMaxTurns,
  parseTimeout,
  readExecutionRecord,
  type ExecutionPolicy,
  writeExecutionRecord
} from "../core/execution.js";
import { SpecRelayError } from "../core/errors.js";
import type { RunPaths } from "../core/paths.js";
import type { ExecutionRecord, ExecutorSummary } from "../core/run.js";
import { transition } from "../core/state.js";
import {
  assertCleanBaseRepository,
  branchHasUniqueCommits,
  createIsolatedWorktree,
  deleteBranch,
  getOwnedWorktreePath,
  isPathInside,
  previewOwnedWorktreePath,
  removeOwnedWorktree,
  resolveBaseCommit,
  supportsGitWorktree,
  worktreeIsClean
} from "../core/worktree.js";
import { requireGitRepository } from "./git.js";

const CLAUDE_BINARY = "claude";

export interface ImplementOptions {
  readonly repositoryPath: string;
  readonly runId: string;
  readonly confirmed: boolean;
  readonly maxTurns?: string;
  readonly timeout?: string;
  readonly dryRun: boolean;
  readonly claudeBinary?: string;
}

export interface ImplementResult {
  readonly command: "implement";
  readonly runId: string;
  readonly dryRun: boolean;
  readonly state: "implementing";
  readonly worktreePath: string;
  readonly branchName: string;
  readonly baseCommit: string;
  readonly policy: ExecutionPolicy;
  readonly promptSha256: string;
  readonly workerPid?: number;
}

export interface ExecutionStatusResult {
  readonly command: "status";
  readonly runId: string;
  readonly runState: string;
  readonly execution: ExecutionRecord;
  readonly heartbeatAgeMs: number;
}

export interface CancelResult {
  readonly command: "cancel";
  readonly runId: string;
  readonly state: "cancellation_requested" | "interrupted";
}

export interface CleanupResult {
  readonly command: "cleanup";
  readonly runId: string;
  readonly worktreeRemoved: boolean;
  readonly branchDeleted: boolean;
}

export interface ReportResult {
  readonly command: "report";
  readonly runId: string;
  readonly execution: ExecutionRecord;
  readonly summary?: ExecutorSummary;
}

function now(): string {
  return new Date().toISOString();
}

function claudeIsAvailable(binary: string): boolean {
  try {
    execFileSync(binary, ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return true;
  } catch {
    return false;
  }
}

function buildExecutorPrompt(options: {
  readonly runId: string;
  readonly plan: unknown;
  readonly baseCommit: string;
  readonly worktreePath: string;
  readonly policy: ExecutionPolicy;
}): string {
  return `# SpecRelay executor contract

Run ID: ${options.runId}
Base commit: ${options.baseCommit}
Worktree: ${options.worktreePath}

You may modify only files inside the current worktree. Do not commit, push, publish, authenticate, download dependencies, access the network, or run tests/build commands. If implementation requires work outside this approved plan or policy, stop and report why.

## Approved plan data

\`\`\`json
${JSON.stringify(options.plan, null, 2)}
\`\`\`

## Fixed policy

\`\`\`json
${JSON.stringify(
  {
    schemaVersion: options.policy.schemaVersion,
    maxTurns: options.policy.maxTurns,
    timeoutMs: options.policy.timeoutMs,
    permissionMode: options.policy.permissionMode,
    allowedTools: options.policy.allowedTools,
    disallowedTools: options.policy.disallowedTools
  },
  null,
  2
)}
\`\`\`
`;
}

function workerEntryPoint(): string {
  const adjacent = fileURLToPath(new URL("./index.js", import.meta.url));
  return existsSync(adjacent)
    ? adjacent
    : path.resolve(path.dirname(adjacent), "../../dist/cli/index.js");
}

function spawnWorker(repositoryRoot: string, runId: string, claudeBinary: string): number {
  const child = spawn(
    process.execPath,
    [
      workerEntryPoint(),
      "__execute-worker",
      runId,
      "--repo",
      repositoryRoot,
      "--claude-bin",
      claudeBinary
    ],
    { detached: true, shell: false, stdio: "ignore" }
  );
  child.unref();
  if (child.pid === undefined) {
    throw new SpecRelayError("INVALID_EXECUTION", "Could not start the executor worker.");
  }
  return child.pid;
}

async function readNormalizedPlan(runPaths: RunPaths): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(runPaths.normalizedPlanPath, "utf8")) as unknown;
  } catch {
    throw new SpecRelayError(
      "INVALID_EXECUTION",
      "Approved normalized plan artifact is missing or invalid."
    );
  }
}

async function ensureNoExecution(runPaths: RunPaths): Promise<void> {
  try {
    await fs.access(runPaths.executionPath);
    throw new SpecRelayError(
      "EXECUTION_ALREADY_EXISTS",
      "This run already has an execution artifact."
    );
  } catch (error) {
    if (error instanceof SpecRelayError) {
      throw error;
    }
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

export async function implementApprovedRun(options: ImplementOptions): Promise<ImplementResult> {
  if (!options.confirmed) {
    throw new SpecRelayError(
      "IMPLEMENT_CONFIRMATION_REQUIRED",
      "Implementation creates an isolated workspace and can spend Claude quota. Re-run with --yes."
    );
  }
  const repositoryRoot = requireGitRepository(options.repositoryPath);
  await readInitializedConfig(repositoryRoot);
  const runPaths = await requireRunPaths(repositoryRoot, options.runId);
  const maxTurns = parseMaxTurns(options.maxTurns);
  const timeoutMs = parseTimeout(options.timeout);
  const claudeBinary = options.claudeBinary ?? CLAUDE_BINARY;

  return withRunLock(runPaths, async () => {
    const run = await readRunRecord(runPaths);
    if (run.state !== "approved") {
      throw new SpecRelayError("RUN_NOT_APPROVED", "Only an approved run can be implemented.", {
        state: run.state
      });
    }
    await requireCurrentPlanApproval(runPaths);
    await ensureNoExecution(runPaths);
    assertCleanBaseRepository(repositoryRoot);
    if (!supportsGitWorktree(repositoryRoot)) {
      throw new SpecRelayError(
        "GIT_WORKTREE_UNAVAILABLE",
        "Git worktree is unavailable in this repository."
      );
    }
    if (!claudeIsAvailable(claudeBinary)) {
      throw new SpecRelayError(
        "CLAUDE_NOT_FOUND",
        "Claude Code was not found or could not be executed."
      );
    }

    const baseCommit = resolveBaseCommit(repositoryRoot);
    const branchName = `specrelay/${options.runId}`;
    const previewPath = previewOwnedWorktreePath(options.runId);
    const normalizedPlan = await readNormalizedPlan(runPaths);
    const provisionalPolicy = createExecutionPolicy({ maxTurns, timeoutMs, prompt: "" });
    const prompt = buildExecutorPrompt({
      runId: options.runId,
      plan: normalizedPlan,
      baseCommit,
      worktreePath: previewPath,
      policy: provisionalPolicy
    });
    const policy = createExecutionPolicy({ maxTurns, timeoutMs, prompt });

    if (options.dryRun) {
      return {
        command: "implement",
        runId: options.runId,
        dryRun: true,
        state: "implementing",
        worktreePath: previewPath,
        branchName,
        baseCommit,
        policy,
        promptSha256: policy.promptSha256
      };
    }

    const owned = await getOwnedWorktreePath(options.runId);
    await createIsolatedWorktree({
      repositoryRoot,
      branchName,
      baseCommit,
      worktreePath: owned.worktreePath,
      managedRoot: owned.root
    });
    const execution = createExecutionRecord({
      runId: options.runId,
      baseCommit,
      branchName,
      managedRoot: owned.root,
      worktreePath: owned.worktreePath,
      timeoutMs
    });
    await writeJsonAtomically(runPaths.policyPath, policy);
    await writeTextAtomically(runPaths.executorPromptPath, prompt);
    await fs.writeFile(runPaths.executorEventsPath, "", { encoding: "utf8", mode: 0o600 });
    await writeExecutionRecord(runPaths, execution);
    const implementing = transition(run, "start_implementation");
    await writeJsonAtomically(runPaths.statePath, { ...implementing, updatedAt: now() });
    await appendArtifactEvent(runPaths.eventsPath, {
      schemaVersion: 1,
      runId: options.runId,
      timestamp: now(),
      type: "executor_prepared",
      details: { branchName, baseCommit, worktreePath: owned.worktreePath, maxTurns, timeoutMs }
    });

    const workerPid = spawnWorker(repositoryRoot, options.runId, claudeBinary);
    await writeExecutionRecord(runPaths, {
      ...execution,
      state: "running",
      workerPid,
      heartbeatAt: now()
    });
    return {
      command: "implement",
      runId: options.runId,
      dryRun: false,
      state: "implementing",
      worktreePath: owned.worktreePath,
      branchName,
      baseCommit,
      policy,
      promptSha256: policy.promptSha256,
      workerPid
    };
  });
}

async function interruptStaleExecution(
  runPaths: RunPaths,
  execution: ExecutionRecord
): Promise<ExecutionRecord> {
  if (
    isExecutionTerminal(execution.state) ||
    Date.now() - Date.parse(execution.heartbeatAt) <= HEARTBEAT_STALE_MS
  ) {
    return execution;
  }
  const finishedAt = now();
  const interrupted: ExecutionRecord = {
    ...execution,
    state: "interrupted",
    heartbeatAt: finishedAt,
    finishedAt,
    outcome: "interrupted"
  };
  await writeExecutionRecord(runPaths, interrupted);
  const run = await readRunRecord(runPaths);
  if (run.state === "implementing") {
    const next = transition(run, "execution_interrupted");
    await writeJsonAtomically(runPaths.statePath, { ...next, updatedAt: finishedAt });
  }
  await appendArtifactEvent(runPaths.eventsPath, {
    schemaVersion: 1,
    runId: execution.runId,
    timestamp: finishedAt,
    type: "executor_interrupted",
    details: { reason: "stale_heartbeat" }
  });
  return interrupted;
}

export async function getExecutionStatus(
  repositoryPath: string,
  runId: string
): Promise<ExecutionStatusResult> {
  const repositoryRoot = requireGitRepository(repositoryPath);
  await readInitializedConfig(repositoryRoot);
  const runPaths = await requireRunPaths(repositoryRoot, runId);
  return withRunLock(runPaths, async () => {
    const execution = await interruptStaleExecution(runPaths, await readExecutionRecord(runPaths));
    const run = await readRunRecord(runPaths);
    return {
      command: "status",
      runId,
      runState: run.state,
      execution,
      heartbeatAgeMs: Math.max(0, Date.now() - Date.parse(execution.heartbeatAt))
    };
  });
}

export async function requestExecutionCancellation(options: {
  readonly repositoryPath: string;
  readonly runId: string;
  readonly confirmed: boolean;
}): Promise<CancelResult> {
  if (!options.confirmed) {
    throw new SpecRelayError(
      "CANCEL_CONFIRMATION_REQUIRED",
      "Cancellation changes the executor state. Re-run with --yes."
    );
  }
  const repositoryRoot = requireGitRepository(options.repositoryPath);
  const runPaths = await requireRunPaths(repositoryRoot, options.runId);
  return withRunLock(runPaths, async () => {
    const execution = await interruptStaleExecution(runPaths, await readExecutionRecord(runPaths));
    if (execution.state === "interrupted") {
      return { command: "cancel", runId: options.runId, state: "interrupted" };
    }
    if (isExecutionTerminal(execution.state)) {
      throw new SpecRelayError(
        "EXECUTION_NOT_RUNNING",
        "Execution has already reached a terminal state."
      );
    }
    const requestedAt = now();
    await writeExecutionRecord(runPaths, {
      ...execution,
      state: "cancellation_requested",
      cancellationRequestedAt: requestedAt,
      heartbeatAt: requestedAt
    });
    await appendArtifactEvent(runPaths.eventsPath, {
      schemaVersion: 1,
      runId: options.runId,
      timestamp: requestedAt,
      type: "cancellation_requested"
    });
    return { command: "cancel", runId: options.runId, state: "cancellation_requested" };
  });
}

export async function cleanupExecution(options: {
  readonly repositoryPath: string;
  readonly runId: string;
  readonly confirmed: boolean;
}): Promise<CleanupResult> {
  if (!options.confirmed) {
    throw new SpecRelayError(
      "CLEANUP_CONFIRMATION_REQUIRED",
      "Cleanup removes an isolated worktree. Re-run with --yes."
    );
  }
  const repositoryRoot = requireGitRepository(options.repositoryPath);
  const runPaths = await requireRunPaths(repositoryRoot, options.runId);
  return withRunLock(runPaths, async () => {
    const execution = await readExecutionRecord(runPaths);
    if (!isExecutionTerminal(execution.state)) {
      throw new SpecRelayError(
        "EXECUTION_NOT_RUNNING",
        "Cannot clean up a non-terminal execution."
      );
    }
    const owned = await getOwnedWorktreePath(options.runId, execution.managedRoot);
    if (
      !isPathInside(owned.root, path.resolve(execution.worktreePath)) ||
      path.resolve(execution.worktreePath) !== owned.worktreePath
    ) {
      throw new SpecRelayError(
        "UNSAFE_WORKTREE_PATH",
        "Execution worktree is not owned by this SpecRelay run."
      );
    }
    try {
      await fs.access(owned.worktreePath);
    } catch {
      return {
        command: "cleanup",
        runId: options.runId,
        worktreeRemoved: false,
        branchDeleted: false
      };
    }
    if (!worktreeIsClean(owned.worktreePath)) {
      throw new SpecRelayError(
        "WORKTREE_NOT_CLEAN",
        "Refusing to remove a worktree that contains changes."
      );
    }
    const hasCommits = branchHasUniqueCommits(
      repositoryRoot,
      execution.branchName,
      execution.baseCommit
    );
    removeOwnedWorktree(repositoryRoot, owned.worktreePath);
    if (!hasCommits) {
      deleteBranch(repositoryRoot, execution.branchName);
    }
    await appendArtifactEvent(runPaths.eventsPath, {
      schemaVersion: 1,
      runId: options.runId,
      timestamp: now(),
      type: "worktree_cleaned",
      details: { worktreeRemoved: true, branchDeleted: !hasCommits }
    });
    return {
      command: "cleanup",
      runId: options.runId,
      worktreeRemoved: true,
      branchDeleted: !hasCommits
    };
  });
}

export async function getExecutionReport(
  repositoryPath: string,
  runId: string
): Promise<ReportResult> {
  const repositoryRoot = requireGitRepository(repositoryPath);
  const runPaths = await requireRunPaths(repositoryRoot, runId);
  const execution = await readExecutionRecord(runPaths);
  try {
    const summary = JSON.parse(
      await fs.readFile(runPaths.executorSummaryPath, "utf8")
    ) as ExecutorSummary;
    return { command: "report", runId, execution, summary };
  } catch {
    return { command: "report", runId, execution };
  }
}

export function formatExecutionPreview(result: ImplementResult): string {
  return `worktree=${result.worktreePath}\nbranch=${result.branchName}\nbase=${result.baseCommit}\nmaxTurns=${result.policy.maxTurns}\ntimeout=${formatDuration(result.policy.timeoutMs)}\npromptSha256=${result.promptSha256}`;
}
