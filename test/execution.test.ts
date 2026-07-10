import { describe, expect, it } from "vitest";

import { SpecRelayError } from "../src/core/errors.js";
import {
  buildClaudeArguments,
  createExecutionPolicy,
  formatDuration,
  parseMaxTurns,
  parseTimeout,
  redactExecutorText
} from "../src/core/execution.js";

describe("execution policy", () => {
  it("limits turns and timeout using stable usage errors", () => {
    expect(parseMaxTurns(undefined)).toBe(10);
    expect(parseTimeout(undefined)).toBe(20 * 60 * 1000);
    expect(parseTimeout("90s")).toBe(90 * 1000);
    expect(formatDuration(5 * 60 * 1000)).toBe("5m");
    expect(() => parseMaxTurns("11")).toThrowError(SpecRelayError);
    expect(() => parseTimeout("21m")).toThrowError(SpecRelayError);
  });

  it("creates a deterministic policy and safe Claude argument array", () => {
    const policy = createExecutionPolicy({ maxTurns: 3, timeoutMs: 60_000, prompt: "implement" });
    const args = buildClaudeArguments(policy, "implement");

    expect(args).toContain("--permission-mode");
    expect(args).toContain("acceptEdits");
    expect(args).toContain("--output-format");
    expect(args).toContain("stream-json");
    expect(args).not.toContain("--dangerously-skip-permissions");
  });

  it("redacts common credential values before logs are persisted", () => {
    expect(redactExecutorText("ANTHROPIC_API_KEY=sk-abcdefghijklmnop")).toBe(
      "ANTHROPIC_API_KEY=[REDACTED]"
    );
    expect(redactExecutorText("Bearer abcdefghijklmnop")).toBe("Bearer [REDACTED]");
  });
});
