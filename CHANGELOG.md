# Changelog

## Unreleased

### Fixed

- A variant reached by its own id (`/preview/atoms/toggle-demo~alt`) is now the same document as
  `?variant=alt`: it gets its base's behaviour scripts (`requireScript`), layout and CSS. It used to
  lose the base's scripts.

## 0.1.0-alpha.4

Fixes found while moving a third PatternLab styleguide (CTS) to Pattern Dump with hTWOo consumed only as
pattern packages: its templates, data, scripts and CSS all come from `@n8d/htwoo-patterns` and
`@n8d/htwoo-core`, and the project compiles only its own SCSS.

### Added

- `styles: false` on a package reference leaves that package's stylesheets out, for a project that
  compiles them itself; its templates, data, themes, scripts and assets are still used. It also works
  for a package that another brings in as a peer: name the peer with the option.
- `themes.dir` is optional: `themes: { default: "<name>" }` alone makes one of your packages' themes the
  one previews start with. `pd dev` warns when the default matches no theme.
- A component or variant `.json` that does not parse is reported as a `DATA_INVALID` diagnostic, with
  the file and, where the parser gives one, the line and column, instead of being dropped silently. An
  invalid variant file no longer fails the whole render.

### Fixed

- A class belongs to the rule that defines it (the class on its own, such as `.card` or `.card:hover`),
  not to every rule that mentions it. A project rule that restyles a package class in context
  (`.tile .hoo-radio`) took the class over, so the package component's CSS was never linked where the
  class was used.
- A rule repeated after a different one (A, B, A) keeps its last position in the base layer and in
  component CSS, as the browser applies it. The first copy was kept, so B won.
- Included partials keep the caller's data frame, as in stock Handlebars: `@root` is the page's data,
  and `{{#if @partial-block}}` sees the block of a block call.
- A configured `styles.entry` list compiles in the order given. It was sorted, which could change the
  cascade.
- SCSS can load an installed package by its bare name (`@use '@scope/pkg/…'`) or a `pkg:` URL, without
  `SASS_PATH`.
- A data variant reached by its own id (`/preview/atoms/chip~danger`) or included by its handle
  (`{{> "atoms-chip~danger"}}`) renders on top of its base component's data, as `?variant=` already did.
- `pd build` copies assets as `pd dev` serves them: where two asset folders share a name, the first one
  (the project's) wins and the other is left out and reported. A package's `images/` used to overwrite
  the project's in the snapshot. `pd dev` warns about such folders at startup.

## 0.1.0-alpha.3

Fixes found while moving a second PatternLab styleguide (n8d) to Pattern Dump.

### Fixed

- A numbered `templates` or `pages` folder now gets the `full` preview layout its category promises.
  The category was matched with its ordering prefix still attached, so a PatternLab tree
  (`04-templates`, `05-pages`) could never hit the documented default — only a per-folder
  `preview: full` could. Folder *labels* still keep the number: `2-col` is a name and `04-templates`
  a prefix, and nothing in the string tells them apart, so a numbered folder sets `title:` for a
  clean label.
- A `requireScript` or `globalScripts` id with no matching `<scriptsDir>/<id>.ts` is reported instead
  of failing inside the preview. `pd dev` names every unresolvable id at startup — with the component
  for a `requireScript` — and the script's URL answers 404 saying which file it expected and where,
  rather than embedding a raw `ENOENT`. Scripts are TypeScript, so a `.js` file of the same name does
  not satisfy an id; that is the common case this hid.

## 0.1.0-alpha.2

Fixes found while moving a PatternLab styleguide to Pattern Dump, and the changes they needed.

### Check before upgrading

These can change how an existing project loads or renders:

- **The config is checked when it loads.** A missing required option, an unknown option or a value
  of the wrong type now stops `pd` with a list of every problem, with a suggestion for likely typos.
  `styles.strategy: "co-located"` and `assets.strategy: "component-relative"` were accepted but never
  implemented; they are now rejected as not supported yet.
- **Numbered folders lose their number in handles.** `00-atoms/badge` is included as
  `{{> atoms-badge }}`, as in PatternLab. Its id and address keep the number (`/00-atoms/badge`).
  Includes written with the number (`{{> 00-atoms-badge }}`) need updating.
- **`documentBase` paths are authoritative.** A file or folder listed there always goes into the base
  layer, even one that belongs to a component; `"."` makes the whole styles tree global. Rules that no
  component owns still join the base layer, as before.
- **Previews have no wrapper element.** The markup sits directly in `<body>`; the `<main>` with inline
  styles around it is gone. CSS or tests that target `main.layout-centered`, `main.layout-full` or
  `main[data-component-id]` inside a preview need updating; `data-component-id` is now on `<body>`.
- **`/api/component/<id>` returns 404** for an id that no component has.

### Added

- `assets.css` accepts full URLs, such as a web-font stylesheet.
- References that start with an asset folder's name are rewritten to the served `/assets/…` path
  when written root-absolute (`/images/logo.svg`), as PatternLab projects write them, and in `url()`
  in compiled CSS.
- A `centered` preview frame is as wide as its content and centred in the Stage. If a width media or
  container query that styles the component would change at that width, the frame keeps the full
  width instead. Gallery tiles fit and centre the same way.
- PatternLab-style links (`/#/atoms/button`) open the matching view. An address that names nothing
  says so in the Stage and links the closest matches; a view that fails to load says so too.
- `pd dev` warns at startup about a `documentBase` entry that matches no file, and summarises the
  unowned rules that are global without being listed.

### Fixed

- A `centered` preview whose height comes from the viewport (`height: 200vh` in the base layer, a
  percentage chain) no longer grows without bound. Content-fitting such a height is circular — the
  frame's height feeds the content's — and the frame used to double every tick to the browser's
  layout ceiling, showing a size like `785 × 33554428`. The run of growth is now detected, the frame
  keeps its last steady height and the content scrolls inside it, and the Console says why.
- SCSS edits reach the preview live when `styles.entry` is set, and edits to base-layer styles
  update live too.
- `@import`, `@charset`, `@layer a, b` and `@namespace` kept their `;`: the next rule was being
  swallowed and both were dropped, in `pd dev` and in `pd build`.
- Components in numbered pattern folders own their CSS, whatever the styles folders are called.
- Missing files return 404 instead of 200 with the workbench page, so broken asset paths show up.
- Every `href` and `src` written into a preview is escaped.
- The flattening and conflicts reports print their full path, and a bare wrapper element around
  different includes is no longer reported as a flattened copy.
- `styles.strategy` is optional.

## 0.1.0-alpha.0

First public alpha.
