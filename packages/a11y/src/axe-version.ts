// The axe-core release the rule tiers were proven on. Which rules decide in jsdom, and which need a browser, was
// measured with one release (each tier list's axeVersion). Another release can add a rule that then runs nowhere, or
// change one so its results are dropped, while the check still says "checked". So every check that runs axe first
// compares the installed release with the lists' and stops on any other. The classifiers, which make the lists for
// a new release, don't.
import { createRequire } from "node:module";
import ruleTiers from "./rule-tiers.generated.json" with { type: "json" };
import pageTiers from "./page-rule-tiers.generated.json" with { type: "json" };

const require = createRequire(import.meta.url);

/** The version of the axe-core this package loads. */
export function installedAxeVersion(): string {
  return (require("axe-core/package.json") as { version: string }).version;
}

/** The installed axe-core is not the release the tier lists were proven on. A setup problem: the CLI shows its message
 *  alone, as it does a config problem's. */
export class AxeVersionError extends Error {
  override readonly name = "AxeVersionError";
}

/** Throws an AxeVersionError, naming both versions, when `installed` is not the release the tier lists were proven on. */
export function assertAxeVersion(installed: string): void {
  for (const listed of new Set([ruleTiers.axeVersion, pageTiers.axeVersion])) {
    if (installed !== listed) {
      throw new AxeVersionError(`axe-core ${installed} is installed, but the accessibility rule tiers were proven on ${listed}: install axe-core ${listed}`);
    }
  }
}

let checked = false;
/** assertAxeVersion for the installed axe-core, once per process. */
export function assertInstalledAxe(): void {
  if (checked) return;
  assertAxeVersion(installedAxeVersion());
  checked = true;
}
