---
title: Home
description: A website written in markdown, next to the design system it shows.
---

This page is `pages/index.md`. Every markdown file in `pages/` is a page, at the address its path
names: `pages/about.md` is [/about/](/about/).

## A live example

A `pattern` fence shows a component from the workbench, in a frame of its own, so its own styles
render it and nothing on this page can restyle it:

```pattern components/note
```

## A component with your values

A `pd-` tag places a component with the values you give it. They are checked against the component's
schema, `src/patterns/components/note/note.schema.json`, before the page is shown:

<pd-components-note tone="tip" heading="Try breaking it">
Change `tone="tip"` to `tone="tips"` and save. The page shows what is wrong, and where.
</pd-components-note>
