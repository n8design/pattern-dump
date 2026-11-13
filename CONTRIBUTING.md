# Contributing to Pattern Dump

Thanks for helping. This guide covers setting up the repository, the checks every change has to pass,
and the rules the code base depends on.

- How the code is organised: [docs/development/architecture.md](docs/development/architecture.md)
- How the workbench shell is styled: [docs/development/styling.md](docs/development/styling.md)

## Setup

Requirements: Node.js 22.22 or later, npm, and a Chromium for Playwright.

```bash
npm install
npm run build
npx playwright install chromium      # once; the end-to-end suite needs it
npm run dev                          # pd dev against test-bench/ → http://localhost:4000
```

## Commands

```bash
npm run build          # nx run-many -t build
npm run typecheck      # nx run-many -t typecheck
npm run lint           # ESLint, one root config for every project
npm test               # Vitest across all packages
npm run e2e            # Playwright; builds first, starts its own servers on :4100 and :4200
npm run e2e:storefront # Playwright for the storefront bench, on :4300 and :4400
npm run e2e:skin-experimental   # Playwright for the experimental skin's demo, on :4600 and :4700
npm run e2e:package-bench       # Playwright for the package bench (linked pattern packages), on :4800 and :4900
npm run lint:css --workspace @pattern-dump/dev-ui    # Stylelint for the shell
npm run lint:css --workspace storefront-bench        # … for the storefront bench's skin
npm run lint:css --workspace @pattern-dump/skin-experimental   # … for the experimental skin
npm run lint:css --workspace package-bench           # … for the package bench's packages
npm run affected       # build, test, lint and typecheck only what changed
npm run graph          # the Nx project graph
npm run dev:check      # is a running dev server older than the build on disk?
npm run pack:pd        # build the installable package → .pd-pack/pattern-dump-<version>.tgz
npm run verify:install # pack, pd init a project outside the repo, boot, audit and build it
```

Run the e2e scripts from the root, not with `--workspace`: the root targets build the runtime chain first.

## Checks before a merge

All of these must pass:

1. `npm run build`
2. `npm run lint:css` in each of `@pattern-dump/dev-ui`, `storefront-bench`,
   `@pattern-dump/skin-experimental` and `package-bench`: a Stylelint error blocks; a warning is advisory
3. `npm run lint`
4. `npm run typecheck`
5. `npm test`
6. `npm run e2e`, `npm run e2e:storefront`, `npm run e2e:skin-experimental` and `npm run e2e:package-bench`

If a check fails, fix the cause, or add a narrowly scoped disable with a written reason.

**Never make a test pass by weakening its assertion.** A test that is out of date is updated to the
current behaviour; a real bug gets the code fixed. A test that passes while the behaviour is broken is
worse than a failing one. When a new test guards a fix, check that it fails without the fix.

### Writing tests that watch files or reload pages

A test that depends on timing passes on a quiet machine and fails on a busy one. Write these so they
cannot depend on it:

- **Assert state, not events.** Check what the server or the page holds after the change (the rendered
  markup, the served stylesheet, the message that was sent), not that a particular watcher event arrived
  or arrived once. The operating system decides how many events one save is.
- **Wait for the outcome, not for time.** Wait for the thing you assert, with a condition that names it.
  Never wait for a fixed time, and never for "nothing more has happened lately": that is a fixed time
  under another name. In the watcher specs, `step()` in `packages/dev-server/test/watch-harness.ts` does
  this: it returns once the last write of every file the act touched has been handled.
- **No fixed ports, no sleeps.** Bind port 0 or use the helpers in `free-ports.ts`, and read the port back.
- **Write files through `save()`** (`test-support/save.ts`), so a save is one event; use `saveInTwoSteps()`
  only to test the editor-style save.
- **Repeat before the first commit.** Run the new or changed spec 20 times, with retries off, on Linux with
  the machine busy (`node scripts/ci/burn-in.mjs --runs 20 --load`). A pull request does this in CI for
  every spec it changes; a failure there is a real failure, not a reason to retry.
  If a burn-in failure is in a test the pull request didn't change, a maintainer may merge when the same
  failure reproduces on main. The failure then becomes an issue with its evidence. A test the pull request
  changed must pass, and a run is never repeated just to get a green result.

## Reporting bugs and proposing features

Use [GitHub issues](https://github.com/n8design/pattern-dump/issues) and pick the bug report or feature
request form. For a bug, a minimal project or component that shows the problem helps most.

## Commits and branches

- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat(cli): …`, `fix(dev-server): …`, `docs: …`), checked by commitlint in the `commit-msg` hook.
- Branch from the current `main`.
- Keep commits small, one concern each, with the checks passing at every commit.

## Releasing

The version lives in `packages/cli/package.json`; everything else (the tarball name, the range `pd init`
installs, the static build's version stamp) reads it from there.

Releases are plain 0.x versions (0.3.0, 0.4.0, …), published under npm's `latest` tag. Pack the tarball
from a clean checkout of the release's tag, never from a working copy on another branch:

```bash
git worktree add ../pd-release v<version>   # a separate folder at the tag
cd ../pd-release
npm ci
npm run pack:pd          # → .pd-pack/pattern-dump-<version>.tgz
npm run verify:install   # install it outside the repository and check it works
npm publish .pd-pack/pattern-dump-<version>.tgz
```

If your shell exports `NX_WORKSPACE_ROOT_PATH`, unset it in the release folder first: it points Nx at another
checkout. npm makes the version available a few minutes after it accepts the upload.

## Rules the code base depends on

### Workspace

- **npm workspaces only.** No pnpm, no yarn.
- **ESM and TypeScript only.** `"type": "module"` everywhere; no CommonJS, no `.js` source.
- **The build and HMR core are in-tree.** `@pattern-dump/build` and `@pattern-dump/hotreloader` are
  extended in place, not replaced by an external build tool.

### Contracts and dependency direction

- **`@pattern-dump/contracts` defines the seams:** `render()`, every dev-server route and response
  shape, and every HMR message. Packages build against those types and never reach into another
  package's internals. A shape that crosses a package boundary changes in `contracts` first.
- **Dependency direction** is fixed (see [architecture.md](docs/development/architecture.md#dependency-direction)).
  `dev-ui` may import only `@pattern-dump/contracts`; ESLint enforces it.

### The preview is an honest page

- The shell injects **nothing** into a preview document: no wrapper element, no stylesheet links, no
  inline styles, no reset. The markup is the body's content; the body carries only `data-theme` and
  `data-component-id`. The shell styles only its own furniture (`#preview-frame` and the Stage), never
  the preview.
- Iframe height comes only from the `pd-height` message, and width from `pd-width`. Iframes are replaced
  elements, so `height: auto` or `fit-content` cannot size them from their content. The document's
  measurement script only reads the page; `pd-width` is trusted only when it was measured at the full
  width available, so a fitted frame cannot narrow itself step by step.
- A preview whose own height depends on the frame's (`height: 200vh`, a `%` chain, `cqb`) makes
  content-fitting circular: each measurement grows the frame, which grows the content. That run of
  growth is detected and the frame parked at its last steady height (`stage/content-height.ts`); full
  previews never content-fit height at all.
- The preview stays same-origin so the workbench can read the rendered source. Server-side validation
  and escaping are the only injection defence.
- Don't patch the preview document from the shell to simplify something; it breaks this contract.

### Components and identity

- Styles live in a parallel `styles/` tree, not next to templates.
- Variants are siblings: `name~variant.hbs` (own markup) or `name~variant.json` (a data overlay). A base
  can be built from variants alone.
- `@pattern-dump/discovery` is the single source of truth for file paths. No code reconstructs
  `<id>/<name>.hbs`.
- Include a variant as a quoted partial: `{{> "atoms-badge~info" }}`. `~` is Handlebars'
  whitespace-control character, so an unquoted variant handle does not parse.
- Keep `render()` pure: the same input gives the same output.

### Workbench UI

- UI regions are named **Nav Rail** (`.sidebar`), **Stage** (`.stage-view`, `#preview-frame`),
  **Inspector** (`.panel`) and **Console** (`.dock`). Use these names in issues and commits.
- **In-app navigation uses real `<a href>` links** to the History API routes, never `<button>`. Buttons
  create no history entry, which breaks Back/Forward, deep links and opening in a new tab. Links
  navigate; buttons act.

## Verifying UI changes

- **Check the rendered page, not the payload.** Confirm a visual change on the computed style or box of
  the real element in the browser, not on served markup or test output alone.
- **Check the CSS the browser loaded.** Fetch `/_pd/main.css` as served, not `dist/main.css`. A stale
  bundle looks exactly like a broken rule.
- **A matching selector can still lose the cascade.** Assert the painted value, not only that the
  selector matches.
- **Compositor-driven states** (`@container scroll-state(…)`) only update on a real scroll gesture,
  never on an assignment to `scrollTop`.
- **`CSS.supports()` proves a value parses**, not that a query evaluates. Exercise the feature instead.

### Rebuild or restart?

| You edited | Rebuild | Restart `pd dev` |
|---|---|---|
| `apps/dev-ui/src/**` (bundle, SCSS) | yes | **no**: it is read per request, so reload the page |
| `packages/*/src/**` | yes | **yes**: Node loads it once, so a rebuild never reaches a running server |

`npm run dev:check` tells you whether a running server is behind the build on disk.

## test-bench

`test-bench/` is a small design system the tool runs against, and the fixture for the end-to-end
suite. Some HMR specs write into it while they run, which is why Playwright runs with one worker. Leave
the tree clean after a test run.
