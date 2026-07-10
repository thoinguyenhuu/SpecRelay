import path from "node:path";

import { ARTIFACT_DIRECTORY, CONFIG_FILENAME, RUNS_DIRECTORY } from "./config.js";

export interface SpecRelayPaths {
  readonly artifactDirectory: string;
  readonly configPath: string;
  readonly runsDirectory: string;
}

export function getSpecRelayPaths(repositoryRoot: string): SpecRelayPaths {
  const artifactDirectory = path.join(repositoryRoot, ARTIFACT_DIRECTORY);

  return {
    artifactDirectory,
    configPath: path.join(artifactDirectory, CONFIG_FILENAME),
    runsDirectory: path.join(artifactDirectory, RUNS_DIRECTORY)
  };
}
