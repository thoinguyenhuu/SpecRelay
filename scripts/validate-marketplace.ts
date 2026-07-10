import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

const marketplaceSchema = z
  .object({
    name: z.literal("specrelay-beta"),
    interface: z.object({ displayName: z.literal("SpecRelay Beta") }).strict(),
    plugins: z
      .array(
        z
          .object({
            name: z.string().min(1),
            source: z
              .object({
                source: z.literal("url"),
                url: z.literal("https://github.com/thoinguyenhuu/SpecRelay.git"),
                ref: z.string().regex(/^v\d+\.\d+\.\d+-beta\.\d+$/u)
              })
              .strict(),
            policy: z
              .object({
                installation: z.literal("AVAILABLE"),
                authentication: z.literal("ON_INSTALL")
              })
              .strict(),
            category: z.literal("Productivity")
          })
          .strict()
      )
      .length(1)
  })
  .strict();

const projectRoot = process.cwd();
const manifest = JSON.parse(
  fs.readFileSync(path.join(projectRoot, ".codex-plugin", "plugin.json"), "utf8")
) as { name: string; version: string };
const marketplace = marketplaceSchema.parse(
  JSON.parse(
    fs.readFileSync(path.join(projectRoot, ".agents", "plugins", "marketplace.json"), "utf8")
  )
);
const plugin = marketplace.plugins[0];

if (
  plugin === undefined ||
  plugin.name !== manifest.name ||
  plugin.source.ref !== `v${manifest.version}`
) {
  throw new Error("Marketplace plugin identity and Git ref must match the beta manifest version.");
}

process.stdout.write(`Marketplace is valid for ${plugin.name}@${plugin.source.ref}\n`);
