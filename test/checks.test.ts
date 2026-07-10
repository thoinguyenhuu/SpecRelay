import { describe, expect, it } from "vitest";

import { parseCheckTimeout, validateCheckDefinition } from "../src/core/checks.js";

describe("approved check definitions", () => {
  it("limits check timeout to ten minutes", () => {
    expect(parseCheckTimeout(undefined)).toBe(5 * 60_000);
    expect(parseCheckTimeout("10m")).toBe(10 * 60_000);
    expect(() => parseCheckTimeout("11m")).toThrowError(
      expect.objectContaining({ code: "INVALID_CHECK_COMMAND" })
    );
  });

  it("validates the executable against its declared preset", () => {
    expect(
      validateCheckDefinition({
        id: "lint",
        preset: "node",
        argv: ["npm", "run", "lint"],
        timeout: "5m"
      })
    ).toMatchObject({ id: "lint", preset: "node" });
    expect(
      validateCheckDefinition({
        id: "typecheck",
        preset: "python",
        argv: ["python", "-m", "compileall"]
      })
    ).toMatchObject({ preset: "python" });
    expect(
      validateCheckDefinition({ id: "test", preset: "go", argv: ["go", "test", "./..."] })
    ).toMatchObject({
      preset: "go"
    });
    expect(() =>
      validateCheckDefinition({ id: "bad", preset: "node", argv: ["git", "status"] })
    ).toThrowError(expect.objectContaining({ code: "INVALID_CHECK_COMMAND" }));
  });

  it("does not permit package installation commands", () => {
    expect(() =>
      validateCheckDefinition({ id: "install", preset: "node", argv: ["npm", "install"] })
    ).toThrowError(expect.objectContaining({ code: "INVALID_CHECK_COMMAND" }));
  });
});
