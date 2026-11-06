# storefront-bench

A sandbox for the storefront: a few markdown pages in `pages/`, rendered with the layouts and partials in
`src/patterns/layouts/` and `src/patterns/partials/`, embedding the components in `src/patterns/components/`.
The skin and the components are ordinary patterns, so `pd dev` shows them in the workbench too.

It is also a test fixture: specs read it, and the storefront Playwright project runs against it.
