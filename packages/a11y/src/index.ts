export { runA11yProducer } from "./producer.js";

/** The axe rule-tier classification (alwaysOn / needsRendering / …), as data. The dev server serves
 *  it to the shell; exported so no consumer has to read this package's sources from disk. */
export { default as ruleTiers } from "./rule-tiers.generated.json" with { type: "json" };
