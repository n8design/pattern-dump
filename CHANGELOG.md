# Changelog

## 0.8.2 (2026-11-22)

### Fixed

- **A `pd-` tag shown as code inside a placed component stays code.** A fence or inline code in a tag's content
  was read for tags, so a `<pd-…>` written there as an example failed the build (`is never closed`). Code is text
  there now, as it is everywhere else on a page.
- **A `pd-` tag can be written over several lines.** Attributes on lines of their own failed with `has something it
  cannot read before its closing >`. Line breaks between attributes work as in HTML, and that error now points at
  what it cannot read.
- **A style guide's `pd build` writes the images its previews use.** An image placed with `{{pd-image}}` showed in
  `pd dev` but was missing from the built workbench, in a preview and in an example in a component's docs. The
  build now writes every image size they reference, as the site build does.

## 0.8.1 (2026-11-22)

### Fixed

- **`pd build` writes only inside its output folders.** A reference with an encoded slash, such as
  `/_pd/components/x%2f..%2fevil.css` in a component's template, could make the workbench build write a file outside
  its output. Such a path now stops the build, naming it, and `/_pd/components/<name>.css` answers 404 for a name
  that is no component (a component without styles still gets an empty stylesheet).
- **A data file can no longer change every object in the process.** A `__proto__` key in a JSON data file was
  merged into `Object.prototype`. Keys named `__proto__`, `constructor` and `prototype` in data files are now
  ignored. In frontmatter, such a key (and any other name every object has, like `toString`) is refused as before,
  now with `"<key>" cannot be a frontmatter key: choose another name` instead of `duplicate key`.
- **`--out` and `site.outDir` are refused on everything the build reads.** The data folder, the scripts folder, the
  helpers file and the site's head file were not checked, so `pd build --out src/_data` replaced the data folder with
  the build. They are refused now, `--out` on the pages folder too, and the message names what the folder would hit:
  `overlaps the data folder <dir>`.
- **The scratch folder is your own.** The audit report, the diagnostics graph, `CONFLICTS.generated.md`,
  `FLATTENED.generated.md`, `BASE-LAYER.generated.md` and `pd export`'s default output moved from the shared temp
  folder to your cache folder: `~/Library/Caches/pattern-dump/` on macOS, `%LOCALAPPDATA%\pattern-dump\` on Windows,
  `~/.cache/pattern-dump/` on Linux. It is created for you alone, and a folder there that is a link or open to other
  users stops the run, naming the folder to remove; a cached audit is never reused from one. Old folders in the temp
  folder are left as they are; delete them when you like.
- **The accessibility check runs with the axe-core it was proven on.** Which rules are decided without a browser was
  measured with axe-core 4.11.4, but any axe-core 4 could be installed, and a fresh install got a newer one. The
  package now depends on axe-core 4.11.4 and jsdom 27.4.0 exactly, and `pd dev`, `pd build` and `pd audit` stop
  with another axe-core installed: `axe-core <installed> is installed, but the accessibility rule tiers were proven
  on 4.11.4: install axe-core 4.11.4`.
- **Live reload works beside a single helper file.** With `helpers` set to one file, every other file in its folder
  counted as a helper's import: saving a template or stylesheet there asked you to restart `pd dev` and reloaded
  nothing. Only the helper file itself is a helper now; files in your patterns, styles and other source folders reload
  as usual, and any other file beside the helper still asks for a restart.
- **Removing a file takes effect in `pd dev`.** A removed component stylesheet's CSS stayed in the preview, a stylesheet
  that used a removed partial showed no error, and a removed theme or script was still served, until a restart. They
  now leave as a change updates them; a stylesheet that used a removed partial shows its error.
- **`pd dev` keeps handling changes after a failed send.** If sending a reload to the open pages threw, every later
  change waited silently until a restart. The failure is reported now, and the next change is handled.
- **A failed `pd build` closes its server.** Some failures between the start and the writing of the files left the
  build's server running, so a script calling the build in its own process never exited.
- **A link that can't be read is a broken link.** A `%` that is no escape in a link a template writes
  (`/sale/50%-off/`) ended `pd build` with a bare `URI malformed`. It is now listed with the broken links, with its
  page and address: `<page>: <a href="/sale/50%-off/">: not a URL that can be read`.
- **Pages with live examples are checked faster.** The accessibility check waited half a second for each page that
  embeds an example, for frames that can't answer. It no longer asks them; the findings are the same.
- **A new website project starts without a warning about its own files.** `pd init --with-site` wrote tag and
  category layouts that were copies of each other, so the first `pd dev` printed `FLATTENED: 2 cluster(s) across 5
  components`. They now share two partials, `partials/term-index` and `partials/term-listing`; the pages they make
  are the same.
- **`pd --version`.** `pd --version` and `pd -v` print the installed version; they answered "unknown command".
- **A helper called without its arguments fails, naming it.** `{{defaultValue x}}` with no fallback showed
  `[object Object]`, and `eq`, `lt` and the other comparisons with one argument quietly gave false. They now fail
  with `<helper> needs 2 arguments, got 1`, and `and` and `or` refuse a third argument, which they ignored. A template
  that showed `[object Object]` or relied on such a call now fails the render: give the helper its arguments.
- **Sample data stays in the workbench.** A component's sample `.json` no longer reaches a site page: the layout,
  its partials at any depth, its views and cards, placed components and the head partial render on a page with what
  the page gives them and their template's defaults (`defaultValue`), and the project's data. So sample data may set
  any key: the build no longer refuses one a layout, a partial, a placed component, a view or a card doesn't
  declare (`the sample data of <id> (<file>) sets "<key>", … so it would show on every page …`), and a header or
  footer in the frame can have sample data of its own again. The workbench, its previews and the examples a page
  embeds show each component with its sample data as before. Every site that built before builds the same pages.

### Changed

- **Dependencies updated within their ranges,** for the security fixes in them: handlebars 4.7.10, markdown-it 14.3.3
  (a crafted page could make the build slow), postcss 8.5.33, postcss-selector-parser 7.2.1, html-validate 11.21.1,
  sass 1.108.2, shiki 4.6.0 and their own dependencies. A fresh install already got these; the release is now
  tested with them.
- **On macOS, `XDG_CACHE_HOME` is honoured.** When it is set to an absolute path, the scratch folder is created
  under it, as on Linux, instead of under `~/Library/Caches`.

## 0.8.0 (2026-11-19)

### Upgrading from 0.7.0

- **Rename your config: `storefront` is now `site`, and `storefront.site` is now `site.globals`.** Templates keep
  reading `{{site.…}}`; only the config changes. The old names still load, with one warning per key
  (`storefront.pagesDir is now site.pagesDir`), until 1.0, which removes them; setting both `site` and `storefront`
  is a config problem. Messages name the new paths (`site.globals.navigations.footer[0]: …`) and say "site" where
  they said "storefront" (`pd build: the site has problems, so nothing was written`), and terminal lines about the
  site start with `[site]` instead of `[storefront]`. The guide and a new project's starter files say "site" too.
- **`pd init --storefront` is now `--with-site`,** and `--no-storefront` is `--without-site`: two flags of their
  own, apart from `--site <package>`, which still makes a website on an existing style guide. The old flags still
  work, with a warning, until 1.0, which removes them; `--with-site` with `--without-site` is an error. A new
  project's config uses the new names.
- **Highlighted code has fixed class names.** Each token's class is its kind, `pd-code-keyword`, `pd-code-string` and
  so on, in place of a generated name such as `__shiki_17h8wv`, and a block is `<pre class="shiki">` with no inline
  style. CSS written for the generated names no longer matches: set the kinds' colours instead (below). If you link
  `/_pd/shiki.css` yourself, link `/_pd/code.css` instead, or code loses its token colours.
- **The config's types are named `Site…`:** `SiteChecks`, `SiteTermPages`, `SiteTag`, `SiteCategory` and
  `SiteNavEntry`, beside `SiteConfig`. Each `Storefront…` name still works as a deprecated alias until 1.0, which
  removes them. `StorefrontConfig` is deprecated too, but it is not an alias of `SiteConfig`: it stays the shape of
  the old `storefront` key, so code typed with it keeps working. Moving such code to `SiteConfig` means its globals
  key `site` becomes `globals`.

### Added

- **Code on site pages is highlighted, in the site's colours.** A page with code links `/_pd/code.css`, which colours
  each kind of token from a custom property, `--pd-code-keyword`, `--pd-code-string`, `--pd-code-comment` and eleven
  more, with Pattern Dump's colours as the defaults. A site sets them from its own tokens
  (`--pd-code-string: var(--color-code-string)`), with no colour values of its own; the defaults are in their own
  cascade layer, `pd-code`, so any rule of the site's wins. Light and dark follow the page's `color-scheme`: a light
  and dark toggle sets `color-scheme` too. `pd build` writes the file into the site's `_pd/`, with or without the
  workbench. The workbench uses the same properties. An additive contract change carries the address:
  `PD_ROUTES.codeCss`.
- **A page can stay out of the navigation:** `nav: false` in its frontmatter. The page is left out of `nav` (and of
  its folder's `children`) and out of `prev` and `next`: its own are empty, and its neighbours link past it. It still
  renders, is searchable, is in the sitemap and `llms.txt`, and is reached by its links, such as a credits or legal
  page linked from the footer. On a folder's `index.md` it leaves out the folder's entry and the folder's pages; in a
  folder's `childDefaults` it applies to the folder's pages. Any value other than `true` or `false` is a problem on
  the page, `nav must be true or false`. A layout still gets `nav`, the navigation, as before.
- **A design system made by `pd init` is a pattern package from the start.** Its `package.json` gets the
  `patternDump` field, naming the same folders as its config, so a website can use it (`pd init site --site
  ../styleguide`) without a manual step. Only a `package.json` init creates gets it; one that exists is left as it is.
  For a style guide in a folder without the field, `pd init --site` prints the block to add, from the folders of the
  style guide's own config.
- **Images in a page's markdown, like symbol images.** `![Alt](/assets/photo.jpg "Caption")` on a line of its own
  is a `<figure>` with the caption as its `<figcaption>`, instead of a `title` attribute (in a line of text, the
  title stays an attribute). A file named `photo-dark.jpg` next to `photo.jpg` makes the image a `<picture>` with a
  `(prefers-color-scheme: dark)` source, both written as WebP variants with their width and height, lazy as before.

### Changed

- **`pd audit` checks every variant.** Each variant is an entry of its own (`atoms/button~secondary`) in the report,
  the Audit tab and a rule's count of components: a data overlay with its data, a variant with markup of its own
  from its template. Until now only each component's default render was audited. **Heads-up:** an audit that passed
  in 0.7.0 can fail in 0.8.0 on a variant's defect, in CI too; the report names the variant.
- **`pd audit` reports a component a handle collision left out.** It is an entry with a `HANDLE_COLLISION` defect
  (an error) naming the handle and the component that keeps it, in the report and the Audit tab; before, the audit
  never mentioned it. The audit's scope lists a Discovery row. Like a variant's defect, it can fail an audit that
  passed in 0.7.0.
- **The remaining wording says "site" or "Pattern Dump".** A key a page cannot set is `filled by Pattern Dump, not by
  a page` (it said `filled by the site`), and the layouts `pd init` writes describe `page` as what Pattern Dump works
  out for it. The Inspector names a generated page's setting as `site.<kind>Pages`, `pd dev` logs a change to
  `site.globals` by that name, and `pd init` asks `Include a website`.
- **Code colours reach 4.5:1 contrast,** in the workbench and on site pages: in light mode, strings, keywords and
  tags, function and attribute names, CSS properties and values, parameters and Handlebars expressions are darker;
  in dark mode, comments are lighter. Each keeps its hue.

### Fixed

- **The Console has a warning level.** A data variant left out for want of a base template, and a preview whose
  height depends on the frame's, are warnings now: the line starts with `Warning:` and has an orange mark at its left
  edge, its text in the normal colour. The variant was shown in red, like a broken build. Errors stay red.
- **A failed `npm install` in `pd init` says what failed.** It said `pattern-dump may not be published yet` and
  suggested installing a local build, whatever the cause. It now repeats npm's error lines (`npm error code E404`,
  `npm error 404 Not Found - GET …`) and says how to install again: `cd <folder> && npm install`. When npm wrote no
  error, it gives npm's exit code, and when npm could not be started, says so.
- **A placed variant no longer asks for a value its data already gives.** `<pd-components-note~warning>` without a
  `heading` stopped the page with `"heading" is required by components/note~warning`, although `note~warning.json`
  sets one. A required key the variant's data sets now counts as given, and the page shows the variant's value. A key
  the variant's `.json` leaves out, or has the same value for as the base's `.json`, is still required on the tag,
  with the same message as before.

## 0.7.0 (2026-11-18)

Diagrams that follow the site's colours: symbol images, drawn once with colour tokens, shown on site pages in light
and dark, and written as standalone files for a README. A component's icon sets now reach site pages, and are found in
a pattern package's assets too. Markdown gains definition lists. Plus the fixes where Pattern Dump did less than its
guide said: metadata is read from the frontmatter block only, variants with data alone get their own docs and schema
and can be placed on a page, a private folder stays out of galleries, and a `pd build` that stops leaves its output
folders as they were.

### Upgrading from 0.6.0

- **Metadata outside the frontmatter block is no longer read.** `title`, `status`, `visibility`, `description`,
  `deprecated-use`, `preview`, `overview`, `requireScript` and `requireAssets` in a component's `.md` or a folder's
  `index.md` were matched as a `key:` line anywhere in the file, so a line in the body (a code sample with
  `requireScript: x`) loaded a script, and a file without a `---` block still had metadata. They now come from the
  block at the top only, like `order`: move any such line into the block. A quoted value loses its quotes
  (`title: "Button, primary"`), and `requireScript: [toggle, menu]` loads two scripts (it was read as one id,
  `toggle, menu`).
- **A placed data variant brings its data.** `<pd-components-note~warning>` on a website page rendered like the base
  note. It now takes each key it leaves unset from `note~warning.json` where that differs from `note.json`
  (`tone: warning`); a page that placed a data variant and relied on its look being the base's sets those keys on
  the tag.
- **An asset folder's `symbols/` folder now holds symbol images.** Every SVG directly in it is a symbol: it is checked
  (colours only as `var(--color-…)` and `currentColor`), and `pd build` writes it as `/_pd/symbols/<name>.svg`, with
  the values of the tokens it uses read from the document base layer. A project that keeps other SVG files in a
  folder of that name moves them, or the build stops on their colours. A markdown image whose address is a `#name`
  (`![Alt](#name)`), which showed a broken image, is now that symbol on a site page, and a page problem when there is
  none; in component docs it shows an error.
- **A component's symbol sets reach site pages,** and are looked up in every asset folder, yours first. A site page
  whose components need a set (`requireAssets`) that no asset folder has used to show blank icons; it now fails, and
  so does `pd build`, naming the component and the set. A preview of a pattern package's component now finds the
  package's own sets.
- **A line that starts with `:` or `~` and a space, right after a line of text, starts a definition list:** the line
  before it becomes the term. Such a line was part of a paragraph before. Check pages and docs that start a line that
  way.

### Added

- **Symbol images.** One SVG per symbol in an asset folder's `symbols/` folder, shown on a site page with
  `![Alt](#name)` (or `![Alt](#name "Caption")` for a figure). The page inlines each symbol it shows once, in a hidden
  sprite, so a diagram follows the site's colour tokens and its light and dark modes. Colours in a symbol are only
  `var(--color-…)` and `currentColor`; anything else stops the build. A `<style>`'s simple class rules become
  attributes; scripts, event attributes and links to other files are removed, with a warning. In a component's docs
  in the workbench, a symbol image shows an error for now.
- **A symbol as a file:** `/_pd/symbols/<name>.svg`, served by `pd dev` and written by `pd build` into both outputs,
  with the token values from the document base layer written in (light, then dark by `prefers-color-scheme`), for a
  README or anywhere else only an image file can be shown. `currentColor` becomes `--color-text` there, or the token
  the new `assets.symbols.currentColor` names. An additive contract change carries the address:
  `PD_ROUTE_PREFIX.symbols`.
- The `pd init --storefront` skin keeps a symbol image inside its column (`.site .doc-image`).
- **Definition lists in markdown.** A term on its own line, then each definition on a line starting with `:`, renders
  as plain `<dl>`, `<dt>` and `<dd>`, in site pages, placed components' markdown content and component docs (the
  syntax of `markdown-it-deflist`, now a dependency at exactly 4.0.0). A listing's teaser never comes from a
  definition list.
- **A data variant with no base template is reported.** A `chip~danger.json` with no `chip.hbs` beside it (or
  beside a base made of own-markup variants alone) has no markup to overlay. It is still left out, but `pd dev` now
  names it in the terminal and on the Console, as it does a handle collision:
  `Data variant left out: …/chip~danger.json needs …/chip.hbs to overlay, and there is none`.
  Two additive contract changes carry it: `DiscoveryResult.orphanVariants` (`OrphanVariantEntry`) and the HMR
  message `orphan-variant` (`OrphanVariantMessage`). `PD_PROTOCOL_VERSION` stays 1.
- **A data variant can have its own docs and schema**, `chip~danger.md` and `chip~danger.schema.json`, as an
  own-markup variant could. Without its own `.md` a variant still shows the base's docs.

### Changed

- **A component's symbol sets reach site pages.** A component that needs a set (`requireAssets`) left its icons
  blank on a site page: only its previews inlined the set. A page now holds each set its layout and the components
  it shows need, once, right after its symbol images, hidden by its size. A set no asset folder has fails the page,
  naming the component; so does an id two sets declare, or one a symbol image has.
- **A symbol set is found in every asset folder,** yours before packages', the first that has it winning; only the
  first folder was read, so a pattern package's sets were never found, in a preview or on a page.
- **`pd build` replaces its output folders only once every check has passed.** The workbench and the storefront are
  each written into a hidden folder beside their output (`.<folder>.pd-build-<process>`) and put in place at the
  end, so a build that stops leaves both as they were. Leftovers of a build that was killed are removed when the
  next one starts. If the workbench has taken its place and the storefront then can't, the build says the two are
  out of step.
- **A placed variant is checked against its base's schema** when it has none of its own.

### Fixed

- A `pd-` tag for a data variant failed with "has no schema, so it cannot be placed with values".
- A variant's `.schema.json` was also read as a data variant of its own (`chip~icon.schema`).
- `visibility: private` on a folder's `index.md` hid only the folder's node: an ancestor's gallery still listed its
  components, and counted them when deciding whether it has a gallery.
- A change noticed after the workbench was written, or while the storefront was, stopped `pd build` with both
  folders part old, part new.
- `pd help` and the guide no longer offer `pd help <command>`, which printed the same usage for every topic. The help
  gives the `--base` default as `build.basePath`, then `/`, and says `--brand` sets the site's title with `--site`.
- The accessibility coverage page called the rendered-page rules deferred; they run in the workbench's Diagnostics
  tab and with `pd build --browser`.
- The guide promised more than the code does in several places, among them that `pd audit` renders every variant
  and reports handle collisions, that `pd build` fails on component findings, and that a component can be made of
  data variants alone. Each now says what Pattern Dump does.

## 0.6.0 (2026-11-18)

A website can now live on its own, on an existing style guide package: `pd init --site` writes pages and a config,
and the components, styles and skin come from the package. Layouts preview at full height, a folder's `index.md`
sets defaults for its pages, a page or template pattern can be a layout, and a class borrowed from another
component is now reported (`STYLE_BORROWED`). `pd init` pins `pattern-dump` exactly.

### Added

- **`pd init --site <package or folder>`: a content-only website** on an existing style guide package. It writes
  pages, a config and a `package.json`, nothing else: no components, styles, themes or skin, which all come from the
  package (an npm name, optionally with a version, or a folder next to the site as a `file:` dependency). After
  `npm install` it asks the site's dev server for every page, so a package without a skin (`layouts/page`,
  `partials/base`) or without a `patternDump` field is named at once; a package named without a version is pinned
  to the one installed. `--workbench-url` says where the style guide publishes its own workbench (default
  `/workbench/`). A style guide and its site in one repository are two inits and a root `package.json`, described in
  the getting started guide.
- **`build.workbench: false`** (a new config option): `pd build` writes the storefront only, for a site whose
  workbench another build publishes (its style guide's). The base-path check for a same-host `workbenchUrl` is then
  the other build's, and `outDir` is not used. `pd init --site` sets it.
- **`pd init` asks two more questions with a website:** site search, which adds Pagefind as a devDependency so
  `pd build` writes the index (`--search` / `--no-search`, default yes), and whether the site follows the viewer's
  light or dark setting (`--system-theme` / `--no-system-theme`, default yes): a `system` theme
  (`color-scheme: light dark`) as the default, so the examples on a page follow the viewer with or without
  JavaScript, and the skin's own colours in `src/styles/base/colors.scss`.
- **Layouts preview at full height.** A component in `layouts/` fills the stage's height and width in the workbench,
  as pages and templates do. `"x-pd-preview": "full"` or `"centered"` at the top of a schema sets it for one
  component (an index.md's `preview:` for a folder, a component `.md`'s `preview:` above both), and the **Full
  height** toggle beside the viewport sizes switches it, as `?layout=full|centered` in the address.
- **Folder defaults.** A folder's `index.md` sets frontmatter for the pages under it once, in a `childDefaults:`
  block written as a page writes its frontmatter: the layout, any key the layout declares, a query's options,
  `tags`, `categories`, `draft`, `index`, `toc`, `image`. A page's own value wins, key by key and option by option;
  the nearest folder wins; a list is replaced, never joined (`tags: [guide]` on the folder and `tags: [setup]` on the
  page give `[setup]`). `childLayout` stays, as the short form of `childDefaults.layout`. A problem about a value a
  folder set names where it came from:
  `services/web.md (from the childDefaults of services/index.md, line 9): limit "two" is not a number of pages: a whole number from 1, such as 3`.
  A draft default is said per folder by `pd build`, so it can't hide a section silently:
  `[pd build]   12 pages are drafts via the childDefaults of services/index.md`.
- **Page and template patterns as layouts.** `"x-pd-layout": "<name>"` in the schema of a pattern in `pages/` or
  `templates/` makes it the layout `<name>`, with no copy under `layouts/`; a page names it as any layout. The page's
  markdown goes into the property `x-pd-content` names (a `text/markdown` string), else `body`. A marker anywhere
  else, a marker on a `layouts/` component, and one name for two layouts are errors that name the files, on the
  components and on every page that asks for the name. Keys a page sets for the build stay refused in a layout's
  schema. A tag or category page can use a marked layout too; the message when the skin has none now says so:
  `storefront.tagPages asks for tag pages, but the skin has no layout "tags" (the index of the tags): add layouts/tags, or mark a page or template pattern with "x-pd-layout": "tags", or set tagPages to false`.
- **`/api/pages` gives each page `defaultsFrom`** (an additive change to the pages response): the keys it took from a
  folder's `childDefaults`, each with that `index.md`, a query's options one by one (`"related.limit"`).

- **A new diagnostic kind, `STYLE_BORROWED`** (info). A template that uses a class another component owns, without
  including that component, borrows it: the owner's stylesheet is linked too, so the class is styled. That stays,
  since a design system can borrow on purpose, and is now said, once per borrowed owner on the component's
  Diagnostics tab:
  `organisms/search uses class "search-field" from molecules/search-field, so molecules/search-field's stylesheet is linked too: include molecules/search-field if it belongs here, or rename the class`.
  A website page that renders a borrower gets the same line as a warning, naming the page file, and `pd build`
  counts the borrowed stylesheets in its summary
  (`[pd build] styles: 3 stylesheets linked by a borrowed class (STYLE_BORROWED on the component's Diagnostics tab)`). Two components that merely use the same class
  name for different things are the usual cause: rename one. It is on the component's detail, not in `pd audit`.

  **Upgrading a site made with an earlier `pd init --storefront`:** its layouts share the page classes
  (`page-title`, `page-description`, `page-tags`, `page-body`, `page-next`, `page-meta`) that `layouts/page` owns,
  so after the upgrade every page that uses another layout (article, doc, home, listing, tag and category pages)
  warns that it borrows them, and those layouts show `STYLE_BORROWED`. Nothing looks different; the warning says
  the styling depends on another layout's stylesheet. Fix: move those rules out of
  `src/styles/layouts/page.scss` (and the three `.doc-content .page-*` rules out of `src/styles/layouts/doc.scss`)
  into a new `src/styles/base/page.scss`, which the base layer (`documentBase: ["base"]`) links on every page, as
  the starter now does. Start it with `@use "tokens";` for the spacing tokens.

### Changed

- **`pd init` pins `pattern-dump` exactly** (`0.6.0`, not `^0.6.0`), and Pagefind with it: a patch release can
  change what a build writes and checks. `npm install --save-dev --save-exact pattern-dump@<version>` moves the pin.
- **`pd init` allows Pattern Dump's own install scripts** (esbuild, `@parcel/watcher`) in the `package.json` it
  writes (`allowScripts`), so npm 11.19 no longer warns about them after the install. A denial the project already
  has stays.
- **`pd init` names a generic folder by its parent:** `pd init styleguide` inside `acme-web/` makes the package
  `@acme-web/styleguide`, titled `acme-web` (`styleguide`, `style-guide`, `design-system`, `site`, `website`, `docs`,
  `www`). The question shows it, `--yes` takes it, and init prints the name it wrote.
- The starter's `light` and `dark` themes declare their `color-scheme`, and its note and search styles follow it.

### Fixed

- **An example on a website page takes the page's theme.** When the page's `<html>` (or `<body>`) has a
  `data-theme` naming one of the workbench's themes, every live example on it shows that theme, and follows when a
  toggle changes it (with `themes.switch: "stylesheet"` too). Without JavaScript an example keeps the default theme.
- **The workbench shows a change saved while it was opening.** A save in the moment between the first view and the
  live-reload connection was missed until the next change; the Nav Rail and the open page now catch up on connect.
- **`pd init` with the starter components and a website** (`--storefront --yes`): the example page's classes
  (`page-title` and others) were also the skin's, so the home and about pages warned that they borrow
  `pages/example`'s stylesheet; and the website's search field had the class of `molecules/search-field`. The example
  page's classes are now `example-page-*`, the search field's `search-input`.

  **Upgrading a project made that way with an earlier `pd init`:** rename the classes in
  `src/patterns/pages/example/example.hbs` and `src/styles/pages/example.scss` (`page`, `page-header`, `page-title`,
  `page-content` to `example-page`, `example-page-header`, `example-page-title`, `example-page-content`), and in
  `src/patterns/components/search/search.hbs` and `src/styles/components/search.scss` the input's `search-field` to
  `search-input` (its `id` and the label's `for` too).

## 0.5.3

`pd build` of a site is up to twice as fast again: 2,000 pages in 8.2 s instead of 16.4 s with the checks left out.
`pd audit` no longer reports a component clean when a partial it includes has a defect, and it now fails when it
finds an error.

### Performance

Measured on a generated documentation site, main and 0.5.3 back to back (median of 5):

| Build | 0.5.2 | 0.5.3 |
|---|---:|---:|
| 500 pages, every check | 15.6 s | 13.2 s |
| 500 pages, `--skip-checks=a11y,html` | 5.5 s | 3.6 s |
| 2,000 pages, every check | 55.1 s | 46.0 s |
| 2,000 pages, `--skip-checks=a11y,html` | 16.4 s | 8.2 s |
| hTWOo workbench | 19.1 s | 17.5 s |

- **A site page reads the design system's files once.** Its checks read the same templates, schemas and sample data
  about 22 times per page; they are now read once per build (and in `pd dev`, again only after an edit).
- **A page's work no longer grows with the size of the site.** The nav, the page's position in it, and the site's
  page list were gone through in full for every page.
- **A template's own checks are worked out once per template**, and a page's HTML is parsed once for its classes
  and its images.

### Changed

- **`pd audit` fails when it finds an error** (exit code 1), as `pd build` fails on its checks' errors. It used to
  exit 0 whatever it found, so a CI step that runs it now fails where it passed before. Warnings alone leave it at
  0; `--strict` makes any finding fail it. The last line says why:
  `[pd audit] failed: 2 errors found (warnings alone don't fail it; --strict makes them fail it too).`
  Fix: correct the errors, or run `pd audit` without failing the step (`pd audit || true`) if it should only report.
- **The navigation a layout gets is read-only.** Every page now shares the site's nav entries; only the current page's
  entry and its parent are new for each page. A helper that changes a nav entry it is given stops the render, with
  0.5.2's message naming the component and the code that made the change:
  `Cannot assign to read only property 'title' of object '#<Object>', while rendering layouts/page. A render's data (...) is shared by every render, so it is read-only: copy a value before changing it (changed at ...)`.
  Fix: copy the entry in the helper before changing it (`{ ...item, title: "..." }`).

### Fixed

- **`pd audit` and the workbench's Audit tab no longer report a component clean when something it includes has a
  defect.** A component's cached audit was reused while its own files were unchanged, so a defect put into a partial
  left every component that includes it clean. The cache now covers every partial a component includes, at any depth,
  and its sample data and schema; a partial a project helper includes by name (such as a `dynamicPartial` helper);
  a dynamic partial (`{{> (expr)}}`); and the project helpers' source. In `pd dev`, an edit to a partial re-audits
  every component that includes it. The cache written by 0.5.2 is not used.
- **`--check-workers 1` no longer runs out of memory.** With one worker (and the default on a machine with two cores
  or little memory) every page was checked in the build's own thread, and a 2,000-page build stopped with a heap out
  of memory. One worker now runs the same pool as several, replaced every 16 pages.

## 0.5.2

A performance release: `pd build` of a 500-page site takes 14.8 s instead of 114.9 s in 0.5.0, with every check on.
Two checks can now be left out for a quick local build.

### Performance

Measured on a generated 500-page documentation site, with every check on (median of 3 runs):

| Build | 0.5.0 | 0.5.2 |
|---|---:|---:|
| 500 pages, every check | 114.9 s | 14.8 s |
| 500 pages, `--skip-checks=a11y` | not available | 6.9 s |

- **The storefront's pages are read once per build**, and each page is assembled once: the build writes the pages as
  its crawl read them instead of asking for each one again. A build no longer slows down faster than the site
  grows: at 2,000 pages it takes the same time per page as at 500 (about 0.1 s before the accessibility check moved
  to worker threads, 5.4x faster than 0.5.0 then).
- **The renderer reads, parses and compiles each file once**, and compiles a template only when a render uses it. The
  hTWOo workbench builds in about 20 s instead of 60 s (3x faster). `pd dev` re-reads a file only when it changes.
- **The site's pages are checked for accessibility on worker threads**: by default the cores less one, at most 8,
  within a quarter of the memory. The findings, and their order in the report, are the same with any number.
- **The same markup is validated once.** A component's markup is shown in its detail, its preview and its source view;
  html-validate now checks it once (hTWOo: 323 validations instead of 931).

### Added

- **`--skip-checks` and `build.skipChecks`** leave a check out of `pd build`, for a quick local build: `a11y` (the
  accessibility of the storefront's pages) and `html` (each component's markup against HTML's content model). Every
  check runs by default; `--skip-checks=` runs every check for one build. A name pd build doesn't know stops it:
  `pd build: "links" is not a check pd build can skip; it can skip "a11y", "html"`. `--browser` with `a11y` skipped is
  refused, since it checks accessibility in Chromium.
- **The "NOT CHECKED" line.** A build that left a check out says so as its last line:
  `[pd build] NOT CHECKED: the accessibility of the site's pages (a11y), as asked (--skip-checks or build.skipChecks)`.
- **`--check-workers <n>`**: the number of threads that check the site's pages for accessibility; `1` checks them
  in one.

### Changed

- **The page model and a component's data are read-only.** Every page and every render now shares one copy, so a
  helper that changes a value it is given stops the render, naming the component and the code that made the change:
  `Cannot assign to read only property 'tone' of object '#<Object>', while rendering atoms/card. A render's data (the component's data files, the global data, a site page's data) is shared by every render, so it is read-only: copy a value before changing it (changed at shout (helpers/shout.js:3:12))`.
  On a site page, a change to the page model (`site`, the pages and their listings) says
  `... The storefront's page data is shared by every page, so it is read-only: copy a value before changing it (changed at ...)`.
  Fix: copy the value in the helper before changing it (`{ ...value, tone: "loud" }`), or return a new one.
- **`pd build` stops when the project changes while it runs.** The sizes and time stamps of every input (patterns,
  styles, data, helpers, scripts, themes, assets, the site's pages and head) are taken when the build starts and
  compared before anything is written and after each part. A change stops the build, naming the files:
  `pd build: the project changed while it was being built, so nothing was written. Run pd build again once the files are saved:`
  followed by `  - pages/guide.md (changed)`. Fix: save the files, then build again. A build that is stopped later says
  what may be part old, part new.

### Fixed

- **A stylesheet saved before its template moves to the component in `pd dev`** when the template arrives, even when a
  request reached the new template before the file watcher did. The stylesheet could stay in the base layer until the
  next change.

## 0.5.1

A patch release: two live-reload fixes for site pages, and four problems that showed a wrong page or wrong output with
no message.

### Fixed

- **A component schema that isn't valid JSON stops the build.** It used to read as "no schema", which turned every
  check of that component off without a word. Now one problem names the file, line and column and says the component
  isn't checked until it's fixed: in the workbench (an error on the component), on every `pd dev` site page, and in
  `pd build`, which writes nothing, with or without a site:
  `src/patterns/atoms/chip/chip.schema.json:5:5: not valid JSON (Expected ',' or '}' after property value), so atoms/chip isn't checked against its schema until it's fixed`.
  A build that passed on 0.5.0 with such a file now stops; before, its output was unchecked.
- **Tags given as strings are reported, not rendered empty.** A component included without `x-pd-card` whose template
  reads `{{label}}` while its sample data gives tags as strings showed empty list items in the workbench. A component
  that contradicts itself about tags is now an error, naming the fix:
  `{{#each tags}} reads {{label}}, but the tags in the sample data are strings: a tag is an object since 0.5.0 (key, label, description, route): give each one as { "key": "design", "label": "Design" } in tag-list.json`.
  The same for a schema that declares tags as strings while the template reads their fields, and a template that
  writes `{{this}}` while the schema declares objects. On the site, a schema that a page's layout or view includes and
  that declares tags as strings fails the page, as a card's already did. Tags that are plain strings, written as
  strings, are left alone.
- **`pd dev` stops when its port is taken on IPv6.** Another server holding the port on `::1` let `pd dev` start on
  127.0.0.1 anyway, and a browser that resolves `localhost` names to `::1` showed the other server's pages. Both ports
  (the workbench's and live reload's) are now checked on IPv4 and IPv6, with the usual message:
  `Port 4000 is already in use, so the workbench cannot start.`
- **Preview pages have a title:** "Button · secondary · Acme DS" (the component, its variant, the workbench's name).
  Accessibility checks reported every preview without one.
- **An open site page in `pd dev` reloads again after its connection drops.** When `pd dev` was stopped and
  started again (or the computer slept) with a site page open, that page never reloaded again until a manual
  refresh: an edit to a component in a linked style guide package, or anywhere else, seemed to have no effect. The
  page now connects again, and reloads once if anything changed meanwhile, as the workbench already did.
- **Site pages under a base path reload on every change in `pd dev`.** With `storefront.url` on a path
  (`https://example.com/docs/`), an edit to the page's markdown, a base-layer stylesheet, global data, a script or
  an asset did not reload the open page.

## 0.5.0

Everything a documentation site needs: categories and tags with their own pages, listings with cards and views,
queries for related and latest pages, search, regions with a table of contents, scheduled pages, `llms.txt`, and
build checks for classes and custom properties. Upgrading a 0.4 site: see
[Upgrading to 0.5](docs/guide/upgrading-to-0.5.md).

### Breaking changes

- **`page.modified` is retired.** Git's last commit counted a typo fix as a change, so Pattern Dump no longer fills
  it. A layout that declares it fails every page that uses it:
  `layouts/page declares "page.modified", which Pattern Dump no longer fills: git's last commit counts a typo fix as a change. Declare "page.updated" instead: the page's own updated: date, set for real changes`.
  Fix: declare `page.updated` and set `updated: YYYY-MM-DD` on a page when it really changes. `page.created` (the
  first commit) is unchanged.
- **A tag is an object, not a string.** `page.tags` and every listing entry's `tags` are
  `{ key, label, description, route }`, as categories are (which gain `route` too). A template that writes a tag as
  text stops the page, naming the template and line:
  `layouts/page (page.hbs:8): {{#each page.tags}} writes {{this}}, but a tag is an object since 0.5.0 (key, label, description, route): write {{label}} to show it ({{key}} is its URL segment, {{route}} its page)`.
  A card named with `x-pd-card` (or a view's card) whose schema declares `tags` as a list of strings stops its
  listing: `components/card (...) declares tags as a list of strings, but a tag is an object since 0.5.0 (key, label, description, route): declare its items as "type": "object", or leave items out`.
  Fix: write `{{label}}` (or `<a href="{{route}}">{{label}}</a>`), declare the items as objects, and change the tags
  in sample data (`.json`) to objects. A component that only receives tags through an include, without `x-pd-card`,
  is not checked: its template and sample data need the same change, or its workbench example shows empty tags.
- **Git's last commit no longer dates anything a reader or a search engine sees.** No message; the output changes:
  - JSON-LD `dateModified` (on the `WebPage` and the `Article`) is the page's `updated`, and left out without one.
  - The sitemap's `<lastmod>` is the page's `updated`, else its `date`, else left out. `pd build` no longer runs git
    for the sitemap.
  - `page.modified` is no longer filled (see above).
  - From a shallow clone, `pd build`'s note is about `datePublished` now:
    `the repository is a shallow clone, so pages without a date of their own have no datePublished in their JSON-LD: build from the full history (in CI, check out with fetch-depth: 0)`.

  Fix: set `updated:` on pages whose last change should show.
- **A page dated after today stays out of `pd build`** until that day (the UTC date of the build's clock), with
  every page under a folder whose `index.md` is dated so. The report names it:
  `[pd build] scheduled: 1 held back (articles/launch.md until 2026-12-01)`, and `pd dev` notes
  `articles/launch.md is scheduled for 2026-12-01: pd build leaves it out until then`. A link to it from a published
  page is then a broken link, and a navigation entry naming it is a problem
  (`storefront.site.navigations.footer[0]: "articles/launch.md" is not a page in the pages folder`). Fix: give the page
  today's date or earlier, or remove the links until that day.
- **`site.collections` is deprecated.** It keeps working, and a skin whose `partials/base` lists it gets one warning
  per build:
  `warning: partials/base lists site.collections (articles), which is deprecated: declare a query on the layouts that show it instead (x-pd-query on a sub-key of page, such as page.latest with { "collections": ["articles"], "sort": "date", "limit": 3 })`.
  Fix: declare a query (see Added). It goes in a later release.
- **New frontmatter keys belong to the build:** `updated`, `categories`, `childLayout`, `view` and `toc`. A layout
  whose schema declares one fails every page that uses it:
  `layout "article" declares "updated", which a page sets for the build, not for its layout: rename it in the layout's schema`.
  Fix: rename the field in the layout's schema; show the page's values through `page.updated` and `page.categories`.
- **A custom property nothing defines stops `pd build`.** A `var(--x)` without a fallback in the project's own styles
  folder (the skin and the component styles), with no `--x` in any stylesheet of the style guide or its packages (or
  a `style` attribute the build writes):
  `pd build: the skin reads custom properties nothing defines, so nothing was written:` followed by
  `styles/card.scss:4: var(--card-gap) reads a custom property nothing defines: define --card-gap in the skin, give it a fallback (var(--card-gap, ...)), or, if JavaScript sets it, list it in storefront.checks.allowProperties`.
  Only a project with a storefront is checked.
- **A skin with `layouts/tag` or `layouts/category` gets tag or category pages** (see Added), without asking. Each
  must fit the layout:
  - A page of the pages folder at a generated route stops the build:
    `tags/index.md is the page at /tags/, which is the index of the tags as well: rename tags/, or give the tag pages another path (storefront.tagPages: { path: "..." })`.
    A `redirectFrom` that claims one does too.
  - The layout must declare `title`
    (`layouts/tag: a tag page's title is the tag's label, so the layout declares "title"`), and a key it requires
    that a generated page doesn't have fails it (`"subtitle" is required by layout "tag"`).

  Fix: adjust the layout, or set `storefront.tagPages: false` (`categoryPages: false`).
- **Search turns on when the project has Pagefind** (`node_modules/pagefind`, also when another package brought it).
  `pd build --browser` then uses the first `input[type="search"]` it finds, at each viewport, and stops when it shows
  no result:
  `/search/: searching for "..." in its search field (input[type="search"]) showed no result within 5 s, though the index has a page with it: ...`.
  A site with a search of its own (another service): set `storefront.search: false`.
- **`region` on a placed component's tag is Pattern Dump's.** A component whose schema declares a property `region`
  can no longer be given one on its tag:
  `<pd-card>: region="..." is Pattern Dump's (the layout's region the component goes into), and components/card declares a property "region" as well: rename that property to place it in a region`.
  Fix: rename the property.
- **Output that changes without a message:**
  - `article:tag` and JSON-LD `keywords` write a tag's label, not its key (for an undeclared tag they are the same).
  - `pd build` writes `/llms.txt` for an indexed site, over a file of the same path. `storefront.llms: false` turns
    it off.
  - Shell code (`bash`, `sh`, `shell`, `zsh`, `console`, `shell-session`) is highlighted where it was a plain `<pre>`:
    in a component's docs, on a storefront page, and in a placed component's content.
  - A storefront code block's copy button is no longer in the page's HTML: the page's script adds it where the
    browser can copy, with a visually hidden status line for screen readers. A skin styles
    `.shiki-container > button.copy-btn` as before; a test or crawler that looked for the button without JavaScript
    finds none.
  - `pd build` prints new report lines, among them `classes:` on every storefront build:
    `[pd build] classes: every class on the site's pages is the style guide's`, `llms.txt: N pages`, and with
    Pagefind `search: N pages indexed`. `pd dev` says once that search needs `pd build`.
  - In the workbench, a layout's Relationships tab lists its pages. Its detail JSON (`pages`) is a union now: a
    generated page has `source: "generated"` and no `path`.

### Added

- **Categories**, independent of folders: `storefront.categories` declares them (key, label, optional description,
  and old keys as `aliases` after a rename), and a page names them in `categories:`. An undeclared value stops the page
  with a "did you mean"; an old key builds as the new category, with a warning naming the page. Layouts get
  `page.categories`, listing entries carry them, and `site.categories` lists every one when `partials/base` lists it.
  `article:section` (the first category's label) and the `Article`'s `articleSection` carry them.
- **Tag declarations:** `storefront.tags`, declared as categories are. Optional: without it any tag works, labelled
  with its key. With it, a tag that isn't declared stops the page with a "did you mean", and an old key builds with a
  warning.
- **`updated:`** on a storefront page, its last real change: `page.updated`, JSON-LD `dateModified`,
  `article:modified_time` on an article, and the sitemap's `lastmod`. Checked: a real date, not before `date`.
- **Scheduled pages:** a page dated after today is held back from `pd build` (see Breaking changes). `pd dev` shows it,
  listed with `scheduled: true`.
- **`childLayout:`** on a folder's `index.md`: the layout of the pages under it that name none. The nearest folder that
  sets one wins, and a page's own `layout:` wins over it. A `childLayout` that names no layout fails the `index.md` and
  each page that takes it, and every problem about a page's layout names where the layout came from. The workbench
  lists a layout's pages in its Relationships tab, each with where its layout came from, and `/api/pages` gives
  `layoutFrom`.
- **A listing's card:** `x-pd-card` names the component each page of a listing is shown as (on a layout's
  `page.children`, or a view's `entries`). Every page in the listing is checked against the card's schema: a field the
  card requires that a page doesn't have fails the listing, naming the page.
- **Listing views:** `view: grid` on a folder's `index.md` shows its listing through `views/grid`, a component in the
  skin's style guide. The layout writes `{{{page.listing}}}`; the view gets the pages as `entries` and names its card.
  `x-pd-view` on `page.listing` sets a layout's default view.
- **Queries:** one way to list pages anywhere but a folder's own listing, such as related pages or a home page's
  latest articles. A layout declares one as a sub-key of `page` with `x-pd-query` and its defaults: hand-picked
  `pages` first, then the pages of `collections` (or `same`) matching `categories` and `tags` (`match`: any or all;
  `same` for the page's own), by `sort` (relevance, date or title) and `order`, to `limit`, through a `view`. The
  layout gets `{ entries, listing }`. A page changes options in a block under the query's name (`related:` with
  `limit: 5` indented under it), or turns it off with `related: false`. The current page, drafts and scheduled pages
  never appear, and a page never comes twice. Every value is checked, with a "did you mean" where it fits.
- **Tag and category pages:** a page for every tag and category a published page has (`/tags/<key>/`,
  `/categories/<key>/`), and an index of each, through the skin's `layouts/tag`, `layouts/tags`, `layouts/category`
  and `layouts/categories`. A term page gets `page.term` and lists its pages through a query; an index gets
  `page.terms`. `storefront.tagPages` and `storefront.categoryPages` turn them off, ask for them, or set the path and
  the index's title. An old key's route forwards to the new one. They are in the sitemap, with JSON-LD
  `CollectionPage`, and the workbench lists them under their layout.
- **Search with Pagefind** (`npm install --save-dev pagefind`): `pd build` indexes each page's own content (never the
  layout's header, navigation or listings) into `_pd/search/`, under the site's path, with `section`, `tag` and
  `category` filters. `storefront.search`: left out, on when the project has Pagefind; `true` makes a build without it
  stop; `false` turns it off. `pd build --browser` uses the site's search field once per viewport.
- **Regions:** a layout declares regions besides the body on `page.regions` (`"x-pd-regions": ["sidebar"]`) and writes
  each as `{{{page.regions.sidebar}}}`, null when empty. A placed component goes into one with `region="sidebar"` on
  its tag or `"x-pd-region"` in its schema. `<body data-pd-regions="sidebar">` names the filled ones.
- **The table of contents:** the skin's `components/toc`, with `items: [{ text, href, level }]`. `toc: true` in a page
  (or `x-pd-toc` on its layout) shows it with the page's headings of level 2 and 3; `<pd-toc>` places it in the
  markdown, with the derived items or links of its own.
- **`llms.txt`** (llmstxt.org): the site's title and description, then the top-level pages and each collection, every
  page with its title, link and teaser. The same pages as the sitemap; absolute URLs with `storefront.url`, under the
  site's path. On by default; `storefront.llms: false` turns it off.
- **The class check:** `pd build` lists each class on a site page that no component or style of the style guide
  defines, naming the page's file and line:
  `about.md:12: class "hero-big-title" isn't defined by any component or style`. State classes (`is-`, `has-`, `js-`)
  and Pattern Dump's own are allowed, and so is `storefront.checks.allowClasses`. A warning;
  `storefront.checks.classes: "error"` stops the build, `"off"` skips it.
- **The custom property check** (see Breaking changes), with `storefront.checks.allowProperties` for properties
  JavaScript sets.
- **Shell highlighting:** `bash`, `sh`, `shell` and `zsh`, and `console` or `shell-session` for a prompt with its
  output. `text` stays plain.
- A page's frontmatter takes one level of keys indented under a key, for a query's options.
- Listing entries carry `updated`, `categories` and `scheduled`.
- The website starter (`pd init --storefront`) has `doc`, `article`, `home`, `tag`, `tags`, `category` and
  `categories` layouts, four views with their cards (`list`, `grid`, `featured`, `compact`), related and latest
  articles as queries, a search page with an accessible `components/search`, and a `components/toc`.

### Changed

- `pd init`'s last line suggests `npm install --save-dev pagefind` for the site's search.
- The message for an unknown `x-pd-*` key in a schema lists the new ones (`x-pd-card`, `x-pd-query`, `x-pd-region`,
  `x-pd-regions`, `x-pd-toc`, `x-pd-view`).

### Fixed

- A storefront code block's copy button tells screen readers too: "Copied" or "Not copied" in a status line, besides
  the button's own text.

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
