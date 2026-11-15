---
title: List
---

A listing as a list, one listing card (`components/listing-card`) per page: title, date, teaser and tags. A
folder's `index.md` picks it with `view: list` (the listing layout's default); its layout (`layouts/listing`) shows it where it writes
`{{{page.listing}}}`.

A view is a component in `views/`, rendered once per listing with `entries`, the folder's pages in its order. Its
schema names its card (`x-pd-card` on `entries`), and every page is checked against that card's schema.
