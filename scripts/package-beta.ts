import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const releaseDirectory = path.join(projectRoot, "release");
const npmCliPath = process.env.npm_execpath;

if (npmCliPath === undefined || npmCliPath.length === 0) {
  throw new Error("npm_execpath is required to create a beta package.");
}

fs.mkdirSync(releaseDirectory, { recursive: true });
execFileSync(process.execPath, [npmCliPath, "pack", "--pack-destination", releaseDirectory], {
  cwd: projectRoot,
  stdio: "inherit"
});
