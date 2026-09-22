# Changelog

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
