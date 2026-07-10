import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const sourcePath = path.join(process.cwd(), "src", "greeting.mjs");
const source = fs.readFileSync(sourcePath, "utf8");

if (!source.includes("export function createGreeting")) {
  throw new Error("src/greeting.mjs must export createGreeting.");
}
