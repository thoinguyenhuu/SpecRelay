import fs from "node:fs/promises";

import { afterEach, describe, expect, it } from "vitest";

import { approvePlanRun } from "../src/cli/approval.js";
import { showPlanRun } from "../src/cli/plan.js";
import { requireCurrentPlanApproval } from "../src/core/approval.js";
import { getRunPaths } from "../src/core/paths.js";
import type { SpecRelayError } from "../src/core/errors.js";
import { createPlanRun } from "../src/cli/plan.js";
import { initializeRepository } from "../src/cli/init.js";
import { createTemporaryGitRepository } from "./helpers.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true }))
  );
});

async function preparedRun(): Promise<{ repositoryPath: string; runId: string }> {
  const repositoryPath = await createTemporaryGitRepository();
  temporaryDirectories.push(repositoryPath);
  await initializeRepository({ repositoryPath, dryRun: false });
  const created = await createPlanRun({
    repositoryPath,
    objective: "Tạo module quản lý cơ sở giáo dục",
    language: "vi"
  });
  const runPaths = getRunPaths(repositoryPath, created.runId);
  await fs.writeFile(runPaths.planPath, completePlan(), "utf8");
  return { repositoryPath, runId: created.runId };
}

function completePlan(openQuestion = ""): string {
  return `---
schemaVersion: 1
language: vi
objective: Tạo module quản lý cơ sở giáo dục
inScope:
  - Tạo API quản lý cơ sở giáo dục
outOfScope:
  - Không thay đổi giao diện
constraints:
  - NestJS
implementationSteps:
  - id: step-1
    description: Tạo entity và module
acceptanceCriteria:
  - id: ac-1
    description: Unit test chạy thành công
openQuestions:${openQuestion || " []"}
---

# Cách tiếp cận

Triển khai theo kiến trúc module hiện có.
`;
}

describe("approval", () => {
  it("requires explicit confirmation, binds approval to a plan hash, and records both transitions", async () => {
    const { repositoryPath, runId } = await preparedRun();

    await expect(
      approvePlanRun({
        repositoryPath,
        runId,
        confirmed: false,
        acceptOpenQuestions: false
      })
    ).rejects.toMatchObject({
      code: "APPROVAL_CONFIRMATION_REQUIRED"
    } satisfies Partial<SpecRelayError>);

    const approved = await approvePlanRun({
      repositoryPath,
      runId,
      confirmed: true,
      approvedBy: "Thôi",
      acceptOpenQuestions: false
    });
    const runPaths = getRunPaths(repositoryPath, runId);
    const state = JSON.parse(await fs.readFile(runPaths.statePath, "utf8")) as { state: string };
    const normalized = JSON.parse(await fs.readFile(runPaths.normalizedPlanPath, "utf8")) as {
      sourceSha256: string;
      body?: string;
    };
    const events = await fs.readFile(runPaths.eventsPath, "utf8");

    expect(approved).toMatchObject({ state: "approved", approval: { approvedBy: "Thôi" } });
    expect(state.state).toBe("approved");
    expect(normalized.sourceSha256).toBe(approved.approval.planSha256);
    expect(normalized).not.toHaveProperty("body");
    expect(events).toContain('"type":"plan_submitted"');
    expect(events).toContain('"type":"plan_approved"');
  });

  it("blocks unresolved blocking questions unless the user explicitly accepts them with a reason", async () => {
    const { repositoryPath, runId } = await preparedRun();
    const runPaths = getRunPaths(repositoryPath, runId);
    await fs.writeFile(
      runPaths.planPath,
      completePlan(`
  - id: q-1
    question: Cần xác nhận mô hình phân quyền nào?
    severity: blocking`),
      "utf8"
    );

    await expect(
      approvePlanRun({
        repositoryPath,
        runId,
        confirmed: true,
        acceptOpenQuestions: true
      })
    ).rejects.toMatchObject({
      code: "OPEN_BLOCKING_QUESTIONS"
    } satisfies Partial<SpecRelayError>);

    const approved = await approvePlanRun({
      repositoryPath,
      runId,
      confirmed: true,
      acceptOpenQuestions: true,
      reason: "Dùng convention phân quyền hiện có của repository."
    });

    expect(approved.approval).toMatchObject({
      acceptedOpenQuestionIds: ["q-1"],
      overrideReason: "Dùng convention phân quyền hiện có của repository."
    });
  });

  it("marks approval as stale after plan.md changes and accepts a new approval", async () => {
    const { repositoryPath, runId } = await preparedRun();
    await approvePlanRun({
      repositoryPath,
      runId,
      confirmed: true,
      acceptOpenQuestions: false
    });
    const runPaths = getRunPaths(repositoryPath, runId);
    await fs.appendFile(runPaths.planPath, "\nThay đổi sau khi duyệt.\n", "utf8");

    await expect(requireCurrentPlanApproval(runPaths)).rejects.toMatchObject({
      code: "PLAN_CHANGED_AFTER_APPROVAL"
    } satisfies Partial<SpecRelayError>);
    await expect(showPlanRun(repositoryPath, runId)).resolves.toMatchObject({
      approval: { status: "stale" }
    });

    const reapproved = await approvePlanRun({
      repositoryPath,
      runId,
      confirmed: true,
      acceptOpenQuestions: false
    });
    expect(reapproved.state).toBe("approved");
    await expect(showPlanRun(repositoryPath, runId)).resolves.toMatchObject({
      approval: { status: "current" }
    });
  });

  it("rejects a locked, malformed, or non-existent run safely", async () => {
    const { repositoryPath, runId } = await preparedRun();
    const runPaths = getRunPaths(repositoryPath, runId);
    await fs.writeFile(runPaths.lockPath, "held", "utf8");

    await expect(
      approvePlanRun({
        repositoryPath,
        runId,
        confirmed: true,
        acceptOpenQuestions: false
      })
    ).rejects.toMatchObject({ code: "RUN_LOCKED" } satisfies Partial<SpecRelayError>);
    await fs.rm(runPaths.lockPath);

    await fs.writeFile(runPaths.statePath, "not json", "utf8");
    await expect(showPlanRun(repositoryPath, runId)).rejects.toMatchObject({
      code: "INVALID_PLAN"
    } satisfies Partial<SpecRelayError>);

    await expect(showPlanRun(repositoryPath, "run-does-not-exist")).rejects.toMatchObject({
      code: "RUN_NOT_FOUND"
    } satisfies Partial<SpecRelayError>);
  });
});
