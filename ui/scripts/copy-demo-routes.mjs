import { cpSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const slugs = [
  "kb",
  "wiki",
  "tasks",
  "data",
  "cms",
  "memory",
  "runbook",
  "adr",
  "prompt",
  "research",
  "log",
];

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(root, "demo-static");
const demoHtml = resolve(out, "demo.html");
const index = resolve(out, "index.html");

if (existsSync(demoHtml) && !existsSync(index)) {
  renameSync(demoHtml, index);
}

if (!existsSync(index)) {
  throw new Error("demo build did not produce index.html or demo.html");
}

for (const slug of slugs) {
  const dir = resolve(out, slug);
  mkdirSync(dir, { recursive: true });
  cpSync(index, resolve(dir, "index.html"));
}

console.log(`Copied index.html to ${slugs.length} template routes.`);
