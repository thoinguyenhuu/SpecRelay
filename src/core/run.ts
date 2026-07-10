import { z } from "zod";

import { runStates } from "./state.js";

export const RUN_SCHEMA_VERSION = 1 as const;

export const runRecordSchema = z
  .object({
    schemaVersion: z.literal(RUN_SCHEMA_VERSION),
    id: z.string().min(1),
    repositoryRoot: z.string().min(1),
    state: z.enum(runStates),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime()
  })
  .strict();

export type RunRecord = z.infer<typeof runRecordSchema>;

export const artifactEventSchema = z
  .object({
    schemaVersion: z.literal(RUN_SCHEMA_VERSION),
    runId: z.string().min(1),
    timestamp: z.string().datetime(),
    type: z.string().min(1),
    details: z.record(z.string(), z.unknown()).optional()
  })
  .strict();

export type ArtifactEvent = z.infer<typeof artifactEventSchema>;
