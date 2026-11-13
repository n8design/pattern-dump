# Storefront

A storefront is a website of real HTML pages, written as markdown files, next to the workbench. Use it for a
design system's public documentation: the pages explain, and every live example in them is the component
itself, rendered by the same code the workbench uses, with a link into the workbench beside it.

The pages are plain HTML. They read with JavaScript off, work from any static host, and load none of the
workbench's own styles.

---

## Quick start

The quickest start is a new project with a website already in it:

```bash
npx pattern-dump init my-site --storefront
```

It brings two pages, a small skin, one component the home page shows (in a live example and placed with a
`pd-` tag), and a GitHub Pages workflow that publishes the website with the workbench under `/workbench/`
([cli.md](cli.md#pd-init)). Its README says how to publish it.

To add a storefront to a project you have, add a `storefront` block to the config ([configuration.md](configuration.md#storefront)):

```ts
export default defineConfig({
  // …
  storefront: {
    pagesDir: "./pages",
    outDir: "./site",
    workbenchUrl: "https://workbench.example.com/",
    site: { title: "Acme Design System", footer: "© Acme" },
  },
});
```

Then write the pages, and give the project a skin: the layouts the pages render with. Either use a skin
from a [pattern package](#skins), or write your own [layouts and partials](#writing-a-skin).

```bash
npx pd dev     # the storefront at http://live.localhost:4000/, the workbench at http://pd.localhost:4000/
npx pd build   # the workbench snapshot in outDir, the storefront in storefront.outDir
```

---

## Pages

Every markdown file in `pagesDir` is a page. The file's path is its URL:

```
pages/
  index.md          → /
  about.md          → /about/
  guides/
    index.md        → /guides/
    setup.md        → /guides/setup/
```

- `index.md` at the top is the home page, and every folder that holds pages needs its own `index.md`,
  the folder's page.
- File and folder names are part of the URL: lowercase letters, digits and hyphens only.
- Only `.md` files belong here. Images and other files go in the project's [assets](authoring.md).
  Files starting with a dot are ignored.
- **Adding a page is adding a file.** It appears in the navigation with no other change.

`pagesDir` is not the same as a `pages` folder among the patterns, such as `src/patterns/pages/` in `pd init`'s
starter components: that is the page level of atomic design, page-sized components shown in the workbench,
while `pagesDir` holds the website's pages.

The navigation is built from the folder, one level deep: the top-level pages and folders, and each
folder's pages beneath it. `order` sorts them, with the same meaning as for components
([authoring.md](authoring.md#order)): a number among siblings, and in the top `index.md` or a folder's
`index.md`, optionally a list of names.

A page's markdown is the same markdown as component docs, with the same safety rules: raw HTML in a page
is shown as text, not run.

### Live examples

A `pattern` fence shows a component:

````md
```pattern components/callout
```

```pattern components/callout~warning
```
````

On a storefront page this is a frame with the component's own preview, not a copy of its markup, so the
component is styled by its own CSS and nothing on the page can restyle it. With JavaScript on, the frame
fits the preview's height. Beside the frame are a list of the component's variants, each a link to its
preview, and a link that opens the component in the workbench (in `pd dev`, this server's workbench; in a
build, `storefront.workbenchUrl`). With JavaScript off, the frame keeps the browser's default height (or the
height its component declares, below) and the links still work.

#### The height an example starts at

Until its preview has loaded, a frame doesn't know how tall its content is. If it started small and then grew,
everything below it on the page would move (a layout shift, which search engines count against a page). So a
component can declare the height its live example starts at, in its schema:

```json
{
  "x-pd-example-height": 112,
  "properties": { "title": { "type": "string" }, "text": { "type": "string" } }
}
```

The frame then starts at that height (as its `height` attribute, so it holds with JavaScript off too, and a
skin's CSS can still change it) and grows from there to fit its preview.

The value must **err short**. A frame can grow to fit its content but never shrink below the height it starts
at, so a value taller than the content leaves the frame too tall, with empty space under the component. Use:

- the height of the example **at the widest column** your skin gives it, which is its smallest height, since
  narrower columns wrap its text onto more lines; and
- **no taller than the shortest variant**: one value covers the component and all its variants.

`pd dev` warns, on the page and in the browser console, when an example's content turns out shorter than its
declared height. It can't tell when a preview's content fills whatever frame it is in (`html { height: 100% }`),
and says nothing then.

The value is a whole number of pixels above 0. Anything else is an error on the component in the workbench, and
every page that shows it in a live example fails to build, as it does when a schema can't be read at all. A
component without the key starts as before: small, then fitted.

A `pattern:` link, such as `[the callout](pattern:components/callout)`, links to the component in the
workbench.

### Placing components

A live example shows a component as it is in the workbench. A `pd-` tag places a component in the page
itself, with values the page gives it, and checks them against the component's schema first:

```md
<pd-components-note tone="tip" heading="Before you start">
Install **Node 22** or later.
</pd-components-note>
```

The tag's name is `pd-` followed by the component's handle (`<category>-<name>`, as in `{{> components-note }}`);
a variant is `pd-components-note~warning`. The component renders into the page, with its stylesheet linked
in the page's head, so the page's own styles also reach it.

| Written | Becomes |
|---|---|
| An attribute | A value, its name turned from kebab-case into camelCase: `per-view="2"` sets `perView` |
| An attribute's value | Text, read as a number or `true`/`false` only where the schema declares that type |
| An attribute with no value | `true`, for a boolean. Any other type needs a value |
| A child `pd-` tag | An item of the property whose items name that component (`"items": { "x-pd-component": "components/slide" }`), or the property's value when it names the component itself |
| Text inside the tag | The property the schema names with `"x-pd-content"`. Markdown when that property is `"contentMediaType": "text/markdown"`, otherwise plain text |

A component placed with children, from the storefront bench:

```md
<pd-components-slider label="The bench in pictures">
  <pd-components-slide image="/assets/images/bench-blocks.svg" alt="Blocks of colour">The **wireframe** skin</pd-components-slide>
  <pd-components-slide image="/assets/images/bench-blocks.svg" alt="The same blocks">Placed with `pd-` tags</pd-components-slide>
</pd-components-slider>
```

Where a tag is read:

- It starts a block: at the start of a line, indented at most three spaces, also inside a list item or a
  quote. The block runs to the tag's closing tag, blank lines included.
- A tag in the middle of a paragraph is text, and a tag indented four spaces is a code block, as for any
  markdown.
- Inside the block only `pd-` tags are tags. Any other HTML in the content is text, escaped like everywhere
  else on a page.

**What is checked.** Before the page is shown, every placement is checked against the component's schema: a
required value missing, a value that isn't declared (with a suggestion for a likely typo), a value of the
wrong type or outside its `enum`, a child the component doesn't take, content text where the schema names no
`x-pd-content`, a tag that is never closed, and a component that doesn't exist or has no schema. Each is a
[problem](#problems) with its file, line and column:

```
index.md:22:21: <pd-components-note>.tone must be one of "tip", "warning" (got "tips")
```

`pd-` tags work on storefront pages. In a component's own documentation they are shown as text.

---

## Frontmatter

```md
---
layout: article
order: 2
title: Setup
description: How the bench is put together.
lede: Three folders make a site.
---
```

| Key | |
|---|---|
| `layout` | The layout the page renders with: `layouts/<name>` in the skin. `page` when it has none |
| `order` | Its position in the navigation, see [Pages](#pages) |
| `image` | Its link-preview image: a raster file in the assets (PNG, JPEG, GIF or WebP), such as `/assets/images/setup.png`. An SVG, or any file that isn't one of those (read from its bytes, not its name), is a problem. Without it, `storefront.image` |
| `index` | `false` keeps the page out of search engines: `noindex`, and no sitemap entry |
| `redirectFrom` | Old routes that forward to the page, one or a list: `redirectFrom: [/setup/, /start/]`. See [Redirects](#redirects) |
| any other key | Must be declared by the layout's schema |

`layout`, `order`, `image`, `index` and `redirectFrom` belong to the build: they never reach the layout, and a
layout's schema may not declare any of them.

**The layout's schema is the frontmatter contract.** A layout is a component, and its
`<name>.schema.json` lists the keys a page using it may set (`properties`) and must set (`required`). A
page fails when:

- its `layout` names no layout (the message lists the ones there are)
- a required key is missing
- it sets a key the layout does not declare (with a suggestion for a likely typo)
- a value does not have its declared type. Values are text, read as numbers or booleans only where the
  schema declares `number`, `integer` or `boolean`
- the frontmatter cannot be read: a line that is not `key: value` or a list item, a nested value, a
  duplicate key, an unclosed block or quote

Frontmatter is a small fixed grammar, not full YAML: one level of `key: value` pairs and lists.

### Problems

In `pd dev` a page with a problem is replaced by the list of its problems, every one with its file and
line, and the same lines go to the terminal. Fix the file and the page comes back by itself.

In `pd build` every problem on every page is listed, and **nothing is written**: neither the storefront nor
the workbench snapshot. A page with a problem never reaches a host.

---

## Skins

A skin is what the pages look like: their layouts, the parts the layouts are built from, and their
styles. A skin is written as ordinary components, so the workbench shows and documents every part of it.
It can live in the project's own patterns, or come from a [pattern package](pattern-packages.md):

```ts
export default defineConfig({
  packages: ["@pattern-dump/skin-experimental"],
  storefront: { /* … */ },
});
```

A skin's package can carry everything a skin needs: patterns, styles with their base layer, helpers,
behaviour scripts and assets such as fonts. `pd dev` watches a linked package (a `file:` dependency or a
workspace) like the project's own files, so edits to a linked skin's layouts, partials and styles reload
the open page, and so do its helpers when their module is rebuilt. A copy installed from a registry is not
watched.

### Writing a skin

| Component | Role |
|---|---|
| `layouts/<name>` | A layout a page can choose with `layout: <name>`. Its schema is the frontmatter contract |
| `partials/base` | The frame every layout is built on. Its schema's `site` property declares what `storefront.site` may hold |
| `partials/head` | Optional: what the skin adds to every page's `<head>`, see below |
| `partials/…` | Anything else the layouts include: header, navigation, footer |

**The head.** Pattern Dump writes every page's `<head>`: the title, the description, the search and
link-preview tags ([below](#search-engines-and-link-previews)) and the stylesheets. A skin adds what Pattern
Dump can't know (an icon, a theme colour, a font preload) with a `partials/head` component. It is rendered with
`site`, placed after Pattern Dump's tags and before the stylesheets, and may hold only `<meta>`, `<link>`,
`<script>`, `<style>` and `<noscript>`. It must not write what Pattern Dump writes: `<title>`, a canonical
link, `description`, `robots`, `og:*`, `twitter:*` or JSON-LD, nor `<base>`. Any of those, any other element,
or text, is a problem for every page. Its workbench preview is empty, since everything in it belongs in a
head.

```hbs
<link rel="icon" href="/assets/images/favicon.png">
<meta name="theme-color" content="#1e3c78">
```

A layout receives:

| Value | |
|---|---|
| each declared key | The page's value, or `null` when the page does not set it |
| `body` | The page's markdown, rendered. Include it unescaped, `{{{body}}}`: it is the only value safe to, because the markdown renderer escapes everything an author writes. Every other value is included escaped, `{{…}}` |
| `nav` | The navigation: `{ route, title, description?, current?, children? }` per entry, `current: true` on the page's own entry |
| `site` | The values of `storefront.site` |
| `page` | What the storefront derives for the page, when the layout declares it (below) |

```hbs
{{#> partials-base }}
<article>
  <h1>{{title}}</h1>
  <div class="page-body">{{{body}}}</div>
</article>
{{/partials-base}}
```

A layout's sample data (`<name>.json`) is what its workbench preview shows. It never reaches a page: a
page gets only its own values and the ones above. To keep that true, a sample may only use the keys its
layout declares plus `body`, `nav` and `site`, and the storefront reports any other as a problem.

### What the storefront derives for a page

A layout that declares a `page` property in its schema, with sub-properties, gets those sub-keys of what
the storefront works out for each page, and only those. Each is present, and `null` where there is
nothing. A page cannot set `page`, and a sub-key the storefront does not fill is a problem that names the
ones it does. A sample's `page` may only use the sub-keys the layout declares, and inside them only the
keys below, at any depth.

| `page.…` | |
|---|---|
| `headings` | Every heading of the page's markdown, in order: `{ level, text, anchor }`. `anchor` is the heading's `id`, GitHub's slug of its text (`## Getting started` is `#getting-started`, a second one `#getting-started-1`). A heading whose anchor the layout already uses as an id (`## Main` against `<main id="main">`) gets the next free suffix, `main-1`, and a note says so |
| `section` | The top-level nav entry the page falls under, `{ route, title }`; a top-level page is its own section |
| `breadcrumbs` | Home, then each folder above the page by its `index.md`, as `{ route, title }`; empty on the home page. They reach pages the one-level nav does not list |
| `prev`, `next` | The pages before and after this one in the nav, read entry by entry with each folder's pages after it, across sections; `null` at either end and for a page the nav does not list |
| `created`, `modified` | The page's first and last commit, from git: the author date, ISO 8601. A renamed page keeps the date it was first added |

```hbs
{{#each page.headings}}<a href="#{{anchor}}">{{text}}</a>{{/each}}
{{#if page.next}}<a rel="next" href="{{page.next.route}}">{{page.next.title}}</a>{{/if}}
```

A field named like a helper (`id`, `eq`, …) can never be read by its name, since `{{id}}` calls the
helper: such a schema field is an error, which is why the heading's field is `anchor`.

**Dates.** They are read from git once, the first time a layout that declares them is rendered; a site
whose layouts show no dates never runs git. A page with uncommitted changes has its last commit's dates
(a note in `pd build`). A page git does not know — not committed yet, ignored, or outside any repository —
has `null` for both, with a note. In `pd dev` the dates are as of the first page that asked for them: a new
commit is seen on restart. Two limits:

- **A shallow clone** has only part of the history, so its dates would be wrong, not missing. `pd build`
  refuses to build a page whose layout shows dates from a shallow clone; in CI, check out the full history
  (`fetch-depth: 0` with `actions/checkout`). `pd dev` notes it.
- **A page moved into the pages folder from outside it** counts as created at the move: the history read
  is limited to the pages folder, so that move reads as an add.

### Declared navigations

Besides the nav built from the pages folder, `storefront.site.navigations` holds named lists of links a
skin shows, such as a footer's. Each entry is a page, an external link or a group, and groups nest to any
depth:

```ts
site: {
  navigations: {
    footer: [
      { page: "about.md" },                                   // labelled with the page's title
      { href: "https://github.com/acme/ds", label: "Source" }, // https:, http:, mailto:, or a path from /
      { label: "Guides", children: [{ page: "guides/setup.md" }, { page: "guides/index.md", label: "All guides" }] },
    ],
  },
},
```

The shape is Pattern Dump's, so the skin does not declare it: `partials/base`'s schema only lists the
names it shows, under `site.properties.navigations.properties`, each with a description at most, and
`required` for the ones it needs. A name the skin does not list, a page that is not in the pages folder, an
entry that is none of the three forms or an unknown key is a problem with its place named
(`storefront.site.navigations.footer[2].children[0]`), reported once for the whole site.

A layout gets `site.navigations.<name>` for every name the skin lists, resolved for the page: entries of
`{ label, route }`, `{ label, href }` or `{ label, children }`, with `current: true` on the page's own entry
and `ancestor: true` on every group above it; `null` for a name the config does not set.

The page's `<head>` links the stylesheets of the layout and everything it includes, and the project's
base layer (`documentBase`), which also reaches every preview. It does not link themes: a skin's colours
belong to the skin.

---

## Images

Every raster image on a page (JPEG, PNG, GIF, WebP and the like) is served as WebP variants, a few widths of it,
and the browser picks the one that fits. Every `<img>` carries its width and height, so the page keeps the room
for an image while it loads and doesn't shift when it arrives. Images live in the assets folder; a component and
a page refer to them by their URL there, such as `/assets/images/harbour.jpg`.

There are two ways an image gets onto a page: a component with an image slot, and an image in a page's markdown.

### Image slots

A component declares where an image goes and how wide it is shown, on the string property that holds the image:

```json
{
  "properties": {
    "image": {
      "type": "string",
      "x-pd-image": { "widths": [480, 960, 1600], "sizes": "(min-width: 60rem) 30rem, 100vw" }
    },
    "alt": { "type": "string" }
  }
}
```

`widths` are the variants' widths in pixels, ascending; `sizes` is the `<img>`'s `sizes`: how wide the image is
shown at each viewport. The template writes the image with the `{{pd-image}}` helper:

```hbs
<figure class="slide">{{pd-image image alt=alt}}</figure>
```

```html
<img src="/_pd/images/images/harbour.3f0a9c1d2e.1600.webp"
  srcset="/_pd/images/images/harbour.0b1c2d3e4f.480.webp 480w, … 1600w"
  sizes="(min-width: 60rem) 30rem, 100vw" width="1600" height="1067" alt="…" loading="lazy" decoding="async">
```

- `alt=` is required. A decorative image says so with `alt=""`; a call without `alt=` is a problem in the
  component's schema check, and a missing value when the page renders fails the page.
- `loading="eager"` loads it at once: for the image at the top of a page.
- An image is never made wider than it is: widths above its own are left out.
- An SVG in the assets is written as one file at its own size (from its `width` and `height`, or its `viewBox`).
- `{{pd-image}}` is a Handlebars helper; a Mustache template can't use it.

### Images in a page's markdown

A page's markdown images get the same treatment, in the slot the page's layout declares at the top of its
schema:

```json
{
  "type": "object",
  "x-pd-prose-images": { "widths": [480, 960, 1920], "sizes": "(min-width: 62rem) 60rem, calc(100vw - 2rem)", "eager": 1 }
}
```

```md
![Cable cars against a clear sky](/assets/images/cable-cars.jpg "Optional title")
```

- `sizes` describes the layout's text column. A lazy image is written with `sizes="auto, …"` (below).
- `eager` (optional, default 0): how many of a page's first images load at once, with the declared `sizes` alone.
- Alt text is required: a markdown image with an empty alt is a problem, since markdown can't tell a decorative
  image from a forgotten description. A decorative image goes in through a component, with `alt=""`.
- An SVG from the assets is written at its own size and needs no slot. A raster image on a page whose layout
  declares no slot is a problem that names the layout.
- An image from another site is written as markdown writes it, and has no size (see the checks below): host it in
  the assets instead.

### `sizes="auto"`

A lazy image's `sizes` starts with `auto`: the browser chooses the variant for the width the image is actually laid
out at, so it never fetches more than the column needs. Chrome and Edge (126 and later) and Firefox (150 and later)
support it; other browsers skip `auto` and use the sizes after it, so those must still be right.

### The skin's image rule

The width and height attributes set an image's aspect ratio. To let it shrink with its column while keeping that
ratio, a skin needs this rule (the `pd init --storefront` skin has it):

```css
img { max-inline-size: 100%; block-size: auto; }
```

### The image checks

Every `<img>` on an assembled page, whether from the page, a component it places, its layout or a partial, is
checked:

| Check | `pd build` | `pd dev` |
|---|---|---|
| An `<img>` without both a `width` and a `height`, external images too | A problem: nothing is written | A warning in the terminal; the page is served |
| A raster file not served as WebP variants (`src` or `srcset`), such as a hand-written `<img src="/assets/images/logo.png">` | A problem, naming the file and the fix: `{{pd-image}}` in a template, or a markdown image in a page | A warning |

Not checked: SVG files, `og:image` and `twitter:image` (the link-preview image stays the original file), icons
(`<link rel="icon">`), and images in stylesheets (`url()`). An image from another site can't be converted;
`pd build` names each one in its report's notes.

### Encoding and the cache

Variants are encoded with [sharp](https://sharp.pixelplumbing.com/), which Pattern Dump installs with its
prebuilt binaries. Each variant is encoded the first time it is asked for and kept in
`node_modules/.cache/pattern-dump/images/`; a full `pd build` removes the ones no page uses any more. The quality
and effort are set by `images` in the config, and a site can override them with `storefront.images`
([Configuration](configuration.md)).

When sharp can't be loaded (an install with `--omit=optional` leaves its binaries out), `pd dev` shows the
original images at their size and says so once, and `pd build` stops with the error, since every image it writes
must be encoded.

---

## Search engines and link previews

**The site's address.** `storefront.url` is where the site will be hosted, such as `https://example.com/`
(an origin: the storefront is served from the root of its host). With it, every page carries:

- a canonical URL, and `og:url`
- Open Graph (`og:type`, `og:site_name`, `og:title`, `og:description`, `og:image` with its width and height)
  and a Twitter card, large when the page has an image
- one JSON-LD graph: the `WebSite`, the `WebPage` with its last change from git (`dateModified`), and a
  `BreadcrumbList` from Home down to the page

and `pd build` writes `sitemap.xml`. Without it, those are left out and `pd build` says so once. In `pd dev`
the same tags carry the address the browser is on. Every page has `<html lang>` from `storefront.lang`
(default `en`).

**Images.** A page's image is its `image`, else `storefront.image`. Link previews show raster images only, so
an image must be a PNG, JPEG, GIF or WebP file in the assets.

**Keeping pages out.** `index: false` on a page gives it `noindex` and leaves it out of the sitemap.
`storefront.index: false` does that for the whole site, for a staging site: `robots.txt` then disallows
everything and there is no sitemap.

**`sitemap.xml`** lists every page in route order, except those with `index: false`, the 404 page and the
redirect pages, each with a `lastmod` where git has a reliable date. A page with uncommitted changes has its
last commit's date. From a shallow clone the dates would be the clone's boundary, so the sitemap and the
JSON-LD leave them out and the build notes it once (in CI, check out with `fetch-depth: 0`). A layout that
*shows* dates still fails the build there.

**`robots.txt`.** Both output roots get one. The storefront's keeps crawlers out of `/preview/` (the live
examples: component demos, not pages) and names the sitemap. The workbench's keeps them out of its
previews only; the workbench itself stays searchable. A workbench on the storefront's own host
([below](#building)) has its previews kept out by the storefront's `robots.txt` too
(`Disallow: /workbench/preview/`), since crawlers read only the one at the host's root. Two limits:

- `Disallow` stops crawling, not indexing: a preview someone links to from elsewhere can still appear in
  results as a bare address, with no description. A crawler also never fetches the examples a page embeds,
  so their text doesn't count toward the page.
- Crawlers read `robots.txt` only at a host's root. A workbench built with `--base` for a host of its own
  writes it to its own root, so copy its rule into the `robots.txt` that host serves at `/` (the build says
  so). On the storefront's host there is nothing to copy.

### The 404 page

`pages/404.md` is the site's 404 page: rendered through its layout like a page, but not one of the site's
pages (not in the navigation, the sitemap or the pages list), with `noindex` and no canonical, Open Graph or
JSON-LD. Without one, a built-in page goes through the default layout (`layouts/page`). `pd build` writes it to
`404.html`, which GitHub Pages and most static hosts serve for every missing address; `pd dev` serves it the
same way, with status 404. Since it is shown at every depth, every URL in it (its own, its layout's and the
head's) must be root-relative (`/…`) or absolute: a relative one is a problem.

### Redirects

When a page moves, list its old routes in `redirectFrom`. Each old route gets a page that forwards to the new
one at once (`<meta http-equiv="refresh">`, which search engines take as a permanent redirect), names it as
canonical, and is never indexed. This works on any static host, GitHub Pages included. An old route must
start and end with `/`, and must not be a page, be claimed by two pages, or lie under `/preview/`, `/_pd/`,
`/assets/`, `/api/` or `/source/`, nor under the path of a workbench on the same host. No page may be there
either: the workbench would take its place.

## Hosts in `pd dev`

One `pd dev` serves both front ends, telling them apart by the host name, and prints the two addresses
to open when it starts:

```
[dev-server] Listening at http://127.0.0.1:4000
[dev-server] Website:   http://live.localhost:4000/
[dev-server] Workbench: http://pd.localhost:4000/
```

| Address | Serves |
|---|---|
| `http://live.localhost:<port>/` | The storefront (`storefront.host` changes the name) |
| `http://pd.localhost:<port>/` | The workbench |
| `http://localhost:<port>/` | The workbench, as without a storefront |

`pd dev` answers only to these names (and `127.0.0.1`) at its own port: a request for any other host name
gets `403`, and the live-reload connection accepts only pages served from them. Without a storefront,
`live.localhost` is not one of them.

Edits to pages, layouts, partials, styles, global data, assets and helper modules reload the open page.
Restart after changing the config. A problem that stops a reload (data that is not valid JSON, a helper
that does not load or register) is listed in a notice on the open page and in the terminal; the page keeps the last good
version until the file is fixed.

### Browsers

`pd dev` listens on `127.0.0.1` only, and the two host names have to reach it there. Checked so far:
Chromium and Playwright's WebKit 26.4 reach all three addresses. Installed Firefox and Safari have not
been checked by hand yet.

The known risk is Safari. Chromium and Firefox resolve `*.localhost` names themselves; Safari asks the
system, and macOS answers `live.localhost` with the IPv6 address `::1` first. If Safari does not fall back
to `127.0.0.1`, the storefront address does not load. The workaround is an entry in `/etc/hosts`:

```
127.0.0.1  live.localhost pd.localhost
```

(with your `storefront.host` in place of `live.localhost` if you set one). This concerns `pd dev` only: a
built site is plain files on a host of its own, with no `*.localhost` name involved.

---

## Building

`pd build` writes two folders, each for its own host:

| Folder | Holds |
|---|---|
| `build.outDir` (or `--out`) | The workbench snapshot, exactly as a build without a storefront writes it ([static-build.md](static-build.md)) |
| `storefront.outDir` | The storefront: one `index.html` per page, plus everything the pages use |

The storefront folder has its own copy of every preview its pages show and of every stylesheet, script,
font and image they reference, so it is complete on its own. It is served from the root of its host. A
page built here is the same page `pd dev` serves, apart from the live-reload script and the address of the
workbench links.

```
site/
  index.html  about/index.html  guides/index.html  guides/setup/index.html
  404.html                                          the 404 page
  setup/index.html  start/index.html                pages that forward from old routes
  robots.txt  sitemap.xml                           for crawlers (the sitemap with storefront.url)
  preview/components/callout/index.html            the previews the pages show
  _pd/  assets/                                    what pages and previews reference
  .nojekyll
```

`storefront.workbenchUrl` is required to build, since built pages link to the workbench at its own address.

### The link check

Before it writes anything, `pd build` checks every link on every page of the site (its pages and its 404 page),
and stops if one is broken: every `href`, `src` and `srcset` of every element must lead to something the build
writes.

- A path leads to a page (`/guides/setup/`, with or without its trailing slash, or as its `index.html`), to a page
  that forwards from an old route (`redirectFrom`), or to a file (a stylesheet, an image, a preview).
- A `#fragment` leads to an element with that `id` in the target page. Headings carry their anchors as ids, so a link
  to a heading is checked too.
- A URL on the site's own address (`storefront.url`) is checked as its path.
- A link into the workbench (`storefront.workbenchUrl`) leads to a component, a folder or a component's variants
  page the workbench snapshot has; its `#fragment` names one of the component's variants.
- A link to another site is not fetched: the build lists each one in its notes, with the pages that use it.
  `mailto:` and `tel:` links are left alone.

```
pd build: the storefront has broken links, so nothing was written:
  - /guides/: <a href="/guides/instal/">: no page or file is built at /guides/instal/
  - /about/: <a href="/guides/setup/#instal">: /guides/setup/ has no element with id "instal"
```

Code examples are text, so a link written in one is not checked. In `pd dev`, a page's links to pages that don't
exist and to anchors it doesn't have are warnings in the terminal; the full check runs in `pd build`.

### The accessibility check

After the link check, `pd build` checks every page of the site (not the previews or the pages that forward from old
routes) with [axe](https://github.com/dequelabs/axe-core), the WCAG 2.x A and AA rules and axe's best practices:

- **Errors stop the build:** a WCAG rule axe rates critical or serious (an image without alt text, a button with no
  name, a page without a language), and a page that doesn't have exactly one main landmark (`<main>`) and exactly one
  `<h1>`.
- **Warnings are listed in the report**, one line per rule with the pages it is found on: a WCAG rule rated moderate
  or minor, and every best-practice rule (headings that skip a level, content outside any landmark).

```
pd build: the storefront has accessibility problems, so nothing was written:
  - /about/: image-alt (critical): Images must have alternative text, on img (https://dequeuniversity.com/rules/axe/…/image-alt)
  - /guides/: the page has 2 <h1> headings: one names the page, the others are <h2> or lower
```

The check runs without a browser, so it leaves out what only a rendered page can tell: colour contrast, and axe's
rules that need layout (`--browser`, below, runs those). The project's own [`pd audit`](cli.md) checks each component
on its own; this check is the assembled page. In `pd dev`, a page without one `<main>` and one `<h1>` is a warning in
the terminal.

### Checks in a browser: `pd build --browser`

`pd build --browser` also opens every page of the site in Chromium, at 1000 × 720 and at 390 × 844 with a pixel ratio
of 2, before anything is written:

- **Accessibility:** axe's rules that need a rendered page: colour contrast, one main landmark and one `<h1>` as axe
  sees them, and the rest the check without a browser leaves out. A critical or serious finding stops the build, as
  above (contrast failures among them); the others are warnings.
- **Image sizes:** every image with variants is brought into view and compared with the box it is laid out in. A
  warning names an image that takes a variant too small for its box while a larger one exists (it shows soft), or a
  larger variant than the box needs (it downloads more than it shows). Either means the slot's `sizes` doesn't
  describe the layout:

```
[pd build]   warning: /guides/: the image images/cable-cars is laid out 396 px wide (396 px at 1x) but takes the 320w
  variant, which is too small: its sizes, "(max-width: 40rem) 33vw, 19rem", says it is narrower than it is (at 1000×720)
```

It uses the project's own [Playwright](https://playwright.dev); Pattern Dump doesn't install a browser. Without it,
the build stops at once and says what to install:

```bash
npm install --save-dev playwright
npx playwright install chromium
```

A page is fetched from the build itself, never from the network: images and fonts from other sites are not loaded.

**The workbench on the storefront's host.** One host can serve both: the website at its root and the
workbench under a path. Set `workbenchUrl` to that path and build the workbench for it:

```ts
export default defineConfig({
  // …
  storefront: { pagesDir: "./pages", outDir: "./site", workbenchUrl: "/workbench/" },
  build: { basePath: "/workbench/" },
});
```

`pd build` still writes two folders. Publish the storefront's at the host's root and the workbench's inside
it at `/workbench/`; on GitHub Pages the workflow copies one into the other before it uploads them, as
`pd init --storefront`'s does. Then:

- the storefront's `robots.txt` also keeps crawlers out of the workbench's previews;
- no page or `redirectFrom` may be at or under `/workbench/`, since the workbench would overwrite it there;
- the build refuses to make the workbench for another base path than `workbenchUrl`'s (`build.basePath`,
  or `--base`): its pages would link to a workbench that isn't there.

An absolute `workbenchUrl` on the origin of `storefront.url` (`https://example.com/workbench/` with
`url: "https://example.com/"`) counts as the same host too.
