# Pattern packages

A design system published as an npm package can be used next to your own patterns. Your components
include its components by handle, its styles, themes, data, helpers and scripts come along, and the
Nav Rail's **Hide packages** switch keeps the library out of the tree while it stays usable.

## Using a package

Install it, then name it in the config:

```bash
npm install --save-dev @acme/design-system
```

```ts
// pattern-dump.config.ts
packages: ["@acme/design-system"],
// or hide some of its templates:
// packages: [{ name: "@acme/design-system", exclude: ["pages/**"] }],
// or leave out its stylesheets, e.g. when your own SCSS compiles them:
// packages: ["@acme/design-system", { name: "@acme/core", styles: false }],
```

`styles: false` drops only the package's stylesheets; its templates, data, themes, scripts and assets
are still used. It works for a package that another package brings in as a peer, too: name the peer
with the option.

Restart `pd dev` after installing, updating or adding a package.

Include a package component exactly as the package itself does, by its handle:

```handlebars
{{> atoms-button label="Save" }}
```

`exclude: [...]` in your own config (not inside `packages`) leaves out some of your own templates, with
globs relative to `patternsDir`.

## How sources combine

| | Rule |
|---|---|
| Identity | Ids and handles don't depend on where a component comes from, so your templates include package components by the package's handles. |
| Same handle | **Your component wins**: it replaces the package's, and the replacement is logged. Two components with the same handle inside one package are a collision. |
| Styles | Each source's styles are attributed to its own components; your styles win class ownership. In the shared base layer, packages come first, so your base rules win the cascade. |
| Themes | Themes come from every source; your theme wins a name clash. |
| Data, helpers, scripts | Packages first, your project last, so your own data, helper or script with the same name wins. |
| Watching | Package files are library code: they are not watched, and `pd export` leaves them out. They are included in the audit. |
| Nav Rail | Package components are marked with their package; **Hide packages** removes them from the tree and from folder galleries. |

## Making a package

A package describes itself with a `patternDump` field in its `package.json`. Every path is relative to
the package folder, and every field is optional:

```jsonc
{
  "name": "@acme/design-system",
  "patternDump": {
    "patterns": "patterns",                      // Handlebars components
    "data": "data",                              // global data, merged beneath the project's
    "helpers": "dist/helpers.js",                // compiled Handlebars helpers, a module or folder
    "assets": ["images", "fonts"],               // served at /assets/images/…, /assets/fonts/…
    "styles": {
      "dir": "scss",
      "entry": "main.scss",                      // compile only this bundle
      "documentBase": ["base"]                   // shared base layer, relative to dir
    },
    "themes": { "dir": "themes", "default": "light", "switch": "attribute" },
    "scripts": "scripts",                        // behaviour script sources (<id>.ts)
    "globalScripts": ["dialog"],                 // loaded into every preview
    "exclude": ["**/legacy/**"]                  // templates shipped but not shown
  }
}
```

The fields mean the same as the project options of the same name ([configuration.md](configuration.md)).

A package can be split: one package with the patterns, and another with the styles and themes they need.
List the second as a `peerDependency` of the first; Pattern Dump follows peer dependencies that have a
`patternDump` field, so naming the patterns package is enough.

Make sure the folders named in `patternDump` are included in the package's `files`.

### Helpers ship compiled

A package's helpers are JavaScript. Write them in TypeScript if you like, but publish the `.js` built from
it and name that in `helpers`: Node does not load TypeScript from a package installed in `node_modules`.
A manifest that names a `.ts` file, or a helpers folder that holds TypeScript and no `.js`, stops
`pd dev`, `pd audit` and `pd build` at startup with an error that says so. In a folder that has both, the
`.js` files load and the TypeScript ones are skipped with a startup warning naming them. (A project's own
`helpers` may still be TypeScript.)

One esbuild command does it, bundling each helper module and what it imports into one file:

```jsonc
// the package's package.json
"scripts": {
  "build": "esbuild helpers/index.ts --bundle --platform=node --format=esm --outfile=dist/helpers.js",
  "watch:helpers": "esbuild helpers/index.ts --bundle --platform=node --format=esm --outfile=dist/helpers.js --watch"
}
```

Leave `dist/` out of version control and build it before packing (a `prepack` script, or your CI).

**Authoring a package's helpers next to a site** takes two processes: in the package,
`npm run watch:helpers` rebuilds `dist/` on every save of the TypeScript; in the site, `pd dev` serves it.
`pd dev` reads helpers when it starts, so restart it to load a rebuilt helper.

An asset folder is served under its own name, `/assets/<folder name>/…`, and a project's folder of the same
name hides a package's. Give a package's asset folder a name of its own, such as the package's
(`assets/acme-design-system/`), and reference its files by that path.

A package can also be a [storefront skin](storefront.md#skins): its layouts and partials are patterns like
any other.
