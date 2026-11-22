// Global data is read from JSON files, the one input a foreign design system gives without running its code. A
// "__proto__" key in one must not reach Object.prototype (and so every object in pd dev or pd build).
import { afterAll, afterEach, beforeAll, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readGlobalData } from "../src/project-loaders.js";
import { save } from "../../../test-support/save.js";

let tmp = "";
beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-global-data-proto-")); });
afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });
const proto = Object.prototype as Record<string, unknown>;
afterEach(() => { for (const key of Object.keys(proto)) delete proto[key]; });

it("a data file's __proto__ key changes no other object, and the rest of the file is read", async () => {
  await save(join(tmp, "a.json"), `{"site":{"name":"A"},"__proto__":{"pdPolluted":"yes"}}`);
  await save(join(tmp, "b.json"), `{"site":{"lang":"en"}}`);
  const { data, problems } = await readGlobalData(tmp);
  expect(problems).toEqual([]);
  expect(({} as Record<string, unknown>).pdPolluted).toBeUndefined();
  expect(Object.getPrototypeOf(data)).toBe(Object.prototype);
  expect(data).toEqual({ site: { name: "A", lang: "en" } });
});
