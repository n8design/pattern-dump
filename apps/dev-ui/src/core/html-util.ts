// HTML string helpers for the shell.
//
// Pure move out of main.ts. Both are leaves: no module state, no DOM refs. `extractHighlightedPre`
// does touch `document`, but only inside its body — importing this module in a node environment is
// safe, which is why the escape function below is unit-testable without jsdom.
//
// `escapeAttr` was called `escapeHtml` until the extraction commit before this one, which was a
// lie with teeth: dev-server exports BOTH names with different semantics, and its `escapeHtml`
// deliberately does NOT escape the quote (its own JSDoc warns it is unsafe for attributes). A
// maintainer who trusted the shared name would have reached for the wrong guarantee.
//
// The two implementations are in fact identical — `& " < >`, differing only in replacement order —
// so this is a pure rename with no behaviour change, and the repo now uses one word for one meaning.
//
// Used in TEXT contexts as well as attribute ones, on purpose: attribute-escaping is a strict
// superset of text-escaping, so the extra `&quot;` is inert (it renders as `"`). A separate
// `escapeText` would be more precise vocabulary but would change emitted bytes for no behavioural
// gain, and the `html` tag landing with sidebar.ts subsumes the distinction properly by making
// escaping the default rather than a call a human must remember.

export function extractHighlightedPre(containerHtml: string): string {
  const tmp = document.createElement("div");
  tmp.innerHTML = containerHtml;
  const pre = tmp.querySelector("pre");
  return pre ? pre.outerHTML : containerHtml;
}

export function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
