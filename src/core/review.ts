import fs from "node:fs/promises";

import { z } from "zod";

import { writeJsonAtomically } from "./artifacts.js";
import { SpecRelayError } from "./errors.js";
import type { RunPaths } from "./paths.js";

const nonEmptyText = z.string().trim().min(1);

export const reviewFindingSchema = z
  .object({
    id: nonEmptyText,
    severity: z.enum(["blocking", "important", "minor"]),
    file: nonEmptyText,
    line: z.number().int().positive(),
    category: nonEmptyText,
    problem: nonEmptyText,
    evidence: z.array(nonEmptyText),
    requiredFix: nonEmptyText
  })
  .strict();

export type ReviewFinding = z.infer<typeof reviewFindingSchema>;

export const reviewRecordSchema = z
  .object({
    decision: z.enum(["complete", "needs_human"]),
    summary: nonEmptyText,
    findings: z.array(reviewFindingSchema)
  })
  .strict();

export type ReviewRecord = z.infer<typeof reviewRecordSchema>;

export function validateReviewRecord(value: unknown): ReviewRecord {
  const parsed = reviewRecordSchema.safeParse(value);
  if (!parsed.success) {
    throw new SpecRelayError("INVALID_REVIEW", "Review input does not match the required schema.", {
      issues: parsed.error.issues
    });
  }
  const hasEscalatedFinding = parsed.data.findings.some(
    (finding) => finding.severity === "blocking" || finding.severity === "important"
  );
  if (hasEscalatedFinding && parsed.data.decision !== "needs_human") {
    throw new SpecRelayError(
      "INVALID_REVIEW",
      "A review with blocking or important findings must use decision 'needs_human'."
    );
  }
  if (!hasEscalatedFinding && parsed.data.decision !== "complete") {
    throw new SpecRelayError(
      "INVALID_REVIEW",
      "A review with only minor findings or no findings must use decision 'complete'."
    );
  }
  return parsed.data;
}

export async function readReviewRecord(runPaths: RunPaths): Promise<ReviewRecord | undefined> {
  let raw: string;
  try {
    raw = await fs.readFile(runPaths.reviewPath, "utf8");
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new SpecRelayError("INVALID_REVIEW", "Review artifact is not valid JSON.");
  }
  return validateReviewRecord(data);
}

export async function writeReviewRecord(runPaths: RunPaths, review: ReviewRecord): Promise<void> {
  await writeJsonAtomically(runPaths.reviewPath, validateReviewRecord(review));
}
