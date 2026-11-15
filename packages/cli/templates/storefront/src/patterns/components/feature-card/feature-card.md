---
title: Feature card
---

The first page of the featured view (`views/featured`), large: its image across the column, its title as a link,
its date and its teaser. Its own card, not a variant of the grid card, so its image slot can be as wide as the
column. It requires what the grid card requires (`route`, `title`, `image`): the featured view names the grid card
in its schema, and every page is checked against that.
