// Every markdown Pattern Dump renders writes a code block the one way (src/code-blocks.ts): a fence and an indented
// block, in the docs, on a page and in a placed component's content, are focusable and carry the copy button. The
// guard: no markdown-it instance is made outside code-blocks.ts, so no path can miss the rule again.
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createMarkdown } from "../src/code-blocks.js";

const src = fileURLToPath(new URL("../src/", import.meta.url));
const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true })
  .flatMap(e => e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith(".ts") ? [join(dir, e.name)] : []);

describe("the code-block rule", () => {
  it("writes a fence and an indented block alike: focusable, with the copy button and the raw code", () => {
    const html = createMarkdown({ html: false }).render("```bash\nnpm i <x>\n```\n\nAnd:\n\n    npm i <y>\n");
    const blocks = html.match(/<div class="shiki-container"[^>]*>.*?<\/pre><\/div>/gs) ?? [];
    expect(blocks).toHaveLength(2);
    for (const b of blocks) expect(b).toMatch(/<pre [^>]*tabindex="0"/);
    expect(blocks[0]).toContain(`data-raw="npm i <x>\n"`);
    expect(blocks[1]).toContain(`data-raw="npm i <y>\n"`);
  });

  it("is every markdown-it instance's: none is made outside code-blocks.ts", () => {
    const makers = files(src).filter(f => !f.endsWith("code-blocks.ts") && /new MarkdownIt\(|markdownit\(/.test(readFileSync(f, "utf-8")));
    expect(makers.map(f => relative(src, f))).toEqual([]);
  });
});
