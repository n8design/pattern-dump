import { describe, it, expect, beforeAll } from "vitest";
import { initHighlighter, highlight, getShikiCSS, getCodeCSS, codeKindOf, CODE_KINDS, wrapWithCopyButton } from "../src/highlight";
import { monokaiLightPalette } from "../src/themes/monokai-light";
import { mcmDarkPalette } from "../src/themes/mcm-dark";
import { wcagContrast } from "culori";

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

describe("highlight: a token's kind as a fixed class", () => {
  const kinds = (html: string) => [...html.matchAll(/<span class="pd-code-([a-z]+)">([^<]*)<\/span>/g)].map(m => [m[2], m[1]]);

  it("names HTML's tags, attributes and strings, and a Handlebars expression", () => {
    const html = highlight(`<p class="a">{{title}}</p>`, "handlebars");
    expect(kinds(html)).toEqual(expect.arrayContaining([["p", "tag"], [" class", "attribute"], [`"a"`, "string"], ["title", "expression"]]));
  });

  it("names keywords, storage, functions, parameters and comments", () => {
    const html = highlight(`// note\nfunction f(a) { return a; }`, "javascript");
    expect(kinds(html)).toEqual(expect.arrayContaining([["// note", "comment"], ["function", "storage"], [" f", "function"], ["a", "parameter"], ["return", "keyword"]]));
  });

  it("names JSON keys as property, numbers as constant", () => {
    expect(kinds(highlight(`{"k": 2}`, "json"))).toEqual([[`"k"`, "property"], ["2", "constant"]]);
  });

  it("writes no hashed class, no theme class and no inline style; text carries no class", () => {
    const html = highlight(`<p class="a">{{title}}</p>`, "handlebars");
    expect(html).toMatch(/^<pre class="shiki" tabindex="0">/);
    expect(html).not.toContain("__shiki_");
    expect(html).not.toContain("style=");
    expect(html).not.toMatch(/class="pd-code-text"/);
    for (const m of html.matchAll(/class="(pd-code-[a-z]+)"/g)) expect(CODE_KINDS.map(k => `pd-code-${k}`)).toContain(m[1]);
  });
});

describe("codeKindOf", () => {
  it("gives each pair of PD's two colours its kind, whatever the case", () => {
    expect(codeKindOf(monokaiLightPalette.keyword, mcmDarkPalette.tag)).toBe("tag");
    expect(codeKindOf(monokaiLightPalette.keyword.toUpperCase(), mcmDarkPalette.keyword)).toBe("keyword");
    expect(codeKindOf(monokaiLightPalette.support, mcmDarkPalette.keyword)).toBe("storage");
  });

  it("names CSS keyword values (light support, dark constant) value", () => {
    expect(codeKindOf(monokaiLightPalette.support, mcmDarkPalette.constant)).toBe("value");
  });

  it("shows the pairs no kind has as the nearest kind", () => {
    expect(codeKindOf(monokaiLightPalette.name, mcmDarkPalette.constant)).toBe("function");
    expect(codeKindOf(monokaiLightPalette.name, mcmDarkPalette.string)).toBe("function");
    expect(codeKindOf(monokaiLightPalette.name, mcmDarkPalette.comment)).toBe("comment");
  });

  it("a pair no rule names takes its light colour's kind, else text", () => {
    expect(codeKindOf(monokaiLightPalette.comment, "#000000")).toBe("comment");
    expect(codeKindOf("#123456", "#654321")).toBe("text");
    expect(codeKindOf(undefined, undefined)).toBe("text");
  });
});

describe("getCodeCSS: /_pd/code.css", () => {
  const css = getCodeCSS();

  it("is all in the pd-code layer", () => {
    expect(css).toMatch(/^@layer pd-code\{[^]*\}\n$/);
    expect(css.match(/@layer/g)).toHaveLength(1);
  });

  it("sets every kind's property on :root, as light-dark() of the two themes' colours (today's colours)", () => {
    const props = Object.fromEntries([...css.matchAll(/--pd-code-([a-z]+):light-dark\((#[0-9a-f]+),(#[0-9a-f]+)\);/g)].map(m => [m[1], [m[2], m[3]]]));
    expect(Object.keys(props)).toEqual([...CODE_KINDS]);
    expect(props["text"]).toEqual(["#49483e", "#d6d0c6"]);
    expect(props["keyword"]).toEqual(["#e40052", "#eaaa36"]);
    expect(props["tag"]).toEqual(["#e40052", "#49c7c0"]);
    expect(props["value"]).toEqual(["#007ca3", "#8caaeb"]);
    expect(props["expression"]).toEqual(["#ba550c", "#e37636"]);
    expect(css).toContain(":root{--pd-code-text:");
  });

  it("colours each kind's class from its property, the block's own text from --pd-code-text", () => {
    expect(css).toContain(".shiki{color:var(--pd-code-text)}");
    for (const k of CODE_KINDS.filter(k => k !== "text")) expect(css).toContain(`.pd-code-${k}{color:var(--pd-code-${k})}`);
    expect(css).not.toContain(".pd-code-text{");
  });

  it("every default reaches 4.5:1 (WCAG AA): light on white and on the block's #fafafa, dark on #22292e", () => {
    const low: string[] = [];
    for (const m of css.matchAll(/--pd-code-([a-z]+):light-dark\((#[0-9a-f]+),(#[0-9a-f]+)\);/g)) {
      const [, kind, light, dark] = m as unknown as [string, string, string, string];
      for (const [mode, colour, ground] of [["light", light, "#ffffff"], ["light", light, "#fafafa"], ["dark", dark, "#22292e"]] as const) {
        const ratio = wcagContrast(colour, ground);
        if (ratio < 4.5) low.push(`${kind} ${mode} ${colour} on ${ground}: ${ratio.toFixed(2)}`);
      }
    }
    expect(low).toEqual([]);
  });

  it("holds no hex outside the properties' defaults", () => {
    expect(css.replace(/--pd-code-[a-z]+:light-dark\([^)]*\);/g, "")).not.toMatch(/#[0-9a-f]{3,8}/i);
  });
});

describe("getShikiCSS: the workbench's code-block frame", () => {
  const css = getShikiCSS();

  it("gives the block its ground in light and dark, following the OS (color-scheme: light dark)", () => {
    expect(css).toContain(".shiki{color-scheme:light dark;background-color:light-dark(#fafafa,#22292e);overflow-x:auto}");
  });

  it("holds no token colour: those are code.css's", () => {
    expect(css).not.toContain("--shiki");
    expect(css).not.toContain("pd-code");
    expect(css).not.toContain("prefers-color-scheme");
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
