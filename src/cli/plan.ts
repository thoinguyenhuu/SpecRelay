import fs from "node:fs/promises";

import {
  appendArtifactEvent,
  createRequestDocument,
  createRunDirectory,
  createRunId,
  readInitializedConfig,
  readRunRecord,
  requireRunPaths,
  writeInitialRunArtifacts
} from "../core/artifacts.js";
import { SpecRelayError } from "../core/errors.js";
import {
  createVietnamesePlanDocument,
  parsePlanDocument,
  type OpenQuestion
} from "../core/plan.js";
import type { RunRecord } from "../core/run.js";
import { requireGitRepository } from "./git.js";

export interface CreatePlanOptions {
  readonly repositoryPath: string;
  readonly objective: string;
  readonly language: "vi";
}

export interface PlanSummary {
  readonly command: "show";
  readonly runId: string;
  readonly state: RunRecord["state"];
  readonly objective: string;
  readonly scope: {
    readonly in: readonly string[];
    readonly out: readonly string[];
  };
  readonly implementationStepCount: number;
  readonly acceptanceCriterionCount: number;
  readonly openQuestions: readonly OpenQuestion[];
  readonly approval: {
    readonly status: "not_approved";
  };
}

export interface CreatePlanResult {
  readonly command: "plan";
  readonly runId: string;
  readonly repositoryRoot: string;
  readonly state: "draft_plan";
  readonly summary: PlanSummary;
}

function now(): string {
  return new Date().toISOString();
}

function createRunRecord(runId: string, repositoryRoot: string, timestamp: string): RunRecord {
  return {
    schemaVersion: 1,
    id: runId,
    repositoryRoot,
    state: "draft_plan",
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function buildPlanSummary(runId: string, run: RunRecord, planContent: string): PlanSummary {
  const plan = parsePlanDocument(planContent);

  return {
    command: "show",
    runId,
    state: run.state,
    objective: plan.objective,
    scope: {
      in: plan.inScope,
      out: plan.outOfScope
    },
    implementationStepCount: plan.implementationSteps.length,
    acceptanceCriterionCount: plan.acceptanceCriteria.length,
    openQuestions: plan.openQuestions,
    approval: { status: "not_approved" }
  };
}

export async function createPlanRun(options: CreatePlanOptions): Promise<CreatePlanResult> {
  const repositoryRoot = requireGitRepository(options.repositoryPath);
  await readInitializedConfig(repositoryRoot);

  const objective = options.objective.trim();
  if (objective.length === 0) {
    throw new SpecRelayError("USAGE", "Plan objective must not be empty.");
  }

  const timestamp = now();
  const runId = createRunId(new Date(timestamp));
  const runPaths = await createRunDirectory(repositoryRoot, runId);
  const record = createRunRecord(runId, repositoryRoot, timestamp);
  const planContent = createVietnamesePlanDocument(objective);

  await writeInitialRunArtifacts(runPaths, createRequestDocument(objective), planContent, record);
  await appendArtifactEvent(runPaths.eventsPath, {
    schemaVersion: 1,
    runId,
    timestamp,
    type: "run_created",
    details: { state: record.state, language: options.language }
  });

  return {
    command: "plan",
    runId,
    repositoryRoot,
    state: "draft_plan",
    summary: buildPlanSummary(runId, record, planContent)
  };
}

export async function showPlanRun(repositoryPath: string, runId: string): Promise<PlanSummary> {
  const repositoryRoot = requireGitRepository(repositoryPath);
  await readInitializedConfig(repositoryRoot);
  const runPaths = await requireRunPaths(repositoryRoot, runId);
  const [record, planContent] = await Promise.all([
    readRunRecord(runPaths),
    fs.readFile(runPaths.planPath, "utf8")
  ]);

  return buildPlanSummary(runId, record, planContent);
}
