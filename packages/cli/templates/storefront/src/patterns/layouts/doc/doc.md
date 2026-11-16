---
title: Doc
---

A page with a sidebar: `layout: doc`. The sidebar is the layout's region (`page.regions` with
`"x-pd-regions": ["sidebar"]`), written as `{{{page.regions.sidebar}}}`. It holds the table of contents
(`toc: true` in a page's frontmatter, or `<pd-toc>` in its markdown) and any component the page places with
`region="sidebar"`.

A page that puts nothing there has no sidebar: the region is null, so the layout leaves it out, and the grid has
one column. `<body data-pd-regions="sidebar">` names the filled regions, which is what the CSS switches on.
