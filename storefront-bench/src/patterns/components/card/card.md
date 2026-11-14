---
title: Card
description: One entry of a listing (layouts/listing, page.children): a title linking to the page, its date, its teaser and its image.
---

The card is included by a layout, inside `{{#each page.children}}`, so it gets an entry as its context. It has no
sample data of its own, since a layout's include tree may only carry the keys the layout declares; its `article`
variant shows it filled.

The teaser is never shortened in the data: the card limits it to three lines in CSS (`line-clamp`).
