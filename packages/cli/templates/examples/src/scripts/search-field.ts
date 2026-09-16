// Behaviour for molecules/search-field, loaded by `requireScript: [search-field]` in its .md.
//
// Runs as a module after the markup, in every preview that shows a search field — including pages
// that include one. Submitting would otherwise navigate the preview away; instead the query is
// announced in the field's status line.

function enhance(form: HTMLFormElement): void {
  const status = form.querySelector<HTMLElement>(".search-field-status");
  form.addEventListener("submit", (event: SubmitEvent) => {
    event.preventDefault();
    const query = String(new FormData(form).get("q") ?? "").trim();
    if (status) status.textContent = query ? `Searching for “${query}”` : "Type something to search";
  });
}

document.querySelectorAll<HTMLFormElement>("form.search-field").forEach(enhance);
