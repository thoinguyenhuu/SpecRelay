import fs from "node:fs";
import path from "node:path";

const releaseTag = process.env.SPECRELAY_RELEASE_TAG;
if (releaseTag === undefined || releaseTag.length === 0) {
  throw new Error("SPECRELAY_RELEASE_TAG is required.");
}

const projectRoot = process.cwd();
const packageMetadata = JSON.parse(
  fs.readFileSync(path.join(projectRoot, "package.json"), "utf8")
) as {
  version: string;
  private: boolean;
};
const pluginMetadata = JSON.parse(
  fs.readFileSync(path.join(projectRoot, ".codex-plugin", "plugin.json"), "utf8")
) as { version: string };

if (
  packageMetadata.version !== pluginMetadata.version ||
  releaseTag !== `v${packageMetadata.version}`
) {
  throw new Error("Release tag, package version, and plugin version must match.");
}
if (!packageMetadata.private) {
  throw new Error("The beta CLI must remain private and must not be published to npm.");
}

process.stdout.write(`Verified beta release ${releaseTag}\n`);
