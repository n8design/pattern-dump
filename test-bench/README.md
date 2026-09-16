# test-bench

A small design system that Pattern Dump runs against during development, and the fixture for the
end-to-end suite (`apps/dev-ui/e2e`). It is not a test suite itself (unit tests live in each package)
and not an example project: some components exist only to exercise edge cases, such as a broken
template, a deliberate handle collision or a component made of variants alone.

Run it from the repository root:

```bash
npm run dev          # pd dev against test-bench → http://localhost:4000
```

Some end-to-end specs write into this tree while they run and restore it afterwards, which is why
Playwright runs with a single worker.
