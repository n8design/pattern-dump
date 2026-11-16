---
title: Guide
description: A page with a table of contents of its own.
layout: doc
order: 4
---

<pd-toc>
- [Write a page](#write-a-page)
- [Place a component](#place-a-component)
  - [In the sidebar](#in-the-sidebar)
- [What is where](/about/)
</pd-toc>

## Write a page

Every markdown file in `pages/` is a page. This one uses the doc layout, so it has a sidebar, and lists its table of
contents itself with `<pd-toc>`: the links in it are checked, so an `#anchor` that is no heading of the page stops the
build.

## Place a component

A page places a component with a `pd-` tag, such as `<pd-components-note>`. It goes where the tag is, unless the tag
names a region of the layout:

```md
<pd-components-note heading="Beside the text" region="sidebar">
In the sidebar.
</pd-components-note>
```

### In the sidebar

<pd-components-note heading="Beside the text" region="sidebar">
This note is in the sidebar, under the table of contents.
</pd-components-note>

A page with nothing for the sidebar, such as the search page, has none: the layout is one column.
