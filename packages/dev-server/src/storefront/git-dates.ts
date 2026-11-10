// A storefront page's dates, from git: `page.created` and `page.modified`.
//
// One pass over the pages folder's history, whatever the number of pages:
//
//   git rev-parse --show-toplevel / --verify HEAD / --is-shallow-repository
//   git log -M --name-status -z --format=%x01%aI -- <pagesDir>     newest first
//   git status --porcelain=v1 -z --untracked-files=all -- <pagesDir>
//
// Walking the log newest to oldest, the first commit seen for a page is its last change (modified) and the
// last one seen its creation (created). A rename R old→new files the older history of `new` under `old`, so
// a renamed page keeps the date it was first added. A copy C is not followed: the copy is a page of its own,
// created at the copy. An add A ends a page's history (older commits with that name were another file).
// The date is the author date (%aI), which survives a rebase or a cherry-pick.
//
// Every value is a function of the commits, never of the clock or of file times. A page with uncommitted
// changes has its last commit's dates; a page that git does not know (untracked, ignored, outside any
// repository) has null for both. Each such case is a note.
//
// LIMITS (also in docs/guide/storefront.md):
//  - A shallow clone has only part of the history, so dates of pages last changed beyond its depth are
//    wrong, not missing: the boundary commit's. `pd build` refuses to build a page whose layout uses
//    dates from a shallow clone (in CI, check out with fetch-depth: 0); `pd dev` notes it.
//  - A page moved into the pages folder from outside it counts as created at the move: the log is limited
//    to the pages folder, so a rename whose old name is outside it reads as an add.

import { execFile } from "node:child_process";
import { relative, sep } from "node:path";

export interface PageDates { created: string | null; modified: string | null }

/** Runs git with `args` in `cwd`; resolves to its stdout, rejects when git fails. */
export type RunGit = (cwd: string, args: string[]) => Promise<string>;

export const runGit: RunGit = (cwd, args) => new Promise((resolve, reject) => {
  execFile("git", args, { cwd, encoding: "utf8", maxBuffer: 1 << 30 }, (error, stdout) => {
    if (error) reject(error); else resolve(stdout);
  });
});

/**
 * Dates by page path, from `git log -M --name-status -z --format=%x01<date>` output (newest first).
 * `pages` maps each page's path as git names it (repository-relative) to the page's own key.
 *
 * The output is one record per commit: \x01, the date, \0, then for each changed file its status and path(s),
 * each ended by \0 — and git puts a newline before the first status of a commit. A rename or copy has two
 * paths, old then new.
 */
export function parseLog(out: string, pages: ReadonlyMap<string, string>): Map<string, PageDates> {
  const dates = new Map<string, PageDates>();
  /** Path in the commit being read → the page it is, at that point of the history. */
  const alias = new Map(pages);
  const seen = (page: string, date: string): void => {
    const d = dates.get(page) ?? { created: null, modified: null };
    d.modified ??= date;
    d.created = date; // provisional: an older commit of the same page overwrites it
    dates.set(page, d);
  };
  for (const record of out.split("\x01").slice(1)) {
    const [date = "", ...rest] = record.split("\x00");
    const fields = rest.map(f => f.replace(/^\n/, "")).filter(f => f !== "");
    for (let i = 0; i < fields.length;) {
      const status = fields[i]!;
      if (status.startsWith("R") || status.startsWith("C")) {
        const from = fields[i + 1]!, to = fields[i + 2]!;
        i += 3;
        const page = alias.get(to);
        if (page === undefined) continue;
        seen(page, date);
        alias.delete(to);
        // A rename carries the page's history on under its old name; a copy's history starts here.
        if (status.startsWith("R")) alias.set(from, page);
      } else {
        const file = fields[i + 1]!;
        i += 2;
        const page = alias.get(file);
        if (page === undefined) continue;
        seen(page, date);
        if (status === "A") alias.delete(file);
      }
    }
  }
  return dates;
}

/** The paths `git status --porcelain=v1 -z` reports, by kind. A rename's old path (its second field) is
 *  skipped: the page is at the new one. */
export function parseStatus(out: string): { untracked: string[]; changed: string[] } {
  const untracked: string[] = [], changed: string[] = [];
  const entries = out.split("\x00");
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]!;
    if (e.length < 4) continue;
    const code = e.slice(0, 2), file = e.slice(3);
    if (code === "??") untracked.push(file);
    else if (code !== "!!") changed.push(file);
    if (code[0] === "R" || code[0] === "C") i++;
  }
  return { untracked, changed };
}

/** What the history says about the pages folder, once per process. */
export interface GitHistory {
  /** Why no page has dates, when none has: no repository, or one without commits. */
  none?: string;
  shallow: boolean;
  /** By page path relative to the pages folder ("guides/setup.md"). */
  dates: Map<string, PageDates>;
  /** Repository-relative path of a page path. */
  repoPath(path: string): string;
  /** The top level, where `status` runs. */
  top: string;
  /** The pages folder, repository-relative ("." at the top). */
  scope: string;
}

/** The one log pass over `pagesDir`, for the pages at `paths` (relative to it, with forward slashes). */
export async function readHistory(pagesDir: string, paths: string[], git: RunGit = runGit): Promise<GitHistory> {
  const empty = (none: string): GitHistory => ({ none, shallow: false, dates: new Map(), repoPath: p => p, top: pagesDir, scope: "." });
  let top: string;
  try { top = (await git(pagesDir, ["rev-parse", "--show-toplevel"])).trim(); } catch { return empty("the pages folder is not in a git repository"); }
  try { await git(top, ["rev-parse", "--verify", "-q", "HEAD"]); } catch { return empty("the repository has no commits"); }
  const shallow = (await git(top, ["rev-parse", "--is-shallow-repository"])).trim() === "true";
  const prefix = relative(top, pagesDir).split(sep).join("/");
  const repoPath = (p: string): string => prefix ? `${prefix}/${p}` : p;
  const scope = prefix || ".";
  const log = await git(top, ["log", "-M", "--name-status", "-z", "--format=%x01%aI", "--", scope]);
  return { shallow, dates: parseLog(log, new Map(paths.map(p => [repoPath(p), p]))), repoPath, top, scope };
}

/** Which pages git does not track, and which have changes not yet committed: the working tree now. */
export async function readStatus(history: GitHistory, git: RunGit = runGit): Promise<{ untracked: Set<string>; changed: Set<string> }> {
  if (history.none) return { untracked: new Set(), changed: new Set() };
  const s = parseStatus(await git(history.top, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", history.scope]));
  return { untracked: new Set(s.untracked), changed: new Set(s.changed) };
}

export type DatesMode = "dev" | "build";

export interface DatedPage {
  dates: PageDates;
  /** Notes about this page's dates: why they are missing, or only approximate. */
  notes: string[];
  /** A problem that stops the page (pd build from a shallow clone). */
  problems: string[];
}

/** The dates of the page at `path`, and what to say about them. */
export function datesOf(path: string, history: GitHistory, status: { untracked: Set<string>; changed: Set<string> }, mode: DatesMode): DatedPage {
  if (history.none) return { dates: { created: null, modified: null }, notes: [`${history.none}: no page has dates`], problems: [] };
  const dates = history.dates.get(path) ?? { created: null, modified: null };
  const notes: string[] = [], problems: string[] = [];
  const repo = history.repoPath(path);
  if (history.shallow) {
    const why = "the repository is a shallow clone, so page.created and page.modified would be wrong (the history stops at the clone's depth)";
    if (mode === "build") problems.push(`${path}: ${why}; build from the full history (in CI, check out with fetch-depth: 0)`);
    else notes.push(`${path}: ${why}`);
  }
  if (status.untracked.has(repo)) notes.push(`${path}: not committed yet, so it has no dates`);
  else if (dates.modified === null) notes.push(`${path}: no git history (ignored, or outside the repository), so it has no dates`);
  else if (mode === "build" && status.changed.has(repo)) notes.push(`${path}: has uncommitted changes; its dates are its last commit's`);
  return { dates, notes, problems };
}

/**
 * The dates of a running server's storefront. The history is read once, the first time a page asks for
 * dates (a site whose layouts use none pays nothing); the working tree's status is read again after a
 * page changes (statusChanged, from the watcher). New commits are seen on restart.
 */
export function createGitDates(pagesDir: string, listPages: () => Promise<string[]>, git: RunGit = runGit) {
  let history: Promise<GitHistory> | null = null;
  let status: Promise<{ untracked: Set<string>; changed: Set<string> }> | null = null;
  return {
    async of(path: string, mode: DatesMode): Promise<DatedPage> {
      history ??= listPages().then(paths => readHistory(pagesDir, paths, git));
      const h = await history;
      status ??= readStatus(h, git);
      return datesOf(path, h, await status, mode);
    },
    statusChanged(): void { status = null; },
  };
}
export type GitDates = ReturnType<typeof createGitDates>;
