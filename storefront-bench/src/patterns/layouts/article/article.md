---
title: Article
description: A longer text — a heading, a lede, and the page's body.
---

| Frontmatter | Type | |
|---|---|---|
| `title` | string | required |
| `description` | string | optional |
| `lede` | string | optional |
| `related` | `false`, `true`, or options indented under it | replaces those of `page.related`'s options for this page; `false` turns it off |

| Query (`page`) | Defaults | |
|---|---|---|
| `page.related` | `collections: same`, `sort: relevance`, `limit: 3`, `view: compact` | `{ entries, listing }`: related pages of the same folder |
