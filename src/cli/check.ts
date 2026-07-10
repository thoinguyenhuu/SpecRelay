import fs from "node:fs/promises";

import {
  appendArtifactEvent,
  readInitializedConfig,
  readRunRecord,
  requireRunPaths,
  withRunLock,
  writeJsonAtomically
} from "../core/artifacts.js";
import { requireCurrentPlanApproval } from "../core/approval.js";
import {
  runCheck,
  validateCheckDefinition,
  writeChecksRecord,
  type CheckResult,
  type ChecksRecord
} from "../core/checks.js";
import { readExecutionRecord } from "../core/execution.js";
import { SpecRelayError } from "../core/errors.js";
import { parsePlanDocument } from "../core/plan.js";
import { transition } from "../core/state.js";
import { isPathInside } from "../core/worktree.js";
import { requireGitRepository } from "./git.js";

export interface RunChecksOptions {
  readonly repositoryPath: string;
  readonly runId: string;
}

export interface RunChecksResult {
  readonly command: "check";
  readonly runId: string;
  readonly state: "ready_for_review" | "failed";
  readonly checks: ChecksRecord;
}

function now(): string {
  return new Date().toISOString();
}

export async function runApprovedChecks(options: RunChecksOptions): Promise<RunChecksResult> {
  const repositoryRoot = requireGitRepository(options.repositoryPath);
  await readInitializedConfig(repositoryRoot);
  const runPaths = await requireRunPaths(repositoryRoot, options.runId);

  return withRunLock(runPaths, async () => {
    const run = await readRunRecord(runPaths);
    if (run.state !== "checking") {
      throw new SpecRelayError(
        "CHECKS_NOT_READY",
        "Checks can only run while the run is checking.",
        {
          currentState: run.state
        }
      );
    }
    await requireCurrentPlanApproval(runPaths);
    const execution = await readExecutionRecord(runPaths);
    if (execution.state !== "succeeded" || execution.outcome !== "succeeded") {
      throw new SpecRelayError(
        "CHECKS_NOT_READY",
        "Checks require a successful executor outcome.",
        { executionState: execution.state, outcome: execution.outcome }
      );
    }
    if (!isPathInside(execution.managedRoot, execution.worktreePath)) {
      throw new SpecRelayError(
        "INVALID_EXECUTION",
        "Execution worktree is outside its managed root."
      );
    }
    const plan = parsePlanDocument(await fs.readFile(runPaths.planPath, "utf8"));
    if (plan.checks.length === 0) {
      throw new SpecRelayError(
        "NO_CHECKS_CONFIGURED",
        "The approved plan has no checks. Update plan.md and approve it again before running checks."
      );
    }
    const checks = plan.checks.map((check) => validateCheckDefinition(check));
    const startedAt = now();
    const results: CheckResult[] = [];
    for (const check of checks) {
      const result = await runCheck(check, execution.worktreePath);
      results.push(result);
      if (result.outcome !== "passed") {
        break;
      }
    }
    const outcome =
      results.length === checks.length && results.every((result) => result.outcome === "passed")
        ? "passed"
        : "failed";
    const state = outcome === "passed" ? "ready_for_review" : "failed";
    const checksRecord: ChecksRecord = {
      schemaVersion: 1,
      runId: options.runId,
      startedAt,
      finishedAt: now(),
      outcome,
      results
    };
    await writeChecksRecord(runPaths, checksRecord);
    const occurredAt = now();
    const event = outcome === "passed" ? "checks_succeeded" : "checks_failed";
    const next = { ...transition(run, event), updatedAt: occurredAt };
    await writeJsonAtomically(runPaths.statePath, next);
    await appendArtifactEvent(runPaths.eventsPath, {
      schemaVersion: 1,
      runId: options.runId,
      timestamp: occurredAt,
      type: outcome === "passed" ? "checks_passed" : "checks_failed",
      details: { state: next.state, completed: results.length, configured: checks.length }
    });
    return { command: "check", runId: options.runId, state, checks: checksRecord };
  });
}
