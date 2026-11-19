---
title: Listing
---

The layout of a folder's `index.md` that lists the folder's pages, such as `pages/articles/index.md`: set
`layout: listing`, and `sort: date` to list the newest first. It declares `page.listing`, so Pattern Dump renders
the folder's pages through a view and the layout writes the result where it says `{{{page.listing}}}`: the list view
by default (`"x-pd-view": "list"` in its schema), or the one the `index.md` names with `view: grid`. The views are in
`views/`: `list`, `grid`, `featured` and `compact`.

Its pages can take a layout from the folder too: `childLayout: <layout>` on the `index.md` gives every page in the
folder that layout, unless the page names its own.
