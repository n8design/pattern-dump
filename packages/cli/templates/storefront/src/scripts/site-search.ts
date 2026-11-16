// The search component's behaviour (components/search). pd build writes the site's index with Pagefind to
// _pd/search/ under the site's path, which <meta name="pd-base-path"> names; this loads it from there and searches in
// the browser. Without the index (npm run dev, or a project without Pagefind) the status line says so.

interface PagefindData {
  url: string;
  excerpt: string;
  meta: Record<string, string | undefined>;
  filters: Record<string, string[] | undefined>;
}
interface Pagefind {
  init(): Promise<void>;
  search(term: string, options?: { filters?: Record<string, string> }): Promise<{ results: Array<{ data(): Promise<PagefindData> }> } | null>;
  filters(): Promise<Record<string, Record<string, number>>>;
}

const base = document.querySelector<HTMLMetaElement>(`meta[name="pd-base-path"]`)?.content ?? "/";
let pagefind: Promise<Pagefind | null> | undefined;
const load = (): Promise<Pagefind | null> => pagefind ??= import(`${base}_pd/search/pagefind.js`)
  .then(async (m: Pagefind) => { await m.init(); return m; }, () => null);

/** The most results shown at once. */
const SHOWN = 20;

for (const root of document.querySelectorAll<HTMLElement>("[data-search]")) {
  const form = root.querySelector("form");
  const field = root.querySelector<HTMLInputElement>(`input[type="search"]`);
  const status = root.querySelector<HTMLElement>("[data-search-status]");
  const list = root.querySelector<HTMLElement>("[data-search-results]");
  if (!form || !field || !status || !list) continue;
  let section: HTMLSelectElement | null = null;
  let run = 0;

  const result = (d: PagefindData): HTMLLIElement => {
    const li = document.createElement("li");
    li.className = "search-result";
    const link = document.createElement("a");
    link.href = d.url;
    link.textContent = d.meta["title"] ?? d.url;
    const heading = document.createElement("h2");
    heading.className = "search-result-title";
    heading.append(link);
    li.append(heading);
    const where = d.filters["section"]?.[0];
    if (where) {
      const p = document.createElement("p");
      p.className = "search-result-section";
      p.textContent = where;
      li.append(p);
    }
    const teaser = document.createElement("p");
    teaser.className = "search-result-teaser";
    // Pagefind's excerpt is the page's text, escaped, with the words found in <mark>.
    teaser.innerHTML = d.excerpt;
    li.append(teaser);
    return li;
  };

  const show = async (term: string): Promise<void> => {
    const mine = ++run;
    const words = term.trim();
    if (!words) { list.replaceChildren(); status.textContent = ""; return; }
    const pf = await load();
    if (mine !== run) return;
    if (!pf) { status.textContent = "Search works on the built site: this one has no search index."; return; }
    const filters = section?.value ? { section: section.value } : undefined;
    const found = await pf.search(words, filters ? { filters } : {});
    if (mine !== run || !found) return;
    const data = await Promise.all(found.results.slice(0, SHOWN).map(r => r.data()));
    if (mine !== run) return;
    list.replaceChildren(...data.map(result));
    const n = found.results.length;
    status.textContent = n === 0 ? `No results for "${words}".`
      : `${n} result${n === 1 ? "" : "s"} for "${words}"${n > SHOWN ? `, the first ${SHOWN} shown` : ""}.`;
  };

  // The words in the address, so a search can be linked and Back returns to it.
  const remember = (): void => {
    const url = new URL(location.href);
    if (field.value.trim()) url.searchParams.set("q", field.value.trim()); else url.searchParams.delete("q");
    if (section?.value) url.searchParams.set("section", section.value); else url.searchParams.delete("section");
    history.replaceState(null, "", url);
  };

  // A section list, once the index is loaded and has sections.
  void load().then(async pf => {
    if (!pf) return;
    const sections = Object.keys((await pf.filters())["section"] ?? {}).sort();
    if (!sections.length) return;
    const label = document.createElement("label");
    label.className = "search-label";
    label.htmlFor = "search-section";
    label.textContent = "Section";
    section = document.createElement("select");
    section.id = "search-section";
    section.name = "section";
    section.className = "search-section";
    section.append(new Option("All sections", ""), ...sections.map(s => new Option(s, s)));
    section.value = new URL(location.href).searchParams.get("section") ?? "";
    section.addEventListener("change", () => { remember(); void show(field.value); });
    form.append(label, section);
    if (section.value && field.value) void show(field.value);
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  field.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => { remember(); void show(field.value); }, 250);
  });
  form.addEventListener("submit", event => {
    event.preventDefault();
    clearTimeout(timer);
    remember();
    void show(field.value);
  });

  const asked = new URL(location.href).searchParams.get("q");
  if (asked) { field.value = asked; void show(asked); }
}
