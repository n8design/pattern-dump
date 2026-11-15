// The served shell page's <title>: the workbench's name, shell.brand.title, else "Pattern Dump" (pd dev and pd build
// both write the shell through buildShellHtml).
import { describe, expect, it } from "vitest";
import { buildShellHtml } from "../src/http-utils.js";

describe("the shell page's title", () => {
  it("is the brand's title, escaped", () => {
    expect(buildShellHtml({ mode: "live", wsPort: 1 }, { title: `Acme <DS> & "co"` })).toContain(`<title>Acme &lt;DS&gt; &amp; "co"</title>`);
  });

  it("is Pattern Dump without one, in pd dev and in a static build", () => {
    expect(buildShellHtml({ mode: "live", wsPort: 1 })).toContain("<title>Pattern Dump</title>");
    expect(buildShellHtml({ mode: "static", basePath: "/", builtAt: "2026-01-01T00:00:00.000Z", pdVersion: "0" }, { logo: "/l.svg" }))
      .toContain("<title>Pattern Dump</title>");
  });
});
