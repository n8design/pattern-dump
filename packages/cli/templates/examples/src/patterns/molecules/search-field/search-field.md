---
title: Search field
description: A labelled search input with a submit button.
status: draft
requireScript: [search-field]
---

Composes two components:

- **`atoms-button`**, included with arguments: `{{> atoms-button label=buttonLabel type="submit" }}`.
- **`molecules-input`**, a *private* sub-component. It lives inside this folder, is marked
  `visibility: private`, and is hidden in the tree until internals are shown.

Both edges appear in the Inspector's **Relationships** tab.

**Behaviour** comes from `src/scripts/search-field.ts`, loaded by `requireScript: [search-field]` in
this file's frontmatter. Every preview that shows a search field loads it — the example page too.
Submit the form: the query appears in the status line instead of the preview navigating away.

```pattern molecules/search-field
```
