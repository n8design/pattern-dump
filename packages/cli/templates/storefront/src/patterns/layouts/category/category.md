---
title: Category
description: The page of one category, with every published page that has it.
---

Pattern Dump makes this page for every category a published page has, at `/categories/<key>/`. Its pages are a query with
`categories: same` (the page's own category), so any view and its card work here. Without this layout the site has no
category pages; `categoryPages: false` in the config turns them off.
