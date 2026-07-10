import { z } from "zod";

import { SpecRelayError } from "./errors.js";

export const CONFIG_SCHEMA_VERSION = 1 as const;
export const ARTIFACT_DIRECTORY = ".specrelay" as const;
export const CONFIG_FILENAME = "config.json" as const;
export const RUNS_DIRECTORY = "runs" as const;

export const configSchema = z
  .object({
    schemaVersion: z.literal(CONFIG_SCHEMA_VERSION),
    createdBy: z.string().min(1),
    artifactDirectory: z.literal(ARTIFACT_DIRECTORY)
  })
  .strict();

export type SpecRelayConfig = z.infer<typeof configSchema>;

export function parseConfig(value: unknown): SpecRelayConfig {
  const result = configSchema.safeParse(value);

  if (!result.success) {
    throw new SpecRelayError("INVALID_CONFIG", "SpecRelay configuration is invalid.", {
      issues: result.error.issues
    });
  }

  return result.data;
}

export function createInitialConfig(version = "0.1.0"): SpecRelayConfig {
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    createdBy: `specrelay/${version}`,
    artifactDirectory: ARTIFACT_DIRECTORY
  };
}
