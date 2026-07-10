import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const projectRoot = process.cwd();
const npmCliPath = process.env.npm_execpath;
const expectedVersion = (
  JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8")) as {
    version: string;
  }
).version;

if (npmCliPath === undefined || npmCliPath.length === 0) {
  throw new Error("npm_execpath is required to smoke-test a beta package.");
}

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "specrelay-package-smoke-"));
const packageDirectory = path.join(temporaryRoot, "package");
const installDirectory = path.join(temporaryRoot, "install");

try {
  fs.mkdirSync(packageDirectory, { recursive: true });
  execFileSync(process.execPath, [npmCliPath, "pack", "--pack-destination", packageDirectory], {
    cwd: projectRoot,
    stdio: "inherit"
  });
  const tarballs = fs.readdirSync(packageDirectory).filter((entry) => entry.endsWith(".tgz"));
  if (tarballs.length !== 1 || tarballs[0] === undefined) {
    throw new Error("Expected npm pack to create exactly one tarball.");
  }
  const tarballPath = path.join(packageDirectory, tarballs[0]);
  execFileSync(
    process.execPath,
    [
      npmCliPath,
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--prefix",
      installDirectory,
      tarballPath
    ],
    { cwd: projectRoot, stdio: "inherit" }
  );

  const installedRoot = path.join(installDirectory, "node_modules", "@specrelay", "cli");
  const requiredPaths = [
    path.join(installedRoot, "dist", "cli", "index.js"),
    path.join(installedRoot, ".codex-plugin", "plugin.json"),
    path.join(installedRoot, "skills", "specrelay-workflow", "SKILL.md"),
    path.join(installedRoot, "templates", "plan.vi.md"),
    path.join(installedRoot, "README.md"),
    path.join(installedRoot, "LICENSE")
  ];
  for (const requiredPath of requiredPaths) {
    if (!fs.existsSync(requiredPath)) {
      throw new Error(`Package is missing required file: ${requiredPath}`);
    }
  }
  const binaryName = process.platform === "win32" ? "specrelay.cmd" : "specrelay";
  if (!fs.existsSync(path.join(installDirectory, "node_modules", ".bin", binaryName))) {
    throw new Error(`Package did not create the '${binaryName}' CLI shim.`);
  }
  const entryPoint = path.join(installedRoot, "dist", "cli", "index.js");
  const version = execFileSync(process.execPath, [entryPoint, "--version"], {
    cwd: temporaryRoot,
    encoding: "utf8"
  });
  if (version.trim() !== expectedVersion) {
    throw new Error(
      `Expected packaged CLI version '${expectedVersion}', received '${version.trim()}'.`
    );
  }
  const help = execFileSync(process.execPath, [entryPoint, "--help"], {
    cwd: temporaryRoot,
    encoding: "utf8"
  });
  if (!help.includes("Usage: specrelay")) {
    throw new Error("Packaged CLI help did not expose the specrelay command.");
  }
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
