// Reading a site's mounts (mounts.ts): the files each publishes and where, links inside a mount, and what stops a
// build: a missing folder, a link out of the mount, a file another file of the site has the place of.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { SiteMountConfig } from "../src/server-config.js";
import { mountCollisions, mountProblems, readMounts, sitemapRoutes } from "../src/storefront/mounts.js";
import { claimsOf } from "../src/storefront/site-output.js";
import { save } from "../../../test-support/save.js";

let tmp = "";
beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), "pd-mounts-")); });
afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });

let n = 0;
/** A project folder and its mounts' folders beside it, with `files` (path: text) written. */
async function layout(files: Record<string, string>): Promise<string> {
  const dir = join(tmp, `l${n++}`);
  for (const [rel, text] of Object.entries(files)) {
    await mkdir(dirname(join(dir, rel)), { recursive: true });
    await save(join(dir, rel), text);
  }
  await mkdir(join(dir, "site"), { recursive: true });
  return dir;
}
const mount = (dir: string, name: string, to: string, sitemap = false): SiteMountConfig =>
  ({ name, from: join(dir, "site", name), to, sitemap });

describe("readMounts", () => {
  it("lists each mount's files at their paths in the site, sorted, folders and all", async () => {
    const dir = await layout({ "tool/index.html": "a", "tool/b/c.css": "c", "tool/a.js": "j", "root/favicon.ico": "i", "root/123456/x.css": "x" });
    const got = await readMounts([mount(dir, "../tool", "/tool/"), mount(dir, "../root", "/")], join(dir, "site"));
    expect(got.files.map(f => `${f.path} <- ${f.mount.name}/${f.rel}`)).toEqual([
      "/tool/a.js <- ../tool/a.js", "/tool/b/c.css <- ../tool/b/c.css", "/tool/index.html <- ../tool/index.html",
      "/123456/x.css <- ../root/123456/x.css", "/favicon.ico <- ../root/favicon.ico",
    ]);
    expect(got.files[0]!.file).toBe(join(dir, "tool", "a.js"));
    expect(got).toMatchObject({ missing: [], problems: [] });
  });

  it("publishes a link inside the mount as the file or folder it points to", async () => {
    const dir = await layout({ "tool/real/a.css": "a", "tool/b.css": "b" });
    await symlink(join(dir, "tool", "b.css"), join(dir, "tool", "same.css"));
    await symlink("real", join(dir, "tool", "alias"));
    const got = await readMounts([mount(dir, "../tool", "/tool/")], join(dir, "site"));
    expect(got.files.map(f => f.path)).toEqual(["/tool/alias/a.css", "/tool/b.css", "/tool/real/a.css", "/tool/same.css"]);
    expect(got.problems).toEqual([]);
  });

  it("names a link out of the mount, a link to nothing and a link back up, and leaves each out", async () => {
    const dir = await layout({ "tool/a.css": "a", "secret.txt": "s" });
    await symlink(join(dir, "secret.txt"), join(dir, "tool", "out.txt"));
    await symlink(join(dir, "tool", "gone.css"), join(dir, "tool", "dangling.css"));
    await symlink(".", join(dir, "tool", "up"));
    const got = await readMounts([mount(dir, "../tool", "/tool/")], join(dir, "site"));
    expect(got.files.map(f => f.path)).toEqual(["/tool/a.css"]);
    const tail = "a mount publishes files, and a link is published as the file it points to, inside the mount; copy the file in, or remove the link";
    expect(got.problems).toEqual([
      `site.mounts: ../tool/dangling.css is a link to nothing: ${tail}`,
      `site.mounts: ../tool/out.txt is a link to ../secret.txt, outside ../tool: ${tail}`,
      `site.mounts: ../tool/up is a link back to a folder above it: ${tail}`,
    ]);
  });

  it("puts a missing folder in missing, and names a file given as a folder", async () => {
    const dir = await layout({ "file.txt": "f" });
    const got = await readMounts([mount(dir, "../gone", "/gone/"), mount(dir, "../file.txt", "/f/")], join(dir, "site"));
    expect(got.files).toEqual([]);
    expect(got.missing.map(m => m.name)).toEqual(["../gone"]);
    expect(got.problems).toEqual(["site.mounts: ../file.txt is a file, not a folder: a mount publishes a folder's files at /f/"]);
  });
});

describe("mountCollisions", () => {
  const model = { pages: [{ route: "/" }, { route: "/about/", redirectFrom: ["/about-us/"] }, { route: "/notes/" }], images: ["notes/shot.png"] } as never;
  const claims = claimsOf(model, [{ address: "/notes/feed.xml", source: "notes/index.md" }]);
  const tail = "remove the file from the mount, or publish the mount at another route";

  it("names each file that takes a place the site writes, with both", async () => {
    const d = await layout({
      "root/about/index.html": "", "root/about-us/index.html": "", "root/notes/feed.xml": "", "root/sitemap.xml": "",
      "root/_pd/x.css": "", "root/notes/shot.png": "", "root/robots.txt": "", "root/ok.css": "", "other/about": "",
    });
    const { files } = await readMounts([mount(d, "../root", "/"), mount(d, "../other", "/")], join(d, "site"));
    expect(mountCollisions(files, claims)).toEqual([
      `site.mounts: ../root/_pd/x.css would be published at /_pd/x.css, which is in _pd/, which Pattern Dump writes: ${tail}`,
      `site.mounts: ../root/about-us/index.html would be published at /about-us/index.html, which is the page /about-us/: ${tail}`,
      `site.mounts: ../root/about/index.html would be published at /about/index.html, which is the page /about/: ${tail}`,
      `site.mounts: ../root/notes/feed.xml would be published at /notes/feed.xml, which is notes/index.md's feed: ${tail}`,
      `site.mounts: ../root/notes/shot.png would be published at /notes/shot.png, which is the image /notes/shot.png: ${tail}`,
      `site.mounts: ../root/robots.txt would be published at /robots.txt, which is the site's robots.txt: ${tail}`,
      `site.mounts: ../root/sitemap.xml would be published at /sitemap.xml, which is the site's sitemap.xml: ${tail}`,
      // A file where the page's folder is.
      `site.mounts: ../other/about would be published at /about, which is the page /about/: ${tail}`,
    ]);
  });

  it("names a file in the place of an old route that is a file (redirectFrom: /how-to/old.html)", async () => {
    const moved = claimsOf({ pages: [{ route: "/about/", redirectFrom: ["/how-to/old.html"] }], images: [] } as never);
    const d = await layout({ "root/how-to/old.html": "", "root/how-to/new.html": "" });
    const { files } = await readMounts([mount(d, "../root", "/")], join(d, "site"));
    expect(mountCollisions(files, moved)).toEqual([
      `site.mounts: ../root/how-to/old.html would be published at /how-to/old.html, which is the page /how-to/old.html: ${tail}`,
    ]);
  });

  it("names a file two mounts publish at one place, the later one, and a file where another mount has a folder", async () => {
    const d = await layout({ "a/x.css": "", "a/dir/y.css": "", "b/x.css": "", "b/dir": "", "b/z.css": "" });
    const { files } = await readMounts([mount(d, "../a", "/"), mount(d, "../b", "/")], join(d, "site"));
    expect(mountCollisions(files, [])).toEqual([
      `site.mounts: ../b/dir would be published at /dir, which clashes with ../a/dir/y.css, published at /dir/y.css: ${tail}`,
      `site.mounts: ../b/x.css would be published at /x.css, which clashes with ../a/x.css, published at /x.css: ${tail}`,
    ]);
  });
});

describe("mountProblems", () => {
  it("is a missing folder, a bad link and each collision, and the files that were read", async () => {
    const d = await layout({ "root/sitemap.xml": "", "root/ok.css": "" });
    const got = await mountProblems([mount(d, "../root", "/"), mount(d, "../tool", "/tool/")], join(d, "site"), claimsOf({ pages: [], images: [] } as never));
    expect(got.files.map(f => f.path)).toEqual(["/ok.css", "/sitemap.xml"]);
    expect(got.problems).toEqual([
      "site.mounts: ../tool, published at /tool/, doesn't exist: build it before the site (the other tool's build runs first), or remove the mount",
      "site.mounts: ../root/sitemap.xml would be published at /sitemap.xml, which is the site's sitemap.xml: remove the file from the mount, or publish the mount at another route",
    ]);
  });
});

describe("sitemapRoutes", () => {
  it("is every .html file of a mount with sitemap: true, an index.html by its folder", async () => {
    const d = await layout({ "tool/index.html": "", "tool/guide/index.html": "", "tool/guide/a.html": "", "tool/x.css": "", "tool/b.htm": "", "other/index.html": "" });
    const { files } = await readMounts([mount(d, "../tool", "/tool/", true), mount(d, "../other", "/other/")], join(d, "site"));
    expect(sitemapRoutes(files)).toEqual(["/tool/guide/a.html", "/tool/guide/", "/tool/"]);
  });
});
