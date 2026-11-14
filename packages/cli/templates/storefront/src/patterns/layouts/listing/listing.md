---
title: Listing
---

The layout of a folder's `index.md` that lists the folder's pages, such as `pages/articles/index.md`: set
`layout: listing`, and `sort: date` to list the newest first. It declares `page.children`, so the storefront fills
it with the folder's pages, each with its route, title, description (or its first paragraph), date, image and tags.
