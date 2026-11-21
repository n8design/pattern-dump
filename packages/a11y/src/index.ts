export { runA11yProducer } from "./producer.js";
export { assertAxeVersion, assertInstalledAxe, AxeVersionError, installedAxeVersion } from "./axe-version.js";
export { axeScript, runPageA11y, severityOf, pageRuleTiers, PAGE_TAGS, type PageA11yFinding } from "./page.js";

/** The axe rule-tier classification (alwaysOn / needsRendering / …), as data. The dev server serves
 *  it to the shell; exported so no consumer has to read this package's sources from disk. */
export { default as ruleTiers } from "./rule-tiers.generated.json" with { type: "json" };
export { defaultCheckWorkers, MOST_CHECK_WORKERS, PAGES_PER_WORKER, PageCheckError, runPagesA11y } from "./page-pool.js";
