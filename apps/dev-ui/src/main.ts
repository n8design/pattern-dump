// @pattern-dump/dev-ui — the workbench shell's entry point.
//
// Deliberately nothing but this. The shell is organised in three layers, and the direction only
// runs one way (enforced by eslint.config.js):
//
//   core/    the substrate — session state, DOM refs, the view-state store, pure helpers.
//            Imports nothing outside core/.
//   rail/ inspector/ dock/ stage/
//            the four UI regions, named as in CONTRIBUTING.md and mirroring styles/regions/.
//            Each imports core/ only — never another region, never app/.
//   app/     the orchestrators — navigation, routing, HMR, wiring, bootstrap. The only layer
//            allowed to import regions, because connecting them is its job.
//
// Class names are OOCSS with no BEM and no is- prefix; see docs/development/styling.md.

import { init } from "./app/bootstrap.js";

void init();
