import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("Codex plugin manifest", () => {
  it("keeps its technical ID stable independently of the clone directory", () => {
    const root = process.cwd();
    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, ".codex-plugin", "plugin.json"), "utf8")
    ) as {
      name: string;
      interface: { displayName: string };
    };

    expect(manifest.name).toBe("plugin-4-codex-control-cc");
    expect(manifest.interface.displayName).toBe("SpecRelay");
  });
});
