---
title: Doc
description: A page with a table of contents, from what the storefront derives for it.
---

| Frontmatter | Type | |
|---|---|---|
| `title` | string | required |
| `description` | string | optional |
| `lede` | string | optional |
| `related` | `false`, `true`, or options indented under it | sets those of `page.related`'s options for this page; `false` turns it off |

| Derived (`page`) | Type | |
|---|---|---|
| `page.headings` | list of `{ level, text, anchor }` | every heading, in order |
| `page.section` | `{ route, title }` or null | the top-level nav entry the page falls under |
| `page.breadcrumbs` | list of `{ route, title }` | Home, then each folder above the page |
| `page.prev`, `page.next` | `{ route, title }` or null | the neighbouring pages in the nav, across sections |
| `page.created` | ISO 8601 date or null | the page's first commit, from git |
| `page.categories` | list of `{ key, label, description }` | the page's categories, declared in `storefront.categories` |
| `page.updated` | `YYYY-MM-DD` or null | the page's own `updated:`, set for a real change (never git's last commit) |
| `page.related` | `{ entries, listing }` | a query (`sort: date`, `view: compact`, every folder): each page picks its own |
