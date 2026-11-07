# @pattern-dump/skin-experimental

A storefront skin for Pattern Dump, shipped as a pattern package: ink, bone and one vermilion accent,
poster-scale titles cut through an accent block, a marquee of the page's sections, chapter rows, and live
examples on specimen plates. Display type is Montserrat, text is Source Serif 4, labels are IBM Plex Mono.

## Using it

The package is private to this repository for now: inside it, a site names it in `packages` (npm
workspaces link it) and gives the storefront a `site`. Its helpers ship compiled (`dist/helpers/skin.js`,
built from `helpers/skin.ts` by `npm run build`), so an installed copy can load them too.

```ts
export default defineConfig({
  packages: ["@pattern-dump/skin-experimental"],
  storefront: {
    pagesDir: "./pages",
    site: { title: "My site", tagline: "…", href: "/", year: "2026", footer: "…" },
  },
});
```

A page picks `layout: page` (the default), `article` (adds a `lede`) or `home` (for `index.md`). The
skin's layouts, partials, helpers, behaviour script, fonts and base layer all come from the package.

## Rebranding

Every colour derives from one token. Set it in your own base layer (`documentBase`), which comes after
the skin's:

```css
:root { --sk-accent: #0a7cff; }
```

## What is in the package

| Folder | What |
|---|---|
| `patterns/` | The layouts (`page`, `article`, `home`) and partials (`base`, `header`, `nav`, `marquee`, `rows`, `footer`) |
| `styles/` | Their stylesheets; `styles/site/` is the base layer (tokens, fonts, document, prose, print) |
| `helpers/skin.ts` | Handlebars helpers that derive a page's chapters, sections, index and next page; built to `dist/helpers/skin.js`, which the manifest names |
| `scripts/` | The variant switcher for live examples (pages work without it) |
| `assets/skin-experimental/` | The fonts, with their licences and provenance, and the film grain; served at `/assets/skin-experimental/` |

## Developing it

`demo/` is a site that uses the skin the way any site would, by package name. `npm run dev` builds the
helpers and serves it; `npm test` and `npm run e2e` are the skin's own checks (colours only from tokens,
the rebrand, accessibility in light and dark, reduced motion, print).

`npm run build` compiles the helpers into `dist/` (not committed); `npm run watch:helpers` keeps
recompiling them while you edit `helpers/skin.ts`. Pattern packages are not watched by `pd dev` yet:
after editing the skin, restart the demo's server.
