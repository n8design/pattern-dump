// Unit tests for the full-page forwarder splice. Node environment — pure string manipulation.
//
// This is the shell's only HTML-by-string-surgery site, so the branch that matters is the one no
// E2E test exercises: a preview document with no </body> at all.

import { describe, it, expect } from "vitest";
import { FORWARDER, withForwarder } from "./fullpage-forwarder.js";

describe("FORWARDER", () => {
  it("is a well-formed script block — it must CLOSE the block it opens", () => {
    // A first draft of this test asserted the opposite, that the runtime value does NOT contain
    // "</script>". That was a misreading. In a JS template literal `<\/script>` is simply
    // `</script>` — the backslash is consumed by the JS parser, which is exactly what the source
    // comment means by "redundant to the JS string parser". The escape is defensive about the
    // SOURCE TEXT (so the bundle never contains a literal </script> that could terminate an HTML
    // script block were it ever inlined); it is not observable here, and the runtime value must
    // contain a real closing tag or the block it opens would never close.
    expect(FORWARDER.startsWith("<script>")).toBe(true);
    expect(FORWARDER.endsWith("</script>")).toBe(true);
    expect(FORWARDER.match(/<script>/g)).toHaveLength(1);
    expect(FORWARDER.match(/<\/script>/g)).toHaveLength(1);
  });

  it("opens a script block and posts both message kinds the shell listens for", () => {
    expect(FORWARDER.startsWith("<script>")).toBe(true);
    expect(FORWARDER).toContain("'pd-fp'");
    expect(FORWARDER).toContain("action:'exit'");
    expect(FORWARDER).toContain("action:'active'");
  });
});

describe("withForwarder", () => {
  it("splices BEFORE </body> so the script runs inside the document body", () => {
    const out = withForwarder("<html><body><main>x</main></body></html>");
    expect(out.indexOf(FORWARDER)).toBeLessThan(out.indexOf("</body>"));
    expect(out.endsWith("</body></html>")).toBe(true);
  });

  it("appends when the document has no </body> — the fallback branch", () => {
    // A preview document is arbitrary author markup; it is not guaranteed to have a body tag.
    // Without this branch the forwarder would silently never be added.
    const out = withForwarder("<main>bare fragment</main>");
    expect(out).toBe("<main>bare fragment</main>" + FORWARDER);
  });

  it("handles an empty document", () => {
    expect(withForwarder("")).toBe(FORWARDER);
  });

  it("splices at the FIRST </body> only, leaving later literal occurrences alone", () => {
    const doc = "<body>a</body><!-- </body> -->";
    const out = withForwarder(doc);
    expect(out.match(/<script>/g)).toHaveLength(1);
  });

  it("preserves the original document content exactly", () => {
    const doc = "<html><body><main data-x=\"1\">content &amp; more</main></body></html>";
    expect(withForwarder(doc).replace(FORWARDER, "")).toBe(doc);
  });
});
