---
title: Listing card
---

One page of a listing, as the list view (`views/list`) shows it: its title as a link, its date, a teaser of three
lines at most, and its tags. Only the title is a link, so a screen reader reads one link per page.

The view names this card in its schema (`"x-pd-card": "components/listing-card"`), so every page of a listing is
checked against this schema: a field in `required` that a page doesn't have stops the listing, naming the page. A
card declares only fields a page in a listing has (route, title, description, date, updated, image, tags,
categories, draft, scheduled); its sample data may set only those too.
