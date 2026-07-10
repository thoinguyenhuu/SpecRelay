import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { approvePlanRun } from "../src/cli/approval.js";
import { runExecutorWorker } from "../src/cli/executor-worker.js";
import { implementApprovedRun, requestExecutionCancellation } from "../src/cli/implementation.js";
import { cleanupExecution } from "../src/cli/implementation.js";
import { initializeRepository } from "../src/cli/init.js";
import { createPlanRun } from "../src/cli/plan.js";
import { readRunRecord, writeJsonAtomically, writeTextAtomically } from "../src/core/artifacts.js";
import {
  createExecutionPolicy,
  createExecutionRecord,
  readExecutionRecord,
  writeExecutionRecord
} from "../src/core/execution.js";
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

function completePlan(): string {
  return `---
schemaVersion: 1
language: vi
objective: Tạo module quản lý cơ sở giáo dục
inScope:
  - Tạo API quản lý cơ sở giáo dục
outOfScope: []
constraints:
  - NestJS
implementationSteps:
  - id: step-1
    description: Tạo module
acceptanceCriteria:
  - id: ac-1
    description: Unit test chạy thành công
openQuestions: []
---

# Cách tiếp cận

Triển khai trong worktree riêng.
`;
}

async function createApprovedRun(): Promise<{ repositoryPath: string; runId: string }> {
  const repositoryPath = await createCommittedTemporaryGitRepository();
  temporaryDirectories.push(repositoryPath);
  await initializeRepository({ repositoryPath, dryRun: false });
  const created = await createPlanRun({
    repositoryPath,
    objective: "Tạo module quản lý cơ sở giáo dục",
    language: "vi"
  });
  const runPaths = getRunPaths(repositoryPath, created.runId);
  await fs.writeFile(runPaths.planPath, completePlan(), "utf8");
  await approvePlanRun({
    repositoryPath,
    runId: created.runId,
    confirmed: true,
    acceptOpenQuestions: false
  });
  return { repositoryPath, runId: created.runId };
}

async function prepareWorkerFixture(
  script: string,
  timeoutMs = 5_000
): Promise<{
  repositoryPath: string;
  runId: string;
  fakeScriptPath: string;
}> {
  const approved = await createApprovedRun();
  const runPaths = getRunPaths(approved.repositoryPath, approved.runId);
  const managedRoot = await fs.mkdtemp(path.join(os.tmpdir(), "specrelay-managed-worktrees-"));
  temporaryDirectories.push(managedRoot);
  const owned = await getOwnedWorktreePath(approved.runId, managedRoot);
  const baseCommit = resolveBaseCommit(approved.repositoryPath);
  const branchName = `specrelay/${approved.runId}`;
  await createIsolatedWorktree({
    repositoryRoot: approved.repositoryPath,
    branchName,
    baseCommit,
    worktreePath: owned.worktreePath,
    managedRoot: owned.root
  });
  const prompt = "Implement the approved fixture plan.";
  const policy = createExecutionPolicy({ maxTurns: 2, timeoutMs, prompt });
  await writeJsonAtomically(runPaths.policyPath, policy);
  await writeTextAtomically(runPaths.executorPromptPath, prompt);
  await fs.writeFile(runPaths.executorEventsPath, "", "utf8");
  await writeExecutionRecord(
    runPaths,
    createExecutionRecord({
      runId: approved.runId,
      baseCommit,
      branchName,
      managedRoot: owned.root,
      worktreePath: owned.worktreePath,
      timeoutMs
    })
  );
  const run = await readRunRecord(runPaths);
  await writeJsonAtomically(runPaths.statePath, {
    ...transition(run, "start_implementation"),
    updatedAt: new Date().toISOString()
  });

  const fakeScriptPath = path.join(approved.repositoryPath, "fake-claude.mjs");
  await fs.writeFile(fakeScriptPath, script, "utf8");
  return { repositoryPath: approved.repositoryPath, runId: approved.runId, fakeScriptPath };
}

const successfulFake = `import fs from "node:fs";
fs.writeFileSync("executor-change.txt", "changed\\n");
console.log(JSON.stringify({ type: "system", subtype: "init", session_id: "fake-session" }));
console.log(JSON.stringify({ type: "result", subtype: "success", is_error: false, session_id: "fake-session" }));
`;

const malformedFake = `console.log("this is not JSON");`;
const slowFake = `setTimeout(() => console.log(JSON.stringify({ type: "result", subtype: "success", is_error: false })), 5000);`;

describe("executor worker", () => {
  it("runs a fake Claude only inside the isolated worktree and advances to checking", async () => {
    const fixture = await prepareWorkerFixture(successfulFake);

    await runExecutorWorker({
      repositoryRoot: fixture.repositoryPath,
      runId: fixture.runId,
      claudeBinary: process.execPath,
      claudeArgumentsPrefix: [fixture.fakeScriptPath]
    });

    const runPaths = getRunPaths(fixture.repositoryPath, fixture.runId);
    await expect(
      fs.access(path.join(fixture.repositoryPath, "executor-change.txt"))
    ).rejects.toMatchObject({
      code: "ENOENT"
    });
    await expect(readExecutionRecord(runPaths)).resolves.toMatchObject({
      state: "succeeded",
      outcome: "succeeded"
    });
    await expect(readRunRecord(runPaths)).resolves.toMatchObject({ state: "checking" });
  });

  it("marks malformed output and timeout as interrupted", async () => {
    const malformed = await prepareWorkerFixture(malformedFake);
    await runExecutorWorker({
      repositoryRoot: malformed.repositoryPath,
      runId: malformed.runId,
      claudeBinary: process.execPath,
      claudeArgumentsPrefix: [malformed.fakeScriptPath]
    });
    await expect(
      readExecutionRecord(getRunPaths(malformed.repositoryPath, malformed.runId))
    ).resolves.toMatchObject({
      state: "interrupted",
      outcome: "interrupted"
    });

    const timeout = await prepareWorkerFixture(slowFake, 1_000);
    await runExecutorWorker({
      repositoryRoot: timeout.repositoryPath,
      runId: timeout.runId,
      claudeBinary: process.execPath,
      claudeArgumentsPrefix: [timeout.fakeScriptPath]
    });
    await expect(
      readExecutionRecord(getRunPaths(timeout.repositoryPath, timeout.runId))
    ).resolves.toMatchObject({
      state: "interrupted",
      outcome: "interrupted"
    });
  });

  it("uses a cancellation request instead of killing an unverified PID", async () => {
    const fixture = await prepareWorkerFixture(slowFake, 10_000);
    const running = runExecutorWorker({
      repositoryRoot: fixture.repositoryPath,
      runId: fixture.runId,
      claudeBinary: process.execPath,
      claudeArgumentsPrefix: [fixture.fakeScriptPath]
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    await requestExecutionCancellation({
      repositoryPath: fixture.repositoryPath,
      runId: fixture.runId,
      confirmed: true
    });
    await running;

    await expect(
      readExecutionRecord(getRunPaths(fixture.repositoryPath, fixture.runId))
    ).resolves.toMatchObject({
      state: "cancelled",
      outcome: "cancelled"
    });
  });

  it("does not create artifacts in an implementation dry run and blocks a stale plan", async () => {
    const fixture = await createApprovedRun();
    const dryRun = await implementApprovedRun({
      repositoryPath: fixture.repositoryPath,
      runId: fixture.runId,
      confirmed: true,
      dryRun: true,
      claudeBinary: process.execPath
    });
    expect(dryRun.dryRun).toBe(true);

    const runPaths = getRunPaths(fixture.repositoryPath, fixture.runId);
    await expect(fs.access(runPaths.executionPath)).rejects.toMatchObject({ code: "ENOENT" });
    await fs.writeFile(path.join(fixture.repositoryPath, "dirty.txt"), "dirty\n", "utf8");
    await expect(
      implementApprovedRun({
        repositoryPath: fixture.repositoryPath,
        runId: fixture.runId,
        confirmed: true,
        dryRun: true,
        claudeBinary: process.execPath
      })
    ).rejects.toMatchObject({ code: "BASE_REPOSITORY_DIRTY" });
    await fs.rm(path.join(fixture.repositoryPath, "dirty.txt"));
    await fs.appendFile(runPaths.planPath, "\nChanged after approval.\n", "utf8");
    await expect(
      implementApprovedRun({
        repositoryPath: fixture.repositoryPath,
        runId: fixture.runId,
        confirmed: true,
        dryRun: true,
        claudeBinary: process.execPath
      })
    ).rejects.toMatchObject({ code: "PLAN_CHANGED_AFTER_APPROVAL" });
  });

  it("removes only a clean, terminal owned worktree and retains audit artifacts", async () => {
    const fixture = await prepareWorkerFixture(malformedFake);
    await runExecutorWorker({
      repositoryRoot: fixture.repositoryPath,
      runId: fixture.runId,
      claudeBinary: process.execPath,
      claudeArgumentsPrefix: [fixture.fakeScriptPath]
    });
    const runPaths = getRunPaths(fixture.repositoryPath, fixture.runId);
    const execution = await readExecutionRecord(runPaths);
    const cleanup = await cleanupExecution({
      repositoryPath: fixture.repositoryPath,
      runId: fixture.runId,
      confirmed: true
    });

    expect(cleanup).toMatchObject({ worktreeRemoved: true, branchDeleted: true });
    await expect(fs.access(execution.worktreePath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.access(runPaths.executorSummaryPath)).resolves.toBeUndefined();
  });
});
