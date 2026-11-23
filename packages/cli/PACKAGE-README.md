# Pattern Dump

Pattern Dump is an open-source workbench for HTML and CSS design systems. You write each component as a Handlebars
template with SCSS, sample data and Markdown docs. Pattern Dump shows every component and variant live, derives its
documentation from the component itself, and checks it.

The same components also build websites. You write the pages in Markdown, and Pattern Dump builds them from your
components and checks every page against the contracts those components declare: a page that breaks one stops the
build. `pd init` asks whether to include a website, and `pd build` writes the workbench, and the site when there is
one, as static files for any host.

**Docs:** https://pattern-dump.design

**Demo:** a style guide and the website built from it, at https://lab.n8d.studio/pattern-dump-demo/

Built by Stefan Bauer (n8d), creator of hTWOo.

> **{{version}}.** Pattern Dump is at 0.x, so breaking changes are possible between minor versions (0.8 to 0.9).
> The [changelog]({{repo}}/blob/main/CHANGELOG.md) names each one, and
> [Upgrade](https://pattern-dump.design/guide/upgrade/) says what to change.

**Coming from Pattern Lab?** Pattern Dump reads two of its conventions: `~` variants such as `button~primary.json`,
and `.json` sample data beside the template.

## Requirements

Node.js 22.22 or later, and npm. Pattern Dump is free, under the MIT licence.

## Quick start

Create a new project:

```bash
npx {{name}}@latest init my-design-system
cd my-design-system
npm run dev              # → http://localhost:4000
```

Or add Pattern Dump to an existing project:

```bash
npm install --save-dev {{name}}
npx pd init
```

`pd init` asks whether to include starter components and a website. It writes a config, a patterns and styles tree,
light and dark themes and a TypeScript setup, and adds npm scripts such as `dev` and `audit` (and `build` with a
website). It never overwrites an existing file.

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
| `pd init [dir]` | Set up a project: a design system, with or without a website |
| `pd dev` | Start the workbench, and the site when there is one, with live reload |
| `pd audit` | Report findings across every component (`--format md`, `text` or `json`) |
| `pd build` | Write the workbench, and the site when there is one, as static files |
| `pd export` | Rewrite near-duplicate copies of a component as one base component with variants |
| `pd graph` | Print the project graph: components, stylesheets, pages and how they connect |
| `pd describe <id>` | What a component accepts, where it is used, what styles it and what a change reaches |
| `pd affected <id\|file>...` | The components and pages a set of changes reaches |
| `pd mcp` | Serve the MCP tools over stdio, for a client that starts a process |
| `pd help` | Show every command and option |

## The graph and the MCP server

Since 0.9, Pattern Dump keeps one graph of your components, stylesheets and pages, and `pd dev` updates it on every
save. [`pd describe`](https://pattern-dump.design/reference/cli/#pd-describe) and
[`pd affected`](https://pattern-dump.design/reference/cli/#pd-affected) print its answers.

An MCP client such as Claude Code can ask the same questions. `pd dev` runs a read-only MCP server at
`http://mcp.localhost:4000/`, and [`pd mcp`](https://pattern-dump.design/reference/cli/#pd-mcp) serves the same
tools over stdio. [MCP server](https://pattern-dump.design/reference/mcp/) lists the seven tools, and
[Claude Code on this site](https://pattern-dump.design/in-practice/claude-code/) shows them answering questions
about a real style guide.

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

## What it does

- A live workbench with every component and variant, themes, viewport sizes and colour-vision simulation. It reloads
  when you save a template, data, docs, a style, a theme or a script.
- Docs written in Markdown, with live examples and source rendered from the component itself.
- Relationships between components: which ones each includes and is included by (the dependency graph), which
  stylesheets style it, and what a change to it reaches.
- Checks per component (render errors, schema mismatches, HTML validation and accessibility findings), and
  `pd audit` for findings across every component, with JSON output for CI.
- A website built from the same components: pages in Markdown, checked against the components' contracts.
- Pattern packages, to use a design system from npm next to your own components.

## Documentation

The docs are at https://pattern-dump.design, in four sections:

- [Guide](https://pattern-dump.design/guide/): a design system step by step, from an empty folder to a style guide
  you run, check and publish.
- [Concepts](https://pattern-dump.design/concepts/): what Pattern Dump does with your design system and why, one
  idea at a time.
- [Reference](https://pattern-dump.design/reference/): every key, command and file, to look up by name.
- [In practice](https://pattern-dump.design/in-practice/): sites built with Pattern Dump, shown from their own files.

What changed in each release: the [changelog]({{repo}}/blob/main/CHANGELOG.md).

## Support

- Bugs and feature requests: [GitHub issues]({{repo}}/issues)
- Sponsor the work: [Stefan Bauer](https://github.com/sponsors/stfbauer) ·
  [n8design](https://github.com/sponsors/n8design)

## Licence

[MIT]({{repo}}/blob/main/LICENSE) © 2026 Stefan Bauer (N8D e.U.)
