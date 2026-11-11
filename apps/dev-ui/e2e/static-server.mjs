#!/usr/bin/env node
// A minimal static file server, standing in for a real static host (GitHub Pages, a CDN, nginx)
// when testing a `pd build` snapshot. No Node logic of Pattern Dump runs here — only files.
//
//   node static-server.mjs --dir <snapshot> [--base /pd/] [--port 4200]
//
// Behaves like a typical host: decodes the request path, serves <path>/index.html for a folder,
// answers 404 (with <base>404.html when present) otherwise, and serves nothing outside --base or outside
// --dir (resolved as the file system resolves it, links followed).

import { createServer } from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: { dir: { type: "string" }, base: { type: "string", default: "/" }, port: { type: "string", default: "4200" } } });
if (!values.dir) { console.error("static-server: --dir is required"); process.exit(1); }
const root = resolve(values.dir);
const base = `/${values.base.replace(/^\/+|\/+$/g, "")}/`.replace("//", "/");

const TYPES = {
  ".html": "text/html; charset=utf-8", ".json": "application/json", ".css": "text/css", ".js": "application/javascript",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".ico": "image/x-icon", ".webp": "image/webp",
  ".mp4": "video/mp4",
};

const inside = (path, dir) => { const rel = relative(dir, path); return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)); };
const realRoot = await realpath(root);

/** The file at `path`, or its folder's index.html; null when there is none, or when it is outside the root. */
async function file(path) {
  const real = await realpath(path).catch(() => null);
  if (!real || !inside(real, realRoot)) return null;
  const s = await stat(real).catch(() => null);
  if (!s) return null;
  if (s.isDirectory()) return file(join(real, "index.html"));
  return real;
}

createServer(async (req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname); } catch { pathname = null; }
  if (pathname === null || !pathname.startsWith(base)) { res.writeHead(404); res.end("outside base"); return; }
  const rest = pathname.slice(base.length);
  // file() compares resolved paths (links followed), which covers ".." and a link pointing out alike.
  const found = rest.includes("\0") || rest.includes("\\") ? null : await file(resolve(root, rest));
  if (!found) {
    const notFound = await file(join(root, "404.html"));
    res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    res.end(notFound ? await readFile(notFound) : "not found");
    return;
  }
  res.writeHead(200, { "Content-Type": TYPES[extname(found)] ?? "application/octet-stream" });
  res.end(await readFile(found));
}).listen(Number(values.port), "127.0.0.1", () => console.log(`static-server: ${root} at http://127.0.0.1:${values.port}${base}`));
