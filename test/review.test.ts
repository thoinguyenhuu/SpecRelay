import { describe, expect, it } from "vitest";

import { validateReviewRecord } from "../src/core/review.js";
import { validateDiffPathspecs } from "../src/cli/review.js";

const importantFinding = {
  id: "F-001",
  severity: "important" as const,
  file: "src/example.ts",
  line: 42,
  category: "maintainability",
  problem: "Cần tách transaction.",
  evidence: ["src/example.ts:42"],
  requiredFix: "Dùng transaction."
};

describe("structured reviews", () => {
  it("requires human escalation for important and blocking findings", () => {
    expect(() =>
      validateReviewRecord({
        decision: "complete",
        summary: "Có lỗi cần sửa.",
        findings: [importantFinding]
      })
    ).toThrowError(expect.objectContaining({ code: "INVALID_REVIEW" }));
    expect(
      validateReviewRecord({
        decision: "needs_human",
        summary: "Có lỗi cần sửa.",
        findings: [importantFinding]
      })
    ).toMatchObject({ decision: "needs_human" });
  });

  it("allows complete only with minor or no findings", () => {
    expect(
      validateReviewRecord({
        decision: "complete",
        summary: "Hoàn tất.",
        findings: []
      })
    ).toMatchObject({ decision: "complete" });
    expect(() =>
      validateReviewRecord({ decision: "needs_human", summary: "Không có lỗi.", findings: [] })
    ).toThrowError(expect.objectContaining({ code: "INVALID_REVIEW" }));
  });
});

describe("diff pathspec guard", () => {
  it("accepts safe relative paths and rejects traversal or option-like input", () => {
    expect(() => validateDiffPathspecs(["src/example.ts"])).not.toThrow();
    expect(() => validateDiffPathspecs(["../secret"])).toThrowError(
      expect.objectContaining({ code: "INVALID_DIFF_PATHSPEC" })
    );
    expect(() => validateDiffPathspecs(["--output"])).toThrowError(
      expect.objectContaining({ code: "INVALID_DIFF_PATHSPEC" })
    );
  });
});
