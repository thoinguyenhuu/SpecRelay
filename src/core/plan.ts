import { createHash } from "node:crypto";

import { parse, stringify } from "yaml";
import { z } from "zod";

import { SpecRelayError } from "./errors.js";

export const PLAN_SCHEMA_VERSION = 1 as const;

const nonEmptyText = z.string().trim().min(1);

export const openQuestionSchema = z
  .object({
    id: z.string().trim().min(1),
    question: nonEmptyText,
    severity: z.enum(["blocking", "non_blocking"])
  })
  .strict();

export type OpenQuestion = z.infer<typeof openQuestionSchema>;

const planStepSchema = z
  .object({
    id: z.string().trim().min(1),
    description: nonEmptyText
  })
  .strict();

const acceptanceCriterionSchema = z
  .object({
    id: z.string().trim().min(1),
    description: nonEmptyText
  })
  .strict();

export const checkPresetSchema = z.enum(["node", "python", "go"]);

export const checkDefinitionSchema = z
  .object({
    id: z.string().trim().min(1),
    preset: checkPresetSchema,
    argv: z.array(nonEmptyText).min(1),
    timeout: z
      .string()
      .regex(/^\d+(?:s|m)$/u)
      .default("5m")
  })
  .strict();

export type CheckDefinition = z.infer<typeof checkDefinitionSchema>;

export const planFrontMatterSchema = z
  .object({
    schemaVersion: z.literal(PLAN_SCHEMA_VERSION),
    language: z.literal("vi"),
    objective: nonEmptyText,
    inScope: z.array(nonEmptyText),
    outOfScope: z.array(nonEmptyText),
    constraints: z.array(nonEmptyText),
    implementationSteps: z.array(planStepSchema),
    acceptanceCriteria: z.array(acceptanceCriterionSchema),
    openQuestions: z.array(openQuestionSchema),
    checks: z.array(checkDefinitionSchema).default([])
  })
  .strict();

export type PlanDraft = z.infer<typeof planFrontMatterSchema> & {
  readonly body: string;
};

export type ValidatedPlan = PlanDraft & {
  readonly blockingQuestions: readonly OpenQuestion[];
};

export const normalizedPlanSchema = planFrontMatterSchema.extend({
  runId: z.string().min(1),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/)
});

export type NormalizedPlan = z.infer<typeof normalizedPlanSchema>;

export const approvalRecordSchema = z
  .object({
    schemaVersion: z.literal(PLAN_SCHEMA_VERSION),
    runId: z.string().min(1),
    planSha256: z.string().regex(/^[a-f0-9]{64}$/),
    approvedAt: z.string().datetime(),
    approvedBy: nonEmptyText,
    acceptedOpenQuestionIds: z.array(z.string().min(1)),
    overrideReason: nonEmptyText.optional()
  })
  .strict();

export type ApprovalRecord = z.infer<typeof approvalRecordSchema>;

export function parsePlanDocument(content: string): PlanDraft {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/u.exec(content);

  if (match === null) {
    throw new SpecRelayError(
      "INVALID_PLAN",
      "Plan must begin with YAML front matter delimited by '---'."
    );
  }

  const frontMatter = match[1];
  const body = match[2];
  if (frontMatter === undefined || body === undefined) {
    throw new SpecRelayError("INVALID_PLAN", "Plan front matter could not be read.");
  }

  let parsed: unknown;
  try {
    parsed = parse(frontMatter);
  } catch (error) {
    throw new SpecRelayError("INVALID_PLAN", "Plan front matter is not valid YAML.", {
      cause: error instanceof Error ? error.message : "Unknown YAML parsing error."
    });
  }

  const validation = planFrontMatterSchema.safeParse(parsed);
  if (!validation.success) {
    throw new SpecRelayError(
      "INVALID_PLAN",
      "Plan front matter does not match the required schema.",
      {
        issues: validation.error.issues
      }
    );
  }

  return { ...validation.data, body };
}

export function validatePlanForApproval(plan: PlanDraft): ValidatedPlan {
  const missingSections: string[] = [];

  if (plan.inScope.length === 0) {
    missingSections.push("inScope");
  }
  if (plan.implementationSteps.length === 0) {
    missingSections.push("implementationSteps");
  }
  if (plan.acceptanceCriteria.length === 0) {
    missingSections.push("acceptanceCriteria");
  }
  if (plan.body.trim().length === 0) {
    missingSections.push("body");
  }

  if (missingSections.length > 0) {
    throw new SpecRelayError("INVALID_PLAN", "Plan is incomplete and cannot be approved.", {
      missingSections
    });
  }

  return {
    ...plan,
    blockingQuestions: plan.openQuestions.filter((question) => question.severity === "blocking")
  };
}

export function calculatePlanSha256(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

export function normalizePlan(
  runId: string,
  plan: ValidatedPlan,
  sourceSha256: string
): NormalizedPlan {
  return {
    schemaVersion: plan.schemaVersion,
    language: plan.language,
    objective: plan.objective,
    inScope: plan.inScope,
    outOfScope: plan.outOfScope,
    constraints: plan.constraints,
    implementationSteps: plan.implementationSteps,
    acceptanceCriteria: plan.acceptanceCriteria,
    openQuestions: plan.openQuestions,
    checks: plan.checks,
    runId,
    sourceSha256
  };
}

export function createVietnamesePlanDocument(objective: string): string {
  const frontMatter = stringify({
    schemaVersion: PLAN_SCHEMA_VERSION,
    language: "vi",
    objective,
    inScope: [],
    outOfScope: [],
    constraints: [],
    implementationSteps: [],
    acceptanceCriteria: [],
    openQuestions: [],
    checks: []
  }).trimEnd();

  return `---\n${frontMatter}\n---\n\n# Kế hoạch triển khai\n\n> Đây là bản nháp. Hãy hoàn thiện phạm vi, các bước và tiêu chí nghiệm thu trước khi duyệt.\n\n## Cách tiếp cận\n\nMô tả ngắn gọn hướng triển khai, các quyết định quan trọng và rủi ro cần lưu ý.\n`;
}
