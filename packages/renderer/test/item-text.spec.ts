import { describe, expect, it } from "vitest";
import { itemsWrittenAsText } from "../src/index.js";

describe("itemsWrittenAsText: a list's items written as text in an #each over it", () => {
  it("finds {{this}} and {{.}} in an #each over a path ending in the name, with its line and the list's path", () => {
    const t = `<ul>\n{{#each page.tags}}<li>{{this}}</li>{{/each}}\n{{#each tags}}{{.}}{{/each}}\n</ul>`;
    expect(itemsWrittenAsText(t, "tags")).toEqual([
      { list: "page.tags", line: 2, column: 24 },
      { list: "tags", line: 3, column: 15 },
    ]);
  });

  it("looks inside #if and #unless, which keep the item as context, also triple-stash", () => {
    const t = `{{#each tags}}{{#if @first}}{{{this}}}{{/if}}{{#unless @last}}{{this}}{{/unless}}{{/each}}`;
    expect(itemsWrittenAsText(t, "tags").map(f => f.line)).toEqual([1, 1]);
  });

  it("leaves fields of the item, other lists, nested context changes, helpers and the else branch alone", () => {
    const t = [
      `{{#each page.tags}}<a href="{{route}}">{{label}}</a>{{this.label}}{{/each}}`,
      `{{#each page.headings}}{{this}}{{/each}}`,
      `{{#each tags}}{{#each ../other}}{{this}}{{/each}}{{#with x}}{{this}}{{/with}}{{/each}}`,
      `{{#each tags}}{{upper this}}{{else}}{{this}}{{/each}}`,
      `{{#each nottags}}{{this}}{{/each}}`,
    ].join("\n");
    expect(itemsWrittenAsText(t, "tags")).toEqual([]);
  });

  it("returns nothing for a template that does not parse", () => {
    expect(itemsWrittenAsText(`{{#each tags}}{{this}}`, "tags")).toEqual([]);
  });
});
