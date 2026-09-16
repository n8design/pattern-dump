# @pattern-dump/a11y

Accessibility checks: axe-core rule tiers and the structural producer.

Classifies axe-core rules into what can run without layout (structural, in `pd audit`) and what needs a rendered page (run in the workbench), and produces the structural findings.

**Internal package.** It is bundled into the published `pattern-dump` package (see
[`cli`](../cli/README.md)) and is not published on its own. See the [architecture](../../docs/development/architecture.md) for how the packages fit together.

**Depends on:** `contracts`

| Entry point | What it holds |
|---|---|
| `src/index.ts` | `ruleTiers` (generated) and `runA11yProducer` |
| `src/classifier.ts` | regenerates `docs/development/a11y-coverage.generated.md` (`npm run classify -w @pattern-dump/a11y`) |
