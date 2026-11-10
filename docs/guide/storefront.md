# Storefront

A storefront is a website of real HTML pages, written as markdown files, next to the workbench. Use it for a
design system's public documentation: the pages explain, and every live example in them is the component
itself, rendered by the same code the workbench uses, with a link into the workbench beside it.

The pages are plain HTML. They read with JavaScript off, work from any static host, and load none of the
workbench's own styles.

---

## Quick start

Add a `storefront` block to the config ([configuration.md](configuration.md#storefront)):

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
build, `storefront.workbenchUrl`). With JavaScript off, the frame keeps the browser's default height and the
links still work.

A `pattern:` link, such as `[the callout](pattern:components/callout)`, links to the component in the
workbench.

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
| any other key | Must be declared by the layout's schema |

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
| `partials/…` | Anything else the layouts include: header, navigation, footer |

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

The page's `<head>` links the stylesheets of the layout and everything it includes, and the project's
base layer (`documentBase`), which also reaches every preview. It does not link themes: a skin's colours
belong to the skin.

---

## Hosts in `pd dev`

One `pd dev` serves both front ends, telling them apart by the host name:

| Address | Serves |
|---|---|
| `http://live.localhost:<port>/` | The storefront (`storefront.host` changes the name) |
| `http://pd.localhost:<port>/` | The workbench |
| `http://localhost:<port>/` | The workbench, as without a storefront |

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
  preview/components/callout/index.html            the previews the pages show
  _pd/  assets/                                    what pages and previews reference
  .nojekyll
```

`storefront.workbenchUrl` is required to build, since built pages link to the workbench at its own address.
