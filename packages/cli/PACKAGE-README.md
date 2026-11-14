# Pattern Dump

A workbench for HTML and CSS design systems, and a successor to PatternLab. Write components as
Handlebars templates with SCSS, data and Markdown docs; Pattern Dump shows them live, checks them, maps
how they relate, and publishes the result as a static site.

**Demo:** a style guide and the website built from it, at https://lab.n8d.studio/pattern-dump-demo/

> **{{version}}.** Pattern Dump is at 0.x, so breaking changes are possible between minor versions (0.3 to 0.4);
> the [changelog]({{repo}}/blob/main/CHANGELOG.md) names them.

**Coming from PatternLab?** Point `patternsDir` at your patterns folder: Handlebars templates, `.json` data and
`~` variants work as they are, and no build step of your own is needed.

## Requirements

Node.js 22.22 or later, and npm.

## Quick start

Create a new project:

```bash
npx {{name}} init my-design-system
cd my-design-system
npm run dev              # → http://localhost:4000
```

Or add Pattern Dump to an existing project:

```bash
npm install --save-dev {{name}}
npx pd init
```

`pd init` writes a config, a patterns and styles tree, light and dark themes, a TypeScript setup and a
few starter components, and adds `dev`, `audit`, `typecheck` and `build:scripts` scripts. It never
overwrites an existing file.

### Installing `pd` globally

```bash
npm install --global {{name}}
pd init my-design-system
```

A global `pd` is handy for creating projects, but each project still needs its own local
`{{name}}` (which `pd init` installs): the config file imports `defineConfig` from it. A global `pd`
runs its own version, not the project's, so inside a project prefer `npm run dev`, `npm run audit`
and `npx pd build`, which always use the version the project depends on.

## Commands

| Command | What it does |
|---|---|
| `pd init [dir]` | Set up a project |
| `pd dev` | Start the workbench with live reload |
| `pd audit` | Report defects across every component (`--format md`, `text` or `json`) |
| `pd build` | Write the workbench as a static site for any host |
| `pd export` | Rewrite near-duplicate component copies as one base with variants |
| `pd help [command]` | Show options |

## Configuration

```ts
// pattern-dump.config.ts
import { defineConfig } from "{{name}}";

export default defineConfig({
  sourceDir: "./src",
  patternsDir: "./src/patterns",
  outDir: "./dist",
  styles: { strategy: "parallel", dir: "./src/styles" },
  themes: { dir: "./themes", default: "light" },
  assets: { strategy: "central", dir: "./assets" },
  scriptsDir: "./src/scripts",
});
```

## Features

- **Live workbench:** every component and variant, with themes, viewport sizes, colour-vision simulation
  and reload on save.
- **Docs next to the code:** Markdown docs with live examples and source rendered from the component.
- **Relationships:** which components each one uses and is used by, including borrowed CSS classes.
- **Checks:** render errors, schema mismatches, HTML validation and accessibility findings, per component
  and across the whole design system.
- **Static publishing:** the whole workbench as plain files.
- **Pattern packages:** use a design system from npm next to your own components.

## Documentation

- [Getting started]({{repo}}/blob/main/docs/guide/getting-started.md)
- [Authoring components]({{repo}}/blob/main/docs/guide/authoring.md)
- [Configuration]({{repo}}/blob/main/docs/guide/configuration.md)
- [Themes]({{repo}}/blob/main/docs/guide/themes.md)
- [Pattern packages]({{repo}}/blob/main/docs/guide/pattern-packages.md)
- [Static build]({{repo}}/blob/main/docs/guide/static-build.md)
- [Command line]({{repo}}/blob/main/docs/guide/cli.md)
- [Changelog]({{repo}}/blob/main/CHANGELOG.md): what changed in each release

## Support

- Bugs and feature requests: [GitHub issues]({{repo}}/issues)
- Sponsor the work: [Stefan Bauer](https://github.com/sponsors/stfbauer) ·
  [n8design](https://github.com/sponsors/n8design)

## License

[MIT]({{repo}}/blob/main/LICENSE) © 2026 Stefan Bauer (N8D e.U.)
