// A partial included on a line of its own keeps its own output as written: Handlebars would otherwise indent every
// line of it by the include's indentation, inside a <pre> too, so a code block shifted right by its include
// (`preventIndent`). Both a plain include and a layout's `{{> @partial-block }}`.
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRenderer } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const render = createRenderer({ patternsDir: join(here, "fixtures") });

describe("an indented include", () => {
  it("keeps a <pre> from a plain include as the partial writes it", async () => {
    const out = await render({ component: "molecules/indented-include" });
    expect(out.html).toContain("<pre><code>line one\n  two\n    three</code></pre>");
  });

  it("keeps a <pre> in a block passed to an indented {{> @partial-block }}", async () => {
    const out = await render({ component: "molecules/indented-block" });
    expect(out.html).toContain("<pre>a\n  b\nc</pre>");
  });
});
