#!/usr/bin/env node

import { Command } from "commander";

import { isExecutionTerminal } from "../core/execution.js";
import { isSpecRelayError } from "../core/errors.js";
import { approvePlanRun } from "./approval.js";
import { runApprovedChecks } from "./check.js";
import { runDoctor } from "./doctor.js";
import { runExecutorWorker } from "./executor-worker.js";
import {
  cleanupExecution,
  formatExecutionPreview,
  getExecutionReport,
  getExecutionStatus,
  implementApprovedRun,
  requestExecutionCancellation
} from "./implementation.js";
import { initializeRepository } from "./init.js";
import { createPlanRun, showPlanRun, type PlanSummary } from "./plan.js";

interface CommandOptions {
  readonly repo?: string;
  readonly json?: boolean;
  readonly dryRun?: boolean;
  readonly language?: "vi";
  readonly yes?: boolean;
  readonly approvedBy?: string;
  readonly acceptOpenQuestions?: boolean;
  readonly reason?: string;
  readonly maxTurns?: string;
  readonly timeout?: string;
  readonly follow?: boolean;
  readonly claudeBin?: string;
}

function writeResult(value: unknown, json: boolean): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }

  if (
    typeof value === "object" &&
    value !== null &&
    "command" in value &&
    value.command === "doctor" &&
    "checks" in value
  ) {
    const report = value as unknown as {
      readonly healthy: boolean;
      readonly checks: readonly { id: string; status: string; message: string }[];
    };
    for (const check of report.checks) {
      process.stdout.write(`[${check.status.toUpperCase()}] ${check.id}: ${check.message}\n`);
    }
    process.stdout.write(
      report.healthy
        ? "SpecRelay doctor completed successfully.\n"
        : "SpecRelay doctor found blocking issues.\n"
    );
    return;
  }

  if (typeof value === "object" && value !== null && "summary" in value) {
    const result = value as {
      readonly runId: string;
      readonly state: string;
      readonly summary: PlanSummary;
    };
    process.stdout.write(`Created run ${result.runId} in ${result.state}.\n`);
    writePlanSummary(result.summary);
    return;
  }

  if (typeof value === "object" && value !== null && "approval" in value && "runId" in value) {
    if ("state" in value && "command" in value && value.command === "approve") {
      const result = value as {
        readonly runId: string;
        readonly state: string;
        readonly approval: { readonly approvedBy: string; readonly planSha256: string };
      };
      process.stdout.write(`Approved run ${result.runId} in ${result.state}.\n`);
      process.stdout.write(`Approved by: ${result.approval.approvedBy}\n`);
      process.stdout.write(`Plan hash: ${result.approval.planSha256}\n`);
      return;
    }
    writePlanSummary(value as PlanSummary);
    return;
  }

  if (typeof value === "object" && value !== null && "command" in value && "runId" in value) {
    const result = value as Record<string, unknown>;
    if (result.command === "implement") {
      const preview = formatExecutionPreview(value as Parameters<typeof formatExecutionPreview>[0]);
      process.stdout.write(
        `${result.dryRun === true ? "Would prepare" : "Started"} execution for ${result.runId}.\n`
      );
      process.stdout.write(`${preview}\n`);
      return;
    }
    if (result.command === "status") {
      const execution = result.execution as { state: string; heartbeatAt: string };
      process.stdout.write(
        `Run ${result.runId}: ${String(result.runState)} / ${execution.state}\n`
      );
      process.stdout.write(`Heartbeat: ${execution.heartbeatAt}\n`);
      return;
    }
    if (result.command === "cancel") {
      process.stdout.write(`Cancellation state for ${result.runId}: ${String(result.state)}\n`);
      return;
    }
    if (result.command === "cleanup") {
      process.stdout.write(
        `Cleanup for ${result.runId}: worktree=${String(result.worktreeRemoved)}, branch=${String(result.branchDeleted)}\n`
      );
      return;
    }
    if (result.command === "report") {
      const execution = result.execution as { state: string; worktreePath: string };
      process.stdout.write(`Execution ${result.runId}: ${execution.state}\n`);
      process.stdout.write(`Worktree: ${execution.worktreePath}\n`);
      return;
    }
    if (result.command === "check") {
      const checks = result.checks as {
        outcome: string;
        results: readonly { id: string; outcome: string }[];
      };
      process.stdout.write(`Checks for ${result.runId}: ${checks.outcome}\n`);
      for (const check of checks.results) {
        process.stdout.write(`- ${check.id}: ${check.outcome}\n`);
      }
      return;
    }
  }

  const result = value as {
    readonly initialized: boolean;
    readonly dryRun: boolean;
    readonly plannedChanges: readonly string[];
  };
  if (result.plannedChanges.length === 0) {
    process.stdout.write("SpecRelay is already initialized; no files were changed.\n");
    return;
  }

  const prefix = result.dryRun ? "Would" : "Applied";
  process.stdout.write(`${prefix} the following changes:\n`);
  for (const change of result.plannedChanges) {
    process.stdout.write(`- ${change}\n`);
  }
}

function writePlanSummary(summary: PlanSummary): void {
  process.stdout.write(`Objective: ${summary.objective}\n`);
  process.stdout.write(`State: ${summary.state}\n`);
  process.stdout.write(
    `Plan: ${summary.implementationStepCount} step(s), ${summary.acceptanceCriterionCount} acceptance criterion/criteria\n`
  );
  process.stdout.write(`Scope: ${summary.scope.in.length} in, ${summary.scope.out.length} out\n`);
  process.stdout.write(`Open questions: ${summary.openQuestions.length}\n`);
  process.stdout.write(`Approval: ${summary.approval.status}\n`);
}

function writeError(error: unknown, json: boolean): void {
  const payload = isSpecRelayError(error)
    ? { error: { code: error.code, message: error.message, details: error.details } }
    : {
        error: {
          code: "INTERNAL_ERROR",
          message: error instanceof Error ? error.message : "Unknown error."
        }
      };

  if (json) {
    process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    process.stderr.write(`[${payload.error.code}] ${payload.error.message}\n`);
  }
}

const program = new Command();
program
  .name("specrelay")
  .description("Plan approval and review workflow for Codex and Claude Code.")
  .version("0.1.0");

program
  .command("doctor")
  .description("Check the local SpecRelay development environment without changing files.")
  .option("--repo <path>", "Repository or directory to inspect", process.cwd())
  .option("--json", "Print machine-readable JSON")
  .action((options: CommandOptions) => {
    const report = runDoctor(options.repo ?? process.cwd());
    writeResult(report, options.json ?? false);
    if (!report.healthy) {
      process.exitCode = 1;
    }
  });

program
  .command("approve <run-id>")
  .description("Approve the current plan after explicit human confirmation.")
  .option("--yes", "Confirm that the displayed plan is approved")
  .option("--repo <path>", "Repository containing the run", process.cwd())
  .option("--approved-by <label>", "Audit label for the person approving")
  .option("--accept-open-questions", "Explicitly accept blocking open questions")
  .option("--reason <text>", "Reason for accepting blocking open questions")
  .option("--json", "Print machine-readable JSON")
  .action(async (runId: string, options: CommandOptions) => {
    try {
      const result = await approvePlanRun({
        repositoryPath: options.repo ?? process.cwd(),
        runId,
        confirmed: options.yes ?? false,
        acceptOpenQuestions: options.acceptOpenQuestions ?? false,
        ...(options.approvedBy === undefined ? {} : { approvedBy: options.approvedBy }),
        ...(options.reason === undefined ? {} : { reason: options.reason })
      });
      writeResult(result, options.json ?? false);
    } catch (error) {
      writeError(error, options.json ?? false);
      process.exitCode = 1;
    }
  });

program
  .command("init")
  .description("Initialize local SpecRelay artifacts in a Git repository.")
  .option("--repo <path>", "Repository or directory to initialize", process.cwd())
  .option("--dry-run", "Show the planned changes without writing files")
  .option("--json", "Print machine-readable JSON")
  .action(async (options: CommandOptions) => {
    try {
      const result = await initializeRepository({
        repositoryPath: options.repo ?? process.cwd(),
        dryRun: options.dryRun ?? false
      });
      writeResult(result, options.json ?? false);
    } catch (error) {
      writeError(error, options.json ?? false);
      process.exitCode = 1;
    }
  });

program
  .command("plan <objective>")
  .description("Create a Vietnamese plan draft and its local artifacts.")
  .option("--repo <path>", "Repository to use", process.cwd())
  .option("--language <language>", "Plan language", "vi")
  .option("--json", "Print machine-readable JSON")
  .action(async (objective: string, options: CommandOptions) => {
    try {
      if (options.language !== "vi") {
        throw new Error("Only the 'vi' plan language is supported in Phase B.");
      }
      const result = await createPlanRun({
        repositoryPath: options.repo ?? process.cwd(),
        objective,
        language: options.language
      });
      writeResult(result, options.json ?? false);
    } catch (error) {
      writeError(error, options.json ?? false);
      process.exitCode = 1;
    }
  });

program
  .command("show <run-id>")
  .description("Show a compact, chat-friendly plan summary.")
  .option("--repo <path>", "Repository containing the run", process.cwd())
  .option("--json", "Print machine-readable JSON")
  .action(async (runId: string, options: CommandOptions) => {
    try {
      const result = await showPlanRun(options.repo ?? process.cwd(), runId);
      writeResult(result, options.json ?? false);
    } catch (error) {
      writeError(error, options.json ?? false);
      process.exitCode = 1;
    }
  });

program
  .command("implement <run-id>")
  .description("Create an isolated worktree and start a controlled Claude Code executor.")
  .option("--yes", "Confirm isolated execution and Claude usage")
  .option("--repo <path>", "Repository containing the run", process.cwd())
  .option("--max-turns <count>", "Maximum Claude agentic turns (1-10)")
  .option("--timeout <duration>", "Executor timeout from 1s to 20m")
  .option("--dry-run", "Print the exact execution preview without writing or spawning")
  .option("--json", "Print machine-readable JSON")
  .action(async (runId: string, options: CommandOptions) => {
    try {
      const result = await implementApprovedRun({
        repositoryPath: options.repo ?? process.cwd(),
        runId,
        confirmed: options.yes ?? false,
        dryRun: options.dryRun ?? false,
        ...(options.maxTurns === undefined ? {} : { maxTurns: options.maxTurns }),
        ...(options.timeout === undefined ? {} : { timeout: options.timeout })
      });
      writeResult(result, options.json ?? false);
    } catch (error) {
      writeError(error, options.json ?? false);
      process.exitCode = 1;
    }
  });

program
  .command("status <run-id>")
  .description("Show executor state and heartbeat for a run.")
  .option("--repo <path>", "Repository containing the run", process.cwd())
  .option("--follow", "Refresh once per second until the execution reaches a terminal state")
  .option("--json", "Print machine-readable JSON")
  .action(async (runId: string, options: CommandOptions) => {
    try {
      let result = await getExecutionStatus(options.repo ?? process.cwd(), runId);
      writeResult(result, options.json ?? false);
      while (options.follow === true && !isExecutionTerminal(result.execution.state)) {
        await new Promise<void>((resolve) => setTimeout(resolve, 1000));
        result = await getExecutionStatus(options.repo ?? process.cwd(), runId);
        writeResult(result, options.json ?? false);
      }
    } catch (error) {
      writeError(error, options.json ?? false);
      process.exitCode = 1;
    }
  });

program
  .command("check <run-id>")
  .description("Run the approved, explicit checks in this run's isolated worktree.")
  .option("--repo <path>", "Repository containing the run", process.cwd())
  .option("--json", "Print machine-readable JSON")
  .action(async (runId: string, options: CommandOptions) => {
    try {
      writeResult(
        await runApprovedChecks({ repositoryPath: options.repo ?? process.cwd(), runId }),
        options.json ?? false
      );
    } catch (error) {
      writeError(error, options.json ?? false);
      process.exitCode = 1;
    }
  });

program
  .command("cancel <run-id>")
  .description("Request cancellation from an active executor worker.")
  .option("--yes", "Confirm cancellation")
  .option("--repo <path>", "Repository containing the run", process.cwd())
  .option("--json", "Print machine-readable JSON")
  .action(async (runId: string, options: CommandOptions) => {
    try {
      const result = await requestExecutionCancellation({
        repositoryPath: options.repo ?? process.cwd(),
        runId,
        confirmed: options.yes ?? false
      });
      writeResult(result, options.json ?? false);
    } catch (error) {
      writeError(error, options.json ?? false);
      process.exitCode = 1;
    }
  });

program
  .command("cleanup <run-id>")
  .description("Remove a clean, terminal isolated worktree while retaining audit artifacts.")
  .option("--yes", "Confirm worktree cleanup")
  .option("--repo <path>", "Repository containing the run", process.cwd())
  .option("--json", "Print machine-readable JSON")
  .action(async (runId: string, options: CommandOptions) => {
    try {
      const result = await cleanupExecution({
        repositoryPath: options.repo ?? process.cwd(),
        runId,
        confirmed: options.yes ?? false
      });
      writeResult(result, options.json ?? false);
    } catch (error) {
      writeError(error, options.json ?? false);
      process.exitCode = 1;
    }
  });

program
  .command("report <run-id>")
  .description("Show the local executor summary without running checks or review.")
  .option("--repo <path>", "Repository containing the run", process.cwd())
  .option("--json", "Print machine-readable JSON")
  .action(async (runId: string, options: CommandOptions) => {
    try {
      writeResult(
        await getExecutionReport(options.repo ?? process.cwd(), runId),
        options.json ?? false
      );
    } catch (error) {
      writeError(error, options.json ?? false);
      process.exitCode = 1;
    }
  });

program
  .command("__execute-worker <run-id>", { hidden: true })
  .description("Internal executor worker entry point.")
  .requiredOption("--repo <path>")
  .requiredOption("--claude-bin <path>")
  .action(async (runId: string, options: CommandOptions) => {
    try {
      await runExecutorWorker({
        repositoryRoot: options.repo ?? process.cwd(),
        runId,
        claudeBinary: options.claudeBin ?? "claude"
      });
    } catch (error) {
      writeError(error, false);
      process.exitCode = 1;
    }
  });

program.parseAsync().catch((error: unknown) => {
  writeError(error, false);
  process.exitCode = 1;
});
