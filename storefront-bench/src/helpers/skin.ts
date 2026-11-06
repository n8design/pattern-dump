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

/** Whether the page is the home page. */
export function skinAtHome(nav: unknown): boolean {
  return isNav(nav) && nav.some(e => e.route === "/" && !!e.current);
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
