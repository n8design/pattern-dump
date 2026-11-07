// The skin's Handlebars helpers: everything a page shows about its own structure is derived here, from
// the page's rendered body and the storefront's nav, never typed by an author. Pure functions (the same
// input gives the same output), so pd dev and pd build render the same page.
//
// Handlebars passes its options object as a helper's last argument; these helpers ignore it.

/** A nav entry as the storefront gives it to a page, with the page's own entry marked current. */
interface NavEntry {
  route: string;
  title: string;
  description?: string;
  current?: boolean;
  children?: NavEntry[];
}

/** Two digits: 1 → "01". */
const two = (n: number): string => String(n).padStart(2, "0");

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", "#x27": "'" };
/** The text of a fragment of rendered HTML: tags dropped, the entities renderDoc writes decoded. */
const textOf = (html: string): string =>
  html.replace(/<[^>]*>/g, "").replace(/&(amp|lt|gt|quot|#39|#x27);/g, (_, e: string) => ENTITIES[e]).trim();

const isNav = (v: unknown): v is NavEntry[] => Array.isArray(v);

/**
 * A rendered body cut at its h2 headings: the text before the first one, and one chapter per h2 with
 * its number, its heading's text and the HTML up to the next h2. The HTML is a slice of the body, as
 * trusted as the body itself (renderDoc escapes everything an author writes).
 */
export function skinChapters(body: unknown): { intro: string; chapters: Array<{ number: string; title: string; html: string }>; count: number } {
  const html = typeof body === "string" ? body : "";
  const parts = html.split(/(?=<h2[\s>])/);
  const intro = parts[0].startsWith("<h2") ? "" : parts.shift()!;
  const chapters = parts.map((part, i) => {
    const m = /^<h2[^>]*>([\s\S]*?)<\/h2>/.exec(part)!;
    return { number: two(i + 1), title: textOf(m[1]), html: part.slice(m[0].length).trim() };
  });
  return { intro: intro.trim(), chapters, count: chapters.length };
}

/**
 * The sections of the site: every top-level nav entry but the home page (the site's name links home),
 * numbered from 01. `inSection` marks the one the page is in, itself or one of its pages.
 */
export function skinSections(nav: unknown): Array<NavEntry & { number: string; inSection: boolean }> {
  if (!isNav(nav)) return [];
  return nav.filter(e => e.route !== "/").map((e, i) => ({
    ...e, number: two(i + 1), inSection: !!e.current || (e.children ?? []).some(c => c.current),
  }));
}

// The advance width of each printable ASCII character in Montserrat 900 (the skin's display face), in
// thousandths of an em, measured from the bench's own font file. With it a title's width is known before
// any browser lays it out, so its size can make it fill its column.
const MONTSERRAT_900: Record<string, number> = { "0": 692, "1": 418, "2": 608, "3": 614, "4": 712, "5": 619, "6": 661, "7": 645, "8": 678, "9": 661, "!": 314, "\"": 489, "#": 740, "$": 657, "%": 917, "&": 777, "'": 254, "(": 381, ")": 381, "*": 473, "+": 620, ",": 304, "-": 390, ".": 304, "/": 440, ":": 304, ";": 304, "<": 620, "=": 620, ">": 620, "?": 606, "@": 1037, "A": 806, "B": 773, "C": 737, "D": 826, "E": 673, "F": 644, "G": 769, "H": 804, "I": 350, "J": 574, "K": 765, "L": 617, "M": 954, "N": 804, "O": 848, "P": 743, "Q": 848, "R": 745, "S": 657, "T": 654, "U": 784, "V": 786, "W": 1206, "X": 762, "Y": 710, "Z": 687, "[": 410, "\\": 440, "]": 410, "^": 620, "_": 500, "`": 600, "a": 639, "b": 700, "c": 615, "d": 705, "e": 653, "f": 426, "g": 711, "h": 702, "i": 326, "j": 334, "k": 701, "l": 326, "m": 1040, "n": 702, "o": 678, "p": 700, "q": 700, "r": 456, "s": 565, "t": 460, "u": 698, "v": 644, "w": 977, "x": 645, "y": 644, "z": 570, "{": 438, "|": 320, "}": 438, "~": 620 };
/** A character the table does not have counts as an average one. */
const AVERAGE_ADVANCE = 600;
/** The display titles' tracking, in em per letter (--sk-title-tracking). */
const TITLE_TRACKING = -0.06;

/**
 * How wide a title's longest word is set in the display face, in em, tracking included: a poster
 * title is sized so that word fills its column (font-size = the column's width / this).
 */
export function skinTitleEm(title: unknown): number {
  const words = (typeof title === "string" ? title : "").split(/\s+/).filter(Boolean);
  const width = (word: string) => [...word].reduce((sum, ch) => sum + (MONTSERRAT_900[ch] ?? AVERAGE_ADVANCE), 0) / 1000
    + [...word].length * TITLE_TRACKING;
  const widest = Math.max(0, ...words.map(width));
  return widest > 0 ? Math.round(widest * 1000) / 1000 : 1;
}

/** What a page's marquee scrolls: its sections' headings, or on the home page the site's sections. */
export function skinMarquee(body: unknown, nav: unknown): string[] {
  return skinAtHome(nav) ? skinSections(nav).map(s => s.title) : skinChapters(body).chapters.map(c => c.title);
}

/** Whether the page is the home page. */
export function skinAtHome(nav: unknown): boolean {
  return isNav(nav) && nav.some(e => e.route === "/" && !!e.current);
}

/** On a folder's own page, the folder's pages, numbered from 01 (with their descriptions); elsewhere none. */
export function skinSectionPages(nav: unknown): Array<NavEntry & { number: string }> {
  const section = skinSections(nav).find(s => s.current);
  return (section?.children ?? []).map((c, i) => ({ ...c, number: two(i + 1) }));
}

/** The page's place in the nav: "00" for the home page, "01" for a section, "01.1" for its first page. */
export function skinIndex(nav: unknown): string {
  if (!isNav(nav)) return "—";
  if (nav.some(e => e.route === "/" && e.current)) return "00";
  for (const s of skinSections(nav)) {
    if (s.current) return s.number;
    const at = (s.children ?? []).findIndex(c => c.current);
    if (at >= 0) return `${s.number}.${at + 1}`;
  }
  return "—";
}

/** The page after this one in nav order (home, each section, its pages), the last wrapping to the first. */
export function skinNext(nav: unknown): { route: string; title: string } | null {
  if (!isNav(nav)) return null;
  const order = nav.flatMap(e => [e, ...(e.children ?? [])]);
  const at = order.findIndex(e => e.current);
  if (at < 0 || order.length < 2) return null;
  const next = order[(at + 1) % order.length];
  return { route: next.route, title: next.title };
}
