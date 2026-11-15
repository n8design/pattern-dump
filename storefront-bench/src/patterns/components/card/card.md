---
title: Card
description: One entry of a listing (layouts/listing, page.children): a title linking to the page, its date, its teaser and its image.
---

The card is included by a layout, inside `{{#each page.children}}`, so it gets an entry as its context. The listing
names it with `x-pd-card`, so each page of the listing is checked against this schema, and sample data of its own
could set only an entry's fields. It has none; its `article` variant shows it filled.

The teaser is never shortened in the data: the card limits it to three lines in CSS (`line-clamp`).
