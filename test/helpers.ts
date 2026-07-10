import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function createTemporaryGitRepository(): Promise<string> {
  const repositoryPath = await fs.mkdtemp(path.join(os.tmpdir(), "specrelay-test-"));
  execFileSync("git", ["init", "--quiet"], { cwd: repositoryPath });
  return repositoryPath;
}

export async function createCommittedTemporaryGitRepository(): Promise<string> {
  const repositoryPath = await createTemporaryGitRepository();
  await fs.writeFile(path.join(repositoryPath, "README.md"), "# Fixture\n", "utf8");
  execFileSync("git", ["add", "README.md"], { cwd: repositoryPath });
  execFileSync(
    "git",
    [
      "-c",
      "user.name=SpecRelay test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "--quiet",
      "-m",
      "Initial fixture"
    ],
    { cwd: repositoryPath }
  );
  return repositoryPath;
}
