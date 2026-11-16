---
title: Tag
description: The page of one tag, with every published page that has it.
---

Pattern Dump makes this page for every tag a published page has, at `/tags/<key>/`. Its pages are a query with
`tags: same` (the page's own tag), so any view and its card work here. Without this layout the site has no
tag pages; `tagPages: false` in the config turns them off.
