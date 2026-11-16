---
title: Search
requireScript: site-search
---

The site's search, on the search page (`pages/search.md`):

```md
<pd-components-search></pd-components-search>
```

`pd build` indexes every page's own content with [Pagefind](https://pagefind.app/) when the project has it
(`npm install --save-dev pagefind`), and writes the index into the site at `_pd/search/`. The script
(`src/scripts/site-search.ts`) loads it from there and searches in the browser:

- It searches as you type and when the form is sent, and keeps the words in the address (`?q=`), so a search can be
  linked and the Back button returns to it.
- Each result is a link with its title, its section and the passage that matched.
- The status line says how many results there are, and screen readers announce it.
- A section list narrows the results, once the index is loaded.

Without JavaScript the form still works as a form and the page says that search needs JavaScript. In `npm run dev`
there is no index, so the status line says that search works on the built site.
