import { describe, it, expect, beforeAll } from "vitest";
import { initHighlighter, highlight, getShikiCSS, wrapWithCopyButton } from "../src/highlight";

beforeAll(async () => {
  await initHighlighter();
});

describe("highlight — class-based output", () => {
  it("produces a <pre class='shiki'> element, no inline style= on spans", () => {
    const html = highlight("const x: number = 1;", "typescript");
    expect(html).toContain('<pre class="shiki');
    // No inline colour styles — class-based output only
    expect(html).not.toMatch(/style="[^"]*color/);
    expect(html).not.toMatch(/style="--shiki/);
  });

  it("handlebars grammar highlights correctly (no inline styles)", () => {
    const html = highlight("<div>{{label}}</div>", "handlebars");
    expect(html).toContain('<pre class="shiki');
    expect(html).not.toMatch(/style="[^"]*color/);
  });

  it("ts alias resolves to typescript grammar", () => {
    const byAlias = highlight("const x = 1;", "ts");
    const byFull  = highlight("const x = 1;", "typescript");
    expect(byAlias).toBe(byFull);
  });

  it("js alias resolves to javascript grammar", () => {
    const html = highlight("const x = 1;", "js");
    expect(html).toContain('<pre class="shiki');
    expect(html).not.toMatch(/style="--shiki/);
  });

  it("is deterministic — same input yields identical output", () => {
    const a = highlight("const x = 1;", "typescript");
    const b = highlight("const x = 1;", "typescript");
    expect(a).toBe(b);
  });
});

describe("highlight — graceful degradation", () => {
  it("unknown language returns plain <pre>, no error", () => {
    const html = highlight("foo bar baz", "wibble");
    expect(html).toContain("<pre");
    expect(html).toContain("foo bar baz");
    // Must not contain Shiki class names
    expect(html).not.toContain("shiki-themes");
  });

  it("empty string is handled without error", () => {
    expect(() => highlight("", "typescript")).not.toThrow();
  });

  it("escapes HTML in plain pre fallback", () => {
    const html = highlight("<script>alert(1)</script>", "wibble");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
});

describe("getShikiCSS", () => {
  it("returns non-empty CSS after highlighting", () => {
    const css = getShikiCSS();
    expect(css.length).toBeGreaterThan(100);
  });

  it("includes prefers-color-scheme media query (theming system #3)", () => {
    const css = getShikiCSS();
    expect(css).toContain("prefers-color-scheme");
    expect(css).toContain("dark");
  });

  it("references --shiki-light and --shiki-dark variables", () => {
    const css = getShikiCSS();
    expect(css).toContain("--shiki-light");
    expect(css).toContain("--shiki-dark");
  });

  it("contains .shiki base rule with background-color", () => {
    const css = getShikiCSS();
    expect(css).toContain(".shiki");
    expect(css).toContain("background-color");
  });
});

describe("wrapWithCopyButton", () => {
  it("wraps with shiki-container and copy button", () => {
    const wrapped = wrapWithCopyButton("<pre>code</pre>", "const x = 1;");
    expect(wrapped).toContain('class="shiki-container"');
    expect(wrapped).toContain('class="copy-btn"');
    expect(wrapped).toContain("<pre>code</pre>");
  });

  it("stores raw source in data-raw (copy source of truth)", () => {
    const raw = "const x = 1;";
    const wrapped = wrapWithCopyButton("<pre></pre>", raw);
    expect(wrapped).toContain(`data-raw="${raw}"`);
  });

  it("escapes & and \" in data-raw attribute", () => {
    const wrapped = wrapWithCopyButton("<pre></pre>", 'a & "b"');
    expect(wrapped).toContain('data-raw="a &amp; &quot;b&quot;"');
  });

  it("raw content is NOT in the highlighted markup — copy gets plain source", () => {
    const highlighted = '<pre><span class="x">const</span></pre>';
    const raw = "const x = 1;";
    const wrapped = wrapWithCopyButton(highlighted, raw);
    // data-raw has raw source
    expect(wrapped).toContain(`data-raw="${raw}"`);
    // highlighted markup is inside the container
    expect(wrapped).toContain(highlighted);
  });
});
