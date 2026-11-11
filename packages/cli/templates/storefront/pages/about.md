---
title: About
description: What is in this starter, and where it lives.
order: 1
---

The pages are in `pages/`. What they look like is the skin, written as ordinary components so the
workbench shows each part of it:

- `src/patterns/layouts/page`: the layout every page renders with
- `src/patterns/partials/base`: the frame around it, with the header, navigation and footer
- `src/patterns/partials/head`: what the skin adds to every page's `<head>`
- `src/patterns/components/note`: a component the pages show

The site's name and footer are `storefront.site` in `pattern-dump.config.ts`.
