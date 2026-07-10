import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { approvePlanRun } from "../src/cli/approval.js";
import { runApprovedChecks } from "../src/cli/check.js";
import { initializeRepository } from "../src/cli/init.js";
import { createPlanRun } from "../src/cli/plan.js";
import { createReviewPacket, getFinalReport, getRunDiff, recordReview } from "../src/cli/review.js";
import { readRunRecord, writeJsonAtomically } from "../src/core/artifacts.js";
import { createExecutionRecord, writeExecutionRecord } from "../src/core/execution.js";
import { getRunPaths } from "../src/core/paths.js";
import { transition } from "../src/core/state.js";
import {
  createIsolatedWorktree,
  getOwnedWorktreePath,
  resolveBaseCommit
} from "../src/core/worktree.js";
import { createCommittedTemporaryGitRepository } from "./helpers.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true }))
  );
});

function completePlan(checkScript: string): string {
  const node = process.execPath.replace(/\\/gu, "/");
  return `---
schemaVersion: 1
language: vi
objective: Kiểm tra review
inScope:
  - Thay đổi đã duyệt
outOfScope: []
constraints: []
implementationSteps:
  - id: step-1
    description: Triển khai thay đổi
acceptanceCriteria:
  - id: ac-1
    description: Check và review thành công
openQuestions: []
checks:
  - id: fixture
    preset: node
    argv: ["${node}", "${checkScript.replace(/\\/gu, "/")}"]
    timeout: "5s"
---

# Kế hoạch

Kiểm tra và review thay đổi trong worktree.
`;
}

async function createReadyRun(): Promise<{
  repositoryPath: string;
  runId: string;
  worktreePath: string;
}> {
  const repositoryPath = await createCommittedTemporaryGitRepository();
  temporaryDirectories.push(repositoryPath);
  const checkScript = path.join(repositoryPath, "check.mjs");
  await fs.writeFile(checkScript, 'process.stdout.write("ok\\n");', "utf8");
  await initializeRepository({ repositoryPath, dryRun: false });
  const created = await createPlanRun({
    repositoryPath,
    objective: "Kiểm tra review",
    language: "vi"
  });
  const runPaths = getRunPaths(repositoryPath, created.runId);
  await fs.writeFile(runPaths.planPath, completePlan(checkScript), "utf8");
  await approvePlanRun({
    repositoryPath,
    runId: created.runId,
    confirmed: true,
    acceptOpenQuestions: false
  });

  const managedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "specrelay-review-worktrees-"));
  temporaryDirectories.push(managedRoot);
  const owned = await getOwnedWorktreePath(created.runId, managedRoot);
  const baseCommit = resolveBaseCommit(repositoryPath);
  const branchName = `specrelay/${created.runId}`;
  await createIsolatedWorktree({
    repositoryRoot: repositoryPath,
    branchName,
    baseCommit,
    worktreePath: owned.worktreePath,
    managedRoot: owned.root
  });
  await fs.writeFile(
    path.join(owned.worktreePath, "reviewed-change.ts"),
    "export const reviewed = true;\n",
    "utf8"
  );
  execFileSync("git", ["add", "reviewed-change.ts"], { cwd: owned.worktreePath });
  const started = createExecutionRecord({
    runId: created.runId,
    baseCommit,
    branchName,
    managedRoot: owned.root,
    worktreePath: owned.worktreePath,
    timeoutMs: 60_000
  });
  const finishedAt = new Date().toISOString();
  const execution = {
    ...started,
    state: "succeeded" as const,
    finishedAt,
    exitCode: 0,
    outcome: "succeeded" as const
  };
  await writeExecutionRecord(runPaths, execution);
  await writeJsonAtomically(runPaths.executorSummaryPath, {
    schemaVersion: 1,
    runId: created.runId,
    executionId: execution.executionId,
    outcome: "succeeded",
    startedAt: execution.startedAt,
    finishedAt,
    durationMs: 1,
    exitCode: 0,
    changedFiles: ["reviewed-change.ts"]
  });
  const approved = await readRunRecord(runPaths);
  const implementing = transition(approved, "start_implementation");
  await writeJsonAtomically(runPaths.statePath, {
    ...transition(implementing, "implementation_succeeded"),
    updatedAt: finishedAt
  });
  await runApprovedChecks({ repositoryPath, runId: created.runId });
  return { repositoryPath, runId: created.runId, worktreePath: owned.worktreePath };
}

describe("review packet and quality gate", () => {
  it("creates bounded evidence, records escalation, and produces the canonical final report", async () => {
    const fixture = await createReadyRun();
    const packet = await createReviewPacket(fixture.repositoryPath, fixture.runId);
    const fullDiff = await getRunDiff({
      repositoryPath: fixture.repositoryPath,
      runId: fixture.runId,
      stat: false,
      pathspec: []
    });
    const stat = await getRunDiff({
      repositoryPath: fixture.repositoryPath,
      runId: fixture.runId,
      stat: true,
      pathspec: []
    });

    expect(packet.packet).toMatchObject({
      checks: { outcome: "passed" },
      diff: { sha256: fullDiff.sha256 }
    });
    expect(fullDiff.content).toContain("reviewed-change.ts");
    expect(stat.content).toContain("1 file changed");

    const reviewInput = path.join(fixture.repositoryPath, "review-input.json");
    await fs.writeFile(
      reviewInput,
      JSON.stringify({
        decision: "needs_human",
        summary: "Cần người quyết định về transaction.",
        findings: [
          {
            id: "F-001",
            severity: "important",
            file: "reviewed-change.ts",
            line: 1,
            category: "maintainability",
            problem: "Ví dụ finding.",
            evidence: ["reviewed-change.ts:1"],
            requiredFix: "Quyết định hướng xử lý."
          }
        ]
      }),
      "utf8"
    );
    const recorded = await recordReview({
      repositoryPath: fixture.repositoryPath,
      runId: fixture.runId,
      inputPath: reviewInput
    });
    const report = await getFinalReport(fixture.repositoryPath, fixture.runId);

    expect(recorded).toMatchObject({ state: "needs_human", review: { decision: "needs_human" } });
    expect(report.report).toMatchObject({
      state: "needs_human",
      checks: { outcome: "passed" },
      review: { decision: "needs_human" }
    });
    await expect(
      fs.access(getRunPaths(fixture.repositoryPath, fixture.runId).finalReportPath)
    ).resolves.toBeUndefined();
  });

  it("rejects an unsafe review decision without changing ready_for_review", async () => {
    const fixture = await createReadyRun();
    const reviewInput = path.join(fixture.repositoryPath, "invalid-review.json");
    await fs.writeFile(
      reviewInput,
      JSON.stringify({
        decision: "complete",
        summary: "Không hợp lệ.",
        findings: [
          {
            id: "F-001",
            severity: "blocking",
            file: "reviewed-change.ts",
            line: 1,
            category: "security",
            problem: "Lỗi blocking.",
            evidence: [],
            requiredFix: "Sửa lỗi."
          }
        ]
      }),
      "utf8"
    );
    await expect(
      recordReview({
        repositoryPath: fixture.repositoryPath,
        runId: fixture.runId,
        inputPath: reviewInput
      })
    ).rejects.toMatchObject({ code: "INVALID_REVIEW" });
    await expect(
      readRunRecord(getRunPaths(fixture.repositoryPath, fixture.runId))
    ).resolves.toMatchObject({ state: "ready_for_review" });
  });
});
