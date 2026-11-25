// Site mounts (site.mounts): folders of another tool's finished files, each published at a route of the site,
// byte for byte. Nothing here reads a file's content: a mount is a list of where each file goes and where it comes
// from, checked against what the site writes (site-output.ts) and against the other mounts.
//
//   { from: "../docs/htwoo-core", to: "/htwoo-core/" }   ../docs/htwoo-core/index.html -> /htwoo-core/index.html
//   { from: "./root", to: "/" }                          ./root/favicon.ico            -> /favicon.ico
//
// A link inside a mount is published as the file it points to, when that is inside the mount; one that points
// outside it, or nowhere, is a problem. So nothing published is a link.

import { lstat, readdir, realpath, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { containedFile } from "../contained-file.js";
import type { SiteMountConfig } from "../server-config.js";
import { collisionOf, describeClaim, type Claim } from "./site-output.js";

/** A file a mount publishes: its path in the site (/htwoo-core/index.html), the file it is read from (links
 *  followed), and its path in the mount's folder, with "/" (index.html). */
export interface MountedFile { path: string; file: string; rel: string; mount: SiteMountConfig }

const inside = (child: string, parent: string): boolean => {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !rel.startsWith(sep) && !/^[a-zA-Z]:/.test(rel));
};

/**
 * Every file of each mount, in the config's order, each mount's files sorted by path. A mount whose folder doesn't
 * exist is in `missing` and has no files; a link that leads out of its mount, or nowhere, is a problem and is left
 * out. `root` is the project's: a link's target is named from it.
 */
export async function readMounts(mounts: readonly SiteMountConfig[], root: string): Promise<{
  files: MountedFile[]; missing: SiteMountConfig[]; problems: string[];
}> {
  const files: MountedFile[] = [], missing: SiteMountConfig[] = [], problems: string[] = [];
  // A link's target, from the project's root, so no message names a folder of the machine.
  const realRoot = await realpath(root).catch(() => root);
  const shown = (p: string) => relative(realRoot, p).split(sep).join("/") || ".";
  for (const mount of mounts) {
    const top = await stat(mount.from).catch(() => null);
    if (top === null) { missing.push(mount); continue; }
    if (!top.isDirectory()) {
      problems.push(`site.mounts: ${mount.name} is a file, not a folder: a mount publishes a folder's files at ${mount.to}`);
      continue;
    }
    const real = await realpath(mount.from);
    const own: MountedFile[] = [];
    // `dir`: the folder as the mount names it (for rel); `at`: its real path. `seen`: the real folders on the way
    // down, so a link back up is a loop, not an endless walk.
    const walk = async (dir: string, seen: ReadonlySet<string>): Promise<void> => {
      for (const e of await readdir(join(mount.from, dir), { withFileTypes: true })) {
        const rel = dir ? `${dir}/${e.name}` : e.name;
        const path = join(mount.from, ...rel.split("/"));
        let isDir = e.isDirectory(), isFile = e.isFile();
        if ((await lstat(path)).isSymbolicLink()) {
          const target = await realpath(path).catch(() => null);
          const say = (why: string) => problems.push(`site.mounts: ${mount.name}/${rel} is a link ${why}: a mount publishes `
            + `files, and a link is published as the file it points to, inside the mount; copy the file in, or remove the link`);
          if (target === null) { say("to nothing"); continue; }
          if (!inside(target, real)) { say(`to ${shown(target)}, outside ${mount.name}`); continue; }
          const s = await stat(target);
          isDir = s.isDirectory(); isFile = s.isFile();
          if (isDir && seen.has(target)) { say("back to a folder above it"); continue; }
        }
        if (isDir) await walk(rel, new Set([...seen, await realpath(path)]));
        else if (isFile) own.push({ path: `${mount.to}${rel}`, file: path, rel, mount });
      }
    };
    await walk("", new Set([real]));
    files.push(...own.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0)));
  }
  return { files, missing, problems };
}

/**
 * Each mounted file that would take the place of a file the site writes (`claims`, site-output.ts) or of another
 * mount's file: one problem per file, naming both. The site's own files are checked first, then the mounts in the
 * config's order, so the later mount's file is the one named.
 */
export function mountCollisions(files: readonly MountedFile[], claims: readonly Claim[]): string[] {
  const problems: string[] = [];
  const taken: Claim[] = [...claims];
  for (const f of files) {
    const clash = collisionOf(taken, f.path);
    if (clash) {
      const what = clash.kind === "mount" ? `clashes with ${clash.source}, published at ${clash.path}` : `is ${describeClaim(clash)}`;
      problems.push(`site.mounts: ${f.mount.name}/${f.rel} would be published at ${f.path}, which ${what}: `
        + `remove the file from the mount, or publish the mount at another route`);
      continue;
    }
    taken.push({ kind: "mount", path: f.path, source: `${f.mount.name}/${f.rel}` });
  }
  return problems;
}

/** The mount problems that stop pd build: a missing folder, a link out of its mount, a collision. */
export async function mountProblems(mounts: readonly SiteMountConfig[], root: string, claims: readonly Claim[]): Promise<{
  files: MountedFile[]; problems: string[];
}> {
  const read = await readMounts(mounts, root);
  return {
    files: read.files,
    problems: [
      ...read.missing.map(m => `site.mounts: ${m.name}, published at ${m.to}, doesn't exist: build it before the site `
        + `(the other tool's build runs first), or remove the mount`),
      ...read.problems,
      ...mountCollisions(read.files, claims),
    ],
  };
}

/** The sitemap's mounted pages: every .html file of each mount with `sitemap: true`, an index.html by its folder's
 *  URL, as a page's route is. */
export const sitemapRoutes = (files: readonly MountedFile[]): string[] =>
  files.filter(f => f.mount.sitemap && f.path.endsWith(".html")).map(f => f.path.replace(/(^|\/)index\.html$/, "$1"));

/** What a request for a site path finds in the mounts (pd dev): the file of the first mount that has it, in the
 *  config's order, with the later mounts that have it too; or a folder of a mount that wants its "/" (a static host
 *  forwards /tool to /tool/, so the folder's relative links resolve). Null when no mount has it. */
export type MountedAnswer =
  | { kind: "file"; file: string; mount: SiteMountConfig; rel: string; also: string[] }
  | { kind: "folder"; location: string }
  | null;

/**
 * Looks `path` (a decoded site path, the base path taken off) up in the mounts, on disk, every time: a mount
 * rebuilt while pd dev runs shows on the next request, and a folder that is missing simply has no files.
 * Containment is containedFile's: a file must be inside its mount's folder, links followed.
 */
export async function mountedFile(mounts: readonly SiteMountConfig[], path: string): Promise<MountedAnswer> {
  let found: Extract<MountedAnswer, { kind: "file" }> | undefined;
  for (const mount of mounts) {
    if (!path.startsWith(mount.to)) continue;
    const rest = path.slice(mount.to.length);
    const rel = rest === "" || rest.endsWith("/") ? `${rest}index.html` : rest;
    const file = await containedFile(mount.from, rel);
    if (file === null) continue;
    if (found) found.also.push(`${mount.name}/${rel}`);
    else found = { kind: "file", file, mount, rel, also: [] };
  }
  if (found) return found;
  if (!path.endsWith("/")) {
    for (const mount of mounts) {
      if (!`${path}/`.startsWith(mount.to)) continue;
      if (await containedFile(mount.from, `${path}/index.html`.slice(mount.to.length))) return { kind: "folder", location: `${path}/` };
    }
  }
  return null;
}
