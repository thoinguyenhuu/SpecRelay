import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

describe("Git marketplace", () => {
  it("pins the public plugin root to the matching beta tag", () => {
    const root = process.cwd();
    const manifest = JSON.parse(
      fs.readFileSync(path.join(root, ".codex-plugin", "plugin.json"), "utf8")
    ) as { name: string; version: string };
    const marketplace = JSON.parse(
      fs.readFileSync(path.join(root, ".agents", "plugins", "marketplace.json"), "utf8")
    ) as {
      plugins: Array<{
        name: string;
        source: { source: string; url: string; ref: string };
        policy: { installation: string; authentication: string };
      }>;
    };
    const plugin = marketplace.plugins[0];

    expect(plugin).toEqual({
      name: manifest.name,
      source: {
        source: "url",
        url: "https://github.com/thoinguyenhuu/SpecRelay.git",
        ref: `v${manifest.version}`
      },
      policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
      category: "Productivity"
    });
  });
});
