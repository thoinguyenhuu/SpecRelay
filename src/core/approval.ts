import fs from "node:fs/promises";

import { SpecRelayError } from "./errors.js";
import { approvalRecordSchema, calculatePlanSha256, type ApprovalRecord } from "./plan.js";
import type { RunPaths } from "./paths.js";

export type ApprovalStatus = "not_approved" | "current" | "stale";

export interface ApprovalAssessment {
  readonly status: ApprovalStatus;
  readonly record?: ApprovalRecord;
  readonly currentPlanSha256: string;
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

export async function readApprovalRecord(runPaths: RunPaths): Promise<ApprovalRecord | undefined> {
  let raw: string;
  try {
    raw = await fs.readFile(runPaths.approvalPath, "utf8");
  } catch (error) {
    if (isMissingFile(error)) {
      return undefined;
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new SpecRelayError("INVALID_PLAN", "Approval artifact is not valid JSON.");
  }

  const validation = approvalRecordSchema.safeParse(parsed);
  if (!validation.success) {
    throw new SpecRelayError("INVALID_PLAN", "Approval artifact is invalid.", {
      issues: validation.error.issues
    });
  }
  return validation.data;
}

export async function assessPlanApproval(runPaths: RunPaths): Promise<ApprovalAssessment> {
  const [planContent, approval] = await Promise.all([
    fs.readFile(runPaths.planPath, "utf8"),
    readApprovalRecord(runPaths)
  ]);
  const currentPlanSha256 = calculatePlanSha256(planContent);

  if (approval === undefined) {
    return { status: "not_approved", currentPlanSha256 };
  }

  return {
    status: approval.planSha256 === currentPlanSha256 ? "current" : "stale",
    record: approval,
    currentPlanSha256
  };
}

export async function requireCurrentPlanApproval(runPaths: RunPaths): Promise<ApprovalRecord> {
  const assessment = await assessPlanApproval(runPaths);
  if (assessment.status !== "current" || assessment.record === undefined) {
    throw new SpecRelayError(
      "PLAN_CHANGED_AFTER_APPROVAL",
      "Plan is not currently approved. Review and approve the current plan before continuing.",
      { approvalStatus: assessment.status }
    );
  }
  return assessment.record;
}
