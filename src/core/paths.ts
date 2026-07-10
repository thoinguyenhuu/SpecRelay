import path from "node:path";

import { ARTIFACT_DIRECTORY, CONFIG_FILENAME, RUNS_DIRECTORY } from "./config.js";

export interface SpecRelayPaths {
  readonly artifactDirectory: string;
  readonly configPath: string;
  readonly runsDirectory: string;
}

export interface RunPaths {
  readonly runDirectory: string;
  readonly requestPath: string;
  readonly planPath: string;
  readonly statePath: string;
  readonly eventsPath: string;
  readonly normalizedPlanPath: string;
  readonly approvalPath: string;
  readonly policyPath: string;
  readonly executorPromptPath: string;
  readonly executionPath: string;
  readonly executorEventsPath: string;
  readonly executorSummaryPath: string;
  readonly checksPath: string;
  readonly lockPath: string;
}

export function getSpecRelayPaths(repositoryRoot: string): SpecRelayPaths {
  const artifactDirectory = path.join(repositoryRoot, ARTIFACT_DIRECTORY);

  return {
    artifactDirectory,
    configPath: path.join(artifactDirectory, CONFIG_FILENAME),
    runsDirectory: path.join(artifactDirectory, RUNS_DIRECTORY)
  };
}

export function getRunPaths(repositoryRoot: string, runId: string): RunPaths {
  const { runsDirectory } = getSpecRelayPaths(repositoryRoot);
  const runDirectory = path.join(runsDirectory, runId);

  return {
    runDirectory,
    requestPath: path.join(runDirectory, "request.md"),
    planPath: path.join(runDirectory, "plan.md"),
    statePath: path.join(runDirectory, "state.json"),
    eventsPath: path.join(runDirectory, "events.jsonl"),
    normalizedPlanPath: path.join(runDirectory, "plan.normalized.json"),
    approvalPath: path.join(runDirectory, "approval.json"),
    policyPath: path.join(runDirectory, "policy.json"),
    executorPromptPath: path.join(runDirectory, "executor-prompt.md"),
    executionPath: path.join(runDirectory, "execution.json"),
    executorEventsPath: path.join(runDirectory, "executor-events.jsonl"),
    executorSummaryPath: path.join(runDirectory, "executor-summary.json"),
    checksPath: path.join(runDirectory, "checks.json"),
    lockPath: path.join(runDirectory, ".lock")
  };
}
