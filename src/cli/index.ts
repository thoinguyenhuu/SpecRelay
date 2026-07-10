#!/usr/bin/env node

import { Command } from "commander";

import { isSpecRelayError } from "../core/errors.js";
import { runDoctor } from "./doctor.js";
import { initializeRepository } from "./init.js";

interface CommandOptions {
  readonly repo?: string;
  readonly json?: boolean;
  readonly dryRun?: boolean;
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

program.parseAsync().catch((error: unknown) => {
  writeError(error, false);
  process.exitCode = 1;
});
