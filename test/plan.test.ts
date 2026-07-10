import { describe, expect, it } from "vitest";

import type { SpecRelayError } from "../src/core/errors.js";
import {
  calculatePlanSha256,
  createVietnamesePlanDocument,
  normalizePlan,
  parsePlanDocument,
  validatePlanForApproval
} from "../src/core/plan.js";

const validPlan = `---
schemaVersion: 1
language: vi
objective: Tạo module giáo dục
inScope:
  - Tạo API quản lý cơ sở giáo dục
outOfScope:
  - Không thay đổi giao diện
constraints:
  - NestJS
implementationSteps:
  - id: step-1
    description: Tạo module
acceptanceCriteria:
  - id: ac-1
    description: Unit test chạy thành công
openQuestions:
  - id: q-1
    question: Có cần phân quyền chi tiết không?
    severity: non_blocking
---

# Cách tiếp cận

Tạo module theo kiến trúc hiện có.
`;

describe("plan document", () => {
  it("parses Vietnamese YAML front matter and normalizes approved data", () => {
    const parsed = parsePlanDocument(validPlan);
    const validated = validatePlanForApproval(parsed);
    const hash = calculatePlanSha256(validPlan);
    const normalized = normalizePlan("run-example", validated, hash);

    expect(normalized).toMatchObject({
      runId: "run-example",
      sourceSha256: hash,
      objective: "Tạo module giáo dục"
    });
  });

  it("uses the complete bytes when computing SHA-256", () => {
    expect(calculatePlanSha256("a\n")).not.toBe(calculatePlanSha256("a\r\n"));
  });

  it("rejects a draft before its required sections are complete", () => {
    const draft = parsePlanDocument(createVietnamesePlanDocument("Lập kế hoạch"));

    expect(() => validatePlanForApproval(draft)).toThrowError(
      expect.objectContaining({
        code: "INVALID_PLAN"
      } satisfies Partial<SpecRelayError>)
    );
  });

  it("rejects malformed front matter with a stable error code", () => {
    expect(() => parsePlanDocument("# Không có front matter")).toThrowError(
      expect.objectContaining({
        code: "INVALID_PLAN"
      } satisfies Partial<SpecRelayError>)
    );
  });
});
