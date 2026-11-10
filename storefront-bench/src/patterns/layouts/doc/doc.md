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
