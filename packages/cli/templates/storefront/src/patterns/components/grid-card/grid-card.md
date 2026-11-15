---
title: Grid card
---

One page of a listing, as the grid view (`views/grid`) and the featured view (`views/featured`) show it: its image,
its title as a link and its date. The image is decoration (`alt=""`): the title next to it says what the page is.

It requires `image`, so a grid lists only pages that have one: a page without an `image:` in its frontmatter stops
the listing, and the message names it. The sample shows the site's icon; a page's image is a raster image in the
assets, written with its WebP variants.
