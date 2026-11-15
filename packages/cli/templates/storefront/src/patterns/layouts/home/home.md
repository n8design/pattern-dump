---
title: Home
---

The layout of the home page (`layout: home` in `pages/index.md`): its text, then the latest articles. They are
`page.latest`, a query its schema declares with `x-pd-query`: the three newest pages of `pages/articles/`, shown in
the list view. The same mechanism lists an article's related articles (`layouts/article`); `latest-limit: 5` in the
home page's frontmatter shows five, and `latest: false` none.
