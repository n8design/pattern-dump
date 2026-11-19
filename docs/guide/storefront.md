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
npx pattern-dump init my-site --with-site
```

It brings two pages, a small skin, one component the home page shows (in a live example and placed with a
`pd-` tag), and a GitHub Pages workflow that publishes the website with the workbench under `/workbench/`
([cli.md](cli.md#pd-init)). Its README says how to publish it.

To add a storefront to a project you have, add a `site` block to the config ([configuration.md](configuration.md#site)):

```ts
export default defineConfig({
  // …
  site: {
    pagesDir: "./pages",
    outDir: "./site",
    workbenchUrl: "https://workbench.example.com/",
    globals: { title: "Acme Design System", footer: "© Acme" },
  },
});
```

Then write the pages, and give the project a skin: the layouts the pages render with. Either use a skin
from a [pattern package](#skins), or write your own [layouts and partials](#writing-a-skin).

```bash
npx pd dev     # the storefront at http://live.localhost:4000/, the workbench at http://pd.localhost:4000/
npx pd build   # the workbench snapshot in outDir, the storefront in site.outDir
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
- **Adding a page is adding a file.** A top-level page, or a page one folder deep, appears in the navigation
  with no other change; a page deeper than that is reached by its links, since the navigation is one level deep.
  A page that should be reachable but not listed, such as a credits or legal page linked from the footer, sets
  `nav: false`: it is left out of the navigation and of `prev` and `next`, and is still a page like any other,
  rendered, searchable, in the sitemap and `llms.txt`, and reached by its links. On a folder's `index.md` it
  leaves out the folder's entry, and the folder's pages with it.

`pagesDir` is not the same as a `pages` folder among the patterns, such as `src/patterns/pages/` in `pd init`'s
starter components: that is the page level of atomic design, page-sized components shown in the workbench,
while `pagesDir` holds the website's pages.

The navigation is built from the folder, one level deep: the top-level pages and folders, and each
folder's pages beneath it. `order` sorts them, with the same meaning as for components
([authoring.md](authoring.md#order)): a number among siblings, and in the top `index.md` or a folder's
`index.md`, optionally a list of names.

A page's markdown is the same markdown as component docs, with the same safety rules: raw HTML in a page
is shown as text, not run.

### Definition lists

For a list of terms and what is said about each (the keys of a configuration, say), write a definition list: the
term on its own line, then each definition on a line of its own starting with `:` (or `~`) and a space. A term can
have several definitions.

```md
outDir
: A string. The only required top-level key.
: The folder `pd build` writes the workbench to.

patternsDir
: A string. Default `<sourceDir>/patterns`.
```

renders as

```html
<dl>
<dt>outDir</dt>
<dd>A string. The only required top-level key.</dd>
<dd>The folder <code>pd build</code> writes the workbench to.</dd>
<dt>patternsDir</dt>
<dd>A string. Default <code>&lt;sourceDir&gt;/patterns</code>.</dd>
</dl>
```

- With a blank line between a term and its definitions, each definition is a paragraph: `<dd><p>…</p></dd>`.
- A definition can hold more than one block (further lines indented, a list, a code block), and a component placed
  with a `pd-` tag.
- The same syntax works in a placed component's markdown content and in component docs.
- A term is not a heading: it gets no anchor and is not in the table of contents.
- The elements have no classes: the skin styles `dl`, `dt` and `dd` in its document base, as it styles `ul` and `p`.
- A listing's teaser (a page's first paragraph, when it has no description) never comes from a definition list.

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
build, `site.workbenchUrl`). With JavaScript off, the frame keeps the browser's default height (or the
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

#### The theme of an example

A site's light and dark belong to its skin, not to the workbench's themes (see [Writing a skin](#writing-a-skin)).
An example is a preview, though, and a preview is drawn in one of the workbench's themes: the default one,
`themes.default`. So that an example matches the page around it, the page carries its own theme into its examples:

- The page's theme is the `data-theme` attribute of its `<html>`, or of its `<body>` when `<html>` has none: where
  a skin's light and dark toggle writes it.
- **The values must be the names of the workbench's themes.** A page with `data-theme="dark"` gives its examples
  the theme `dark`, if the project has one. Any other value, or none, leaves each example in the default theme.
- The examples change with the page: when the toggle changes the page's `data-theme`, every example on the page
  follows.
- With themes that switch by stylesheet (`themes.switch: "stylesheet"`), each example loads the page theme's
  stylesheet instead of the default one.

A toggle sets `color-scheme` with its attribute, so the page's code follows it too ([Code colours](#code-colours)).

Without JavaScript an example stays in the default theme. For a site that follows the viewer's light or dark
setting, make the default theme follow it too, with `color-scheme: light dark`:

```scss
// themes/system.theme.scss, with themes.default: "system"
[data-theme="system"] {
  color-scheme: light dark;
}
```

Its examples then follow the viewer with or without JavaScript, as the page does. `pd init --with-site` sets this
up unless given `--no-system-theme`: a `system` theme as the default, and the skin's own colours
(`src/styles/base/colors.scss`) following the viewer too.

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
a variant is `pd-components-note~warning`. A variant's values are checked against its own `.schema.json`, else its
base's, and it brings the data that makes it the variant: each key the tag leaves unset whose value in
`note~warning.json` differs from `note.json` (`tone: warning`), while sample text the two share stays out; the tag's
own values win. A required key the variant brings counts as given, so `<pd-components-note~warning>` needs no
`heading` when `note~warning.json` sets one; a required key that the variant's data leaves out, or shares with the
base's, is still the tag's to set. The component renders into the page, with its stylesheet linked in the page's
head, so the page's own styles also reach it.

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
| `layout` | The layout the page renders with: `layouts/<name>` in the skin. Without it, its folder's `childLayout`, else `page`. See [A folder's default layout](#a-folders-default-layout) |
| `childLayout` | On a folder's `index.md` only: the layout of the pages under it that name none. See [A folder's default layout](#a-folders-default-layout) |
| `order` | Its position in the navigation, see [Pages](#pages) |
| `nav` | `false` leaves the page out of the navigation (`nav`, and its folder's `children`) and out of `prev` and `next`, its own and its neighbours'. It still renders, and stays searchable and in the sitemap and `llms.txt`. On a folder's `index.md`, the folder's entry and its pages are left out. `true`, the default, lists it. The layout's `nav`, the navigation itself, is filled as before. See [Pages](#pages) |
| `image` | Its link-preview image: a raster file in the assets (PNG, JPEG, GIF or WebP), such as `/assets/images/setup.png`. An SVG, or any file that isn't one of those (read from its bytes, not its name), is a problem. Without it, `site.image` |
| `index` | `false` keeps the page out of search engines: `noindex`, and no sitemap entry |
| `redirectFrom` | Old routes that forward to the page, one or a list: `redirectFrom: [/setup/, /start/]`. See [Redirects](#redirects) |
| `date` | The page's date, a real calendar date written `YYYY-MM-DD`: what a listing sorts and shows, and its JSON-LD `datePublished`. Without it, the day git first saw the page. A date after today holds the page back from `pd build` until that day, see [Scheduled pages](#scheduled-pages). See [Collections](#collections) |
| `updated` | The page's last real change, `YYYY-MM-DD`, set by its author: not before `date`. The only "last changed" date a reader or a search engine sees, see [Dates](#dates) |
| `tags` | One tag or a list, each lowercase letters, digits and hyphens, none twice: `tags: [css, design-systems]`. When the config declares tags (`site.tags`), each is a declared one (or an old key of one). See [Tags](#tags) |
| `categories` | One category or a list, each declared in `site.categories` (or an old key of one), none twice: `categories: [guides]`. See [Categories](#categories) |
| `draft` | `true` shows the page in `pd dev` and leaves it out of `pd build`. See [Drafts](#drafts) |
| `sort` | On a folder's `index.md` only: `date` lists the folder's pages newest first; `order`, the default, in the folder's order |
| `view` | On a folder's `index.md` only: the view its listing is shown in, `views/<name>` in the skin. See [Listing views](#listing-views) |
| `toc` | `true` shows the table of contents in its region; `false` keeps it out, whatever the layout says. See [The table of contents](#the-table-of-contents) |
| any other key | Must be declared by the layout's schema |

`layout`, `childLayout`, `order`, `image`, `index`, `redirectFrom`, `date`, `updated`, `tags`, `categories`, `draft`,
`sort`, `view` and `toc` belong to the build: they never reach the layout as keys of their own, and a layout's schema may not declare any of
them (a layout shows them through `page.date`, `page.updated`, `page.tags` and `page.categories`). `nav: true` or
`false` belongs to the build as well; the layout still gets `nav`, the navigation, and may declare it.

**The layout's schema is the frontmatter contract.** A layout is a component, and its
`<name>.schema.json` lists the keys a page using it may set (`properties`) and must set (`required`). A
page fails when:

- its `layout` names no layout (the message lists the ones there are)
- a required key is missing
- it sets a key the layout does not declare (with a suggestion for a likely typo)
- a value does not have its declared type. Values are text, read as numbers or booleans only where the
  schema declares `number`, `integer` or `boolean`
- the frontmatter cannot be read: a line that is not `key: value` or a list item, a value nested deeper
  than one level, a duplicate key, an unclosed block or quote
- keys indented under a key that is not one of the layout's [queries](#queries)

Frontmatter is a small fixed grammar, not full YAML: `key: value` pairs and lists, and, for a query's options only,
one level of keys indented under a key.

### A folder's default layout

With many pages in a folder, `childLayout` on its `index.md` saves writing `layout:` on each, and a forgotten line
can no longer give a page the wrong layout:

```md
---
title: Articles
layout: listing
childLayout: article
---
```

- **A page without its own `layout:`** takes the `childLayout` of the nearest folder above it that sets one; without
  any, `page`. Its own `layout:` always wins.
- **A folder's `index.md` is a page of its parent folder:** its own `childLayout` is for the pages under it, and it
  takes its layout from its parent's, as any page there does.
- **Checked:** a `childLayout` that names no layout fails on the `index.md`, at its line, and on every page that
  takes it. Each page is checked against the schema of the layout it ends up with, and a problem about that layout
  names where it came from: `"subtitle" is required by layout "article" (the childLayout of articles/index.md)`.
- `404.md` is not a page of the site, so it takes no `childLayout`.
- For any other key, see [A folder's defaults](#a-folders-defaults); `childLayout` is its short form for the layout.

**Which layout a page got:** in the workbench, a layout's Relationships tab lists its **Pages**, each with where its
layout came from ("its own layout", "childLayout of articles/index.md", "the default layout"). `/api/pages` on the
website's host gives each page's `layout`, and `layoutFrom` when it came from a folder.

### A folder's defaults

`childLayout` sets one key for a folder's pages. `childDefaults` sets any of them, written as a page writes its
frontmatter, indented under the key:

```md
---
title: Services
childDefaults:
  layout: service
  audience: business
  tags: [consulting]
  related:
    collections: [episodes]
    limit: 2
---
```

Every page under `services/` now has the `service` layout, `audience: business`, the tag `consulting` and those two
options for its `related` query, without writing them.

- **A page's own value always wins**, key by key, and option by option for a query: a page that writes
  `related:` with `  limit: 4` gets `limit: 4` and the folder's `collections`.
- **The nearest folder wins**, key by key. `services/europe/index.md` can set `related:` with `  limit: 3`; its
  pages then get `limit: 3` from it and `collections` from `services/`.
- **A list is replaced, never joined.** With `tags: [guide]` in the folder and `tags: [setup]` on the page, the
  page's tags are `[setup]` only. Write every tag a page should have on the page when it differs from its folder's.
- **For the pages under the folder:** its own `index.md` takes its parent's defaults, as with `childLayout`.
  `404.md` and the tag and category pages take none.
- `layout` in `childDefaults` is `childLayout` written the long way. Use one: both on one `index.md` is a problem.
- **What can't be a default:** what names one page (`title`, `order`, `redirectFrom`, `date`, `updated`), what
  belongs to a folder's own `index.md` (`sort`, `view`, `childLayout`, `childDefaults`), and what the storefront
  fills (`body`, `site`, `page`). Each is a problem on the `index.md`, at its line. `nav: false` can be a default:
  it leaves the folder's pages out of the navigation, and not the `index.md` itself.
- **Checked as if the page had written it.** Each page is checked against the layout it ends up with, its folder's
  values included, so a default its layout doesn't declare is a problem on that page. A problem about a value a
  folder set names the page and where the value came from:

  ```
  services/web.md (from the childDefaults of services/index.md, line 9): limit "two" is not a number of pages: a whole number from 1, such as 3
  ```

  The values that can be checked without a page (`tags`, `categories`, `draft`, `index`, `toc`, `image`, `layout`)
  are also checked on the `index.md`, so a folder with no pages yet is checked too.
- **`draft: true` as a default** keeps every page under the folder out of `pd build`. So that a forgotten line can't
  hide a section without a word, the build says so per folder:

  ```
  [pd build] drafts: 12 left out (...)
  [pd build]   12 pages are drafts via the childDefaults of services/index.md
  ```

`/api/pages` on the website's host gives each page `defaultsFrom`: the keys it took from a folder, each with that
folder's `index.md` (a query's options one by one, `"related.limit"`).

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
  site: { /* … */ },
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
| `layouts/<name>` | A layout a page can choose with `layout: <name>`. Its schema is the frontmatter contract. A page or template pattern can be a layout too ([below](#a-page-or-template-as-a-layout)) |
| `partials/base` | The frame every layout is built on. Its schema's `site` property declares what `site.globals` may hold |
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

**The site's own head.** A site whose skin is a shared package can't change the skin's `partials/head`, and
some head content is the site's, not the skin's: an analytics script, a search engine's verification tag. Name a
Handlebars file of the site's in the config:

```ts
site: { …, head: "./head.hbs", site: { analyticsKey: "…" } },
```

```hbs
<meta name="google-site-verification" content="…">
<script defer src="https://analytics.example.com/script.js" data-key="{{site.analyticsKey}}"></script>
```

It is rendered with `site` (plain Handlebars: `{{#if}}`, `{{#each}}` and the like, not Pattern Dump's helpers) into
every page's head, after the skin's `partials/head` and before the stylesheets, and checked the same way: the same
elements only, none of those Pattern Dump writes. An edit to it shows when the page is loaded again.

**Behaviour scripts.** A page loads the scripts its components bring, as their workbench previews do: the
project's `globalScripts`, then every `requireScript` of its layout's components (the header's, a partial's) and
of each component it places with a `pd-` tag, each once, as module scripts after its stylesheets. A layout doesn't
need a `<script>` tag of its own for them. A live example (a fenced `pattern` block) is a preview in a frame and
loads its own.

```hbs
<link rel="icon" href="/assets/images/favicon.png">
<meta name="theme-color" content="#1e3c78">
```

A layout receives:

| Value | |
|---|---|
| each declared key | The page's value, or `null` when the page does not set it |
| `body` | The page's markdown, rendered. Include it unescaped, `{{{body}}}`: it is the only value safe to, because the markdown renderer escapes everything an author writes. Every other value is included escaped, `{{…}}`. A layout can name another key for it ([below](#a-page-or-template-as-a-layout)) |
| `nav` | The navigation: `{ route, title, description?, current?, children? }` per entry, `current: true` on the page's own entry. A page with `nav: false` in its frontmatter is not in it |
| `site` | The values of `site.globals` |
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

In the workbench a layout fills the Stage, like a page or a template, so its `index.md` needs no
`preview: full`. See [Preview layout](authoring.md#preview-layout) for overriding it.

### A page or template as a layout

A design system's page and template patterns are often what a site's layouts should be. Instead of a copy under
`layouts/`, mark the pattern as a layout in its schema:

```json
{
  "x-pd-layout": "case-study",
  "x-pd-content": "content",
  "required": ["title"],
  "properties": {
    "title": { "type": "string" },
    "client": { "type": "string" },
    "content": { "type": "string", "contentMediaType": "text/markdown" }
  }
}
```

A page then names it as any layout, `layout: case-study` (or through `childLayout` and `childDefaults`), and its
schema is the page's frontmatter contract.

- **Only in `pages/` and `templates/`** (numbered folders count: `04-templates`). `x-pd-layout` on any other
  pattern is an error on that pattern, and it makes no layout. A `layouts/` component is already a layout by its
  folder; `x-pd-layout` there is an error too.
- **The name** is lowercase letters, digits and hyphens, as a `layouts/` folder's.
- **One name, one layout.** Two patterns marked with the same name, or a marked pattern and a `layouts/` component
  of that name, are an error that names both files, on both and on every page that asks for the name; the name is
  no layout until one is renamed.
- **Where the markdown goes:** into the property `x-pd-content` names, which must be a string with
  `"contentMediaType": "text/markdown"`. Write it unescaped in the template (`{{{content}}}`). Without `x-pd-content`
  it is `body`, as for any layout. A page can't set that property, and the layout's `required` doesn't ask it of the
  page. `x-pd-content` works the same on a `layouts/` layout.
- **The keys a page sets for the build** (`image`, `date`, `tags` and the rest) can't be the layout's own, as for any
  layout: a template that declares one is refused until it renames it.
- Its sample data (`<name>.json`) stays its workbench render, and the checks above for a layout's sample data apply
  to it from then on.

**A read-only design system** (one read through `--root`, or a package you don't edit) can't be marked. There, a
`layouts/` (or your own `templates/`) pattern that includes it stays the way: `{{> templates-article }}`, with a
schema that declares what the template takes. Resolving `$ref` and `allOf` in schemas, so such a wrapper's schema
could refer to the original instead of repeating it, is not supported yet.

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
| `prev`, `next` | The pages before and after this one in the nav, read entry by entry with each folder's pages after it, across sections; `null` at either end and for a page the nav does not list, such as one with `nav: false`. A page with `nav: false` is no one's `prev` or `next` |
| `created` | The page's first commit, from git: the author date, ISO 8601. A renamed page keeps the date it was first added |
| `updated` | The page's `updated`, `YYYY-MM-DD`, else `null`. Never git's last commit, see [Dates](#dates) |
| `children` | On a folder's `index.md`: the folder's pages, an entry each, sorted as its `sort` says (see [Collections](#collections)); `[]` on any other page |
| `date` | The page's `date`, else the day git first saw it (`YYYY-MM-DD`), else `null` |
| `tags` | The page's tags, in its order, each `{ key, label, description, route }` (see [Tags](#tags)), else `[]` |
| `categories` | The page's categories, in its order, each `{ key, label, description, route }` (`description` `null` when the config gives none, `route` the category's page or `null`), else `[]` |
| `term` | On a tag or category page: the tag or category, `{ key, label, description, route, count }` (see [Tag and category pages](#tag-and-category-pages)), else `null` |
| `terms` | On the index of the tags or the categories: every one with a page, by label, each as `term`, else `null` |
| `listing` | On a folder's `index.md`: the folder's pages rendered through the view its `view:` names, as HTML for `{{{page.listing}}}` (see [Listing views](#listing-views)); `null` on any other page |

```hbs
{{#each page.headings}}<a href="#{{anchor}}">{{text}}</a>{{/each}}
{{#if page.next}}<a rel="next" href="{{page.next.route}}">{{page.next.title}}</a>{{/if}}
```

A field named like a helper (`id`, `eq`, …) can never be read by its name, since `{{id}}` calls the
helper: such a schema field is an error, which is why the heading's field is `anchor`.

#### Dates

A page has three dates, and only the author sets the two a reader or a search engine sees as changes:

- **`date`**, the publication date: `page.date`, a listing's date, `datePublished` and `article:published_time`.
  Without it, the day git first saw the page.
- **`updated`**, the last real change: `page.updated`, JSON-LD `dateModified`, `article:modified_time` and the
  sitemap's `lastmod` (which falls back to `date`). Without it, there is no "last changed" date anywhere.
- **`page.created`**, the page's first commit, from git.

Git's last commit is not used for any of them: a typo fix or a reformat moves it, and readers and search engines
would take that for new content. `page.modified`, which carried it, is no longer filled; a layout that declares it
is told to declare `page.updated` instead.

Git is read once, the first time a page needs its first commit (a layout that declares `page.created`, a page with
no `date` in a listing or in its JSON-LD); a site that needs none never runs git. A page with uncommitted changes
has its last commit's history (a note in `pd build`). A page git does not know (not committed yet, ignored, or
outside any repository) has `null`, with a note. In `pd dev` the history is as of the first page that asked for
it: a new commit is seen on restart. Two limits:

- **A shallow clone** has only part of the history, so its dates would be wrong, not missing. `pd build`
  refuses to build a page whose layout shows dates from a shallow clone; in CI, check out the full history
  (`fetch-depth: 0` with `actions/checkout`). `pd dev` notes it.
- **A page moved into the pages folder from outside it** counts as created at the move: the history read
  is limited to the pages folder, so that move reads as an add.

### Regions

A layout can have regions besides the body: places, such as a sidebar, that a page's placed components go into. A page
with nothing for a region has an empty one, so the layout leaves it out: the sidebar is there or not by what the page
holds.

**A layout declares them** on `page.regions` in its schema, and writes each where it wants it:

```json
"page": { "properties": { "regions": { "x-pd-regions": ["sidebar"], "x-pd-toc": true } } }
```

```handlebars
{{#if page.regions.sidebar}}<div class="doc-sidebar">{{{page.regions.sidebar}}}</div>{{/if}}
```

- `page.regions.<name>` is the region's HTML, or null when the page puts nothing there.
- `x-pd-toc` (optional) shows the [table of contents](#the-table-of-contents) on the layout's pages.
- **CSS is told what is filled:** a page whose layout declares regions names the filled ones on its `<body>`,
  `<body data-pd-regions="sidebar">` (empty when none), so a skin switches its grid without `:has()`:

  ```css
  body[data-pd-regions~="sidebar"] .doc { grid-template-areas: "content sidebar"; }
  ```

**A component goes into a region** by its tag, `region="sidebar"` on the `pd-` tag, or by its default, `"x-pd-region":
"sidebar"` at its schema's root. The tag wins. Inside a region, components keep the page's order, and each is checked
against its schema wherever it ends up.

- A region another layout of the skin has, and this page's layout doesn't: the component is left out, with no
  message. Some layouts have a sidebar, some don't.
- A region no layout of the skin declares stops the page, with a "did you mean".
- `region` on a tag is Pattern Dump's: a component whose schema declares a `region` property can't be placed with it.

**The layout's own landmarks are not regions:** `header`, `footer`, `nav` and `main` (the body itself). A layout may use
them as grid-area names for its own markup, but declaring one as a region stops its pages, and so does a tag or a
default region naming one (the message lists the regions the layout offers). A component in a region may not bring a
landmark of its own either: a `<main>`, or a `<header>` or `<footer>` outside `article`, `aside`, `nav` and `section`
(a banner or contentinfo). axe still checks the page's landmarks as a whole.

### The table of contents

The table of contents is the skin's `components/toc`, given `items: [{ text, href, level }]`. Its schema's
`x-pd-region` says which region it goes into.

- `toc: true` in a page's frontmatter, or `x-pd-toc` on its layout, shows it with the page's headings of level 2 and 3,
  first in its region. `toc: false` keeps it out. A page with no such heading gets none.
- `<pd-toc></pd-toc>` in the markdown places it where the tag is, or in its region, with the same items. With a list of
  links inside, it shows those instead, the nesting giving the level:

  ```md
  <pd-toc>
  - [Install](#install)
    - [Options](#options)
  - [About](/about/)
  </pd-toc>
  ```

  Each item is one link. An `#anchor` must be a heading of the page (as it finally is, a suffixed anchor included),
  or the page stops with a "did you mean"; any other link is checked by the link check, as everywhere. A page with a
  `<pd-toc>` gets no derived one besides.
- Asking for it without a `components/toc` in the skin is a problem naming it.

The starter (`pd init --with-site`) has a `doc` layout with a sidebar that collapses to one column when it is empty,
and a `components/toc`: the about page uses `toc: true`, the guide lists its own links, and the search page has
neither.

### Declared navigations

Besides the nav built from the pages folder, `site.globals.navigations` holds named lists of links a
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
(`site.globals.navigations.footer[2].children[0]`), reported once for the whole site.

A layout gets `site.navigations.<name>` for every name the skin lists, resolved for the page: entries of
`{ label, route }`, `{ label, href }` or `{ label, children }`, with `current: true` on the page's own entry
and `ancestor: true` on every group above it; `null` for a name the config does not set.

### Collections

A folder of pages is a collection: its `index.md` can list the folder's pages, and any page can show them.

```
pages/articles/index.md       layout: listing, sort: date
pages/articles/first-post.md  date: 2026-11-02, tags: [css]
```

**On the folder's own page.** A layout that declares `page.children` gets the folder's pages: its direct pages
and each subfolder (by its `index.md`), as on the nav. `sort: date` on the `index.md` puts the newest first,
pages with the same date by their route; without it they come in the folder's order (`order`). Each entry
has the same fixed shape:

| Entry | |
|---|---|
| `route`, `title` | The page's route and title |
| `description` | The page's `description`; without one, the first paragraph of its body as plain text (links keep their text, markup and images are left out, a paragraph that is only an image or a placed component is skipped), or `null` |
| `date` | The page's `date`, else the day git first saw it, else `null` |
| `updated` | The page's `updated`, or `null` |
| `image` | The page's `image`, a path in the assets, or `null` |
| `tags` | The page's tags, each `{ key, label, description, route }`, or `[]` |
| `categories` | The page's categories, each `{ key, label, description, route }`, or `[]` |
| `draft` | `true` for a draft in `pd dev` |
| `scheduled` | `true` in `pd dev` for a page dated after today |

The description is never shortened: limit it in the skin's CSS, for example to three lines with
`line-clamp: 3` (and `-webkit-line-clamp`, `display: -webkit-box` and `-webkit-box-orient: vertical` for the
browsers that still need them).

To show an entry's image with its variants, pass it to a component with an image slot, inside the loop:

```hbs
{{#each page.children}}<li>{{> components-card }}</li>{{/each}}
```

where `components/card` declares `image` with `x-pd-image` and writes `{{pd-image image alt=""}}`.

**The card.** Name that component in the layout's schema, and every page of the listing is checked against the
card's schema:

```json
"page": { "properties": { "children": { "x-pd-card": "components/card" } } }
```

- **A field the card requires** (`required`) that a page doesn't have, `null` or an empty list, fails the listing
  page, once per page, naming it and what to add: `articles/index.md: articles/plain.md has no image, which the
  listing's card (components/card) requires: give it one (image: ...)`.
- **A value a page has** is checked against the type the card declares.
- **A card declares only fields of an entry** (the table above). The entry's shape is Pattern Dump's and the base
  every card shares: a page can't add fields to it, so a card says which of them it shows and which it needs.
- **Its sample data** may set only an entry's fields, since the card renders with an entry as its context. Without
  `x-pd-card`, a component the layout includes may only have sample data of keys the layout declares; give it a
  variant (`card~article.json`) to show it filled in the workbench.

With `sort: date`, a page with no date at all (no `date` and no commit, such as a new file) is a problem in
`pd build` and a note in `pd dev`, where it is listed last. From a shallow clone, a date git would give is
refused by `pd build`, as for `page.created`.

**On any page (deprecated).** Use a [query](#queries) instead: it lists pages on any page, with a limit and a
view. `site.collections` keeps working for now, and a skin that lists it gets one warning per build.
`partials/base`'s schema lists the collections the skin shows under
`site.properties.collections.properties`, by the folder's path (`articles`, or `blog/news` for a nested folder,
read as `site.collections.[blog/news]`), each with a description at most, as it lists navigations. Every page
gets `site.collections.<name>`: the folder's entries, sorted as above. A listed name the site has no folder for is
an empty list and a note naming the nearest folder; a name in `required` is a problem instead. The config can't
set `site.collections`.

```hbs
{{#each site.collections.articles}}{{#if (lt @index 3)}}<a href="{{route}}">{{title}}</a>{{/if}}{{/each}}
```

In `pd dev` an edit to what a listing shows of a page (its date, description, first paragraph, image, tags,
categories or draft) reloads every open page, as a title edit does.

### Listing views

One listing, several ways to show it. A folder's `index.md` names its view:

```md
---
title: Articles
layout: listing
view: grid
sort: date
---
```

A **view** is a component directly under `views/` in the skin's style guide (`views/grid`), as a layout is under
`layouts/`. Pattern Dump has no views of its own: every skin defines its own, and the workbench shows and documents
them like any component.

- **The layout** declares `page.listing` and writes it unescaped where the listing goes: `{{{page.listing}}}`.
- **The view** is rendered once per listing with `entries`, the folder's pages in its sort order (each an entry, as
  above), and nothing else.
- **The view names its card** in its schema, and that card's `required` are the fields the view needs. Every page
  of the listing is checked against that card, as for `x-pd-card` on `page.children`:

  ```json
  { "properties": { "entries": { "type": "array", "x-pd-card": "components/grid-card" } } }
  ```

  So views are separate components with cards of their own, not variants of one card: a grid's card can require an
  image while a list's doesn't.
- **A default view.** The layout can name the view its listings take when the `index.md` names none, with
  `x-pd-view` on `page.listing`: `"listing": { "x-pd-view": "list" }`. The `index.md`'s `view:` wins.
- **Checked:** a view that doesn't exist fails the page with the views there are (and a "did you mean"); a listing
  page whose layout shows `page.listing` must name its view, unless the layout names a default; a `view:` on a page whose layout shows no listing, or on
  a page that is not a folder's `index.md`, is a problem; a view whose schema names no card is a problem.
- **Sample data:** a view's may set only `entries`, each an entry; its card's only an entry's fields.
- **Styles and scripts** of the view and its card load on the page as those of a placed component do.

The starter (`pd init --with-site`) ships four plain views, each with its card in `components/`: `list` (title,
date, teaser and tags), `grid` (cards with an image; every page needs one), `featured` (the first page large, the
rest as the grid: with `sort: date`, the newest first) and `compact` (title and date only).

### Queries

Every list of pages that isn't a folder's own listing is a query: related pages under an article, the latest
articles on the home page. A layout declares it as a sub-key of `page`, with `x-pd-query` and its defaults:

```json
"page": { "properties": {
  "related": { "x-pd-query": { "collections": "same", "sort": "relevance", "limit": 3, "view": "compact" } }
} }
```

The layout gets `page.related` as `{ entries, listing }`: the pages, each an entry (the table above), and the same
rendered through the query's view, as HTML. `listing` is `null` without a view, or when no page matched, so
`{{#if page.related.listing}}` leaves out an empty section:

```hbs
{{#if page.related.listing}}<section><h2>Related articles</h2>{{{page.related.listing}}}</section>{{/if}}
```

A layout that writes its own markup loops over `page.related.entries`, and can name a card for them with
`x-pd-card` on the query's `entries` (`"properties": { "entries": { "x-pd-card": "components/card" } }`), so each
page is checked against it. A query's name is letters, digits, `_` and `-`, starting with a letter or `_`
(`related`, `latestNotes`), and is none of the sub-keys Pattern Dump fills.

| Option | Value | Default |
|---|---|---|
| `pages` | Pages picked by hand, by their path in the pages folder (`articles/a.md`): listed first, in this order | none |
| `collections` | Folders' paths (`articles`, `blog/news`), or `same` for the page's own folder | every folder |
| `categories` | Declared categories (an old key works, with a warning), or `same` for the page's own | none |
| `tags` | Tags (declared ones, when the config declares tags), or `same` for the page's own | none |
| `match` | `any`: a page needs one of the listed tags, and one of the categories; `all`: every one | `any` |
| `sort` | `relevance` (the number of tags and categories a page shares with the current one, then the date), `date` or `title` | `date` |
| `order` | `asc` or `desc`; not with `relevance`, which always lists the most relevant first | newest first; A to Z |
| `limit` | How many pages in all, picked ones included: a whole number from 1 | no limit |
| `view` | A view (`views/<name>`), as for a listing | none |

With both `tags` and `categories`, a page must match both. `same` is the current page's own tags (categories); on a page
with none the query lists no page. On a tag page it is that tag. A page with no date sorts last. Always: the current page
is left out, a page never comes twice (a picked page isn't repeated), and drafts and scheduled pages never appear,
in `pd dev` either.

**A page changes options** in its frontmatter, in a block under the query's name, with the same option names:

```yaml
related:
  pages: [articles/tokens-explained.md]
  tags: [css]
  limit: 5
  sort: date
```

Each option given replaces that one of the layout's; the rest stay. `related: false` turns the query off for that
page, and `related: true` keeps the layout's as it is. The key is the build's: the layout never gets it. It is the
one place a page's frontmatter nests: one level of keys under a key, each a value or a list.

**Every value is checked**, at the page's line or in the layout's schema: an option there isn't, a picked page that
doesn't exist (with a "did you mean"), a folder that isn't one, a category that isn't declared, a tag that isn't declared (or, without declared tags, a
tag no page has), an
unknown `sort`, `match` or `order`, `order` with `relevance`, a `limit` that isn't a whole number from 1, more picked
pages than the limit, a page picked twice, and a view that isn't one; every page is checked against the view's card.
A picked draft or scheduled page fails `pd build`; in `pd dev` it is a warning, and left out.

In `pd dev`, an edit to what a query reads of a page (its date, tags, categories, title or draft) reloads every open
page, as for a listing.

The starter (`pd init --with-site`) shows both: the article layout's `related` (three, from the same folder, by
relevance, in the compact view) and the home layout's `latest` (the three newest articles, in the list view).

### Categories

Categories say what a page is about, apart from the folder it is in: a page changes category without moving, so
its URL stays. The config declares them, by key:

```ts
site: {
  categories: {
    "design-systems": { label: "Design systems", description: "How they are built", aliases: ["ds"] },
    guides: { label: "Guides" },
  },
},
```

- **A key** is lowercase letters, digits and hyphens, as a tag is. `label` is required, `description` is optional.
- **A page names them** in `categories:`. A value the config does not declare stops the page, with a "did you mean"
  where one is close, else the list of keys. A page that names one when the config declares none stops too.
- **Renaming** keeps the old key as an alias of the new one (`aliases`). A page that still names the old key
  builds, as the new category, with a warning that names the page and line so it can be updated. An alias that is
  a key of its own, or that two categories claim, is a config problem.
- **A layout** gets `page.categories` (in the page's order) and each listing entry carries them. `site.categories`
  is every declared category in the config's order, `{ key, label, description, route }`, on every page, when
  `partials/base`'s schema lists `categories` under `site.properties` (no shape of its own, a description at most).
  The config can't set `site.categories`.

### Tags

A tag is a URL segment a page lists in `tags:`. Without declarations any tag works, and its label is its key. The
config can declare them, as it declares categories: then they are the list, so a typo stops the page (with a "did you
mean"), and an old key builds as the tag it now is, with a warning.

```ts
site: {
  tags: {
    css: { label: "CSS", description: "Cascading style sheets", aliases: ["styles"] },
    "design-tokens": { label: "Design tokens" },
  },
},
```

A layout gets each tag as `{ key, label, description, route }`, as it gets a category: `label` to show it, `key` as its
URL segment, `route` its [tag page](#tag-and-category-pages) or `null`. Write `<a href="{{route}}">{{label}}</a>`.

**Tags were strings before 0.5.0.** A template that still writes one as text, `{{#each page.tags}}{{this}}{{/each}}`,
would print `[object Object]`, so the page stops instead, naming the template and line and what to write
(`{{label}}`). A card whose schema declares `tags` as a list of strings stops the listing the same way: declare the
items as objects, or leave `items` out. So does any other schema a page's layout or view includes.

In the workbench, a component that contradicts itself about tags is an error too: its template reads `{{label}}` (or
`key`, `route`, `description`) while its sample data or its schema gives the tags as strings, which would show empty
list items; or it writes `{{this}}` while its schema declares objects. Give the tags in its `.json` as objects,
`{ "key": "design", "label": "Design" }`.

### Tag and category pages

Pattern Dump makes a page for every tag and every category a published page has, and an index of each, through the
skin's layouts:

| Route | Layout | What the layout gets |
|---|---|---|
| `/tags/<key>/` | `layouts/tag` | `title` (the label), `description` (when declared), `page.term` |
| `/tags/` | `layouts/tags` | `title` ("Tags"), `page.terms` |
| `/categories/<key>/` | `layouts/category` | as a tag page |
| `/categories/` | `layouts/categories` | `title` ("Categories"), `page.terms` |

- **Their pages are a query** the layout declares, with `tags: same` (`categories: same`), so views, cards and every
  check work as on any page:

  ```json
  "pages": { "x-pd-query": { "tags": "same", "sort": "date", "view": "list" } }
  ```

- **Published pages only.** Drafts and scheduled pages never count, in `pd dev` either: a tag only they have gets no
  page, and isn't in the index.
- **On and off:** `site.tagPages` and `site.categoryPages`. Left out, the pages are there when the skin has
  the layout (`layouts/tag`; the index when it has `layouts/tags` too), and a skin without it gets none, with no
  message. `false` turns them off. `true`, or `{ path, title }`, asks for them: a missing layout is then a problem.
  `path` is the URL segment (`{ path: "topics" }` gives `/topics/css/`), `title` the index's title.
- **Old keys forward.** `/tags/<old>/` of a declared tag's alias is a redirect to `/tags/<key>/`, like a page's
  `redirectFrom`.
- **Checked:** a page or folder of the pages folder at a generated route, or a `redirectFrom` claiming one, is a
  problem naming both; the two paths can't be the same.
- They are in the sitemap (`lastmod`: the newest change of their pages) and have JSON-LD `CollectionPage`. They are
  not in the nav or any listing. The workbench lists them under their layout's pages, each naming what made it
  (`from site.tagPages`).
- No pagination yet: a tag page lists every page with the tag.

The starter (`pd init --with-site`) has plain `tag`, `tags`, `category` and `categories` layouts.

### Scheduled pages

A page whose `date` is after today stays out of `pd build`, as a draft does: no page, no entry in the nav, a
listing or `site.collections`, no sitemap entry, none of its old routes, and a link to it from a published page is
a broken link. It appears with the first build on or after its date. A folder whose `index.md` is scheduled holds
its pages back with it, until the later of the dates. A draft is only a draft, whatever its date.

**Today is the UTC date** of the build's clock, so a laptop and a CI runner agree: a page dated 2026-12-01 is built
from 00:00 UTC on that day. The day is taken once per build. `pd dev` shows a scheduled page, listed with
`scheduled: true` so the skin can mark it, and notes once until when `pd build` leaves it out. The build's report
says what it held back:

```
[pd build] scheduled: 1 held back (articles/launch.md until 2026-12-01)
```

A static site is only as current as its last build: to publish on the day, build on the day (a scheduled CI run).

### Drafts

`draft: true` keeps a page out of the published site. `pd dev` shows it, listed with `draft: true` so the skin
can mark it, and notes once that `pd build` leaves it out. `pd build` builds the site as if the file weren't
there: no page, no entry in the nav, a listing or `site.collections`, no sitemap entry, none of its old routes,
and a link to it from a published page is a broken link. A folder whose `index.md` is a draft takes the
folder's pages with it. The build's report names what it left out:

```
[pd build] drafts: 1 left out (articles/first-post.md)
```

### A page's stylesheets

The page's `<head>` links the stylesheets of the layout and everything it includes, and the project's
base layer (`documentBase`), which also reaches every preview. It does not link themes: a skin's colours,
light and dark included, belong to the skin. The workbench's themes reach a page only through its live examples
([The theme of an example](#the-theme-of-an-example)).

A component whose template uses a class another component owns, without including it, links that component's
stylesheet too (see [Styles](authoring.md#styles)). On a page that is a warning, naming the page, the component,
the class and its owner:

```
[site] warning: find.md: organisms/search uses class "search-field" from molecules/search-field, so
molecules/search-field's stylesheet is linked too: include molecules/search-field if it belongs here, or rename the class
```

Two components that use the same class name for different things are the usual cause: rename one.

### Code colours

A page that shows code (a code block in its markdown, or in a placed component's content) also links
`/_pd/code.css`, the colours of its highlighted code, as its first stylesheet. A page without code doesn't.
`pd build` writes the file into the site's own `_pd/`, whether or not it builds the workbench.

Each token of a highlighted block has a kind, written as its class, `pd-code-<kind>`, and coloured by the custom
property of the same name, `--pd-code-<kind>`:

| Kind | Colours |
|---|---|
| `text` | Everything else: the block's own colour, `.shiki` (its tokens carry no class) |
| `comment` | Comments |
| `string` | Strings |
| `keyword` | Keywords: `import`, `return`, `if`, a Handlebars `#each` |
| `storage` | Declarations: `const`, `function`, `interface` |
| `constant` | Numbers, `true`, `null` |
| `value` | CSS keyword values: `auto`, `none`, `system-ui` |
| `tag` | HTML tag names |
| `attribute` | HTML attribute names |
| `function` | Function, class and type names |
| `support` | CSS property names, built-in types |
| `property` | JSON keys |
| `parameter` | A function's parameters |
| `expression` | A Handlebars `{{expression}}` |

The file sets Pattern Dump's colours as the properties' defaults on `:root`, light and dark, each with a contrast of
at least 4.5:1 on a white or near-white block (light) and on a dark slate one (dark), in a cascade layer of its own,
`pd-code`. The workbench uses the same defaults. Linked before every stylesheet of the site's, the layer comes first, so any rule of the site's
wins over it, in a layer or not. A site sets the kinds from its own tokens, with no colour values of its own:

```scss
:root {
  --pd-code-keyword: var(--color-code-keyword);
  --pd-code-string: var(--color-code-string);
  --pd-code-comment: var(--color-code-comment);
}
```

A kind it leaves alone keeps Pattern Dump's colour. The file colours tokens only: the block's background, padding
and font are the skin's (`pre.shiki`, `.shiki-container`).

**Light and dark follow the page's `color-scheme`.** The defaults are `light-dark()` pairs, so they take the dark
colours where the page, or the block, has `color-scheme: dark`, and the light ones otherwise. A `color-scheme: light
dark` theme follows the viewer's setting. A light and dark toggle must set `color-scheme` as well as its own
attribute (`[data-theme="dark"] { color-scheme: dark; }`); a toggle that only switches the skin's colours leaves the
code in the colours of the page's `color-scheme`. A site whose code blocks are dark in both modes gives them
`color-scheme: dark` (`pre.shiki { color-scheme: dark; }`), or sets the properties from its dark tokens.

---

### Search

`pd build` indexes the site with [Pagefind](https://pagefind.app/) and writes the index into it, at `_pd/search/`.
There is no server: search runs in the reader's browser, on GitHub Pages and under a path as well.

```bash
npm install --save-dev pagefind
```

`pd init` adds it with the website, pinned, unless given `--no-search`.

- **Pagefind is the project's own**, as Playwright is for `--browser`; Pattern Dump does not depend on it.
  `site.search` left out: the site is indexed when the project has Pagefind, and built without search, with no
  message, when it has none. `true` asks for it: without Pagefind the build stops before anything is built, naming the
  install. `false` turns it off.
- **What is indexed is each page's own content:** its markdown and the components it places, with its title. The
  layout's markup is not: header, footer, navigation, listings and related pages (other pages' titles and teasers)
  and the copy buttons never match. The written pages are unchanged; they carry no Pagefind attributes.
- **Left out:** the 404 page (it has no address of its own); tag and category pages and their indexes (their text is
  other pages' labels and teasers, so each page would match twice; the filters do their job); redirect stubs; and a
  page with `index: false`, which keeps it out of site search as well as search engines. `site.index: false`
  does not: a site kept out of search engines still has its own search. Drafts and scheduled pages are never built.
- **Filters:** `section`, the label of the page's collection (the folder that lists it, by its index page's title; a
  page at the top has none), `tag` and `category`, by their labels. **Meta:** `title`, and `teaser` (the listing
  teaser: the description, else the first paragraph).
- **The search UI is the skin's:** a component that loads `<base path>_pd/search/pagefind.js` (the site's path is in
  `<meta name="pd-base-path">`) and uses Pagefind's JavaScript API. Pagefind's own UIs are not written.
- **`pd dev` has no index,** so a save stays as fast as it is: search works on the built site, and `pd dev` says so
  when it starts.

The starter (`pd init --with-site`) has a search page with a plain, accessible component, `components/search`: a
`<search>` landmark with a labelled field and a button, a status line screen readers announce (such as
`2 results for "grid".`), and the results as a list of links with their section and the passage that matched. It searches as you
type, keeps the words in the address (`?q=`), and adds a section list once the index is loaded. Without JavaScript
the form still submits and the page says that search needs JavaScript.

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
![Cable cars against a clear sky](/assets/images/cable-cars.jpg "Cable cars on the hill, in the morning")
```

- **A caption:** an image with a title, on a line of its own, is a `<figure class="doc-figure">` with the title as
  its `<figcaption>`, as a symbol image is. In a line of text, the title stays the image's `title` attribute.
- **A dark version:** a file named `<name>-dark.<ext>` next to the image (`cable-cars-dark.jpg` beside
  `cable-cars.jpg`) makes it a `<picture>`. Its `<source media="(prefers-color-scheme: dark)">` is the dark file, in
  the same widths as WebP variants with its own width and height; the `<img>` is the light one, lazy as before.
  `pd build` writes the variants of both. A `<name>-dark` image follows the system setting (`prefers-color-scheme`),
  not a site's theme toggle: a page switched to dark by its toggle still shows the light image while the system is
  light. Name the `-dark` file itself in markdown to show it always.
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
ratio, a skin needs this rule (the `pd init --with-site` skin has it):

```css
img { max-inline-size: 100%; block-size: auto; }
```

### Symbol images

A diagram or illustration can follow the site's colours, in light and dark, with no colour of its own: draw it as a
symbol. Each symbol is one SVG file in a `symbols/` folder of an asset folder (`assets/symbols/flow.svg`), and a page
shows it by its file name after `#`:

```md
![How a page is built from its layout](#flow)

![The two layers of a page](#layers "Optional caption")
```

- The page gets one hidden sprite at the top of its body, holding each symbol it shows, once. The image is
  `<svg class="doc-image" role="img" aria-label="…">` drawing that symbol at the size the file declares (its width
  and height, else its `viewBox`). Because it is part of the page, it uses the page's custom properties and
  `currentColor`, so it follows the skin's colour tokens and its light and dark modes.
- With a title, the image is a `<figure class="doc-figure">` with the title as its `<figcaption>`; the image must
  then be on a line of its own.
- Alt text is required, as for every markdown image.
- Colours in a symbol are only `var(--color-…)`, `currentColor`, `none`, `transparent` or a `url(#…)` to a gradient
  or pattern in the same file. Anything else is a problem: the build stops and names the file.
- A `<style>` in the file may hold only simple class rules of presentation properties (`.box { fill: var(--color-fill);
  stroke: var(--color-line); }`). Each becomes attributes on the elements with that class, and the `<style>` and every
  `class` go: a `<style>` left in a page styles the whole page, and the page's own CSS would reach the classes.
  Anything else in a `<style>` is a problem.
- `<script>`, `<foreignObject>`, `<image>`, event attributes (`onclick`) and links to other files are removed, and
  the build and `pd dev` say what was removed, once per file. `<title>` and `<desc>` go too: the alt text is the
  image's name.
- Ids inside a file are prefixed with the symbol's (`img-flow--arrow`), so two symbols on a page never share one.
  A heading whose anchor would be a symbol's id gets the next free one, as with the layout's ids.
- When two asset folders have a symbol of the same name, the first one wins (your own folders come before
  packages'), and `pd dev` and the build say which.
- The skin keeps a symbol inside its column with the same rule as for images (the `pd init --with-site` skin
  has it):

  ```css
  .doc-image { max-inline-size: 100%; block-size: auto; }
  ```

A symbol image shows on site pages. In a component's docs in the workbench it shows an error until a later release.

#### A symbol as a file

Where only an image file can be shown, such as a README on GitHub, use the symbol's standalone file:
`/_pd/symbols/<name>.svg`, served by `pd dev` and written by `pd build` into the site and the workbench. It holds the
values of the tokens the symbol uses, light, then dark for `prefers-color-scheme: dark`, read from your document base
layer (the compiled `:root` rules, with `light-dark()` and `@supports` as a browser reads them). `currentColor` has no
text around it there, so it becomes `--color-text`, or the token `assets.symbols.currentColor` names. A token the
base layer doesn't declare stops the build.

Point a README at the hosted file by its full address:

```md
![How a page is built from its layout](https://example.com/_pd/symbols/flow.svg)
```

### Symbol sets of components

A component that needs a symbol set (`requireAssets: [icons]` in its frontmatter, see the authoring guide) brings it
to every site page that shows it: the page's layout and what it includes, a component placed with a `pd-` tag, and a
listing's or a query's view. The page holds each set once, right after its symbol images, hidden by its size, as a
preview holds it.

- A set that no asset folder has is a problem that names the component and the set: the page fails, and so does
  `pd build`. (A preview leaves a missing set out without a word.)
- Two sets that declare the same id, or a set that declares an id one of the page's symbol images has (`img-…`), are
  a problem too: a `<use>` of that id could draw either.
- A heading whose anchor would be a set's id gets the next free one, with a note.

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
and effort are set by `images` in the config, and a site can override them with `site.images`
([Configuration](configuration.md)).

When sharp can't be loaded (an install with `--omit=optional` leaves its binaries out), `pd dev` shows the
original images at their size and says so once, and `pd build` stops with the error, since every image it writes
must be encoded.

---

## Search engines and link previews

**The site's address.** `site.url` is where the site will be hosted, such as `https://example.com/`,
or with a path, such as `https://example.github.io/project/`, for a site published under one
([below](#publishing-under-a-path)). With it, every page carries:

- a canonical URL, and `og:url`
- Open Graph (`og:type`, `og:site_name`, `og:title`, `og:description`, `og:image` with its width and height)
  and a Twitter card, large when the page has an image
- one JSON-LD graph: the `WebSite`, the `WebPage` with its date (`datePublished`: its `date`, else its first
  commit) and its last real change (`dateModified`: its `updated`, else none), and a `BreadcrumbList` from Home
  down to the page

`og:type` is `website`, except on an article: a page whose frontmatter gives it a `date`, other than the home
page and a listing (a folder's `index.md` with pages under it). An article gets `og:type` `article`, with
`article:published_time` (its `date`), `article:modified_time` (its `updated`, when it has one), `article:section`
(its first category's label: Open Graph has one) and one `article:tag` per tag (its label), and its JSON-LD graph
adds an `Article` (headline, dates, `keywords` from its tags' labels, `articleSection` from its categories' labels:
one string, or a list for several) as the page's main entity. The date git gives a page does not make
it an article: every committed page has one.

and `pd build` writes `sitemap.xml`. Without it, those are left out and `pd build` says so once. In `pd dev`
the same tags carry the address the browser is on. Every page has `<html lang>` from `site.lang`
(default `en`).

**Images.** A page's image is its `image`, else `site.image`. Link previews show raster images only, so
an image must be a PNG, JPEG, GIF or WebP file in the assets.

**Keeping pages out.** `index: false` on a page gives it `noindex` and leaves it out of the sitemap.
`site.index: false` does that for the whole site, for a staging site: `robots.txt` then disallows
everything and there is no sitemap.

**`sitemap.xml`** lists every page in route order, except those with `index: false`, the 404 page and the
redirect pages, each with a `lastmod` of its `updated`, else its `date`, else none. Git is not read for it. From a
shallow clone, a `datePublished` git would give is left out of the JSON-LD and the build notes it once (in CI,
check out with `fetch-depth: 0`). A layout that shows `page.created` still fails the build there.

**`llms.txt`** ([llmstxt.org](https://llmstxt.org/)) gives a language model the site in one file: the site's title
(`site.globals.title`, else the home page's) and the home page's description as a quote, then a `## Pages` section
with the top-level pages and one section per collection (every folder with an `index.md`, nested ones too, headed by
its title, led by it and listing that folder's own pages), in the order of the pages folder. Each page is a line `- [title](url): teaser`, its description else its first paragraph. It lists
the same pages as the sitemap (no draft, no scheduled page, none with `index: false`); tag and category pages are left
out, since their pages are listed. URLs are absolute with `site.url`, else paths from the site's root. `pd
build` writes it to the site's root (under a path, at `<path>llms.txt`); `pd dev` has none. On unless the site has
`index: false`; `site.llms: false` turns it off.

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
  so); its previews also carry a robots `noindex` tag then. On the storefront's host there is nothing to copy.
- A site published under a path has no `robots.txt` at all ([below](#publishing-under-a-path)).

### The 404 page

`pages/404.md` is the site's 404 page: rendered through its layout like a page, but not one of the site's
pages (not in the navigation, the sitemap or the pages list), with `noindex` and no canonical, Open Graph or
JSON-LD. Without one, a built-in page goes through the default layout (the layout named `page`); a site with no
default layout gets a plain built-in page, and Pattern Dump notes that. `pd build` writes it to
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
| `http://live.localhost:<port>/` | The storefront (`site.host` changes the name), under its path when `site.url` has one |
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

(with your `site.host` in place of `live.localhost` if you set one). This concerns `pd dev` only: a
built site is plain files on a host of its own, with no `*.localhost` name involved.

---

## Building

`pd build` writes two folders, each for its own host:

| Folder | Holds |
|---|---|
| `build.outDir` (or `--out`) | The workbench snapshot, exactly as a build without a storefront writes it ([static-build.md](static-build.md)) |
| `site.outDir` | The storefront: one `index.html` per page, plus everything the pages use |

The storefront folder has its own copy of every preview its pages show and of every stylesheet, script,
font and image they reference, so it is complete on its own. It is served at `site.url`: the root of its
host, or the path under it ([Publishing under a path](#publishing-under-a-path)). A
page built here is the same page `pd dev` serves, apart from the live-reload script and the address of the
workbench links.

```
site/
  index.html  about/index.html  guides/index.html  guides/setup/index.html
  404.html                                          the 404 page
  setup/index.html  start/index.html                pages that forward from old routes
  robots.txt  sitemap.xml                           for crawlers (the sitemap with site.url)
  llms.txt                                          the site for language models
  preview/components/callout/index.html            the previews the pages show
  _pd/  assets/                                    what pages and previews reference
  .nojekyll
```

`site.workbenchUrl` is required to build, since built pages link to the workbench at its own address.

### Publishing under a path

A site can be published under a path of its host, such as a GitHub project page at
`https://<owner>.github.io/<repository>/`, without a domain of its own. Give `site.url` the full address:

```ts
site: { pagesDir: "./pages", outDir: "./site", url: "https://example.github.io/project/", … },
```

The path (`/project/`) is the site's base path. `site.outDir` holds what is served at it: copy the folder's
contents to the path, not to the host's root.

**Links stay written from the site's root.** In pages, navigations, layouts and stylesheets, write `/guides/setup/`,
`/assets/images/hero.jpg`, `url(/assets/fonts/serif.woff2)`, as for a site at the root. Pattern Dump puts the path in
front of every such reference as it serves a page or stylesheet, in `pd dev` and `pd build` alike: `href`, `src`,
`srcset` and `imagesrcset`, `poster`, `action` and `formaction`, `<object data>`, a refresh's `url=`, and `url()` in
`style` attributes, `<style>` and stylesheets (and `@import "…"`). A link written with the path already gets it twice,
and the link check says so. Text and code examples are left as written, and so are `data-*` attributes, other
hosts and relative links. The canonical URLs, Open Graph, JSON-LD and the sitemap carry the path, since they are
built from `site.url`.

**`pd dev` serves the site under its path too**, at `http://live.localhost:<port>/project/`; the host's root forwards
there, and any other address outside the path is the 404 page. That way a URL that misses the path fails while you
work, not only once the site is published.

**A skin's own scripts.** Pattern Dump can't rewrite a URL that a script puts together itself
(`fetch("/search.json")`, a path read from a `data-*` attribute). Every page names its path in a meta tag, `/` at
a host's root, for a script to build its URLs from:

```js
const base = document.querySelector('meta[name="pd-base-path"]')?.content ?? "/";
const index = await fetch(`${base}search.json`);
```

A URL the page already holds needs nothing: `a.href`, `img.src` and the attributes above are already under the path.
`pd build --browser` stops the build when a page requests anything on the site's host outside the path, naming the
page and the URL.

**Search engines.** Crawlers read `robots.txt` only at a host's root, so a site under a path gets none. The build's
notes say what to add to the host's own `robots.txt` where you can (its previews and its sitemap). Each preview
the site shows carries a robots `noindex` tag instead, and with `site.index: false` every page does. The
sitemap is written at `<path>sitemap.xml`: submit it in the search engine's console.

**The workbench beside it.** A workbench on the same host is built for its own full path:

```ts
site: { …, url: "https://example.github.io/project/", workbenchUrl: "/project/workbench/" },
build: { basePath: "/project/workbench/" },
```

Publish the workbench's folder at `/project/workbench/`, inside the site's. Links into it are left as written.

### The link check

Before it writes anything, `pd build` checks every link on every page of the site (its pages and its 404 page),
and stops if one is broken: every `href`, `src` and `srcset` of every element must lead to something the build
writes.

- A path leads to a page (`/guides/setup/`, with or without its trailing slash, or as its `index.html`), to a page
  that forwards from an old route (`redirectFrom`), or to a file (a stylesheet, an image, a preview).
- A `#fragment` leads to an element with that `id` in the target page. Headings carry their anchors as ids, so a link
  to a heading is checked too.
- A URL on the site's own address (`site.url`) is checked as its path.
- On a site published under a path, a path outside it is broken, and so is one written with the path already
  (the build says how to write it).
- A link into the workbench (`site.workbenchUrl`) leads to a component, a folder or a component's variants
  page the workbench snapshot has; its `#fragment` names one of the component's variants.
- A link to another site is not fetched: the build lists each one in its notes, with the pages that use it.
  `mailto:` and `tel:` links are left alone.

```
pd build: the site has broken links, so nothing was written:
  - /guides/: <a href="/guides/instal/">: no page or file is built at /guides/instal/
  - /about/: <a href="/guides/setup/#instal">: /guides/setup/ has no element with id "instal"
```

Code examples are text, so a link written in one is not checked. In `pd dev`, a page's links to pages that don't
exist and to anchors it doesn't have are warnings in the terminal; the full check runs in `pd build`.

### The class check

Before it writes anything, `pd build` looks at every class on every page of the site (its pages and its 404 page)
and lists each one the style guide doesn't define, so a class improvised outside the design system shows, whether a
person or an agent wrote it.

- **Defined:** a class a stylesheet of the style guide names in a selector (the project's and its packages', and each
  stylesheet the site loads), and a class a component's template writes, styled or not. A word a template builds
  from a value, such as `doc-toc-h{{level}}`, defines every class that starts that way. A page's own `<style>` counts
  too.
- **Allowed:** state classes JavaScript adds (`is-`, `has-`, `js-`), the classes Pattern Dump writes itself (code
  highlighting, the copy button, pattern links, live examples), and the names in `site.checks.allowClasses`
  (a trailing `*` for a prefix).
- A page's markdown can't write HTML, so what the check finds is a value a component writes into a `class`
  attribute (`<pd-components-badge look="hero-big-title">`, a template with `class="{{look}}"`). It names the page's
  file and the line that gives the value.

```
[pd build] classes: 1 outside the design system:
[pd build]   warning: about.md:12: class "hero-big-title" isn't defined by any component or style
```

A warning by default; with `site.checks.classes: "error"` it stops the build, and `"off"` skips the check.

### Custom properties nothing defines

A `var(--x)` in the project's own styles (its styles folder, SCSS or CSS) with no `--x` defined anywhere stops the
build, naming the file and line. Without the check it falls back to nothing, and a colour just goes missing on screen.

- **Defined:** `--x:` or `@property --x` in any compiled stylesheet of the style guide (the project's and its
  packages', the base layer and the themes) or one the site loads, and `--x:` in a `style` attribute of a page or
  preview the build writes (`style="--cols: {{cols}}"` in a template).
- `var(--x, fallback)` is fine: it says what to show without `--x`. A name Sass builds (`var(--#{$name})`) and a
  `var()` in a comment are not checked. A package's own stylesheets are not checked: they are not the project's to fix.
- A property JavaScript sets goes in `site.checks.allowProperties` (a trailing `*` for a prefix).

```
pd build: the skin reads custom properties nothing defines, so nothing was written:
  - src/styles/components/card.scss:42: var(--card-gap) reads a custom property nothing defines: define --card-gap
    in the skin, give it a fallback (var(--card-gap, ...)), or, if JavaScript sets it, list it in
    site.checks.allowProperties
```

### The accessibility check

After the link check, `pd build` checks every page of the site (not the previews or the pages that forward from old
routes) with [axe](https://github.com/dequelabs/axe-core), the WCAG 2.x A and AA rules and axe's best practices:

- **Errors stop the build:** a WCAG rule axe rates critical or serious (an image without alt text, a button with no
  name, a page without a language), and a page that doesn't have exactly one main landmark (`<main>`) and exactly one
  `<h1>`.
- **Warnings are listed in the report**, one line per rule with the pages it is found on: a WCAG rule rated moderate
  or minor, and every best-practice rule (headings that skip a level, content outside any landmark).

```
pd build: the site has accessibility problems, so nothing was written:
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

- **Search:** with a search index, on the first page that has a search field (`input[type="search"]`), at each
  viewport, a word of an indexed page's title is typed and sent. A page that shows no result within 5 seconds stops
  the build; the page showing its results is checked with axe again. Once per viewport, since the search component is
  the skin's, the same on every page.

A page is fetched from the build itself, never from the network: images and fonts from other sites are not loaded.

**The workbench on the storefront's host.** One host can serve both: the website at its root and the
workbench under a path. Set `workbenchUrl` to that path and build the workbench for it:

```ts
export default defineConfig({
  // …
  site: { pagesDir: "./pages", outDir: "./site", workbenchUrl: "/workbench/" },
  build: { basePath: "/workbench/" },
});
```

`pd build` still writes two folders. Publish the storefront's at the host's root and the workbench's inside
it at `/workbench/`; on GitHub Pages the workflow copies one into the other before it uploads them, as
`pd init --with-site`'s does. Then:

- the storefront's `robots.txt` also keeps crawlers out of the workbench's previews;
- no page or `redirectFrom` may be at or under `/workbench/`, since the workbench would overwrite it there;
- the build refuses to make the workbench for another base path than `workbenchUrl`'s (`build.basePath`,
  or `--base`): its pages would link to a workbench that isn't there.

An absolute `workbenchUrl` on the origin of `site.url` (`https://example.com/workbench/` with
`url: "https://example.com/"`) counts as the same host too.
