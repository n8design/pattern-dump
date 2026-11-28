// @pattern-dump/config/console
// The console lines PD prints: each starts with the label of its source ("[sass] CSS updated: base.scss"), and four
// labels and the severity words get a colour where the output takes colour. Whether it does is Node's own decision
// (FORCE_COLOR, NO_COLOR, NODE_DISABLE_COLORS, TERM and the stream), made here from the stream and the environment
// given, so the line builders are pure and testable with an explicit Terminal. Named colours go through
// util.styleText; the orange is a raw SGR sequence, since styleText takes no 256-colour code on Node 22.
import { styleText } from "node:util";
import { WriteStream } from "node:tty";

/** Where a line comes from. `reload` is a reload with no single source (a config change, the watcher itself). */
export type Source = "ts" | "sass" | "reload" | "components" | "site" | "images" | "audit" | "mcp" | "pd";

/** What an output stream takes: colour on or off, its colour depth in bits, and whether it is a terminal. */
export interface Terminal {
  colour: boolean;
  depth: 1 | 4 | 8 | 24;
  tty: boolean;
}

type Stream = Pick<NodeJS.WriteStream, "isTTY"> & Partial<Pick<NodeJS.WriteStream, "getColorDepth">>;

/**
 * What `stream` takes under `env`. Colour follows Node's own rule for util.styleText: with FORCE_COLOR set, the
 * environment decides whatever the stream is (Playwright and Nx set it for pipes); otherwise only a terminal with
 * more than 2 colours gets colour.
 */
export function terminal(stream: Stream = process.stdout, env: NodeJS.ProcessEnv = process.env): Terminal {
  const tty = stream.isTTY === true;
  const forced = env["FORCE_COLOR"] !== undefined;
  let depth: number = 1;
  if (tty && typeof stream.getColorDepth === "function") depth = stream.getColorDepth(env);
  else if (tty || forced) depth = WriteStream.prototype.getColorDepth.call(undefined, env);
  const colour = (forced || tty) && depth > 2;
  return { colour, depth: colour ? (depth as Terminal["depth"]) : 1, tty };
}

type Format = Parameters<typeof styleText>[0];
const STYLE: Partial<Record<Source, Format>> = {
  ts: ["bold", "blue"],
  sass: ["bold", "magenta"],
  components: ["bold", "cyan"],
};

/** `[source]`, bold and coloured for ts, sass, reload and components where `t` takes colour; plain otherwise.
 *  The other labels stay plain: `[site]`, `[images]`, `[audit]`, `[mcp]`, `[pd]`. */
export function label(source: Source, t: Terminal = terminal()): string {
  const text = `[${source}]`;
  if (!t.colour) return text;
  // Orange (256-colour 208) needs 256 colours and a terminal; else bright yellow.
  if (source === "reload") return t.tty && t.depth >= 8 ? `\x1b[1;38;5;208m${text}\x1b[39;22m` : styleText(["bold", "yellowBright"], text, { validateStream: false });
  const style = STYLE[source];
  return style ? styleText(style, text, { validateStream: false }) : text;
}

/** One console line: the source's label, then the text. */
export function line(source: Source, text: string, t: Terminal = terminal()): string {
  return `${label(source, t)} ${text}`;
}

const SEVERITY: Record<"error:" | "warning:" | "passed", Format> = {
  "error:": ["bold", "red"],
  "warning:": "yellow",
  passed: "green",
};

/** A severity word, red and bold, yellow or green where `t` takes colour. The word is always there. */
export function severity(word: "error:" | "warning:" | "passed", t: Terminal = terminal()): string {
  return t.colour ? styleText(SEVERITY[word], word, { validateStream: false }) : word;
}

/** The flame after a line that reloads the preview: only where colour is on and the output is a terminal. */
export function flame(t: Terminal = terminal()): string {
  return t.colour && t.tty ? " \u{1F525}" : "";
}

/**
 * Print one line through the console (so a spy on console.* sees it): info on console.log, decided for stdout;
 * warn and error on console.warn / console.error, decided for stderr.
 */
export function say(source: Source, text: string, level: "info" | "warn" | "error" = "info"): void {
  if (level === "info") console.log(line(source, text, terminal(process.stdout)));
  else if (level === "warn") console.warn(line(source, text, terminal(process.stderr)));
  else console.error(line(source, text, terminal(process.stderr)));
}
