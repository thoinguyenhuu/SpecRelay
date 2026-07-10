import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

const pluginSchema = z
  .object({
    name: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    version: z.string().min(1),
    description: z.string().min(1),
    author: z
      .object({
        name: z.string().min(1),
        url: z.string().url().optional()
      })
      .strict(),
    homepage: z.string().url().optional(),
    repository: z.string().url().optional(),
    license: z.string().min(1).optional(),
    keywords: z.array(z.string().min(1)).optional(),
    skills: z.string().min(1),
    interface: z.object({
      displayName: z.string().min(1),
      shortDescription: z.string().min(1),
      longDescription: z.string().min(1),
      developerName: z.string().min(1),
      category: z.string().min(1),
      capabilities: z.array(z.string()),
      defaultPrompt: z.string().min(1)
    })
  })
  .strict();

const projectRoot = process.cwd();
const manifestPath = path.join(projectRoot, ".codex-plugin", "plugin.json");
const manifest = pluginSchema.parse(JSON.parse(fs.readFileSync(manifestPath, "utf8")));
const technicalPluginId = "plugin-4-codex-control-cc";

if (manifest.name !== technicalPluginId) {
  throw new Error(
    `Plugin name '${manifest.name}' must remain the technical plugin ID '${technicalPluginId}'.`
  );
}

const skillsPath = path.resolve(projectRoot, manifest.skills);
if (!fs.existsSync(skillsPath) || !fs.statSync(skillsPath).isDirectory()) {
  throw new Error(`Configured skills directory does not exist: ${skillsPath}`);
}

process.stdout.write(`Plugin manifest is valid: ${manifest.name}\n`);
