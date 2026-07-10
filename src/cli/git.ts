import { execFileSync } from "node:child_process";
import path from "node:path";

import { SpecRelayError } from "../core/errors.js";

interface GitCommandResult {
  readonly ok: boolean;
  readonly stdout: string;
}

function runGit(cwd: string, args: readonly string[]): GitCommandResult {
  try {
    const stdout = execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });

    return { ok: true, stdout: stdout.trim() };
  } catch {
    return { ok: false, stdout: "" };
  }
}

export function findGitRepository(targetPath: string): string | undefined {
  const result = runGit(targetPath, ["rev-parse", "--show-toplevel"]);
  return result.ok && result.stdout.length > 0 ? path.resolve(result.stdout) : undefined;
}

export function requireGitRepository(targetPath: string): string {
  const repositoryRoot = findGitRepository(targetPath);

  if (repositoryRoot === undefined) {
    throw new SpecRelayError(
      "NOT_A_GIT_REPOSITORY",
      `No Git repository was found at '${path.resolve(targetPath)}'.`,
      { targetPath: path.resolve(targetPath) }
    );
  }

  return repositoryRoot;
}

export function getGitInfoExcludePath(repositoryRoot: string): string {
  const result = runGit(repositoryRoot, ["rev-parse", "--git-path", "info/exclude"]);

  if (!result.ok || result.stdout.length === 0) {
    throw new SpecRelayError("NOT_A_GIT_REPOSITORY", "Could not locate Git's local exclude file.");
  }

  return path.resolve(repositoryRoot, result.stdout);
}

export function gitVersion(): string | undefined {
  try {
    return execFileSync("git", ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return undefined;
  }
}
