import fs from "node:fs";
import path from "node:path";

import { parse } from "yaml";
import { describe, expect, it } from "vitest";

describe("beta release workflow", () => {
  it("is manual, environment-gated, and only grants write permission to the release job", () => {
    const workflow = parse(
      fs.readFileSync(path.join(process.cwd(), ".github", "workflows", "beta-release.yml"), "utf8")
    ) as {
      on: { workflow_dispatch: { inputs: { tag: { required: boolean } } } };
      permissions: { contents: string };
      jobs: {
        release: {
          environment: string;
          permissions: { contents: string };
          steps: Array<{ run?: string }>;
        };
      };
    };

    expect(workflow.on.workflow_dispatch.inputs.tag.required).toBe(true);
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(workflow.jobs.release.environment).toBe("beta-release");
    expect(workflow.jobs.release.permissions).toEqual({ contents: "write" });
    expect(
      workflow.jobs.release.steps.some((step) => step.run?.includes("npm publish") === true)
    ).toBe(false);
    expect(
      workflow.jobs.release.steps.some((step) => step.run?.includes("gh release create") === true)
    ).toBe(true);
  });
});
