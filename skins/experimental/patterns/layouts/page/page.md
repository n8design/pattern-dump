---
title: Page
description: The default layout — a heading, an optional description, and the page's body.
---

Every page without a `layout:` uses this one.

| Frontmatter | Type | |
|---|---|---|
| `title` | string | required |
| `description` | string | optional |

The body is the page's markdown, rendered; the site, nav and footer come from the storefront, not from
the page.
