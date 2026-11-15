---
title: Article
---

The layout of an article, which the pages in `pages/articles/` take from their folder (`childLayout: article` on its
`index.md`). It shows the article's date and tags, and below its text the related articles: `page.related`, a query
its schema declares with `x-pd-query`. Up to three articles of the same folder, the ones sharing most tags and
categories with this one first, shown in the compact view.

An article changes one option of the query with `related-<option>` in its frontmatter: `related-limit: 5`,
`related-pages: [articles/hello.md]` to pick pages first, `related-tags: [notes]` to keep only pages with a tag.
`related: false` turns the list off.
