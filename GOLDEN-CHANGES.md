# Golden changes

The golden is test-bench's workbench, built by `pd build` with a fixed clock and the base path `/pd/`
(`scripts/golden/build.mjs`). Every pull request builds it twice in CI: at its base and at its head. When the two
differ, the check passes only if what the pull request adds to this file names every file that changed. Each entry
says what changed in the output and why, so a change nobody meant can't merge unnoticed.

## Writing an entry

Add a section for the pull request, newest first, and name each changed file by its path in the build, in
backticks. Files that change for one reason can share a line:

```md
## 2026-12-01: The Console's warning level

- `_pd/main.js`, `_pd/main.css`: the Console shows warnings apart from errors.
```

`api/version.json` is compared without `serverBundleMtime`, which changes with every build. An entry already on
the base doesn't count for a later pull request: each change is recorded by the pull request that makes it.

## 2026-11-28: Custom property findings in the audit, and inline styles as API only

- `api/graph.json`: the two `uses-property` edges from `class:df-button--primary` carry their fallbacks as written,
  `"fallback": "#2563eb"` (`--buttonPrimaryBackground`) and `"fallback": "#fff"` (`--buttonPrimaryText`). The edge
  to `--tb-accent` has none: `.tb-themed` reads it without one. No node or edge is added or removed.
- `api/component/atoms/theme-demo/index.json`: the `PROPERTY_UNDECLARED` message is the new one. It names the rule
  that reads `--tb-accent` without a fallback (`.tb-themed`) and suggests a fallback first. Nothing else changed.
- `api/component/atoms/contrast-fail/index.json`, `api/component/atoms/cvd-reference/index.json`,
  `api/component/atoms/font-demo/index.json`, `api/component/atoms/linker/index.json`,
  `api/component/atoms/white-noise/index.json`, `api/component/organisms/card/index.json`: each gains one
  `INLINE_STYLE` warning. Their templates have a `style` attribute that sets more than custom properties
  (`padding: 8px` on the card, `height: 60rem` on the linker, colours and fonts on the others). test-bench wrote
  them to test other things; they stay as they are.
- `api/audit.json`: the six `INLINE_STYLE` findings above (14 occurrences become 20) and their rule
  `render:INLINE_STYLE`. `style` gains `undeclared`, with one entry: `atoms/theme-demo` reads `--tb-accent` in
  `.tb-themed`. The other findings and style couplings are unchanged.
- `_pd/main.js`, `_pd/main.css`: the Audit tab lists the custom properties declared nowhere after the style
  couplings, with their total in muted text.

## 2026-11-28: Custom properties in the graph

- `api/graph.json`: the graph gains 6 `property` nodes, the 5 themes as stylesheet nodes with the source `theme`, 3
  `uses-property` edges (from `class:df-button--primary` to two button properties, and from `class:tb-themed` to
  `--tb-accent`) and 19 `declares` edges from the themes. No node or edge is removed or changed.
- `api/component/atoms/theme-demo/index.json`: a new `PROPERTY_UNDECLARED` warning. `.tb-themed` reads
  `--tb-accent`, which only `themes-bare/` declares, and test-bench's config reads `themes/`. Nothing else in the file
  changed.

## 2026-11-28: The workbench's query conditions in `em`

- `_pd/main.css`: the narrow layout's media query is (max-width: 56.25em) instead of 900px, and the Nav Rail's
  accessibility label switches at 9.375em and 5em instead of 150px and 80px. At the default 16 px text each
  is the same width as before; with a larger text size the breakpoints move with it.
- `_pd/main.js`: the workbench opens the Inspector on first load unless `matchMedia("(max-width: 56.25em)")` matches,
  the CSS's own query, instead of when `innerWidth` is over 900. The bundle gains `NARROW_QUERY` and `isNarrow`.

## 2026-11-28: Redirects from old `.html` files

- `_pd/main.js`: the workbench bundles `staticPathFor`, which gains one line: a path ending in `.html` is a file of
  that name (an old route such as `/how-to/old.html`). The workbench asks for no such path, so it behaves as before.

## 2026-11-28: ESLint 10

- `_pd/main.js`: three variables in the workbench bundle lose an initial value that no path read (`next` in the
  radio group keys, `ground` in the Stage frame's background, `address` in the frame links). Each is assigned on
  every path before it is read, so the workbench behaves as before.

## 2026-11-27: axe-core 4.14.1

- `_pd/axe-core.js`: the bundled axe-core is 4.14.1.
- `_pd/rule-tiers.json`: the component rule tiers name axe-core 4.14.1 and a new date; the rule lists are unchanged.
- `api/component/atoms/a11y-invalid/index.json`, `api/component/atoms/tbflat/tbflat-a/index.json`,
  `api/component/atoms/tbflat/tbflat-b/index.json`, `api/component/atoms/tbflat/tbflat-c/index.json`,
  `api/component/atoms/tbflat/tbflat-drift/index.json`, `api/component/atoms/tbflat/tbflat-sibling/index.json`: each
  accessibility finding's `helpUrl` points at the axe 4.14 rule pages instead of 4.11. Nothing else in them changed.

## 2026-11-25: Theme switching without a reload or a flicker

- `_pd/main.js`: a stylesheet theme switch keeps the current sheet until the new one has loaded, `data-theme` names
  the theme in effect in both modes, and the Stage fetches a preview with a picked theme baked in.

## Before the check

The golden was compared by hand until 2026-11-25. Five pull requests since 0.7.0 changed its output, each as
intended:

- #97 (0.8.0): code colours as named classes (`--pd-code-<kind>`, in `_pd/code.css`, linked by every page), the
  Console's warning level, and every variant as an audit entry of its own.
- #103 (0.9.0): the Relationships panel's style fields, four new test-bench fixtures, the project graph
  (`api/graph.json`), and the workbench's 0.9.0 interface.
- #106, #115, #117: the bundled routes of images beside a site's pages, social images and feeds.
