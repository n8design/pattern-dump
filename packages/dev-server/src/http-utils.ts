// HTTP + HTML leaf helpers for the dev server.
//
// This module is a LEAF: it imports nothing from the rest of dev-server, and everything here takes
// explicit arguments. That is deliberate — `escapeHtml` is shared by the Markdown renderer, the
// preview-document composer and the shell builder, so it has to live somewhere none of them import
// each other through. Leaving it in index.ts while those modules import it would create an import
// cycle the moment any of them is extracted.
//
// Nothing here touches server state, so these are safe to call from a route handler, a watcher
// callback, or a test.

import { readFile } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { PD_ROUTE_PREFIX, PD_ROUTES, type ShellRuntime } from "@pattern-dump/contracts";

/** Content-Type for a file extension; unknown extensions fall back to a download-safe default. */
export function mimeType(ext: string): string {
  const map: Record<string, string> = {
    ".css":   "text/css",
    ".js":    "application/javascript",
    ".json":  "application/json",
    ".html":  "text/html",
    ".svg":   "image/svg+xml",
    ".png":   "image/png",
    ".jpg":   "image/jpeg",
    ".jpeg":  "image/jpeg",
    ".gif":   "image/gif",
    ".webp":  "image/webp",
    ".ico":   "image/x-icon",
    ".woff":  "font/woff",
    ".woff2": "font/woff2",
    ".ttf":   "font/ttf",
    ".otf":   "font/otf",
    ".mp4":   "video/mp4",
    ".webm":  "video/webm",
  };
  return map[ext.toLowerCase()] ?? "application/octet-stream";
}

/** Escape for HTML *text* content. Not sufficient for attribute values — use `escapeAttr`. */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Escape for an HTML *attribute* value — additionally handles the quote character, which is what
 * stops an injected value breaking out of the attribute. Applied at every attribute bake site in
 * the preview document.
 */
export function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Write a JSON response with the given status. */
export function json(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

/** Stream a file, or 404 if it cannot be read. Any read failure is a 404, not a 500 — a missing
 * asset is a routing outcome, not a server fault. */
/** A file's bytes: 404 when there is no such file, 500 when it exists but can't be read. */
export async function serveFile(res: ServerResponse, filePath: string, contentType: string): Promise<void> {
  try {
    const content = await readFile(filePath);
    res.writeHead(200, { "Content-Type": contentType });
    res.end(content);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    const missing = code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR";
    res.writeHead(missing ? 404 : 500, { "Content-Type": "text/plain" });
    res.end(missing ? "Not found" : `Could not read the file (${code ?? "unknown error"})`);
  }
}

/** Prefixes owned by the server's own routes. An unmatched path under one is never a workbench route. */
const RESERVED_PREFIXES = ["/_pd/", "/api/", PD_ROUTE_PREFIX.preview, PD_ROUTE_PREFIX.source, PD_ROUTE_PREFIX.assets];

/**
 * Whether an unmatched path gets the SPA shell (a workbench route) or a 404. The shell is for page
 * loads: a path outside the reserved prefixes whose last segment has no file extension, or any such
 * path a browser navigates to (`Accept: text/html`, which also covers a component id with a dot in
 * it). A missing image, font, stylesheet or script is a 404, not a 200 carrying the workbench.
 */
export function servesShell(pathname: string, accept: string | undefined): boolean {
  if (RESERVED_PREFIXES.some(p => pathname.startsWith(p))) return false;
  const last = pathname.slice(pathname.lastIndexOf("/") + 1);
  return !/\.[a-z0-9]+$/i.test(last) || (accept ?? "").includes("text/html");
}

/**
 * The SPA shell document. Served for unmatched workbench routes (see `servesShell`) so client-side
 * routing owns the URL space.
 * `window.__pd` (ShellRuntime) is the only value the shell needs inline — how it was served: live,
 * with the live-reload port, or from a static build. Everything else it fetches.
 */
export function buildShellHtml(runtime: ShellRuntime): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Pattern Dump Dev</title>
<link rel="stylesheet" href="${PD_ROUTES.mainCss}">
<link rel="stylesheet" href="${PD_ROUTES.shikiCss}">
</head>
<body>
<div id="app"></div>
<script>window.__pd=${JSON.stringify(runtime).replace(/</g, "\\u003c")};</script>
<script type="module" src="${PD_ROUTES.mainJs}"></script>
</body>
</html>`;
}
