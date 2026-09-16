// `pd init` file I/O: read the template tree, and apply a plan decided by plan.ts.

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import type { InitPlan, TemplateFile } from "./plan.js";

/** Every file under `dir`, with forward-slash paths relative to it. */
export async function readTemplateDir(dir: string): Promise<TemplateFile[]> {
  const out: TemplateFile[] = [];
  async function walk(current: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out.push({ path: relative(dir, full).split(sep).join("/"), content: await readFile(full, "utf8") });
    }
  }
  await walk(dir);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** Both template sets, from the `templates/` folder shipped beside the CLI. */
export async function readTemplates(templatesDir: string): Promise<{ base: TemplateFile[]; examples: TemplateFile[] }> {
  const [base, examples] = await Promise.all([
    readTemplateDir(join(templatesDir, "base")),
    readTemplateDir(join(templatesDir, "examples")),
  ]);
  return { base, examples };
}

/** Perform a plan. Writes use the `wx` flag, so even a file that appeared after planning is never
 *  overwritten — the operation fails instead. */
export async function applyPlan(target: string, plan: InitPlan): Promise<void> {
  await mkdir(target, { recursive: true });
  for (const file of plan.writes) {
    const abs = join(target, file.path);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, file.content, { flag: "wx" });
  }
  await writeFile(join(target, "package.json"), plan.packageJson.content);
  // Directories the config names that have no template file of their own.
  for (const dir of ["assets", "src/patterns"]) await mkdir(join(target, dir), { recursive: true });
}
