import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ARTIFACT_DIRECTORY, CONFIG_FILENAME, RUNS_DIRECTORY } from "../src/core/config.js";
import type { SpecRelayError } from "../src/core/errors.js";
import { runDoctor } from "../src/cli/doctor.js";
import { initializeRepository } from "../src/cli/init.js";
import { createPlanRun, showPlanRun } from "../src/cli/plan.js";
import { createTemporaryGitRepository } from "./helpers.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true }))
  );
});

async function temporaryRepository(): Promise<string> {
  const repositoryPath = await createTemporaryGitRepository();
  temporaryDirectories.push(repositoryPath);
  return repositoryPath;
}

describe("doctor", () => {
  it("recognizes the npm executable used by the current platform", async () => {
    const repositoryPath = await temporaryRepository();

    const report = runDoctor(repositoryPath);
    const npmCheck = report.checks.find((check) => check.id === "npm");

    expect(npmCheck).toMatchObject({ status: "pass" });
  });

  it("reports a non-repository target without treating it as a missing runtime dependency", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "specrelay-non-repo-"));
    temporaryDirectories.push(directory);

    const report = runDoctor(directory);
    const repositoryCheck = report.checks.find((check) => check.id === "repository");

    expect(repositoryCheck).toMatchObject({ status: "warn" });
    expect(report.command).toBe("doctor");
  });
});

describe("init", () => {
  it("does not write artifacts in dry-run mode", async () => {
    const repositoryPath = await temporaryRepository();

    const result = await initializeRepository({ repositoryPath, dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(result.plannedChanges).toHaveLength(3);
    await expect(fs.access(path.join(repositoryPath, ARTIFACT_DIRECTORY))).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("creates the configuration, run directory, and local exclude entry", async () => {
    const repositoryPath = await temporaryRepository();

    const result = await initializeRepository({ repositoryPath, dryRun: false });
    const configPath = path.join(repositoryPath, ARTIFACT_DIRECTORY, CONFIG_FILENAME);
    const runsPath = path.join(repositoryPath, ARTIFACT_DIRECTORY, RUNS_DIRECTORY);
    const excludePath = path.join(repositoryPath, ".git", "info", "exclude");

    expect(result.initialized).toBe(true);
    await expect(fs.access(configPath)).resolves.toBeUndefined();
    await expect(fs.access(runsPath)).resolves.toBeUndefined();
    await expect(fs.readFile(excludePath, "utf8")).resolves.toContain(`${ARTIFACT_DIRECTORY}/`);
  });

  it("is idempotent and does not overwrite a valid configuration", async () => {
    const repositoryPath = await temporaryRepository();
    await initializeRepository({ repositoryPath, dryRun: false });
    const configPath = path.join(repositoryPath, ARTIFACT_DIRECTORY, CONFIG_FILENAME);
    const original = await fs.readFile(configPath, "utf8");

    const result = await initializeRepository({ repositoryPath, dryRun: false });

    expect(result).toMatchObject({ initialized: false, plannedChanges: [] });
    await expect(fs.readFile(configPath, "utf8")).resolves.toBe(original);
  });

  it("rejects corrupted configuration and unmanaged artifact directories", async () => {
    const withCorruptedConfig = await temporaryRepository();
    await fs.mkdir(path.join(withCorruptedConfig, ARTIFACT_DIRECTORY), { recursive: true });
    await fs.writeFile(
      path.join(withCorruptedConfig, ARTIFACT_DIRECTORY, CONFIG_FILENAME),
      "not json",
      "utf8"
    );

    await expect(
      initializeRepository({ repositoryPath: withCorruptedConfig, dryRun: false })
    ).rejects.toMatchObject({
      code: "INVALID_CONFIG"
    } satisfies Partial<SpecRelayError>);

    const withCollision = await temporaryRepository();
    await fs.mkdir(path.join(withCollision, ARTIFACT_DIRECTORY), { recursive: true });
    await fs.writeFile(path.join(withCollision, ARTIFACT_DIRECTORY, "unmanaged.txt"), "x", "utf8");

    await expect(
      initializeRepository({ repositoryPath: withCollision, dryRun: false })
    ).rejects.toMatchObject({
      code: "ARTIFACT_DIRECTORY_COLLISION"
    } satisfies Partial<SpecRelayError>);
  });
});

describe("plan artifacts", () => {
  it("creates a draft run and shows a compact summary without raw Markdown", async () => {
    const repositoryPath = await temporaryRepository();
    await initializeRepository({ repositoryPath, dryRun: false });

    const created = await createPlanRun({
      repositoryPath,
      objective: "Tạo module quản lý cơ sở giáo dục",
      language: "vi"
    });
    const summary = await showPlanRun(repositoryPath, created.runId);

    expect(created.state).toBe("draft_plan");
    expect(summary).toMatchObject({
      objective: "Tạo module quản lý cơ sở giáo dục",
      approval: { status: "not_approved" },
      implementationStepCount: 0
    });
    expect("body" in summary).toBe(false);
    await expect(
      fs.access(
        path.join(repositoryPath, ARTIFACT_DIRECTORY, RUNS_DIRECTORY, created.runId, "events.jsonl")
      )
    ).resolves.toBeUndefined();
  });
});
