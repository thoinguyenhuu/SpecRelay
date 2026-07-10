import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import {
  appendArtifactEvent,
  readInitializedConfig,
  readRunRecord,
  requireRunPaths,
  withRunLock,
  writeJsonAtomically
} from "../core/artifacts.js";
import { requireCurrentPlanApproval } from "../core/approval.js";
import { readChecksRecord, type ChecksRecord } from "../core/checks.js";
import { readExecutionRecord, readExecutorSummary } from "../core/execution.js";
import { SpecRelayError } from "../core/errors.js";
import { normalizedPlanSchema, type NormalizedPlan } from "../core/plan.js";
import {
  readReviewRecord,
  validateReviewRecord,
  writeReviewRecord,
  type ReviewRecord
} from "../core/review.js";
import type { RunPaths } from "../core/paths.js";
import type { ExecutionRecord, ExecutorSummary, RunRecord } from "../core/run.js";
import { transition } from "../core/state.js";
import { isPathInside } from "../core/worktree.js";
import { requireGitRepository } from "./git.js";

export const MAX_DIFF_OUTPUT_BYTES = 2 * 1024 * 1024;

const reviewPacketSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: z.string().min(1),
    createdAt: z.string().datetime(),
    plan: normalizedPlanSchema,
    acceptanceCriteria: z.array(
      z.object({ id: z.string().min(1), description: z.string().min(1) }).strict()
    ),
    execution: z.object({ record: z.unknown(), summary: z.unknown() }).strict(),
    checks: z.unknown(),
    diff: z
      .object({
        stat: z.string(),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        bytes: z.number().int().nonnegative()
      })
      .strict(),
    worktreePath: z.string().min(1)
  })
  .strict();

export type ReviewPacket = z.infer<typeof reviewPacketSchema>;

const finalReportSchema = z
  .object({
    schemaVersion: z.literal(1),
    runId: z.string().min(1),
    generatedAt: z.string().datetime(),
    state: z.string().min(1),
    branchName: z.string().min(1),
    worktreePath: z.string().min(1),
    baseCommit: z.string().min(1),
    execution: z.object({ record: z.unknown(), summary: z.unknown().optional() }).strict(),
    checks: z.unknown().optional(),
    review: z.unknown().optional()
  })
  .strict();

export type FinalReport = z.infer<typeof finalReportSchema>;

export interface DiffOptions {
  readonly repositoryPath: string;
  readonly runId: string;
  readonly stat: boolean;
  readonly pathspec: readonly string[];
}

export interface DiffResult {
  readonly command: "diff";
  readonly runId: string;
  readonly stat: boolean;
  readonly baseCommit: string;
  readonly content: string;
  readonly sha256: string;
  readonly bytes: number;
}

export interface ReviewPacketResult {
  readonly command: "review-packet";
  readonly runId: string;
  readonly packet: ReviewPacket;
}

export interface RecordReviewOptions {
  readonly repositoryPath: string;
  readonly runId: string;
  readonly inputPath: string;
}

export interface RecordReviewResult {
  readonly command: "record-review";
  readonly runId: string;
  readonly state: "complete" | "needs_human";
  readonly review: ReviewRecord;
}

export interface FinalReportResult {
  readonly command: "report";
  readonly runId: string;
  readonly report: FinalReport;
}

function now(): string {
  return new Date().toISOString();
}

function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

export function validateDiffPathspecs(pathspec: readonly string[]): void {
  for (const candidate of pathspec) {
    const normalized = candidate.replace(/\\/gu, "/");
    if (
      candidate.length === 0 ||
      candidate.includes("\u0000") ||
      candidate.startsWith("-") ||
      path.isAbsolute(candidate) ||
      normalized === ".." ||
      normalized.startsWith("../") ||
      normalized.includes("/../") ||
      normalized.startsWith(":(")
    ) {
      throw new SpecRelayError(
        "INVALID_DIFF_PATHSPEC",
        "Diff pathspec must be a safe relative path.",
        {
          pathspec: candidate
        }
      );
    }
  }
}

async function collectGitOutput(worktreePath: string, args: readonly string[]): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn("git", ["-C", worktreePath, ...args], {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const chunks: Buffer[] = [];
    const errors: Buffer[] = [];
    let bytes = 0;
    let exceeded = false;
    let settled = false;
    const finish = (action: () => void): void => {
      if (!settled) {
        settled = true;
        action();
      }
    };
    child.stdout.on("data", (chunk: Buffer) => {
      if (exceeded) {
        return;
      }
      const remaining = MAX_DIFF_OUTPUT_BYTES - bytes;
      if (chunk.byteLength > remaining) {
        exceeded = true;
        child.kill();
        return;
      }
      bytes += chunk.byteLength;
      chunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => errors.push(chunk));
    child.once("error", () => {
      finish(() =>
        reject(new SpecRelayError("INVALID_EXECUTION", "Git diff could not be started."))
      );
    });
    child.once("close", (code) => {
      finish(() => {
        if (exceeded) {
          reject(
            new SpecRelayError(
              "DIFF_OUTPUT_LIMIT",
              `Git diff exceeded the ${MAX_DIFF_OUTPUT_BYTES} byte output limit.`
            )
          );
          return;
        }
        if (code !== 0) {
          reject(
            new SpecRelayError("INVALID_EXECUTION", "Git diff failed.", {
              stderr: Buffer.concat(errors).toString("utf8").trim()
            })
          );
          return;
        }
        resolve(Buffer.concat(chunks));
      });
    });
  });
}

async function readNormalizedPlan(runPaths: RunPaths): Promise<NormalizedPlan> {
  let data: unknown;
  try {
    data = JSON.parse(await fs.readFile(runPaths.normalizedPlanPath, "utf8")) as unknown;
  } catch {
    throw new SpecRelayError(
      "INVALID_PLAN",
      "Approved normalized plan artifact is missing or invalid."
    );
  }
  const parsed = normalizedPlanSchema.safeParse(data);
  if (!parsed.success) {
    throw new SpecRelayError("INVALID_PLAN", "Approved normalized plan artifact is invalid.", {
      issues: parsed.error.issues
    });
  }
  return parsed.data;
}

function assertSuccessfulExecution(execution: ExecutionRecord): void {
  if (execution.state !== "succeeded" || execution.outcome !== "succeeded") {
    throw new SpecRelayError(
      "REVIEW_NOT_READY",
      "Diff and review require a successful execution.",
      {
        executionState: execution.state,
        outcome: execution.outcome
      }
    );
  }
  if (!isPathInside(execution.managedRoot, execution.worktreePath)) {
    throw new SpecRelayError(
      "INVALID_EXECUTION",
      "Execution worktree is outside its managed root."
    );
  }
}

async function readDiff(
  execution: ExecutionRecord,
  stat: boolean,
  pathspec: readonly string[]
): Promise<DiffResult> {
  validateDiffPathspecs(pathspec);
  const content = await collectGitOutput(execution.worktreePath, [
    "diff",
    "--no-ext-diff",
    "--no-color",
    ...(stat ? ["--stat"] : []),
    execution.baseCommit,
    "--",
    ...pathspec
  ]);
  return {
    command: "diff",
    runId: execution.runId,
    stat,
    baseCommit: execution.baseCommit,
    content: content.toString("utf8"),
    sha256: sha256(content),
    bytes: content.byteLength
  };
}

export async function getRunDiff(options: DiffOptions): Promise<DiffResult> {
  const repositoryRoot = requireGitRepository(options.repositoryPath);
  await readInitializedConfig(repositoryRoot);
  const runPaths = await requireRunPaths(repositoryRoot, options.runId);
  const execution = await readExecutionRecord(runPaths);
  assertSuccessfulExecution(execution);
  return readDiff(execution, options.stat, options.pathspec);
}

export async function createReviewPacket(
  repositoryPath: string,
  runId: string
): Promise<ReviewPacketResult> {
  const repositoryRoot = requireGitRepository(repositoryPath);
  await readInitializedConfig(repositoryRoot);
  const runPaths = await requireRunPaths(repositoryRoot, runId);
  return withRunLock(runPaths, async () => {
    const run = await readRunRecord(runPaths);
    if (run.state !== "ready_for_review") {
      throw new SpecRelayError(
        "REVIEW_NOT_READY",
        "A review packet requires a run ready for review.",
        {
          currentState: run.state
        }
      );
    }
    await requireCurrentPlanApproval(runPaths);
    const [plan, execution, summary, checks] = await Promise.all([
      readNormalizedPlan(runPaths),
      readExecutionRecord(runPaths),
      readExecutorSummary(runPaths),
      readChecksRecord(runPaths)
    ]);
    assertSuccessfulExecution(execution);
    if (summary.outcome !== "succeeded" || checks.outcome !== "passed") {
      throw new SpecRelayError(
        "REVIEW_NOT_READY",
        "Review packet requires successful execution and checks."
      );
    }
    const [diff, stat] = await Promise.all([
      readDiff(execution, false, []),
      readDiff(execution, true, [])
    ]);
    const packet: ReviewPacket = {
      schemaVersion: 1,
      runId,
      createdAt: now(),
      plan,
      acceptanceCriteria: plan.acceptanceCriteria,
      execution: { record: execution, summary },
      checks,
      diff: { stat: stat.content, sha256: diff.sha256, bytes: diff.bytes },
      worktreePath: execution.worktreePath
    };
    const parsed = reviewPacketSchema.safeParse(packet);
    if (!parsed.success) {
      throw new SpecRelayError("INTERNAL_ERROR", "Attempted to write an invalid review packet.", {
        issues: parsed.error.issues
      });
    }
    await writeJsonAtomically(runPaths.reviewPacketPath, parsed.data);
    await appendArtifactEvent(runPaths.eventsPath, {
      schemaVersion: 1,
      runId,
      timestamp: now(),
      type: "review_packet_created",
      details: { diffSha256: diff.sha256, diffBytes: diff.bytes }
    });
    return { command: "review-packet", runId, packet: parsed.data };
  });
}

async function readOptionalExecutorSummary(
  runPaths: RunPaths
): Promise<ExecutorSummary | undefined> {
  try {
    return await readExecutorSummary(runPaths);
  } catch (error) {
    if (error instanceof SpecRelayError && error.code === "INVALID_EXECUTION") {
      try {
        await fs.access(runPaths.executorSummaryPath);
      } catch {
        return undefined;
      }
    }
    throw error;
  }
}

async function readOptionalChecks(runPaths: RunPaths): Promise<ChecksRecord | undefined> {
  try {
    return await readChecksRecord(runPaths);
  } catch (error) {
    if (error instanceof SpecRelayError && error.code === "INVALID_CHECKS") {
      return undefined;
    }
    throw error;
  }
}

export async function writeFinalReportArtifact(
  runPaths: RunPaths,
  run: RunRecord
): Promise<FinalReport> {
  const execution = await readExecutionRecord(runPaths);
  const [summary, checks, review] = await Promise.all([
    readOptionalExecutorSummary(runPaths),
    readOptionalChecks(runPaths),
    readReviewRecord(runPaths)
  ]);
  const report: FinalReport = {
    schemaVersion: 1,
    runId: run.id,
    generatedAt: now(),
    state: run.state,
    branchName: execution.branchName,
    worktreePath: execution.worktreePath,
    baseCommit: execution.baseCommit,
    execution: {
      record: execution,
      ...(summary === undefined ? {} : { summary })
    },
    ...(checks === undefined ? {} : { checks }),
    ...(review === undefined ? {} : { review })
  };
  const parsed = finalReportSchema.safeParse(report);
  if (!parsed.success) {
    throw new SpecRelayError("INTERNAL_ERROR", "Attempted to write an invalid final report.", {
      issues: parsed.error.issues
    });
  }
  await writeJsonAtomically(runPaths.finalReportPath, parsed.data);
  return parsed.data;
}

export async function recordReview(options: RecordReviewOptions): Promise<RecordReviewResult> {
  const repositoryRoot = requireGitRepository(options.repositoryPath);
  await readInitializedConfig(repositoryRoot);
  const runPaths = await requireRunPaths(repositoryRoot, options.runId);
  let input: unknown;
  try {
    input = JSON.parse(await fs.readFile(options.inputPath, "utf8")) as unknown;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      throw new SpecRelayError("REVIEW_INPUT_NOT_FOUND", "Review input file does not exist.", {
        inputPath: options.inputPath
      });
    }
    throw new SpecRelayError("INVALID_REVIEW", "Review input is not valid JSON.");
  }
  const review = validateReviewRecord(input);
  return withRunLock(runPaths, async () => {
    const run = await readRunRecord(runPaths);
    if (run.state !== "ready_for_review") {
      throw new SpecRelayError(
        "REVIEW_NOT_READY",
        "Review can only be recorded while the run is ready for review.",
        {
          currentState: run.state
        }
      );
    }
    await requireCurrentPlanApproval(runPaths);
    const state = review.decision === "complete" ? "complete" : "needs_human";
    const event = state === "complete" ? "review_completed" : "mark_needs_human";
    const occurredAt = now();
    const next = { ...transition(run, event), updatedAt: occurredAt };
    await writeReviewRecord(runPaths, review);
    await writeJsonAtomically(runPaths.statePath, next);
    await appendArtifactEvent(runPaths.eventsPath, {
      schemaVersion: 1,
      runId: options.runId,
      timestamp: occurredAt,
      type: "review_recorded",
      details: {
        state,
        decision: review.decision,
        findingCount: review.findings.length
      }
    });
    await writeFinalReportArtifact(runPaths, next);
    return { command: "record-review", runId: options.runId, state, review };
  });
}

export async function getFinalReport(
  repositoryPath: string,
  runId: string
): Promise<FinalReportResult> {
  const repositoryRoot = requireGitRepository(repositoryPath);
  await readInitializedConfig(repositoryRoot);
  const runPaths = await requireRunPaths(repositoryRoot, runId);
  return withRunLock(runPaths, async () => {
    const run = await readRunRecord(runPaths);
    const report = await writeFinalReportArtifact(runPaths, run);
    return { command: "report", runId, report };
  });
}
