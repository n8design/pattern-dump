# Changelog

## 0.4.0

### Added

- `pd build --browser` also checks a storefront's pages in Chromium, at a desktop and a phone width: colour contrast
  and the other accessibility rules that need a rendered page (a critical or serious finding stops the build), and
  each image's variant against the box it is laid out in (a warning when its slot's `sizes` doesn't match). It uses
  the project's own Playwright: `npm install --save-dev playwright`, then `npx playwright install chromium`.
- Collections: a folder of storefront pages is a collection. A layout that declares `page.children` lists the
  folder's pages on its `index.md` (route, title, description, date, image, tags), newest first with `sort: date`;
  a page without a description is listed with the first paragraph of its body. `partials/base` can list folders
  under `site.collections` to show their pages on every page, such as a home page's latest articles. Layouts can
  show a page's own `page.date` and `page.tags`.
- A storefront can be published under a path, such as a GitHub project page: `storefront.url` takes the full
  address (`https://example.github.io/project/`). Every page, stylesheet, script and image is then served under the
  path, in `pd dev` too, with links still written from the site's root; canonical URLs, Open Graph, JSON-LD and the
  sitemap carry it. Every page names its path in `<meta name="pd-base-path">` for a skin's own scripts, and
  `pd build --browser` stops on a request outside the path. Under a path there is no `robots.txt` (the build says what
  the host's own needs) and previews carry a robots `noindex` tag, as a workbench's do when it is built with `--base`.
- A project that is a pattern package itself (a style guide with its own workbench) describes its folders once: its
  config takes each folder it doesn't name from its `package.json`'s `patternDump` field (patterns, data, helpers,
  assets, styles with `entry` and `documentBase`, themes, scripts, `globalScripts`, `exclude`). A folder named in
  both with different values is a config error naming both files.
- `storefront.head`: a site's own additions to every page's head (an analytics script, a verification tag), a
  Handlebars file rendered with `site` after the skin's `partials/head` and checked like it. For a site whose skin
  is a shared package.
- A `HELPER_SHADOW` warning on a component whose template has a bare `{{name}}` that calls a registered helper
  while its data has a field of that name, at any depth: `{{id}}` inside `{{#each palettes}}` showed the `id`
  helper's output instead of each palette's `id`, silently. Read the field as `{{this.id}}`, or rename it.
- `pd init --storefront` writes an `articles/` collection (a listing page and one dated, tagged article) with a
  `listing` layout, shows a page's date and tags in its page layout, and its config shows a `storefront.url` for a
  subfolder.
- `date`, `tags` and `draft` in a page's frontmatter. `date` (`YYYY-MM-DD`) is the page's date for listings and its
  JSON-LD `datePublished`, which falls back to the page's first commit. `draft: true` shows a page in `pd dev` and
  leaves it out of `pd build`, which names the drafts it left out.

### Fixed

- A storefront page loads the behaviour scripts its components bring (`requireScript` of its layout's components and
  of the components it places, and `globalScripts`), as their workbench previews do. Before, only the markup and CSS
  reached the page.
- A code block on a storefront page, or in a component's `<pre>`, keeps its lines as written when its partial is
  included on an indented line (as a skin's `{{> @partial-block }}` usually is). Handlebars indented every line after
  the first by the include's indentation.
- A schema field named like a registered helper (`id`, `eq`, …) is no longer an error only the workbench's Diagnostics
  tab shows: `pd dev` and `pd build` say it in the terminal, a storefront page that places the component fails (as
  one whose layout has such a field already did), and `pd audit` re-audits a component when its schema changes
  instead of reusing a verdict cached before.
- An image in a site page's markdown from a pattern package's assets, when that package's folder is the site's only
  asset folder, gets its variants. Before, the page failed with "is not an image in the assets" for a URL that was
  served.
- `pd dev` no longer keeps base-layer rules that a component's stylesheet stopped writing (through a mixin) until it is
  restarted.

### Changed

- **Breaking:** `date`, `tags`, `draft` and `sort` are now frontmatter keys of the build, like `layout` and
  `image`. A layout whose schema declares one of them fails every page that uses it; rename the field in the
  layout's schema (and show the page's date or tags through `page.date` and `page.tags`).
- A storefront page's JSON-LD carries `datePublished`.

## 0.3.0

From this release Pattern Dump is published as plain 0.x versions under npm's `latest` tag: install it with
`npx pattern-dump init`, without `@alpha`. Being at 0.x, breaking changes are possible between minor versions, and
this changelog names them.

### Added

- `sourceDir`, `patternsDir` and `styles` are optional. A site whose components, skin and styles all come from
  pattern packages names none of them; they default to `./src`, `./src/patterns` and `./src/styles`, and the folders
  don't have to exist.

### Changed

- `pd build` now checks every page of a storefront with axe before it writes anything, and **stops on an
  accessibility error**: a WCAG rule rated critical or serious (an image without alt text, a button with no name, a
  page without a language), or a page without exactly one `<main>` and one `<h1>`. Each error is printed with its
  page, the rule, the elements it was found on and a link to the rule's explanation; moderate and minor findings,
  and axe's best practices, are listed as warnings and don't stop the build. To see them before a build, run
  `pd build` locally: nothing is written while there are errors. In `pd dev`, a page without one `<main>` and one
  `<h1>` is a warning in the terminal.

## 0.2.0-alpha.0

The storefront: a website written as markdown pages, dressed by a skin made of ordinary components, served by
`pd dev` on a host of its own and built by `pd build` next to the workbench. With it come responsive images, link
and image checks, and live examples of your components on the site's pages.

Pattern Dump now needs Node.js 22.22 or later (it was 20.10).

### Workbench

- Pattern packages linked into a project (a `file:` dependency or a workspace) are watched like the project's own
  files, and each is read from its real folder. Global data, assets and helper modules reload while `pd dev` runs.
- A pattern package's TypeScript helpers are refused with a message naming them, and diagnostics name files by
  project or package path, never by an absolute path.
- Live reload is dependable: changes are handled one at a time, in the order they happen; a page or preview that
  missed a change fetches it again and never shows an older one; a save the file watcher drops is still handled; a
  folder added while `pd dev` runs (as `git checkout` or `git pull` does) is seen with every file in it.
- A component added while `pd dev` runs gets its own stylesheet even when the stylesheet is saved before the
  template.
- A variant reached by its own id (`/preview/atoms/toggle-demo~alt`) is the same document as `?variant=alt`, with
  its base's behaviour scripts, layout and CSS.
- An overview tile picks up a stylesheet that was still empty when it rendered.
- Behaviour scripts are stamped with their content hash, so a browser fetches a script again exactly when it
  changed.
- Every base-layer file whose rules no component owns and no `documentBase` entry lists is named in
  `BASE-LAYER.generated.md`, with its rule count.

### Storefront

- Pages: every markdown file in `storefront.pagesDir` is a page, rendered with a layout from your patterns. Its
  frontmatter is checked against the layout's schema, `storefront.site` against `partials/base`'s, and every
  problem names its file and line. `pd dev` serves the site at `http://live.localhost:4000/`, `pd build` writes it
  to `storefront.outDir`.
- Live examples: a `pattern` fence shows a component's own preview in a frame, with links to its variants. A
  component can declare the height its example starts at (`x-pd-example-height`), and `pd dev` warns when that
  height is too tall.
- Placing components with values: `<pd-…>` tags in a page's markdown, checked against the component's schema at
  every level (`x-pd-component`, `x-pd-content`, `text/markdown` properties), with the file, line and column of any
  problem.
- What a page knows about itself, for layouts that ask for it: its headings (with GitHub's anchors), section,
  breadcrumbs, previous and next pages, dates from git, and declared navigations.
- Search engines and link previews: canonical URLs, Open Graph, the site's language, JSON-LD, `sitemap.xml`,
  `robots.txt`, a 404 page, `redirectFrom` for old routes, `index: false`, and a link-preview image per page or site.
- A skin can add to every page's `<head>` through a `partials/head` component, and can be a pattern package.
- `pd init --storefront` starts a project with a website: pages, a plain skin, the workbench under `/workbench/`
  on the same host, and a GitHub Pages workflow.
- Every file a page references (stylesheets, scripts, fonts, images) carries the content hash of the file as
  served, so a visitor's browser fetches it again exactly when it changed.

### Images

- Every raster image is served as WebP variants of the widths it is shown at, encoded with sharp on first use and
  cached in `node_modules/.cache/pattern-dump/images/`. `images` (quality, effort) sets the encoding, and
  `storefront.images` overrides it for the site.
- Image slots: a component declares where an image goes and how wide it is shown (`x-pd-image`), and its template
  writes it with `{{pd-image field alt=…}}`. Alt text is required; `alt=""` marks a decorative image.
- Images in a page's markdown get their variants in the slot the page's layout declares (`x-pd-prose-images`),
  with `sizes="auto"`, and the first ones can load at once (`eager`).
- Every `<img>` carries its width and height, so the page doesn't shift as images load. Photos are turned upright
  by their EXIF orientation.

### Checks

- `pd build` checks every link on every page of the site before it writes anything: pages, files, `#` anchors (a
  heading's too), the site's own address and links into the workbench. A broken link stops the build; links to other
  sites are listed in the build's notes. `pd dev` warns about a page's links to pages that don't exist.
- `pd build` refuses a page with an `<img>` that has no width and height, or a raster image served without its WebP
  variants, and names the fix; `pd dev` shows the same as warnings.
- A schema field named like a registered helper is an error, and so is an unknown `x-pd-` key in a schema.
- The shape check tells a list from an object (an array property was reported as a mismatch).

### Fixes

- `pd dev` answers only requests addressed to its own host names, accepts live-reload connections only from its own
  pages, binds its live-reload socket to 127.0.0.1 like its HTTP server, and serves files only from inside each
  route's folder.
- The starter's body defaults no longer override a pattern package's document styles (hTWOo's dark themes showed
  dark text on a white page).
- Two config loads in the same millisecond no longer share a temporary file.
- The audit reuses a cached result only when it was made by the same version of the check.
- The live-reload socket reports the port it is actually bound to.
- A code example on a page that quotes `<img src="/assets/…">` is shown as written, not with a cache stamp added.

## 0.1.0-alpha.4

Fixes found while moving a third PatternLab styleguide to Pattern Dump with hTWOo consumed only as
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
