---
title: Listing
description: A folder's index.md that lists the folder's pages, each as a card.
---

For a folder's `index.md`: set `layout: listing`, and `sort: date` to list the newest first. The layout declares
`page.children`, so Pattern Dump fills it with the folder's pages (an entry each: route, title, description, date,
image, tags, draft).

| Frontmatter | Type | |
|---|---|---|
| `title` | string | required |
| `description` | string | optional |
