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

> **0.10.** Pattern Dump is complete enough to use, but breaking changes are still possible between minor versions.
> The [changelog](CHANGELOG.md) names each one, and [Upgrade](https://pattern-dump.design/guide/upgrade/) says what
> to change.

**Coming from Pattern Lab?** Pattern Dump reads two of its conventions: `~` variants such as `button~primary.json`,
and `.json` sample data beside the template.

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

## The graph and the MCP server

Since 0.9, Pattern Dump keeps one graph of your components, stylesheets and pages, and `pd dev` updates it on every
save. [`pd describe <id>`](https://pattern-dump.design/reference/cli/#pd-describe) says what a component accepts,
where it is used, which stylesheets style it and what a change to it reaches.
[`pd affected <id|file>...`](https://pattern-dump.design/reference/cli/#pd-affected) lists the components and pages
that a set of changes reaches.

An MCP client such as Claude Code can ask the same questions. `pd dev` runs a read-only MCP server at
`http://mcp.localhost:4000/`, and [`pd mcp`](https://pattern-dump.design/reference/cli/#pd-mcp) serves the same
tools over stdio, for a client that starts a process. [MCP server](https://pattern-dump.design/reference/mcp/) lists
the seven tools, and [Claude Code on this site](https://pattern-dump.design/in-practice/claude-code/) shows them
answering questions about a real style guide.

## Requirements

Node.js 22.22 or later, and npm. Pattern Dump is free, under the MIT licence.

## Quick start

```bash
npx pattern-dump@latest init my-design-system
cd my-design-system
npm run dev              # → http://localhost:4000
```

Day to day:

```bash
npm run dev              # the workbench, with live reload
npm run audit            # findings across every component
npx pd build             # the workbench, and the site when there is one, as static files
```

## Documentation

The docs are at https://pattern-dump.design, in four sections:

- [Guide](https://pattern-dump.design/guide/): a design system step by step, from an empty folder to a style guide
  you run, check and publish.
- [Concepts](https://pattern-dump.design/concepts/): what Pattern Dump does with your design system and why, one
  idea at a time.
- [Reference](https://pattern-dump.design/reference/): every key, command and file, to look up by name.
- [In practice](https://pattern-dump.design/in-practice/): sites built with Pattern Dump, shown from their own files.

## Developing Pattern Dump

[CONTRIBUTING.md](CONTRIBUTING.md) covers setup, the checks every change has to pass, and the rules the code base
depends on. [docs/development/architecture.md](docs/development/architecture.md) describes how the code is organised.

To try changes that are not released yet, build the package from this repository and create a project from the file:

```bash
git clone https://github.com/n8design/pattern-dump.git
cd pattern-dump
npm install
npm run pack:pd          # → .pd-pack/pattern-dump-<version>.tgz

cd ..
TGZ="$PWD/pattern-dump/.pd-pack/pattern-dump-<version>.tgz"
npx --package="$TGZ" pd init my-design-system --pd-source "$TGZ"
```

## Licence

[MIT](LICENSE) © 2026 Stefan Bauer (N8D e.U.)
