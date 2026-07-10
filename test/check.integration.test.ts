import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { approvePlanRun } from "../src/cli/approval.js";
import { runApprovedChecks } from "../src/cli/check.js";
import { initializeRepository } from "../src/cli/init.js";
import { createPlanRun } from "../src/cli/plan.js";
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

function completePlan(checks = "checks: []"): string {
  return `---
schemaVersion: 1
language: vi
objective: Xác minh thay đổi
inScope:
  - Thay đổi đã duyệt
outOfScope: []
constraints: []
implementationSteps:
  - id: step-1
    description: Triển khai thay đổi
acceptanceCriteria:
  - id: ac-1
    description: Check thành công
openQuestions: []
${checks}
---

# Kế hoạch

Chạy các check đã duyệt trong worktree.
`;
}

type ChecksFactory = (repositoryPath: string) => Promise<string>;

async function createCheckingRun(
  createChecks?: ChecksFactory
): Promise<{ repositoryPath: string; runId: string; worktreePath: string }> {
  const repositoryPath = await createCommittedTemporaryGitRepository();
  temporaryDirectories.push(repositoryPath);
  await initializeRepository({ repositoryPath, dryRun: false });
  const created = await createPlanRun({
    repositoryPath,
    objective: "Xác minh thay đổi",
    language: "vi"
  });
  const runPaths = getRunPaths(repositoryPath, created.runId);
  await fs.writeFile(
    runPaths.planPath,
    completePlan(createChecks === undefined ? undefined : await createChecks(repositoryPath)),
    "utf8"
  );
  await approvePlanRun({
    repositoryPath,
    runId: created.runId,
    confirmed: true,
    acceptOpenQuestions: false
  });

  const managedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "specrelay-check-worktrees-"));
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
  const started = createExecutionRecord({
    runId: created.runId,
    baseCommit,
    branchName,
    managedRoot: owned.root,
    worktreePath: owned.worktreePath,
    timeoutMs: 60_000
  });
  const finishedAt = new Date().toISOString();
  await writeExecutionRecord(runPaths, {
    ...started,
    state: "succeeded",
    finishedAt,
    exitCode: 0,
    outcome: "succeeded"
  });
  const approved = await readRunRecord(runPaths);
  const implementing = transition(approved, "start_implementation");
  await writeJsonAtomically(runPaths.statePath, {
    ...transition(implementing, "implementation_succeeded"),
    updatedAt: finishedAt
  });
  return { repositoryPath, runId: created.runId, worktreePath: owned.worktreePath };
}

async function createNodeScript(
  repositoryPath: string,
  fileName: string,
  content: string
): Promise<string> {
  const scriptPath = path.join(repositoryPath, fileName);
  await fs.writeFile(scriptPath, content, "utf8");
  return scriptPath;
}

describe("approved worktree checks", () => {
  it("runs explicit Node checks without a shell, stops at the first failure, and changes state", async () => {
    const fixture = await createCheckingRun(async (repositoryPath) => {
      const first = await createNodeScript(
        repositoryPath,
        "first-check.mjs",
        'process.stdout.write("first ok\\n");'
      );
      const failing = await createNodeScript(
        repositoryPath,
        "failing-check.mjs",
        'process.stderr.write("GITHUB_TOKEN=secret-token-value\\n"); process.exitCode = 1;'
      );
      const third = await createNodeScript(
        repositoryPath,
        "third-check.mjs",
        'import fs from "node:fs"; fs.writeFileSync("must-not-exist.txt", "bad");'
      );
      const node = process.execPath.replace(/\\/gu, "/");
      return `checks:
  - id: first
    preset: node
    argv: ["${node}", "${first.replace(/\\/gu, "/")}"]
    timeout: "5s"
  - id: fail
    preset: node
    argv: ["${node}", "${failing.replace(/\\/gu, "/")}"]
    timeout: "5s"
  - id: skipped
    preset: node
    argv: ["${node}", "${third.replace(/\\/gu, "/")}"]
    timeout: "5s"`;
    });
    const runPaths = getRunPaths(fixture.repositoryPath, fixture.runId);

    const result = await runApprovedChecks({
      repositoryPath: fixture.repositoryPath,
      runId: fixture.runId
    });

    expect(result).toMatchObject({ state: "failed", checks: { outcome: "failed" } });
    expect(result.checks.results).toHaveLength(2);
    expect(result.checks.results[1]?.output).toContain("GITHUB_TOKEN=[REDACTED]");
    await expect(
      fs.access(path.join(fixture.worktreePath, "must-not-exist.txt"))
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readRunRecord(runPaths)).resolves.toMatchObject({ state: "failed" });
  });

  it("refuses missing checks and stale plans without changing the run", async () => {
    const noChecks = await createCheckingRun();
    await expect(
      runApprovedChecks({ repositoryPath: noChecks.repositoryPath, runId: noChecks.runId })
    ).rejects.toMatchObject({
      code: "NO_CHECKS_CONFIGURED"
    });
    await expect(
      readRunRecord(getRunPaths(noChecks.repositoryPath, noChecks.runId))
    ).resolves.toMatchObject({ state: "checking" });

    const stale = await createCheckingRun();
    await fs.appendFile(
      getRunPaths(stale.repositoryPath, stale.runId).planPath,
      "\nThay đổi sau approval.\n",
      "utf8"
    );
    await expect(
      runApprovedChecks({ repositoryPath: stale.repositoryPath, runId: stale.runId })
    ).rejects.toMatchObject({
      code: "PLAN_CHANGED_AFTER_APPROVAL"
    });
  });
});
