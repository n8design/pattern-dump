---
title: Related articles
description: How an article lists the articles like it, and how to change the list.
date: 2026-11-15
tags: [notes]
categories: [notes]
---

Below every article is a short list of related articles: up to three from the same folder, the ones sharing most
tags and categories first. It is a query the article layout declares (`src/patterns/layouts/article`), and the home
page's latest articles are the same mechanism. An article changes the list in its frontmatter, under `related:`:

```yaml
related:
  pages: [articles/hello.md]
  limit: 5
```

picks a page first and shows five; `related: false` shows none.
