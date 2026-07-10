import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { findGitRepository, gitVersion } from "./git.js";

export type CheckStatus = "pass" | "warn" | "fail";

export interface DoctorCheck {
  readonly id: string;
  readonly status: CheckStatus;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface DoctorReport {
  readonly command: "doctor";
  readonly repositoryPath: string;
  readonly healthy: boolean;
  readonly checks: readonly DoctorCheck[];
}

const MINIMUM_NODE_MAJOR = 22;

function executableVersion(command: string): string | undefined {
  try {
    return execFileSync(command, ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return undefined;
  }
}

function npmVersion(): string | undefined {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")
  ].filter((candidate): candidate is string => candidate !== undefined && fs.existsSync(candidate));

  for (const npmCliPath of candidates) {
    try {
      return execFileSync(process.execPath, [npmCliPath, "--version"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
      }).trim();
    } catch {
      // Try the next known npm CLI location.
    }
  }

  return executableVersion("npm");
}

function nodeCheck(): DoctorCheck {
  const [majorText] = process.versions.node.split(".");
  const major = Number(majorText);
  const status: CheckStatus =
    Number.isInteger(major) && major >= MINIMUM_NODE_MAJOR ? "pass" : "fail";

  return {
    id: "node",
    status,
    message:
      status === "pass"
        ? `Node.js ${process.versions.node} satisfies the >=${MINIMUM_NODE_MAJOR} requirement.`
        : `Node.js ${process.versions.node} does not satisfy the >=${MINIMUM_NODE_MAJOR} requirement.`,
    details: { version: process.versions.node, minimumMajor: MINIMUM_NODE_MAJOR }
  };
}

function dependencyCheck(
  command: string,
  required: boolean,
  version = executableVersion(command)
): DoctorCheck {
  const status: CheckStatus = version === undefined ? (required ? "fail" : "warn") : "pass";

  return {
    id: command,
    status,
    message:
      version === undefined
        ? `${command} was not found on PATH.`
        : `${command} is available (${version}).`,
    ...(version === undefined ? {} : { details: { version } })
  };
}

function repositoryCheck(targetPath: string): DoctorCheck {
  const repositoryRoot = findGitRepository(targetPath);

  return repositoryRoot === undefined
    ? {
        id: "repository",
        status: "warn",
        message: `No Git repository was found at '${targetPath}'. Run specrelay init inside a repository.`,
        details: { targetPath }
      }
    : {
        id: "repository",
        status: "pass",
        message: `Git repository found at '${repositoryRoot}'.`,
        details: { repositoryRoot }
      };
}

export function runDoctor(repositoryPath: string): DoctorReport {
  const targetPath = path.resolve(repositoryPath);
  const installedGitVersion = gitVersion();
  const checks: DoctorCheck[] = [
    nodeCheck(),
    dependencyCheck("npm", true, npmVersion()),
    {
      id: "git",
      status: installedGitVersion === undefined ? "fail" : "pass",
      message:
        installedGitVersion === undefined
          ? "git was not found on PATH."
          : `git is available (${installedGitVersion}).`
    },
    repositoryCheck(targetPath),
    dependencyCheck("codex", false),
    dependencyCheck("claude", false)
  ];

  if (!fs.existsSync(targetPath)) {
    checks.push({
      id: "target-path",
      status: "fail",
      message: `Target path '${targetPath}' does not exist.`,
      details: { targetPath }
    });
  }

  return {
    command: "doctor",
    repositoryPath: targetPath,
    healthy: checks.every((check) => check.status !== "fail"),
    checks
  };
}
