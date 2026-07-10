import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SpecRelayError } from "../src/core/errors.js";
import { getOwnedWorktreePath } from "../src/core/worktree.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true }))
  );
});

describe("managed worktree paths", () => {
  it("creates a run-specific path beneath a real managed root", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "specrelay-worktree-root-"));
    temporaryDirectories.push(root);

    await expect(getOwnedWorktreePath("run-20260710-abc", root)).resolves.toMatchObject({
      root: await fs.realpath(root),
      worktreePath: path.join(await fs.realpath(root), "run-20260710-abc")
    });
  });

  it("rejects unsafe run IDs and symlinked roots", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "specrelay-worktree-root-"));
    temporaryDirectories.push(root);

    await expect(getOwnedWorktreePath("../escape", root)).rejects.toBeInstanceOf(SpecRelayError);
  });
});
