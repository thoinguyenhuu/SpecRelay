import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function createTemporaryGitRepository(): Promise<string> {
  const repositoryPath = await fs.mkdtemp(path.join(os.tmpdir(), "specrelay-test-"));
  execFileSync("git", ["init", "--quiet"], { cwd: repositoryPath });
  return repositoryPath;
}
