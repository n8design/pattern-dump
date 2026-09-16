# __PD_NAME__

A design system worked on with [Pattern Dump](https://www.npmjs.com/package/__PD_PACKAGE__).

```bash
npm run dev     # the workbench at http://localhost:4000
npm run audit   # static defects across every component
npm run typecheck      # type-check the behaviour scripts
npm run build:scripts  # compile them to lib/scripts (JavaScript + type declarations)
```

## Layout

| Path | What lives there |
|---|---|
| `pattern-dump.config.ts` | where everything is — every path resolves against this folder |
| `src/patterns/<category>/<name>/` | one component: `<name>.hbs`, `.json` data, `.md` docs, `.schema.json` |
| `src/patterns/<category>/<name>/<name>~<variant>.json` | a variant that overrides data |
| `src/patterns/<category>/<name>/<name>~<variant>.hbs` | a variant with its own markup |
| `src/styles/` | SCSS mirroring `src/patterns/` (`atoms/button.scss` styles `atoms/button`) |
| `src/styles/base/` | shared rules with no single owner, linked beneath every preview |
| `themes/<name>.theme.scss` | a theme: custom properties under `[data-theme="<name>"]` |
| `assets/` | served at `/assets/` |
| `src/scripts/<id>.ts` | a behaviour script, loaded by the components that name it |
| `tsconfig.json` | TypeScript settings for `src/scripts` |

Include a component from another with its handle, `<category>-<name>`: `{{> atoms-button }}`.
A variant handle contains `~`, so quote it: `{{> "atoms-button~secondary" }}`.

A folder's `index.md` titles it and can order its children by name. `...` stands for every child
the list doesn't name, so a folder you add later needs no edit here:

```md
---
title: Atoms
order: [button, ..., badge]
---
```

Any component (in its `.md`) or folder (in its `index.md`) can also rank itself with a number. Without
one its rank is `0`; lower comes first, whatever the parent's list says. This puts a folder before
every rank-0 sibling (`order: 10` would put it after them):

```md
---
title: Projects
order: -10
---
```

Siblings sort by rank first, then by the parent's list, then alphabetically.
`src/patterns/index.md` orders the top-level folders.

## Behaviour scripts

A script is a TypeScript module in `src/scripts/`. A component loads it by naming it in its `.md`
frontmatter, and every preview that shows the component — directly or included in another — loads it:

```md
---
title: Search field
requireScript: [search-field]
---
```

To load a script into every preview, list it in `pattern-dump.config.ts`: `globalScripts: ["<id>"]`.

`npm run dev` compiles scripts itself (esbuild) and reloads the preview when one changes; there is no
build step while you work. `tsconfig.json` is for your editor, `npm run typecheck` and
`npm run build:scripts`, which writes JavaScript and type declarations to `lib/scripts/`.

To let another package in your repository import the compiled scripts, export them from `package.json`:

```json
"files": ["lib/scripts"],
"exports": { "./package.json": "./package.json", "./scripts/*": "./lib/scripts/*" }
```
