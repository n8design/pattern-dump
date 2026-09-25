// A data file that does not parse is reported (DATA_INVALID, with its file and position) instead of
// being dropped silently; the component still renders, without that file's data.
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRenderer } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "fixtures");
const render = createRenderer({ patternsDir: fixtures });

const dataInvalid = (meta: { diagnostics?: { kind: string }[] } | undefined) =>
  (meta?.diagnostics ?? []).filter(d => d.kind === "DATA_INVALID") as
    { kind: string; severity: string; message: string; location?: { file?: string; line?: number } }[];

describe("DATA_INVALID", () => {
  it("an invalid component .json is reported with its file and line, and the component still renders", async () => {
    const out = await render({ component: "atoms/bad-data" });
    expect(out.html).toContain('<span class="bad"></span>');
    const [d] = dataInvalid(out.meta);
    expect(d).toMatchObject({ severity: "error", location: { file: join(fixtures, "atoms/bad-data/bad-data.json"), line: 3 } });
    expect(d.message).toContain("bad-data.json");
  });

  it("an invalid variant .json is reported instead of failing the render", async () => {
    const out = await render({ component: "atoms/bad-data", variant: "broken" });
    const files = dataInvalid(out.meta).map(d => d.location?.file);
    expect(files).toContain(join(fixtures, "atoms/bad-data/bad-data~broken.json"));
  });

  it("an included partial's invalid .json is reported once by the component that includes it", async () => {
    const out = await render({ component: "molecules/bad-include" });
    expect(out.html).toContain("From caller");
    expect(dataInvalid(out.meta).map(d => d.location?.file)).toEqual([join(fixtures, "atoms/bad-data/bad-data.json")]);
  });

  it("a component that does not include it is not affected", async () => {
    const out = await render({ component: "atoms/button" });
    expect(dataInvalid(out.meta)).toEqual([]);
  });
});
