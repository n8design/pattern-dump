# __PD_NAME__

A website written in markdown with [Pattern Dump](https://www.npmjs.com/package/__PD_PACKAGE__). Its components,
styles and skin come from the style guide package `__PD_SITE_PACKAGE__`; this project holds the pages.

```bash
npm run dev     # the website at http://live.localhost:4000/
npm run build   # the website, checked, in site/
```

If Safari can't open the address, add this line to `/etc/hosts`: `127.0.0.1  live.localhost pd.localhost`.

## Where things are

| Path | What lives there |
|---|---|
| `pages/` | the pages, in markdown: `pages/about.md` is `/about/` |
| `pattern-dump.config.ts` | the style guide package (`packages`), the site's name and footer (`site.globals`), where the style guide's workbench is published (`site.workbenchUrl`) |

`npm run dev` also serves a workbench, at http://pd.localhost:4000/: the style guide's components as this site
has them installed. Work on the components in the style guide itself; its own `npm run dev` is where they change.

## The style guide

`pd build` checks every page against the style guide: its frontmatter against the layout's schema, its classes
against the style guide's styles, its links, including those into the workbench. A newer style guide is a newer
version of the package; with a `file:` dependency it is the folder as it is now.

Pattern Dump and Pagefind are pinned to exact versions. To move to a newer Pattern Dump:

```bash
npm install --save-dev --save-exact pattern-dump@<version>
```
__PD_SITE_PUBLISH_README__
