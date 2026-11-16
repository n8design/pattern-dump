# Upgrading to 0.5

0.5 is the release for documentation sites: categories, tag pages, listings with cards and views, related pages,
search, a sidebar with a table of contents. A few of those change what an existing 0.4 site writes, and some stop a
build until a template or schema is updated. This guide takes a 0.4.x site through them in order, then shows each new
feature with one small example.

Every change is in the [changelog](../../CHANGELOG.md#050). Pattern Dump is still 0.x, so a minor version can
break things; each one that does is listed there and here.

## Before you start

- **Node 22.22 or later** (as for 0.4).
- **Upgrade every project that uses Pattern Dump to the same version.** A site whose skin is a pattern package of its
  own (a style guide in another folder or workspace) has Pattern Dump in both:

  ```bash
  npm install --save-dev pattern-dump@0.5.0
  ```

- **Build, then read the build.** `pd build` checks the whole site before it writes anything, and lists every
  problem at once, with the file and line. Most steps below start with the message you'll see.

## 1. Tags are objects

A tag used to be a string. It is now `{ key, label, description, route }`, as a category is: `label` to show,
`key` as its URL segment, `route` its tag page (or `null`).

**What the build says:**

```
layouts/page (page.hbs:8): {{#each page.tags}} writes {{this}}, but a tag is an object since 0.5.0 (key, label, description, route): write {{label}} to show it ({{key}} is its URL segment, {{route}} its page)
```

**Fix the template.** Before:

```handlebars
{{#each page.tags}}<span class="page-tag">{{this}}</span>{{/each}}
```

After:

```handlebars
{{#each page.tags}}<span class="page-tag">{{label}}</span>{{/each}}
```

or, linked to the tag's page when it has one:

```handlebars
{{#each page.tags}}{{#if route}}<a href="{{route}}">{{label}}</a>{{else}}{{label}}{{/if}}{{/each}}
```

The same holds for a listing's entries (`{{#each tags}}` inside `{{#each page.children}}`).

**Fix the schema of every component that receives tags.** A card named with `x-pd-card` (or a view's card) whose
schema still says `"items": { "type": "string" }` stops its listing:

```
components/card (...) declares tags as a list of strings, but a tag is an object since 0.5.0 (key, label, description, route): declare its items as "type": "object", or leave items out
```

Before:

```json
"tags": { "type": "array", "items": { "type": "string" } }
```

After:

```json
"tags": { "type": "array", "items": { "type": "object" } }
```

**Fix the sample data.** A component that only gets its tags through an include (`{{> components-article-card }}`
inside a loop, with no `x-pd-card`) is not checked, so nothing tells you: its workbench example just shows empty tags.
Change its schema as above, and its tags in the sample data (`card.json`, `card~example.json`, a layout's `.json`).
Before:

```json
"tags": ["lorem", "ipsum"]
```

After:

```json
"tags": [
  { "key": "lorem", "label": "Lorem", "description": null, "route": null },
  { "key": "ipsum", "label": "Ipsum", "description": null, "route": null }
]
```

`article:tag` and JSON-LD `keywords` now write a tag's label. Without declared tags (see
[Categories](#categories) below) the label is the key, so nothing changes there.

## 2. `page.modified` is gone: use `updated`

Git's last commit counts a typo fix or a reformat as a change, so Pattern Dump no longer uses it for anything a reader
or a search engine sees.

**What the build says**, for a layout that declares `page.modified`:

```
layouts/page declares "page.modified", which Pattern Dump no longer fills: git's last commit counts a typo fix as a change. Declare "page.updated" instead: the page's own updated: date, set for real changes
```

**Fix:** declare `page.updated` in the layout's schema, show it, and set `updated:` on a page when its content really
changes. Before:

```handlebars
<p>Last changed {{page.modified}}</p>
```

After:

```handlebars
{{#if page.updated}}<p>Updated {{page.updated}}</p>{{/if}}
```

```md
---
title: Setup
date: 2026-10-02
updated: 2026-11-20
---
```

**What changes without a message:** JSON-LD `dateModified` is the page's `updated` (left out without one), and the
sitemap's `<lastmod>` is `updated`, else `date`, else left out. Before, both were the last commit. `page.created` (the
first commit) and `datePublished` are unchanged.

## 3. Layout fields that are now the build's

`updated`, `categories`, `childLayout`, `view` and `toc` are frontmatter keys Pattern Dump reads itself, as `date` and
`tags` were in 0.4. A layout whose schema declares one of them as its own field fails every page that uses it.

**What the build says:**

```
layout "article" declares "updated", which a page sets for the build, not for its layout: rename it in the layout's schema
```

**Fix:** rename the field in the layout's schema and in the pages that set it (for example `toc` to `contents`), or,
if it meant the same thing, drop it and use Pattern Dump's (`page.updated`, `page.categories`).

## 4. Pages dated after today wait

A page whose `date` is after today (the UTC date of the build) stays out of `pd build` until that day, with every page
in a folder whose `index.md` is dated so. `pd dev` still shows it.

**What the build says:**

```
[pd build] scheduled: 1 held back (articles/launch.md until 2026-12-01)
```

A link to it from a published page is then a broken link, and stops the build:

```
pd build: the storefront has broken links, so nothing was written:
  - /: <a href="/articles/launch/">: no page or file is built at /articles/launch/
```

and so does a navigation entry naming it
(`storefront.site.navigations.footer[0]: "articles/launch.md" is not a page in the pages folder`).

**Fix:** if the date was meant as the publication date, keep it and remove the links until that day; if it was a
typo, correct it. To publish on the day, build on the day (a scheduled CI run).

## 5. `site.collections`: use a query

`site.collections` still works in 0.5, with one warning per build. It goes in a later release.

**What the build says:**

```
warning: partials/base lists site.collections (articles), which is deprecated: declare a query on the layouts that show it instead (x-pd-query on a sub-key of page, such as page.latest with { "collections": ["articles"], "sort": "date", "limit": 3 })
```

**Fix:** move the list from `partials/base` to the layout that shows it. Before, in `partials/base.schema.json`:

```json
"site": { "properties": { "collections": { "properties": { "articles": {} } } } }
```

```handlebars
{{#each site.collections.articles}}{{#if (lt @index 3)}}<a href="{{route}}">{{title}}</a>{{/if}}{{/each}}
```

After, in the home layout's schema (and take `collections` out of `partials/base`'s):

```json
"page": { "properties": {
  "latest": { "x-pd-query": { "collections": ["articles"], "sort": "date", "limit": 3 } }
} }
```

```handlebars
{{#each page.latest.entries}}<a href="{{route}}">{{title}}</a>{{/each}}
```

## 6. Custom properties nothing defines

A `var(--x)` without a fallback in the project's own styles (the skin and the component styles), with no `--x` defined
in any stylesheet of the style guide or its packages, stops the build. Only a project with a storefront is checked.

**What the build says:**

```
pd build: the skin reads custom properties nothing defines, so nothing was written:
  - styles/card.scss:4: var(--card-gap) reads a custom property nothing defines: define --card-gap in the skin, give it a fallback (var(--card-gap, ...)), or, if JavaScript sets it, list it in storefront.checks.allowProperties
```

**Fix**, one of: define it (`:root { --card-gap: 1rem; }`), give it a fallback (`var(--card-gap, 1rem)`), or, for a
property a script sets, declare it:

```ts
storefront: {
  checks: { allowProperties: ["--menu-height"] },
},
```

A property set in a `style` attribute that a template writes (`style="--size: {{size}}"`) counts as defined.

## 7. Tag and category pages

A skin that already has `layouts/tag` or `layouts/category` now gets a page for every tag (category) and an index at
`/tags/` (`/categories/`), without asking.

**What the build may say:**

```
tags/index.md is the page at /tags/, which is the index of the tags as well: rename tags/, or give the tag pages another path (storefront.tagPages: { path: "..." })
layouts/tag: a tag page's title is the tag's label, so the layout declares "title"
```

**Fix:** the layout must declare `title` and require nothing a generated page lacks; move a page that sits at a
generated route; or turn them off:

```ts
storefront: { tagPages: false, categoryPages: false },
```

A skin without those layouts gets no tag pages and no message.

## 8. Search, and a search field of your own

When the project has Pagefind (`node_modules/pagefind`, also when another package brought it), `pd build` indexes the
site, and `pd build --browser` tries the first `input[type="search"]` on the site. A site with a search of its own (a
hosted service) fails that check:

```
/search/: searching for "..." in its search field (input[type="search"]) showed no result within 5 s, though the index has a page with it: ...
```

**Fix:** `storefront: { search: false }`.

## 9. Smaller changes

- **`region` on a placed component's tag is Pattern Dump's** (the layout's region the component goes into). A
  component with a property `region` must rename it:
  `<pd-card>: region="..." is Pattern Dump's (the layout's region the component goes into), and components/card declares a property "region" as well: rename that property to place it in a region`.
- **`llms.txt`** is written at the site's root for an indexed site. If you had one of your own in the site, it is
  replaced: set `storefront.llms: false` to keep yours.
- **The copy button of a storefront code block** is added by the page's script now, not written into the HTML. CSS for
  `.shiki-container > button.copy-btn` works as before.
- **Shell code is highlighted**: a `bash`, `sh`, `shell`, `zsh`, `console` or `shell-session` fence was a plain block
  and now has colours. Use `text` for a block that should stay plain.
- **New report lines** in `pd build`, such as `classes: every class on the site's pages is the style guide's` and
  `llms.txt: 2 pages`. Update a script that reads the build's output.
- **The workbench**: a layout's Relationships tab lists its pages, generated ones included.

## What's new

Each with the smallest example that works. The [storefront guide](storefront.md) has the details.

### Categories

```ts
storefront: {
  categories: { guides: { label: "Guides", description: "Longer texts" } },
},
```

```md
---
title: Setup
categories: [guides]
---
```

A layout gets `page.categories`, each `{ key, label, description, route }`. An undeclared category stops the page with
a "did you mean". Tags can be declared the same way (`storefront.tags`), and then a typo stops the page too.

### `updated`

```md
updated: 2026-11-20
```

`page.updated`, JSON-LD `dateModified`, `article:modified_time` and the sitemap's `lastmod`. Not before `date`.

### Scheduled pages

```md
date: 2026-12-01
```

After today: held back from `pd build`, shown in `pd dev` with `scheduled: true` on its listing entry.

### `childLayout`

On a folder's `index.md`, the layout of the pages under it that name none:

```md
---
title: Articles
layout: listing
childLayout: article
---
```

### Cards and views

A listing's card, checked against every page of the listing:

```json
"page": { "properties": { "children": { "x-pd-card": "components/card" } } }
```

A view, `views/grid` in the skin, chosen on the folder's `index.md` with `view: grid`; the layout writes
`{{{page.listing}}}`, and the view names its card on `entries`:

```json
{ "properties": { "entries": { "type": "array", "x-pd-card": "components/grid-card" } } }
```

### Queries

Related pages, latest articles, any list that isn't a folder's own. In the layout's schema:

```json
"page": { "properties": {
  "related": { "x-pd-query": { "collections": "same", "sort": "relevance", "limit": 3, "view": "compact" } }
} }
```

```handlebars
{{#if page.related.listing}}<section><h2>Related articles</h2>{{{page.related.listing}}}</section>{{/if}}
```

A page changes options in a block under the query's name, or turns it off with `related: false`:

```yaml
related:
  tags: [css]
  limit: 5
```

### Tag and category pages

Add `layouts/tag` (and `layouts/tags` for the index) to the skin. A tag page lists its pages through a query:

```json
"pages": { "x-pd-query": { "tags": "same", "sort": "date", "view": "list" } }
```

`storefront.tagPages: { path: "topics" }` moves them to `/topics/<key>/`.

### Search

```bash
npm install --save-dev pagefind
```

`pd build` writes the index to `_pd/search/`. The search field is the skin's: the starter's `components/search` is a
plain, accessible one to copy.

### Regions and the table of contents

```json
"page": { "properties": { "regions": { "x-pd-regions": ["sidebar"], "x-pd-toc": true } } }
```

```handlebars
{{#if page.regions.sidebar}}<aside class="doc-sidebar">{{{page.regions.sidebar}}}</aside>{{/if}}
```

`toc: true` on a page (or `x-pd-toc` on the layout) puts the skin's `components/toc` in its region, with the page's
headings of level 2 and 3. A placed component goes into a region with `region="sidebar"` on its tag.

### `llms.txt`

On by default for an indexed site: the site's title and description, then each collection with its pages' titles,
links and teasers. `storefront.llms: false` turns it off.

### The class and property checks

`pd build` lists a class on a page that no component or style defines, as a warning:

```
about.md:12: class "hero-big-title" isn't defined by any component or style
```

```ts
storefront: {
  checks: { classes: "error", allowClasses: ["swiper-*"], allowProperties: ["--menu-height"] },
},
```

`is-*`, `has-*` and `js-*` are allowed as state classes. The property check is step 6.

### Shell highlighting

````md
```bash
npm run dev
```
````

`bash`, `sh`, `shell`, `zsh`, and `console` or `shell-session` for a prompt with its output.
