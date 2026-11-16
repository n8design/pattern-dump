---
title: About
description: What is in this starter, and where it lives.
layout: doc
toc: true
order: 1
---

## What is where

The pages are in `pages/`. What they look like is the skin, written as ordinary components so the
workbench shows each part of it:

- `src/patterns/layouts/page`: the layout every page renders with, unless it names another
- `src/patterns/layouts/home` and `src/patterns/layouts/article`: the home page's, with the latest articles, and an
  article's, with its related articles
- `src/patterns/partials/base`: the frame around it, with the header, navigation and footer
- `src/patterns/partials/head`: what the skin adds to every page's `<head>`
- `src/patterns/layouts/doc`: a page with a sidebar, which this page uses: its table of contents (`toc: true`) is there
- `src/patterns/components/note`: a component the pages show
- `src/patterns/components/toc`: the table of contents
- `src/patterns/components/search`: the site's search, on the search page; `pd build` writes its index once the
  project has Pagefind (`npm install --save-dev pagefind`)

## Settings

The site's name and footer are `storefront.site` in `pattern-dump.config.ts`.
