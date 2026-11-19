---
title: About
order: 1
---

## Where things are

- `pages/`: the pages, in markdown. A page's frontmatter is checked against its layout's schema, which is the style
  guide's: open the workbench to see what each layout accepts.
- `pattern-dump.config.ts`: the site's name and footer (`site.globals`), and where the style guide's own workbench
  is published (`site.workbenchUrl`).

A page can name another of the style guide's layouts with `layout:`, and place its components with a `pattern` fence
or a `pd-` tag, as the [storefront guide](https://github.com/n8design/pattern-dump/blob/main/docs/guide/storefront.md)
describes.
