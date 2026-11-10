---
title: Doc
description: A page with a table of contents, from what the storefront derives for it.
---

| Frontmatter | Type | |
|---|---|---|
| `title` | string | required |
| `description` | string | optional |
| `lede` | string | optional |

| Derived (`page`) | Type | |
|---|---|---|
| `page.headings` | list of `{ level, text, anchor }` | every heading, in order |
| `page.section` | `{ route, title }` or null | the top-level nav entry the page falls under |
| `page.breadcrumbs` | list of `{ route, title }` | Home, then each folder above the page |
| `page.prev`, `page.next` | `{ route, title }` or null | the neighbouring pages in the nav, across sections |
| `page.created`, `page.modified` | ISO 8601 date or null | the page's first and last commit, from git |
