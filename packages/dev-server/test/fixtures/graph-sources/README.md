# graph-sources

The graph's stylesheet sources that the benches don't carry: an `assets.css` file (read for its classes), an
`assets.css` URL and a template's own `<link>` (named, never fetched). An `assets.css` entry is linked into every
preview, so adding one to test-bench or storefront-bench would change all their documents. Used by
`graph-fixtures.spec.ts`. No asset here is copied from anywhere: the stylesheet is written for this fixture.
