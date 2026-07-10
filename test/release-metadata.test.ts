import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repositoryUrl = "https://github.com/thoinguyenhuu/SpecRelay";

describe("beta release metadata", () => {
  it("keeps the CLI and plugin on the same explicit prerelease version", () => {
    const root = process.cwd();
    const packageMetadata = JSON.parse(
      fs.readFileSync(path.join(root, "package.json"), "utf8")
    ) as {
      version: string;
      private: boolean;
      homepage: string;
      license: string;
      repository: { url: string };
    };
    const pluginMetadata = JSON.parse(
      fs.readFileSync(path.join(root, ".codex-plugin", "plugin.json"), "utf8")
    ) as {
      version: string;
      homepage: string;
      repository: string;
      license: string;
    };

    expect(packageMetadata.version).toBe("0.1.0-beta.3");
    expect(pluginMetadata.version).toBe(packageMetadata.version);
    expect(packageMetadata.private).toBe(true);
    expect(packageMetadata.homepage).toBe(`${repositoryUrl}#readme`);
    expect(packageMetadata.repository.url).toBe(`git+${repositoryUrl}.git`);
    expect(pluginMetadata.repository).toBe(repositoryUrl);
    expect(pluginMetadata.license).toBe("Apache-2.0");
    expect(packageMetadata.license).toBe("Apache-2.0");
  });
});
