---
title: Home
description: The front page — the site's name as its heading, an optional description, and the page's body.
---

For the site's own `index.md`: set `layout: home` in its frontmatter.

| Frontmatter | Type | |
|---|---|---|
| `title` | string | required |
| `description` | string | optional |

| Query (`page`) | Defaults | |
|---|---|---|
| `page.latest` | `collections: [articles]`, `sort: date`, `limit: 2` | `{ entries, listing }`: the layout writes the entries itself |
