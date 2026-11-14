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

Restart `pd dev` after installing, updating or adding a package. A package installed from a registry is a
copy in `node_modules`: `pd dev` does not watch it, since it changes only by reinstalling, and says so when
it starts (`pattern package @acme/design-system@1.4.0: an installed copy, not watched`). A linked package is
watched like your own files: see below.

Include a package component exactly as the package itself does, by its handle:

```handlebars
{{> atoms-button label="Save" }}
```

`exclude: [...]` in your own config (not inside `packages`) leaves out some of your own templates, with
globs relative to `patternsDir`.

## A package you edit: a git submodule, or any folder of your own

When the design system is a repository of its own that you change while you build the site (a shared
styleguide, a skin, a theme set), keep it in a folder of the site and link it, rather than install a copy.
The setup this is made for is a git submodule consumed through a relative `file:` dependency:

```bash
git submodule add https://github.com/acme/styleguide.git vendor/styleguide
npm install --save-dev ./vendor/styleguide
```

npm writes `"@acme/styleguide": "file:vendor/styleguide"` into `package.json` and links the folder into
`node_modules` (npm 9 and later link a `file:` dependency rather than copying it). The submodule's commit
pins the version; `git submodule update --remote` moves it. Name it in the config as any package:

```ts
packages: ["@acme/styleguide"],
```

`pd dev` uses a linked package from its real folder, `vendor/styleguide`, and watches it like the project's
own files. An edit there, or through `node_modules/@acme/styleguide`, which is the same file, reloads the
open workbench preview and storefront pages. A workspace package in a monorepo is linked the same way.

If the package's helpers are TypeScript, run its `watch:helpers` beside `pd dev` (see
[Helpers ship compiled](#helpers-ship-compiled)).

## What reloads, and what needs a restart

The same for the project and for every linked package, while `pd dev` runs:

| You change | `pd dev` |
|---|---|
| A template, its data or docs, a stylesheet (the base layer too), a theme, a behaviour script, an asset, global data | Reloads the open workbench preview and storefront pages |
| A component added or removed | Updates the workbench's tree, and reloads storefront pages |
| A helper module (your own, or a package's compiled `.js`) | Reloads it in place, and the open pages |
| A file a helper module imports | Asks for a restart: a helper's own imports are not reloaded |
| A data or helper file that does not load (invalid JSON, a syntax error, a module that throws when it loads or when it registers its helpers) | Keeps the last good version, and lists the problem in the terminal, the workbench's Console and a notice on storefront pages, until you fix it |
| `pattern-dump.config.ts`, a package installed, updated or added, or a file in an installed copy | Needs a restart |

## How sources combine

| | Rule |
|---|---|
| Identity | Ids and handles don't depend on where a component comes from, so your templates include package components by the package's handles. |
| Same handle | **Your component wins**: it replaces the package's, and the replacement is logged. Two components with the same handle inside one package are a collision. |
| Styles | Each source's styles are attributed to its own components; your styles win class ownership. In the shared base layer, packages come first, so your base rules win the cascade. |
| Themes | Themes come from every source; your theme wins a name clash. |
| Data, helpers, scripts | Packages first, your project last, so your own data, helper or script with the same name wins. |
| Watching | A linked package is watched like your own files; an installed copy is not. `pd export` leaves package files out; the audit includes them. |
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
    "assets": ["assets/acme-design-system"],     // served at /assets/acme-design-system/…
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

**A package with a workbench of its own.** A style guide that you design in its own `pd dev` and publish for sites
to use describes its folders once, in `patternDump`. Its `pattern-dump.config.ts` takes every folder it doesn't
name from there: `patterns` (as `patternsDir`), `data`, `helpers`, `assets` (as `assets.dir`), `styles` (with
`entry` and `documentBase`), `themes`, `scripts` (as `scriptsDir`), `globalScripts` and `exclude`. Its config then
holds only what is about the workbench, such as `outDir` and `build`:

```ts
// pattern-dump.config.ts beside the package.json above
export default defineConfig({ outDir: "./dist" });
```

A field in both must have the same value in both (`"./patterns"` and `"patterns"` are the same). Different values
stop `pd` with a config error naming both files, since the workbench and the sites using the package would
otherwise read different folders.

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
`pd dev` reloads a rebuilt helper in place. A change to a file that a helper module imports needs a restart,
which `pd dev` asks for; a bundled helper (one file, as above) never imports one.

An asset folder is served under its own name, `/assets/<folder name>/…`, and a project's folder of the same
name hides a package's. Give a package's asset folder a name of its own, such as the package's
(`assets/acme-design-system/`), and reference its files by that path.

A package can also be a [storefront skin](storefront.md#skins): its layouts and partials are patterns like
any other.
