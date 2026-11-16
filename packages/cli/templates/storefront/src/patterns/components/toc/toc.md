---
title: Table of contents
---

The page's table of contents. It goes into the layout's sidebar (`"x-pd-region": "sidebar"` in its schema).

- `toc: true` in a page's frontmatter shows it with the page's headings of level 2 and 3.
- `<pd-toc></pd-toc>` in a page's markdown does the same; with a list of links inside, it shows those instead:

```md
<pd-toc>
- [Install](#install)
  - [Options](#options)
- [About](/about/)
</pd-toc>
```

An `#anchor` must be a heading of the page, or the build stops and names the closest one.
