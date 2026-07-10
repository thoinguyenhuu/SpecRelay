import { describe, expect, it } from "vitest";

import {
  ARTIFACT_DIRECTORY,
  CONFIG_SCHEMA_VERSION,
  createInitialConfig,
  parseConfig
} from "../src/core/config.js";
import { SpecRelayError } from "../src/core/errors.js";

describe("SpecRelay configuration", () => {
  it("creates and parses the v1 configuration", () => {
    const config = createInitialConfig("0.1.0");

    expect(config).toEqual({
      schemaVersion: CONFIG_SCHEMA_VERSION,
      createdBy: "specrelay/0.1.0",
      artifactDirectory: ARTIFACT_DIRECTORY
    });
    expect(parseConfig(config)).toEqual(config);
  });

  it("rejects unknown, missing, and invalid configuration fields", () => {
    expect(() =>
      parseConfig({
        schemaVersion: CONFIG_SCHEMA_VERSION,
        createdBy: "specrelay/0.1.0",
        artifactDirectory: ARTIFACT_DIRECTORY,
        unsafeExtra: true
      })
    ).toThrowError(SpecRelayError);

    try {
      parseConfig({ schemaVersion: 2, createdBy: "x", artifactDirectory: ARTIFACT_DIRECTORY });
    } catch (error) {
      expect(error).toMatchObject({ code: "INVALID_CONFIG" });
    }
  });
});
