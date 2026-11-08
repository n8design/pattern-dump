// The diagnostics artifact is replaced in one step: a reader during a write sees the previous artifact,
// whole, never part of the new one. Produced by making each write pause half-way, with only half its text
// on disk, while the test reads the artifact; no timing involved.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// While `held` is set, a write puts half its text on disk and waits for `release` before the rest.
const gate = vi.hoisted(() => ({ held: false, release: (): void => {}, paused: (): void => {} }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs/promises")>();
  const writeFile = (async (path: Parameters<typeof fs.writeFile>[0], data: string, ...rest: unknown[]) => {
    if (!gate.held || typeof data !== "string") return (fs.writeFile as (...a: unknown[]) => Promise<void>)(path, data, ...rest);
    await fs.writeFile(path, data.slice(0, Math.floor(data.length / 2)));
    await new Promise<void>(resolve => { gate.release = resolve; gate.paused(); });
    await fs.writeFile(path, data);
  }) as typeof fs.writeFile;
  return { ...fs, writeFile, default: { ...fs, writeFile } };
});

const { persistSlices, readDiagnosticsArtifact } = await import("../src/diagnostics.js");
const { pdScratchDir } = await import("../src/scratch.js");

let root = "";
beforeAll(async () => { root = await mkdtemp(join(tmpdir(), "pd-artifact-write-")); });
afterAll(async () => {
  if (!root) return;
  await rm(pdScratchDir(root), { recursive: true, force: true });
  await rm(root, { recursive: true, force: true });
});

describe("the diagnostics artifact, while it is written", () => {
  it("reads as the previous artifact, whole, never as part of the new one", async () => {
    await persistSlices(root, new Map());
    expect(await readDiagnosticsArtifact(root)).not.toBeNull();

    gate.held = true;
    const paused = new Promise<void>(resolve => { gate.paused = resolve; });
    const writing = persistSlices(root, new Map());
    await paused;
    // Half of the new text is on disk somewhere; the artifact a reader finds is still whole.
    const during = await readDiagnosticsArtifact(root);
    gate.held = false;
    gate.release();
    await writing;
    expect(during).not.toBeNull();
    expect(await readDiagnosticsArtifact(root)).not.toBeNull();
    // And nothing is left beside it.
    expect((await readdir(pdScratchDir(root))).filter(f => f.endsWith(".tmp"))).toEqual([]);
  });
});
