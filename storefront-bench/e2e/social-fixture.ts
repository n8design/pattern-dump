// The project the social image specs build (social-images.spec.ts, social-command.spec.ts), made here: a card
// component and its pages written by these specs, a grey PNG generated for the site's image, and no font file.
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { defineConfig, validateConfig } from "@pattern-dump/config";
import { save } from "../../test-support/save.js";

/** A PNG of one grey, made here: the site's image. */
export function greyPng(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const out = Buffer.alloc(8 + data.length + 4);
    out.writeUInt32BE(data.length, 0);
    typed.copy(out, 4);
    out.writeUInt32BE(crc32(typed), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 0, 0, 0, 0], 8);
  const rows = Buffer.concat(Array.from({ length: height }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(width, 128)])));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}
/** A PNG's size, read from its header. */
export const pngSize = (b: Buffer) => ({ width: b.readUInt32BE(16), height: b.readUInt32BE(20) });

export const json = (v: unknown) => JSON.stringify(v);
export const fm = (lines: string[], body = "Text.") => `---\n${lines.join("\n")}\n---\n\n${body}\n`;
export const CARD_CSS = `.card {
  box-sizing: border-box;
  inline-size: 1200px;
  block-size: 630px;
  padding: 60px;
  background: #102a43;
  color: #fff;
  font: 64px/1.2 system-ui, sans-serif;
}

.card h1 {
  margin: 0;
  font-size: 1em;
  max-block-size: 2.4em;
  overflow: hidden;
}

.card p {
  margin: 0;
  font-size: 32px;
}

.card--pale {
  background: #fff;
  color: #ccc;
}
`;
export const FILES: Record<string, string | Buffer> = {
  "src/patterns/layouts/page/page.hbs": `<header><p>Site</p></header><main><h1>{{title}}</h1>{{{body}}}</main><footer><p>F</p></footer>\n`,
  "src/patterns/layouts/page/page.schema.json": json({ type: "object", required: ["title"], properties: { title: { type: "string" } } }),
  "src/patterns/components/social-image/social-image.hbs": `<div class="card"><p>{{section}}</p><h1>{{title}}</h1></div>\n`,
  "src/patterns/components/social-image/social-image.schema.json": json({ properties: { title: { type: "string" }, section: { type: "string" } } }),
  "src/patterns/components/social-image/social-image~pale.hbs": `<div class="card card--pale"><h1>{{title}}</h1></div>\n`,
  "src/styles/components/social-image.scss": CARD_CSS,
  "assets/share.png": greyPng(240, 126),
  "pages/index.md": fm(["title: Home"]),
  "pages/guide/index.md": fm(["title: Guide"]),
  "pages/guide/install.md": fm(["title: Install"]),
  "pages/about.md": fm(["title: About", "image: /assets/share.png"]),
};

export const config = validateConfig(defineConfig({
  sourceDir: "./src", patternsDir: "./src/patterns", outDir: "./.out/wb", build: { workbench: false },
  styles: { strategy: "parallel", dir: "./src/styles" }, assets: { strategy: "central", dir: "./assets" },
  site: { pagesDir: "./pages", outDir: "./.out/site", workbenchUrl: "https://wb.test/", url: "https://example.test/",
    image: "/assets/share.png", socialImages: { component: "components/social-image" } },
} as never), "test");

let n = 0;
/** A copy of the project under `tmp`, with `files` over it (null: left out). */
export async function project(tmp: string, files: Record<string, string | Buffer | null> = {}): Promise<string> {
  const root = join(tmp, `p${n++}`);
  for (const [rel, text] of Object.entries({ ...FILES, ...files })) if (text !== null) await save(join(root, rel), text);
  return root;
}
