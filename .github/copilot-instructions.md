# Review instructions for Pattern Dump

Pattern Dump is a design system workbench and site builder: Handlebars components with JSON data, built by `pd dev` and `pd build`. Review against the rules below. They are the project's own rules, from the documents linked; when a suggestion conflicts with one, the rule wins.

## Checks and tests (CONTRIBUTING.md)

- Never suggest making a test pass by weakening its assertion. A failing check gets its cause fixed, or a narrowly scoped disable with a written reason. An out-of-date test is updated to current behaviour; a real bug gets the code fixed.
- Tests that watch files or reload pages assert state, not events, and wait for the outcome, never for a fixed time. No fixed ports, no sleeps; files are written through `save()`, `saveInTwoSteps()` only to test the editor-style save.
- Commits follow Conventional Commits, one concern each, with the checks passing at every commit. No tool attribution trailers.
- A change to the built output (the golden files) must be explained in GOLDEN-CHANGES.md.

## Architecture (CONTRIBUTING.md, docs/development/architecture.md)

- npm workspaces, ESM and TypeScript only.
- A shape that crosses a package boundary changes in `@pattern-dump/contracts` first. The dependency direction is fixed; `dev-ui` imports only contracts.
- `@pattern-dump/discovery` is the only source of file paths; no code rebuilds `<id>/<name>.hbs`.
- `render()` stays pure.
- The preview is an honest page: the shell adds no wrapper, stylesheet, inline style or reset to a preview document, and styles only its own furniture.

## Workbench UI and CSS (docs/development/styling.md)

- OOCSS naming, never BEM. State comes from the DOM first: native state, then ARIA that is there for assistive tech; a bare adjective class or `data-*` only for app-only state, never with an `is-` or `has-` prefix. Never add an `aria-*` attribute only to style it.
- Cascade layers, `:where()` for defaults, no `!important`.
- Units: `rem`/`em` for type and text spacing, `em` in media and container query conditions, `fr`/`auto`/`%` for grids, `px` only for hairline borders.
- Container queries for component layout; media queries only for viewport concerns.
- In-app navigation uses real `<a href>` links; buttons act, links navigate.
- Accessibility: `:focus-visible` rings kept, motion behind `prefers-reduced-motion`, never colour alone.

## What not to suggest

- Rewriting code outside the pull request's concern.
- Style-only rewording of existing comments or docs, unless they are wrong.
