#!/usr/bin/env node

import { Command } from "commander";

import { isSpecRelayError } from "../core/errors.js";
import { runDoctor } from "./doctor.js";
import { approvePlanRun } from "./approval.js";
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
}

function writeResult(value: unknown, json: boolean): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }

  if (typeof value === "object" && value !== null && "checks" in value) {
    const report = value as {
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

program.parseAsync().catch((error: unknown) => {
  writeError(error, false);
  process.exitCode = 1;
});
