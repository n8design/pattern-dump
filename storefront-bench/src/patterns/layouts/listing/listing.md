---
title: Listing
description: A folder's index.md that lists the folder's pages, each as a card.
---

For a folder's `index.md`: set `layout: listing`, and `sort: date` to list the newest first. The layout declares
`page.children`, so Pattern Dump fills it with the folder's pages (an entry each: route, title, description, date,
image, tags, draft). Its schema names the card each one is shown as (`"x-pd-card": "components/card"`), so every
page of the listing is checked against the card's schema.

| Frontmatter | Type | |
|---|---|---|
| `title` | string | required |
| `description` | string | optional |
