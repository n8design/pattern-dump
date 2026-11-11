// The snapshot writer: the one way a file gets into a `pd build` output root.
//
// A writer belongs to one output root. It fetches a live URL from the headless server, or takes a body
// already in hand, and writes it to the file `staticPathFor` names under that root — rewriting
// root-relative PD URLs for the base path on the way. Its `done` record means each file is written once:
// the first writer of a path wins and later ones are skipped; `store` says which URL holds the file.
//
// Fetch failures are reported, never thrown. By default they are warnings (a component that fails to
// render is a finding about the design system, not a reason to stop the build); a `fatal` capture
// records its failure in `failures` instead, for the caller to turn into a build error.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { PD_ROUTES, staticPathFor } from "@pattern-dump/contracts";

/** Root-relative PD URL prefixes that must move under the base path. */
const PD_PREFIXES = /(^|["'(\s,=])\/(_pd|api|preview|source|assets)\//g;

/** Prefix every root-relative PD URL in a text response with the base path. "/" leaves it untouched. */
export function withBasePath(text: string, basePath: string): string {
  if (basePath === "/") return text;
  return text.replace(PD_PREFIXES, (_m, lead: string, head: string) => `${lead}${basePath}${head}/`);
}

const isText = (contentType: string): boolean =>
  /\b(text\/html|text\/css|application\/json)\b/.test(contentType);

/** The on-disk path for a snapshot URL path: segments decoded, as a static host will look them up. */
function diskPath(outDir: string, urlPath: string): string {
  return join(outDir, ...urlPath.split("/").map(seg => decodeURIComponent(seg)));
}

/** The counters and warnings a writer adds to. Shared by every writer of one build. */
export interface SnapshotCounts {
  files: number;
  bytes: number;
  warnings: string[];
}

export interface SnapshotWriterOptions {
  /** Absolute output root. */
  outDir: string;
  /** "/" or "/sub/path/". */
  basePath: string;
  /** The headless server, e.g. "http://127.0.0.1:61234". */
  origin: string;
  report: SnapshotCounts;
  /** How a live URL is fetched. Default: fetch(origin + url). A writer for another host passes its own. */
  fetch?: (liveUrl: string) => Promise<Response>;
}

export interface CaptureOptions {
  /** A 404 is expected (a component without a data file) and not listed. */
  optional?: boolean;
  /** A failure goes to `failures`, not to the warnings. */
  fatal?: boolean;
}

export interface SnapshotWriter {
  /** Fetch a live URL and write it to its snapshot file. Returns the (unrewritten) body, or null. */
  capture(liveUrl: string, options?: CaptureOptions): Promise<string | null>;
  /** Write a text body under the snapshot path of a live URL (for responses already in hand). Returns null
   *  when it wrote the file, or — when the file was already written — the live URL that wrote it. */
  store(liveUrl: string, body: string): Promise<string | null>;
  /** Failures of fatal captures, one line each ("<status> <url>[: reason]"). */
  readonly failures: string[];
}

export function createSnapshotWriter({ outDir, basePath, origin, report, fetch: get = (u: string) => fetch(`${origin}${u}`) }: SnapshotWriterOptions): SnapshotWriter {
  /** Snapshot file → the live URL that wrote it. */
  const done = new Map<string, string>();
  const failures: string[] = [];

  async function capture(liveUrl: string, { optional = false, fatal = false }: CaptureOptions = {}): Promise<string | null> {
    const file = staticPathFor(liveUrl);
    if (done.has(file)) return null;
    done.set(file, liveUrl);
    const res = await get(liveUrl);
    // The 404 page is written as it is answered, with its 404 status; anything else is written when it is 200.
    if (res.status !== (liveUrl === PD_ROUTES.notFound ? 404 : 200)) {
      // A component that fails to render is a finding about the design system, not a reason to abort
      // the build: the static shell reports the missing file exactly as the live one reports the error.
      // 404s of optional views (a component without a data file) are expected and not listed.
      if (res.status >= 500 || !optional || fatal) {
        const reason = res.status >= 500 ? `: ${((await res.text()).split("\n")[0] ?? "").slice(0, 160)}` : "";
        (fatal ? failures : report.warnings).push(`${res.status} ${liveUrl}${reason}`);
      }
      return null;
    }
    const type = res.headers.get("content-type") ?? "";
    const target = diskPath(outDir, file);
    await mkdir(dirname(target), { recursive: true });
    if (isText(type)) {
      const body = await res.text();
      const out = withBasePath(body, basePath);
      await writeFile(target, out);
      report.bytes += Buffer.byteLength(out);
      report.files++;
      return body;
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    await writeFile(target, buffer);
    report.bytes += buffer.length;
    report.files++;
    return /javascript/.test(type) ? buffer.toString("utf8") : null;
  }

  async function store(liveUrl: string, body: string): Promise<string | null> {
    const file = staticPathFor(liveUrl);
    const holder = done.get(file);
    if (holder !== undefined) return holder;
    done.set(file, liveUrl);
    const target = diskPath(outDir, file);
    await mkdir(dirname(target), { recursive: true });
    const out = withBasePath(body, basePath);
    await writeFile(target, out);
    report.bytes += Buffer.byteLength(out);
    report.files++;
    return null;
  }

  return { capture, store, failures };
}
