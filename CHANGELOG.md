# Changelog

## Unreleased

### Changed

- `toc` is a key the build owns now (the table of contents): a layout's schema that declares it must rename it.
- **A storefront page's "last changed" date is the author's, never git's.** Git's last commit counts a typo fix or a
  reformat as a change, so it is no longer used for anything a reader or a search engine sees. A page sets
  `updated: YYYY-MM-DD` for a real change instead. What changes for an existing site:
  - JSON-LD `dateModified` (on the `WebPage` and the `Article`) is the page's `updated`, and is left out without one.
    Before, it was the page's last commit.
  - The sitemap's `<lastmod>` is the page's `updated`, else its own `date`, else left out. Before, it was the last
    commit. `pd build` no longer runs git for the sitemap.
  - `page.modified` is no longer filled. A layout that declares it fails with a message to declare `page.updated`
    instead. `page.created` (the first commit) is unchanged.
  - From a shallow clone, the note `pd build` gives is about `datePublished` (a page without a `date` of its own),
    since `dateModified` and `lastmod` no longer come from git.
- **A page dated after today stays out of `pd build`** until that day (today is the UTC date of the build's
  clock), with every page under a folder whose `index.md` is dated so. A site with such a page builds without it
  now. `pd dev` shows it, and the report names it: `scheduled: 1 held back (articles/launch.md until 2026-12-01)`.
- `updated` and `categories` are now keys the build owns: a layout's schema that declares either must rename it.
- `childLayout` and `view` are keys the build owns too, so the same holds for them.
- **A tag is an object now, not a string:** `page.tags` and every listing entry's `tags` are
  `{ key, label, description, route }`, as categories are (which gain `route` too). A template that writes a tag as
  text (`{{#each page.tags}}{{this}}{{/each}}`) stops the page, naming the template, its line and the fix: write
  `{{label}}`. A card whose schema declares `tags` as a list of strings stops its listing the same way. The starter's
  layouts and cards write `{{label}}`, linked to the tag's page.
- `article:tag` and the JSON-LD `keywords` write a tag's label, not its key (the same for an undeclared tag).
- A skin with `layouts/tag` or `layouts/category` gets tag or category pages without asking (see Added): a page of the
  pages folder at `/tags/` or `/categories/` then stops the build, naming the fix.

### Deprecated

- `site.collections`. It keeps working, and a skin whose `partials/base` lists it gets one warning per build, naming
  the query to declare instead (`x-pd-query` on a sub-key of `page`). It goes in a later release.

### Added

- **`llms.txt`.** `pd build` writes one at the site's root (llmstxt.org): the site's title and description, then
  the top-level pages and each collection, every page with its title, link and teaser. The same pages as the sitemap;
  absolute URLs with `storefront.url`, under the site's path. On by default; `storefront.llms: false` turns it off.
- **Regions.** A layout declares regions besides the body on `page.regions` (`"x-pd-regions": ["sidebar"]`) and writes
  each as `{{{page.regions.sidebar}}}`, null when the page puts nothing there. A placed component goes into one with
  `region="sidebar"` on its tag, or its schema's `"x-pd-region"`; components keep the page's order there. A region
  another layout has is left out without a message; one no layout has stops the page with a "did you mean". `<body>`
  names the filled regions (`data-pd-regions="sidebar"`), so a skin's grid can collapse an empty one. `header`,
  `footer`, `nav` and `main` are the layout's own landmarks and can't be regions, and a component in a region can't
  bring a main, banner or contentinfo.
- **The table of contents in a region:** the skin's `components/toc`, with `items: [{ text, href, level }]`.
  `toc: true` in a page (or `x-pd-toc` on its layout) shows it with the page's headings of level 2 and 3; `toc: false`
  keeps it out. `<pd-toc>` places it in the markdown, with the derived items or a list of links of its own, whose
  `#anchors` must be headings of the page. The starter has a `doc` layout with a sidebar and a `components/toc`.
- **Search with Pagefind.** `pd build` indexes each page's own content (its markdown and placed components, never the
  layout's header, navigation or listings) and writes the index into the site at `_pd/search/`, under the site's path,
  with `section`, `tag` and `category` filters by label. Pagefind is the project's own
  (`npm install --save-dev pagefind`): with `storefront.search` left out the site is indexed when the project has it;
  `true` makes a build without it stop, `false` turns it off. The 404 page, tag and category pages and a page with
  `index: false` are left out. `pd dev` builds no index. `pd build --browser` uses the site's search field once per
  viewport and stops when it shows no result. The starter has a search page and a plain, accessible
  `components/search`.
- Tag declarations: `storefront.tags`, declared as categories are (label, description, old keys). Optional: without it
  any tag works, labelled with its key. With it, a tag that isn't declared stops the page with a "did you mean", and an
  old key builds with a warning. A query's `tags` are checked against the declarations.
- Tag and category pages: a page for every tag and every category a published page has (`/tags/<key>/`,
  `/categories/<key>/`), and an index of each (`/tags/`, `/categories/`), through the skin's `layouts/tag`,
  `layouts/tags`, `layouts/category` and `layouts/categories`. A term page gets `page.term` and lists its pages
  through a query; an index gets `page.terms`. Drafts and scheduled pages never count. `storefront.tagPages` and
  `storefront.categoryPages` turn them off (`false`), ask for them (`true`: a missing layout is a problem), or set the
  path and the index's title. An old key's route forwards to the new one. They are in the sitemap, with JSON-LD
  `CollectionPage`. The starter has plain layouts for all four.
- `same` for a query's `tags` and `categories`: the current page's own (on a tag page, its tag).
- Categories in search and link previews: `article:section` (the first category's label) and the `Article`'s
  `articleSection`.

- `childLayout:` on a folder's `index.md`: the layout of the pages under it that name none. The nearest folder that
  sets one wins, and a page's own `layout:` wins over it. A `childLayout` that names no layout fails the `index.md`
  and each page that takes it, and every problem about a page's layout names where the layout came from. The
  workbench lists a layout's pages in its Relationships tab, each with where its layout came from, and `/api/pages`
  gives `layoutFrom`.
- A listing's card: `x-pd-card` names the component each page of a listing is shown as (on a layout's
  `page.children`, or a view's `entries`). Every page in the listing is checked against the card's schema: a field
  the card requires that a page doesn't have fails the listing, naming the page. A card declares only fields a
  listing's page has, and its sample data may set only those.
- Listing views: `view: grid` on a folder's `index.md` shows its listing through `views/grid`, a component in the
  skin's style guide (Pattern Dump has none of its own). The layout writes `{{{page.listing}}}`; the view gets the
  pages as `entries`, and names its card, so each view's required fields are checked on their own. A view that
  doesn't exist, a listing that names none and a view on a page with no listing are problems.
- The website starter (`pd init --storefront`) ships four plain views with their cards: `list`, `grid`, `featured`
  and `compact`.
- `updated:` on a storefront page, its last real change: `page.updated`, JSON-LD `dateModified`,
  `article:modified_time` on an article, and the sitemap's `lastmod`. Checked: a real date, not before `date`.
- Categories, independent of folders: `storefront.categories` declares them (key, label, optional description, and
  old keys as `aliases` after a rename), a page names them in `categories:`. An undeclared value fails the page with
  a "did you mean"; an old key builds as the new category, with a warning naming the page. Layouts get
  `page.categories`, listing entries carry them, and `site.categories` lists every one when `partials/base` lists it.
- Listing entries carry `updated`, `categories` and `scheduled` (true in `pd dev` for a page dated after today).
- Queries: one way to list pages anywhere but a folder's own listing, such as related pages and a home page's latest
  articles. A layout declares one as a sub-key of `page` with `x-pd-query` and its defaults: hand-picked `pages`
  first, then the pages of `collections` (or `same`, the page's own folder) matching `categories` and `tags`
  (`match`: any or all), by `sort` (relevance, date or title) and `order`, to `limit`, through a `view`. The layout
  gets `{ entries, listing }`. A page changes options in a block under the query's name, with the same option names (`related:` with
  `limit: 5` indented under it), or turns the
  query off with `<name>: false`. The current page, drafts and scheduled pages never appear, and a page never comes
  twice. Every value is checked, at the page's line or in the layout, with a "did you mean" where it fits.
- A page's frontmatter takes one level of keys indented under a key, for a query's options. Under any other key, and
  any deeper, it is a problem with its line, as before.
- A layout's default view for its listing: `x-pd-view` on `page.listing`. An `index.md`'s `view:` wins.
- The website starter has an article layout, which its articles take from their folder, listing three related
  articles in the compact view, and a home layout listing the three newest articles in the list view. Its listing
  layout shows the list view by default, so `articles/index.md` names no view.
- Shell code is highlighted: `bash`, `sh`, `shell` and `zsh`, and `console` or `shell-session` for a prompt with its
  output. `text` stays plain.

## 0.4.2

### Fixed

- Every code block is written the same way wherever its markdown is: a component's docs, a storefront page, and the
  content of a component placed on a page. A fence and an indented code block are both highlighted, focusable and
  have a copy button. Before, a code block in a placed component's content, and an indented code block anywhere,
  was a plain `<pre>` without `tabindex`, so one that scrolled sideways failed `pd build --browser` at phone width.
- The copy button on a storefront page's code block copies the code. It is shown by a small script of the page's
  own, only where the browser can copy; with scripting off there is no button to tab to.

### Changed

- A folder's browser tab names the folder ("Atoms · Acme DS"), as a component's does.
- No em dash in anything Pattern Dump writes or prints. Separators are a middle dot ("Button · ghost", "Diagnostics
  audit · <sha>", a docs error marker "[pattern: x · no such component]"), clauses in messages use a colon or a
  period ("unknown key "x": did you mean …"), and placeholders are words in parentheses ("(no theme)"). This
  includes `pd audit`'s headline and report lines, terminal and console messages, `pd --help`, `pd init`'s notes
  and the files it writes, and the docs. A script or test that matches one of these strings needs the new text.

## 0.4.1

### Fixed

- A style guide whose config uses `defineConfig()` and takes its folders from its `package.json`'s `patternDump`
  field loads again. `defineConfig` filled in default folders, which then disagreed with the manifest's ("the config
  and the project's own package manifest disagree"); it now returns the config unchanged, and the defaults are filled
  in after the manifest's folders.
- A storefront page with a `date` in its frontmatter, other than the home page and a listing, gets `og:type`
  `article`, with `article:published_time` and one `article:tag` per tag, and an `Article` in its JSON-LD. Every
  other page keeps `og:type` `website`. The date git gives a page does not make it an article.
- Every code block is focusable (`tabindex="0"`), including one in a language without highlighting such as `bash`,
  in the workbench's docs and on storefront pages. A block that scrolls sideways no longer fails `pd build --browser`
  (axe `scrollable-region-focusable`) at phone width.
- The workbench's browser tab shows `shell.brand.title` ("Pattern Dump" without one, instead of "Pattern Dump Dev"
  on every route), with the component in front on a component route ("Button · Acme DS"), in `pd dev` and in a
  `pd build` snapshot.

### Changed

- A storefront page's <title> separates the page and the site with a middle dot
  ("About · Site") instead of an em dash, as do the workbench tab and the problems page.

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
  (`04-templates`, `05-pages`) could never hit the documented default. Only a per-folder
  `preview: full` could. Folder *labels* still keep the number: `2-col` is a name and `04-templates`
  a prefix, and nothing in the string tells them apart, so a numbered folder sets `title:` for a
  clean label.
- A `requireScript` or `globalScripts` id with no matching `<scriptsDir>/<id>.ts` is reported instead
  of failing inside the preview. `pd dev` names every unresolvable id at startup (with the component
  for a `requireScript`), and the script's URL answers 404 saying which file it expected and where,
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
  percentage chain) no longer grows without bound. Content-fitting such a height is circular (the
  frame's height feeds the content's), and the frame used to double every tick to the browser's
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
