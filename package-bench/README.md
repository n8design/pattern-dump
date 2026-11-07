# package-bench

A site that uses pattern packages the way a git submodule is consumed: `vendor/fixture-ds` (a design
system) and `vendor/fixture-skin` (a storefront skin) are plain folders, named in `package.json` as relative
`file:` dependencies. npm links them into `node_modules`, so their real folders stay outside it.

Both packages ship compiled helpers: `npm run build` bundles each `helpers/index.ts` into `dist/helpers.js`
(not committed), which each manifest names. The bench's tests build first.

It is a test fixture: its specs check the links, the packages in the workbench and the storefront, and that
a build of both roots names no folder of the machine.
