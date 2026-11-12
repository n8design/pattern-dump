// The same source, width and settings give the same WebP bytes on every machine: the committed hashes were
// encoded on macOS (arm64), and CI checks them on Linux (x64) under Node 22 and 24. A built site, and the golden
// snapshot when it holds images, depend on it. The machine's CPU and SIMD features are printed, so a CI log shows
// what the hashes were checked on.
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { cpus } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeWebp, loadSharp } from "../src/images.js";

const fixtures = fileURLToPath(new URL("./fixtures/images/", import.meta.url));
const expected = JSON.parse(readFileSync(join(fixtures, "expected-webp.json"), "utf8")) as Record<string, string>;
const ENC = { quality: 75, effort: 4 };
const WIDTHS = [160, 320];

/** The SIMD features the CPU reports (Linux: /proc/cpuinfo flags or Features), the ones libvips and libwebp use. */
function simdFeatures(): string {
  try {
    const info = readFileSync("/proc/cpuinfo", "utf8");
    const line = /^(?:flags|Features)\s*:\s*(.*)$/m.exec(info)?.[1] ?? "";
    const wanted = /^(sse4_1|sse4_2|avx|avx2|fma|avx512f|avx512bw|avx512vl|avx512dq|avx512cd|avx512_vnni|avx512vbmi|asimd|neon|sve|sve2)$/;
    return [...new Set(line.split(/\s+/).filter(f => wanted.test(f)))].join(" ") || "(none listed)";
  } catch {
    return "(no /proc/cpuinfo)";
  }
}

describe("WebP encoding is the same on every machine", () => {
  it("matches the committed hashes", async () => {
    const sharp = await loadSharp();
    const got: Record<string, string> = {};
    for (const name of Object.keys(expected).map(k => k.split("@")[0]!).filter((v, i, a) => a.indexOf(v) === i)) {
      const source = await readFile(join(fixtures, name));
      for (const w of WIDTHS) got[`${name}@${w}`] = createHash("sha256").update(await encodeWebp(sharp, source, w, ENC)).digest("hex");
    }
    console.log(`[image-determinism] ${process.platform}-${process.arch} node ${process.version}; cpu: ${cpus()[0]?.model ?? "?"}; `
      + `simd features: ${simdFeatures()}; sharp ${sharp.versions.sharp ?? "?"} vips ${sharp.versions.vips} webp ${sharp.versions.webp ?? "?"} highway ${sharp.versions.highway ?? "?"}; sharp.simd() ${sharp.simd()}`);
    expect(got).toEqual(expected);
  });
});
