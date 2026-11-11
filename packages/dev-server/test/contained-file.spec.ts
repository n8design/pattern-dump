// contained-file.ts: a file a route serves must be inside the folder it serves from, as the file system
// resolves both. Every way out is refused: "..", a backslash, a NUL, a sibling folder that shares the root's
// name as a prefix, and a link inside the root that points outside it.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { containedFile, decodePath, isInside } from "../src/contained-file.js";
import { save } from "../../../test-support/save.js";

let tmp = "", root = "";
beforeAll(async () => {
  tmp = await realpath(await mkdtemp(join(tmpdir(), "pd-contained-")));
  root = join(tmp, "assets");
  await mkdir(join(root, "images"), { recursive: true });
  await save(join(root, "images", "a.png"), "inside");
  await save(join(tmp, "secret.txt"), "outside");
  await mkdir(join(tmp, "assets-other"), { recursive: true });
  await save(join(tmp, "assets-other", "b.txt"), "a sibling");
  await symlink(join(tmp, "secret.txt"), join(root, "out.txt"));
  await symlink(tmp, join(root, "up"));
  await symlink(join(root, "images", "a.png"), join(root, "alias.png"));
  await symlink(root, join(tmp, "linked-root"));
});
afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });

describe("containedFile", () => {
  it("finds a file inside the root, and one a link inside the root points to inside it", async () => {
    expect(await containedFile(root, "images/a.png")).toBe(join(root, "images", "a.png"));
    expect(await containedFile(root, "/images/a.png")).toBe(join(root, "images", "a.png"));
    expect(await containedFile(root, "alias.png")).toBe(join(root, "images", "a.png"));
  });

  it("serves from a root that is itself a link", async () => {
    expect(await containedFile(join(tmp, "linked-root"), "images/a.png")).toBe(join(root, "images", "a.png"));
  });

  it("refuses every way out of the root", async () => {
    for (const rest of ["../secret.txt", "images/../../secret.txt", "../assets-other/b.txt", "..", "/../secret.txt",
      "images\\..\\..\\secret.txt", "..\\secret.txt", "images/a.png\0", "out.txt", "up/secret.txt"]) {
      expect(await containedFile(root, rest), JSON.stringify(rest)).toBeNull();
    }
  });

  it("finds nothing for a folder or a missing file", async () => {
    expect(await containedFile(root, "images")).toBeNull();
    expect(await containedFile(root, "")).toBeNull();
    expect(await containedFile(root, "images/gone.png")).toBeNull();
  });
});

describe("isInside", () => {
  it("is true for the root and below it, false for its parent and for a sibling sharing its name as a prefix", () => {
    expect(isInside("/a/assets", "/a/assets")).toBe(true);
    expect(isInside("/a/assets/x/y", "/a/assets")).toBe(true);
    expect(isInside("/a/assets/..x", "/a/assets")).toBe(true);
    expect(isInside("/a", "/a/assets")).toBe(false);
    expect(isInside("/a/assets-other/x", "/a/assets")).toBe(false);
  });
});

describe("decodePath", () => {
  it("decodes, and gives null for a malformed escape", () => {
    expect(decodePath("..%2fsecret")).toBe("../secret");
    expect(decodePath("%E0%A4%A")).toBeNull();
  });
});
