// An inline style that isn't an API (inline-style.ts): a template's style attribute that sets anything other than
// custom properties is an INLINE_STYLE warning naming those declarations, at the attribute; custom properties alone
// (the component's API) are fine, and so is an attribute a Handlebars expression writes whole.
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRenderer, inlineStyles } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const render = createRenderer({ patternsDir: join(here, "fixtures") });

describe("INLINE_STYLE", () => {
  it("custom properties alone give none; width does; a mix warns for the non-property part only", () => {
    expect(inlineStyles(`<div style="--x: 1"></div>`)).toEqual([]);
    expect(inlineStyles(`<div style="width: 300px"></div>`)).toEqual([{ declarations: ["width: 300px"], line: 1, column: 6 }]);
    expect(inlineStyles(`<div style='--x: 1; color: red;'></div>`)).toEqual([{ declarations: ["color: red"], line: 1, column: 6 }]);
  });

  it("reads past Handlebars: a value it writes keeps the property's name, a block around a declaration too", () => {
    expect(inlineStyles(`<i style="width: {{w}}px"></i>`)).toEqual([{ declarations: ["width: {{w}}px"], line: 1, column: 4 }]);
    expect(inlineStyles(`<i {{#if c}}style="{{#if c.d}}--cols: {{c.d}};{{/if}}"{{/if}}></i>`)).toEqual([]);
    expect(inlineStyles(`<i style="{{styles}}"></i><i style="{{{raw}}}"></i>`)).toEqual([]);
    expect(inlineStyles(`<i data-style="width: 1px"></i>`)).toEqual([]);
    expect(inlineStyles(`<i\n  style="width: 1px;\n    height:\n 2px"></i>`)).toEqual([{ declarations: ["width: 1px", "height: 2px"], line: 2, column: 3 }]);
  });

  it("reads real attributes of opening tags only, quoted or not: not comments, other attributes or script text", () => {
    expect(inlineStyles(`<div title='example style="width: 300px"'></div>`)).toEqual([]);
    expect(inlineStyles(`<!-- <div style="width: 1px"> -->{{!-- <i style="width: 2px"> --}}{{! <b style="width: 3px"> }}`)).toEqual([]);
    expect(inlineStyles(`<script>const t = '<i style="width: 1px">';</script><style>i{}</style>`)).toEqual([]);
    expect(inlineStyles(`<div style=width:300px></div>`)).toEqual([{ declarations: ["width:300px"], line: 1, column: 6 }]);
    expect(inlineStyles(`<div\nhidden style = "color: red"/>`)).toEqual([{ declarations: ["color: red"], line: 2, column: 8 }]);
  });

  it("masks Handlebars before reading: a quote inside an expression doesn't end the value", () => {
    expect(inlineStyles(`<i style="--x: {{default x "1"}}; width: 300px"></i>`))
      .toEqual([{ declarations: ["width: 300px"], line: 1, column: 4 }]);
    expect(inlineStyles(`<i class="{{#if a}}x{{/if}}" {{#if s}}style="height: {{h "a>b"}}"{{/if}}></i>`))
      .toEqual([{ declarations: [`height: {{h "a>b"}}`], line: 1, column: 39 }]);
  });

  it("leaves CSS comments out: a comment is no property name, and its ; or : splits nothing", () => {
    expect(inlineStyles(`<i style="/* API */ --x: 1"></i>`)).toEqual([]);
    expect(inlineStyles(`<i style="--x: 1 /* not; width: 1px */"></i>`)).toEqual([]);
    expect(inlineStyles(`<i style="/* a: b; */ width: 2px"></i>`)).toEqual([{ declarations: ["width: 2px"], line: 1, column: 4 }]);
    // A comment opener inside a quoted string is text: the string ends, and what follows is read.
    expect(inlineStyles(`<i style="--label: '/*'; width: 300px"></i>`)).toEqual([{ declarations: ["width: 300px"], line: 1, column: 4 }]);
    expect(inlineStyles(`<i style='--q: "a\\"/*"; color: red'></i>`)).toEqual([{ declarations: ["color: red"], line: 1, column: 4 }]);
    expect(inlineStyles(`<i style="--x: {{d 'it"s'}}; /* note */ width: 1px"></i>`)).toEqual([{ declarations: ["width: 1px"], line: 1, column: 4 }]);
  });

  it("is a warning on the render, naming the template and the declarations, one per attribute", async () => {
    const out = await render({ component: "atoms/inline-style", data: { side: 4, styles: "color: red" } });
    expect(out.meta?.diagnostics?.filter(d => d.kind === "INLINE_STYLE")).toEqual([
      {
        kind: "INLINE_STYLE", severity: "warning", source: "render",
        message: "the style attribute sets width: 300px, which isn't a custom property: in a template, an inline style is the "
          + "component's API and sets custom properties only (style=\"--name: value\", read by its stylesheet); move the rest "
          + "into the stylesheet",
        location: { file: expect.stringMatching(/atoms\/inline-style\/inline-style\.hbs$/), line: 2, column: 6 },
      },
      expect.objectContaining({
        message: expect.stringMatching(/^the style attribute sets margin: 0 \{\{side\}\}px; background: url\('a;b\.png'\), which aren't custom properties: /),
        location: expect.objectContaining({ line: 3, column: 6 }),
      }),
    ]);
  });
});
