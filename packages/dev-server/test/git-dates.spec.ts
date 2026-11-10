// A storefront page's dates from git (storefront/git-dates.ts): the parser on recorded -z output, and the
// whole pass against repositories the test builds with fixed dates — renames, uncommitted and untracked
// pages, author and committer dates apart, a shallow clone, no repository, a repository with no commits, an
// ignored page, and a page moved into the pages folder from outside it.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile, execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { save } from "../../../test-support/save.js";
import { createGitDates, datesOf, parseLog, parseStatus, readHistory, readStatus, type RunGit } from "../src/storefront/git-dates.js";

// Recorded from `git log -M --name-status -z --format=%x01%aI -- pages`, newest first: a copy (git -C),
// a rename with an edit (R095), a pure rename (R100), a modification, and the first commit adding two pages.
const LOG = "\x012026-05-10T10:00:00+01:00\x00\nC075\x00pages/a.md\x00pages/e.md\x00"
  + "\x012026-04-10T10:00:00+01:00\x00\nR095\x00pages/c.md\x00pages/d.md\x00"
  + "\x012026-03-10T10:00:00+01:00\x00\nR100\x00pages/b.md\x00pages/c.md\x00"
  + "\x012026-02-10T10:00:00+01:00\x00\nM\x00pages/a.md\x00"
  + "\x012026-01-10T10:00:00+01:00\x00\nA\x00pages/a.md\x00A\x00pages/b.md\x00";
const PAGES = new Map([["pages/a.md", "a.md"], ["pages/d.md", "d.md"], ["pages/e.md", "e.md"]]);

describe("parseLog", () => {
  it("dates an added and modified page from its first and last commits", () => {
    expect(parseLog(LOG, PAGES).get("a.md")).toEqual({ created: "2026-01-10T10:00:00+01:00", modified: "2026-02-10T10:00:00+01:00" });
  });

  it("follows a rename, and a rename with an edit, back to the page's add", () => {
    expect(parseLog(LOG, PAGES).get("d.md")).toEqual({ created: "2026-01-10T10:00:00+01:00", modified: "2026-04-10T10:00:00+01:00" });
  });

  it("does not follow a copy: the copy is created at the copy", () => {
    expect(parseLog(LOG, PAGES).get("e.md")).toEqual({ created: "2026-05-10T10:00:00+01:00", modified: "2026-05-10T10:00:00+01:00" });
  });

  it("reads the newline git puts before each commit's first status", () => {
    // Without it read away, "\nA" is not a status and the first page of every commit is missed.
    expect([...parseLog(LOG, PAGES).keys()].sort()).toEqual(["a.md", "d.md", "e.md"]);
  });

  it("gives a page with no commit no entry, and ignores files that are not pages", () => {
    const dates = parseLog(LOG, new Map([["pages/zz.md", "zz.md"]]));
    expect(dates.size).toBe(0);
  });
});

describe("parseStatus", () => {
  it("reads untracked and changed paths, and skips a rename's old path", () => {
    expect(parseStatus("R  pages/f.md\x00pages/a.md\x00?? pages/new.md\x00 M pages/b.md\x00")).toEqual({
      untracked: ["pages/new.md"], changed: ["pages/f.md", "pages/b.md"],
    });
    expect(parseStatus("")).toEqual({ untracked: [], changed: [] });
  });
});

// ---- the whole pass, against repositories built here ----

let tmp = "";
beforeAll(async () => { tmp = await realpath(await mkdtemp(join(tmpdir(), "pd-git-dates-"))); });
afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true }); });

/** git with no global or system config, no repository above `tmp`, and a fixed identity. */
const ENV = (): NodeJS.ProcessEnv => ({
  ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_CEILING_DIRECTORIES: tmp,
  GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@example.test", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@example.test",
});
const git: RunGit = (cwd, args) => new Promise((resolve, reject) => {
  execFile("git", args, { cwd, env: ENV(), encoding: "utf8", maxBuffer: 1 << 30 }, (e, out) => { if (e) reject(e); else resolve(out); });
});
const sh = (cwd: string, args: string[], env: Record<string, string> = {}) =>
  execFileSync("git", args, { cwd, env: { ...ENV(), ...env }, encoding: "utf8" });
const commit = (cwd: string, message: string, author: string, committer = author) =>
  sh(cwd, ["commit", "-q", "-m", message], { GIT_AUTHOR_DATE: author, GIT_COMMITTER_DATE: committer });
const put = async (file: string, text: string) => { await mkdir(dirname(file), { recursive: true }); await save(file, text); };
const body = (n: string) => Array.from({ length: 20 }, (_, i) => `${n} line ${i}`).join("\n") + "\n";

describe("the pass, on a repository with history", () => {
  let repo = "";
  let pages = "";
  const PATHS = ["index.md", "setup.md", "draft.md", "new.md", "moved.md", "ignored.md"];
  beforeAll(async () => {
    repo = join(tmp, "repo");
    pages = join(repo, "site", "pages");
    await mkdir(pages, { recursive: true });
    sh(repo, ["init", "-q", "-b", "main"]);
    await put(join(repo, ".gitignore"), "site/pages/ignored.md\n");
    await put(join(pages, "index.md"), body("index"));
    await put(join(pages, "install.md"), body("install"));
    await put(join(repo, "notes", "moved.md"), body("moved"));
    sh(repo, ["add", "-A"]); commit(repo, "one", "2026-01-10T10:00:00+01:00");
    // A rename: install.md becomes setup.md, its history kept.
    sh(repo, ["mv", "site/pages/install.md", "site/pages/setup.md"]);
    await put(join(pages, "draft.md"), body("draft"));
    sh(repo, ["add", "-A"]); commit(repo, "two", "2026-02-10T10:00:00+01:00");
    // An author date apart from its committer date; and a page moved in from outside the pages folder.
    await put(join(pages, "index.md"), body("index") + "more\n");
    sh(repo, ["mv", "notes/moved.md", "site/pages/moved.md"]);
    sh(repo, ["add", "-A"]); commit(repo, "three", "2026-04-25T09:00:00+02:00", "2026-05-01T09:00:00+02:00");
    // The working tree: draft.md edited and not committed, new.md never added, ignored.md ignored.
    await put(join(pages, "draft.md"), body("draft") + "unsaved\n");
    await put(join(pages, "new.md"), body("new"));
    await put(join(pages, "ignored.md"), body("ignored"));
  });

  const of = async (path: string, mode: "dev" | "build" = "build") => {
    const h = await readHistory(pages, PATHS, git);
    return datesOf(path, h, await readStatus(h, git), mode);
  };

  it("takes the author date, not the committer date", async () => {
    expect((await of("index.md")).dates).toEqual({ created: "2026-01-10T10:00:00+01:00", modified: "2026-04-25T09:00:00+02:00" });
  });

  it("dates a renamed page from its first add", async () => {
    expect(await of("setup.md")).toEqual({ dates: { created: "2026-01-10T10:00:00+01:00", modified: "2026-02-10T10:00:00+01:00" }, notes: [], problems: [] });
  });

  it("gives a page with uncommitted edits its last commit's dates, with a note in pd build and none in pd dev", async () => {
    const dates = { created: "2026-02-10T10:00:00+01:00", modified: "2026-02-10T10:00:00+01:00" };
    expect(await of("draft.md")).toEqual({ dates, notes: ["draft.md: has uncommitted changes; its dates are its last commit's"], problems: [] });
    expect(await of("draft.md", "dev")).toEqual({ dates, notes: [], problems: [] });
  });

  it("gives an untracked page no dates, and says so", async () => {
    expect(await of("new.md")).toEqual({ dates: { created: null, modified: null }, notes: ["new.md: not committed yet, so it has no dates"], problems: [] });
  });

  it("gives an ignored page no dates, and says it has no history", async () => {
    expect(await of("ignored.md")).toEqual({
      dates: { created: null, modified: null },
      notes: ["ignored.md: no git history (ignored, or outside the repository), so it has no dates"], problems: [],
    });
  });

  it("counts a page moved in from outside the pages folder as created at the move (a documented limit)", async () => {
    expect((await of("moved.md")).dates).toEqual({ created: "2026-04-25T09:00:00+02:00", modified: "2026-04-25T09:00:00+02:00" });
  });

  describe("a shallow clone of it", () => {
    let clonePages = "";
    beforeAll(async () => {
      const clone = join(tmp, "shallow");
      sh(tmp, ["clone", "-q", "--depth", "1", `file://${repo}`, clone]);
      clonePages = join(clone, "site", "pages");
    });
    const ofClone = async (path: string, mode: "dev" | "build") => {
      const h = await readHistory(clonePages, PATHS, git);
      return datesOf(path, h, await readStatus(h, git), mode);
    };
    const why = "the repository is a shallow clone, so page.created and page.modified would be wrong (the history stops at the clone's depth)";

    it("is a problem in pd build: the dates would be the boundary commit's, not missing", async () => {
      const page = await ofClone("setup.md", "build");
      expect(page.dates).toEqual({ created: "2026-04-25T09:00:00+02:00", modified: "2026-04-25T09:00:00+02:00" });
      expect(page.problems).toEqual([`setup.md: ${why}; build from the full history (in CI, check out with fetch-depth: 0)`]);
    });

    it("is a note in pd dev", async () => {
      expect(await ofClone("setup.md", "dev")).toMatchObject({ notes: [`setup.md: ${why}`], problems: [] });
    });
  });
});

describe("the pass, with no history to read", () => {
  it("gives every page null in a folder outside any repository, with one reason", async () => {
    const pages = join(tmp, "plain", "pages");
    await put(join(pages, "index.md"), "x\n");
    const h = await readHistory(pages, ["index.md"], git);
    expect(datesOf("index.md", h, await readStatus(h, git), "build")).toEqual({
      dates: { created: null, modified: null }, notes: ["the pages folder is not in a git repository: no page has dates"], problems: [],
    });
  });

  it("gives every page null in a repository with no commits", async () => {
    const repo = join(tmp, "empty");
    await put(join(repo, "pages", "index.md"), "x\n");
    sh(repo, ["init", "-q"]);
    const h = await readHistory(join(repo, "pages"), ["index.md"], git);
    expect(datesOf("index.md", h, await readStatus(h, git), "build").notes).toEqual(["the repository has no commits: no page has dates"]);
  });
});

describe("createGitDates", () => {
  it("reads the history once, and the status again only after statusChanged", async () => {
    const calls: string[] = [];
    const counting: RunGit = (cwd, args) => { calls.push(args[0]!); return git(cwd, args); };
    const repo = join(tmp, "counted");
    await put(join(repo, "pages", "index.md"), "x\n");
    sh(repo, ["init", "-q"]); sh(repo, ["add", "-A"]); commit(repo, "one", "2026-01-10T10:00:00+01:00");
    const dates = createGitDates(join(repo, "pages"), async () => ["index.md"], counting);
    expect(calls).toEqual([]);
    await dates.of("index.md", "dev");
    await dates.of("index.md", "dev");
    expect(calls.filter(c => c === "log")).toHaveLength(1);
    expect(calls.filter(c => c === "status")).toHaveLength(1);
    dates.statusChanged();
    await dates.of("index.md", "dev");
    expect(calls.filter(c => c === "log")).toHaveLength(1);
    expect(calls.filter(c => c === "status")).toHaveLength(2);
  });
});
