import fs from "node:fs/promises";

import {
  appendArtifactEvent,
  readInitializedConfig,
  readRunRecord,
  requireRunPaths,
  withRunLock,
  writeJsonAtomically
} from "../core/artifacts.js";
import { assessPlanApproval } from "../core/approval.js";
import { SpecRelayError } from "../core/errors.js";
import {
  calculatePlanSha256,
  normalizePlan,
  parsePlanDocument,
  validatePlanForApproval,
  type ApprovalRecord
} from "../core/plan.js";
import { transition } from "../core/state.js";
import type { RunRecord } from "../core/run.js";
import { requireGitRepository } from "./git.js";

export interface ApprovePlanOptions {
  readonly repositoryPath: string;
  readonly runId: string;
  readonly confirmed: boolean;
  readonly approvedBy?: string;
  readonly acceptOpenQuestions: boolean;
  readonly reason?: string;
}

export interface ApprovePlanResult {
  readonly command: "approve";
  readonly runId: string;
  readonly state: "approved";
  readonly approval: ApprovalRecord;
}

function withUpdatedTimestamp(record: RunRecord, timestamp: string): RunRecord {
  return { ...record, updatedAt: timestamp };
}

function timestamp(): string {
  return new Date().toISOString();
}

function resolveOverride(
  options: ApprovePlanOptions,
  blockingQuestionIds: readonly string[]
): {
  readonly acceptedOpenQuestionIds: readonly string[];
  readonly overrideReason?: string;
} {
  const reason = options.reason?.trim();
  const isOverrideRequested = options.acceptOpenQuestions || reason !== undefined;

  if (blockingQuestionIds.length === 0) {
    if (isOverrideRequested) {
      throw new SpecRelayError(
        "USAGE",
        "Open-question override flags can only be used when the plan has blocking questions."
      );
    }
    return { acceptedOpenQuestionIds: [] };
  }

  if (!options.acceptOpenQuestions || reason === undefined || reason.length === 0) {
    throw new SpecRelayError(
      "OPEN_BLOCKING_QUESTIONS",
      "Plan has blocking open questions. Use --accept-open-questions with --reason to override them.",
      { blockingQuestionIds }
    );
  }

  return { acceptedOpenQuestionIds: blockingQuestionIds, overrideReason: reason };
}

async function transitionToApproved(
  runId: string,
  runPaths: Awaited<ReturnType<typeof requireRunPaths>>,
  record: RunRecord
): Promise<RunRecord> {
  let current = record;

  if (current.state === "draft_plan") {
    const occurredAt = timestamp();
    current = withUpdatedTimestamp(transition(current, "submit_plan"), occurredAt);
    await writeJsonAtomically(runPaths.statePath, current);
    await appendArtifactEvent(runPaths.eventsPath, {
      schemaVersion: 1,
      runId,
      timestamp: occurredAt,
      type: "plan_submitted",
      details: { state: current.state }
    });
  }

  if (current.state === "awaiting_approval") {
    const occurredAt = timestamp();
    current = withUpdatedTimestamp(transition(current, "approve_plan"), occurredAt);
    await writeJsonAtomically(runPaths.statePath, current);
    await appendArtifactEvent(runPaths.eventsPath, {
      schemaVersion: 1,
      runId,
      timestamp: occurredAt,
      type: "plan_approved",
      details: { state: current.state }
    });
  }

  if (current.state !== "approved") {
    throw new SpecRelayError(
      "INVALID_STATE_TRANSITION",
      `Run '${runId}' cannot be approved while in '${current.state}'.`,
      { currentState: current.state }
    );
  }

  return current;
}

export async function approvePlanRun(options: ApprovePlanOptions): Promise<ApprovePlanResult> {
  if (!options.confirmed) {
    throw new SpecRelayError(
      "APPROVAL_CONFIRMATION_REQUIRED",
      "Approval changes the run state. Re-run with --yes after reviewing the plan."
    );
  }

  const repositoryRoot = requireGitRepository(options.repositoryPath);
  await readInitializedConfig(repositoryRoot);
  const runPaths = await requireRunPaths(repositoryRoot, options.runId);

  return withRunLock(runPaths, async () => {
    const [record, planContent, existingApproval] = await Promise.all([
      readRunRecord(runPaths),
      fs.readFile(runPaths.planPath, "utf8"),
      assessPlanApproval(runPaths)
    ]);
    const validatedPlan = validatePlanForApproval(parsePlanDocument(planContent));
    const override = resolveOverride(
      options,
      validatedPlan.blockingQuestions.map((question) => question.id)
    );
    const approvedBy = options.approvedBy?.trim() || "local-user";
    const approvedAt = timestamp();
    const planSha256 = calculatePlanSha256(planContent);
    const approval: ApprovalRecord = {
      schemaVersion: 1,
      runId: options.runId,
      planSha256,
      approvedAt,
      approvedBy,
      acceptedOpenQuestionIds: [...override.acceptedOpenQuestionIds],
      ...(override.overrideReason === undefined ? {} : { overrideReason: override.overrideReason })
    };

    const finalRecord = await transitionToApproved(options.runId, runPaths, record);
    await writeJsonAtomically(
      runPaths.normalizedPlanPath,
      normalizePlan(options.runId, validatedPlan, planSha256)
    );
    await writeJsonAtomically(runPaths.approvalPath, approval);
    await appendArtifactEvent(runPaths.eventsPath, {
      schemaVersion: 1,
      runId: options.runId,
      timestamp: approvedAt,
      type: existingApproval.status === "stale" ? "plan_reapproved" : "approval_recorded",
      details: {
        state: finalRecord.state,
        approvedBy,
        planSha256,
        acceptedOpenQuestionIds: override.acceptedOpenQuestionIds
      }
    });

    return { command: "approve", runId: options.runId, state: "approved", approval };
  });
}
