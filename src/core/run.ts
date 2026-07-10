import { z } from "zod";

import { runStates } from "./state.js";

export const RUN_SCHEMA_VERSION = 1 as const;

export const runRecordSchema = z
  .object({
    schemaVersion: z.literal(RUN_SCHEMA_VERSION),
    id: z.string().min(1),
    repositoryRoot: z.string().min(1),
    state: z.enum(runStates),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime()
  })
  .strict();

export type RunRecord = z.infer<typeof runRecordSchema>;

export const artifactEventSchema = z
  .object({
    schemaVersion: z.literal(RUN_SCHEMA_VERSION),
    runId: z.string().min(1),
    timestamp: z.string().datetime(),
    type: z.string().min(1),
    details: z.record(z.string(), z.unknown()).optional()
  })
  .strict();

export type ArtifactEvent = z.infer<typeof artifactEventSchema>;

export const executionStates = [
  "prepared",
  "running",
  "cancellation_requested",
  "succeeded",
  "failed",
  "interrupted",
  "cancelled"
] as const;

export type ExecutionState = (typeof executionStates)[number];

export const executionRecordSchema = z
  .object({
    schemaVersion: z.literal(RUN_SCHEMA_VERSION),
    runId: z.string().min(1),
    executionId: z.string().min(1),
    state: z.enum(executionStates),
    baseCommit: z.string().min(1),
    branchName: z.string().min(1),
    worktreePath: z.string().min(1),
    workerPid: z.number().int().positive().optional(),
    claudePid: z.number().int().positive().optional(),
    startedAt: z.string().datetime(),
    heartbeatAt: z.string().datetime(),
    timeoutAt: z.string().datetime(),
    cancellationRequestedAt: z.string().datetime().optional(),
    finishedAt: z.string().datetime().optional(),
    exitCode: z.number().int().nullable().optional(),
    outcome: z.enum(["succeeded", "failed", "interrupted", "cancelled"]).optional(),
    outputBytes: z.number().int().nonnegative(),
    outputTruncated: z.boolean()
  })
  .strict();

export type ExecutionRecord = z.infer<typeof executionRecordSchema>;

export const executorSummarySchema = z
  .object({
    schemaVersion: z.literal(RUN_SCHEMA_VERSION),
    runId: z.string().min(1),
    executionId: z.string().min(1),
    outcome: z.enum(["succeeded", "failed", "interrupted", "cancelled"]),
    startedAt: z.string().datetime(),
    finishedAt: z.string().datetime(),
    durationMs: z.number().int().nonnegative(),
    exitCode: z.number().int().nullable(),
    sessionId: z.string().min(1).optional(),
    changedFiles: z.array(z.string()),
    errorCode: z.string().min(1).optional()
  })
  .strict();

export type ExecutorSummary = z.infer<typeof executorSummarySchema>;
