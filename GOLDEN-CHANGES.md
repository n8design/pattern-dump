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
