// A data file that does not parse is reported (DATA_INVALID, with its file and position) instead of
// being dropped silently; the component still renders, without that file's data. The file is named
// without an absolute path: by the caller's displayPath, else relative to its pattern root.
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, isAbsolute, join } from "node:path";
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
    expect(d).toMatchObject({ severity: "error", location: { file: "atoms/bad-data/bad-data.json", line: 3 } });
    expect(d.message).toContain("bad-data.json");
  });

  it("an invalid variant .json is reported instead of failing the render", async () => {
    const out = await render({ component: "atoms/bad-data", variant: "broken" });
    const files = dataInvalid(out.meta).map(d => d.location?.file);
    expect(files).toContain("atoms/bad-data/bad-data~broken.json");
  });

  it("an included partial's invalid .json is reported once by the component that includes it", async () => {
    const out = await render({ component: "molecules/bad-include" });
    expect(out.html).toContain("From caller");
    expect(dataInvalid(out.meta).map(d => d.location?.file)).toEqual(["atoms/bad-data/bad-data.json"]);
  });

  it("a component that does not include it is not affected", async () => {
    const out = await render({ component: "atoms/button" });
    expect(dataInvalid(out.meta)).toEqual([]);
  });
});

describe("DATA_INVALID names its file without an absolute path", () => {
  const files = async (r: ReturnType<typeof createRenderer>) => {
    const out = [...dataInvalid((await r({ component: "atoms/bad-data" })).meta),
      ...dataInvalid((await r({ component: "atoms/bad-data", variant: "broken" })).meta),
      ...dataInvalid((await r({ component: "molecules/bad-include" })).meta)];
    return out.map(d => d.location?.file);
  };
  // The base's data, then the variant render's (its base's and its own), then the include's.

  it("never absolute, with or without displayPath", async () => {
    const named = createRenderer({ patternsDir: fixtures, displayPath: p => `pkg/${p.slice(fixtures.length + 1)}` });
    for (const r of [render, named]) {
      const found = await files(r);
      expect(found.length).toBeGreaterThan(0);
      for (const f of found) expect(isAbsolute(f!), f).toBe(false);
    }
  });

  it("uses the caller's displayPath when it gives one", async () => {
    const r = createRenderer({ patternsDir: fixtures, displayPath: p => `pkg/${p.slice(fixtures.length + 1)}` });
    expect(await files(r)).toEqual(["pkg/atoms/bad-data/bad-data.json", "pkg/atoms/bad-data/bad-data.json", "pkg/atoms/bad-data/bad-data~broken.json", "pkg/atoms/bad-data/bad-data.json"]);
  });

  it("falls back to the pattern-root path when displayPath returns an absolute one", async () => {
    const r = createRenderer({ patternsDir: fixtures, displayPath: p => p });
    expect(await files(r)).toEqual(["atoms/bad-data/bad-data.json", "atoms/bad-data/bad-data.json", "atoms/bad-data/bad-data~broken.json", "atoms/bad-data/bad-data.json"]);
  });

  it("names a file by the pattern root that holds it, when there are several", async () => {
    const r = createRenderer({ patternsDir: join(here, "nowhere"), patternRoots: [{ dir: join(here, "nowhere") }, { dir: fixtures, source: "pkg" }] });
    expect((await files(r))[0]).toBe("atoms/bad-data/bad-data.json");
  });
});
