import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { SpecRelayError } from "./errors.js";

function git(repositoryRoot: string, args: readonly string[]): string {
  try {
    return execFileSync("git", ["-C", repositoryRoot, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }).trim();
  } catch (error) {
    const detail =
      error instanceof Error && "stderr" in error && typeof error.stderr === "string"
        ? error.stderr.trim()
        : "Git command failed.";
    throw new SpecRelayError("GIT_WORKTREE_UNAVAILABLE", detail || "Git command failed.", {
      args
    });
  }
}

function tryGit(repositoryRoot: string, args: readonly string[]): string | undefined {
  try {
    return execFileSync("git", ["-C", repositoryRoot, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return undefined;
  }
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))
  );
}

export function getManagedWorktreeRoot(environment: NodeJS.ProcessEnv = process.env): string {
  if (process.platform === "win32") {
    const localAppData = environment.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
    return path.join(localAppData, "SpecRelay", "worktrees");
  }

  return path.join(
    environment.XDG_CACHE_HOME ?? path.join(os.homedir(), ".cache"),
    "specrelay",
    "worktrees"
  );
}

export async function ensureManagedWorktreeRoot(root = getManagedWorktreeRoot()): Promise<string> {
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(root);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new SpecRelayError(
      "UNSAFE_WORKTREE_PATH",
      "Managed worktree root must be a real directory.",
      {
        root
      }
    );
  }
  return fs.realpath(root);
}

export async function getOwnedWorktreePath(
  runId: string,
  root = getManagedWorktreeRoot()
): Promise<{ readonly root: string; readonly worktreePath: string }> {
  if (!/^run-[a-z0-9-]+$/u.test(runId)) {
    throw new SpecRelayError("UNSAFE_WORKTREE_PATH", "Run ID is not safe for a worktree path.", {
      runId
    });
  }
  const realRoot = await ensureManagedWorktreeRoot(root);
  const worktreePath = path.resolve(realRoot, runId);
  if (!isPathInside(realRoot, worktreePath) || worktreePath === realRoot) {
    throw new SpecRelayError("UNSAFE_WORKTREE_PATH", "Worktree path escapes the managed root.", {
      root: realRoot,
      worktreePath
    });
  }
  return { root: realRoot, worktreePath };
}

export function assertCleanBaseRepository(repositoryRoot: string): void {
  const status = git(repositoryRoot, ["status", "--porcelain=v1", "--untracked-files=all"]);
  if (status.length > 0) {
    throw new SpecRelayError(
      "BASE_REPOSITORY_DIRTY",
      "Base repository has uncommitted changes. Commit, stash, or remove them before implementation."
    );
  }

  const mergeHead = tryGit(repositoryRoot, ["rev-parse", "-q", "--verify", "MERGE_HEAD"]);
  if (mergeHead !== undefined && mergeHead.length > 0) {
    throw new SpecRelayError("BASE_REPOSITORY_DIRTY", "Base repository has an unfinished merge.");
  }
}

export function resolveBaseCommit(repositoryRoot: string): string {
  const commit = git(repositoryRoot, ["rev-parse", "--verify", "HEAD"]);
  if (commit.length === 0) {
    throw new SpecRelayError(
      "GIT_WORKTREE_UNAVAILABLE",
      "Repository has no commit to use as a base."
    );
  }
  return commit;
}

export function supportsGitWorktree(repositoryRoot: string): boolean {
  try {
    git(repositoryRoot, ["worktree", "list", "--porcelain"]);
    return true;
  } catch {
    return false;
  }
}

export async function createIsolatedWorktree(options: {
  readonly repositoryRoot: string;
  readonly branchName: string;
  readonly baseCommit: string;
  readonly worktreePath: string;
  readonly managedRoot: string;
}): Promise<void> {
  const resolvedPath = path.resolve(options.worktreePath);
  if (!isPathInside(options.managedRoot, resolvedPath)) {
    throw new SpecRelayError(
      "UNSAFE_WORKTREE_PATH",
      "Refusing to create a worktree outside the managed root.",
      {
        managedRoot: options.managedRoot,
        worktreePath: resolvedPath
      }
    );
  }

  try {
    await fs.lstat(resolvedPath);
    throw new SpecRelayError("EXECUTION_ALREADY_EXISTS", "Worktree path already exists.", {
      worktreePath: resolvedPath
    });
  } catch (error) {
    if (!(
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    )) {
      throw error;
    }
  }

  git(options.repositoryRoot, [
    "worktree",
    "add",
    "-b",
    options.branchName,
    resolvedPath,
    options.baseCommit
  ]);
  const realWorktreePath = await fs.realpath(resolvedPath);
  if (!isPathInside(options.managedRoot, realWorktreePath)) {
    throw new SpecRelayError(
      "UNSAFE_WORKTREE_PATH",
      "Created worktree resolved outside the managed root.",
      {
        managedRoot: options.managedRoot,
        worktreePath: realWorktreePath
      }
    );
  }
}

export function worktreeIsClean(worktreePath: string): boolean {
  return git(worktreePath, ["status", "--porcelain=v1", "--untracked-files=all"]).length === 0;
}

export function removeOwnedWorktree(repositoryRoot: string, worktreePath: string): void {
  git(repositoryRoot, ["worktree", "remove", worktreePath]);
}

export function branchHasUniqueCommits(
  repositoryRoot: string,
  branchName: string,
  baseCommit: string
): boolean {
  return git(repositoryRoot, ["rev-list", "--count", `${baseCommit}..${branchName}`]) !== "0";
}

export function deleteBranch(repositoryRoot: string, branchName: string): void {
  git(repositoryRoot, ["branch", "-D", branchName]);
}
