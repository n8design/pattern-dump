// Whole-page fixtures for the page rule classifier (page-classifier.ts): for each candidate axe rule, a page that
// fails it and one that passes it. A rule is decided in jsdom when its failing page is a violation there and its
// passing page is clean (no violation, nothing incomplete); every other rule needs a browser.
//
// A rule without a fixture here (meta-viewport-large, skip-link, marquee and the rest of the tags' rules) is a browser
// rule: `pd build --browser` runs it.
//
// A page is a body (inside <main>, after its <h1>) on a sound document, or a whole document where the rule is about
// the document itself. The sound document passes every rule decided in jsdom.

export interface PageFixture { ruleId: string; fail: string; pass: string }

/** A sound page: language, title, one banner, one main with one h1, one contentinfo; `body` goes into main. */
export function page(body = "", o: { head?: string; html?: string } = {}): string {
  return `<!DOCTYPE html><html ${o.html ?? `lang="en"`}><head><meta charset="utf-8"><title>A page</title>${o.head ?? ""}</head>`
    + `<body><header><p>Site</p></header><main><h1>A page</h1>${body}</main><footer><p>Footer</p></footer></body></html>`;
}
/** A whole document, as written. */
const doc = (head: string, body: string, html = `lang="en"`) =>
  `<!DOCTYPE html><html ${html}><head><meta charset="utf-8">${head}</head><body>${body}</body></html>`;
const TITLE = "<title>A page</title>";

export const PAGE_FIXTURES: PageFixture[] = [
  // The document
  { ruleId: "document-title", fail: doc("", "<main><h1>T</h1></main>"), pass: page() },
  { ruleId: "html-has-lang", fail: page("", { html: "" }), pass: page() },
  { ruleId: "html-lang-valid", fail: page("", { html: `lang="xyz123"` }), pass: page() },
  { ruleId: "html-xml-lang-mismatch", fail: page("", { html: `lang="en" xml:lang="fr"` }), pass: page("", { html: `lang="en" xml:lang="en"` }) },
  { ruleId: "valid-lang", fail: page(`<p lang="xyz123">Text</p>`), pass: page(`<p lang="de">Text</p>`) },
  { ruleId: "meta-refresh", fail: page("", { head: `<meta http-equiv="refresh" content="5; url=/x/">` }), pass: page() },
  { ruleId: "meta-viewport", fail: page("", { head: `<meta name="viewport" content="width=device-width, user-scalable=no">` }),
    pass: page("", { head: `<meta name="viewport" content="width=device-width, initial-scale=1">` }) },
  { ruleId: "aria-hidden-body", fail: doc(TITLE, `<main><h1>T</h1></main>`).replace("<body>", `<body aria-hidden="true">`), pass: page() },
  // Landmarks and structure
  { ruleId: "landmark-one-main", fail: doc(TITLE, `<header><p>S</p></header><h1>T</h1><footer><p>F</p></footer>`), pass: page() },
  { ruleId: "page-has-heading-one", fail: doc(TITLE, `<main><h2>T</h2></main>`), pass: page() },
  { ruleId: "region", fail: doc(TITLE, `<p>Outside every landmark</p><main><h1>T</h1></main>`), pass: page() },
  { ruleId: "bypass", fail: doc(TITLE, `<div><a href="/a/">A</a> <a href="/b/">B</a></div>`), pass: page() },
  { ruleId: "landmark-no-duplicate-banner", fail: doc(TITLE, `<header><p>A</p></header><header><p>B</p></header><main><h1>T</h1></main>`), pass: page() },
  { ruleId: "landmark-no-duplicate-contentinfo", fail: doc(TITLE, `<main><h1>T</h1></main><footer><p>A</p></footer><footer><p>B</p></footer>`), pass: page() },
  { ruleId: "landmark-no-duplicate-main", fail: doc(TITLE, `<main><h1>T</h1></main><main><p>B</p></main>`), pass: page() },
  { ruleId: "landmark-unique", fail: page(`<nav><a href="/a/">A</a></nav><nav><a href="/b/">B</a></nav>`),
    pass: page(`<nav aria-label="One"><a href="/a/">A</a></nav><nav aria-label="Two"><a href="/b/">B</a></nav>`) },
  { ruleId: "landmark-banner-is-top-level", fail: page(`<div role="banner"><p>B</p></div>`), pass: page() },
  { ruleId: "landmark-contentinfo-is-top-level", fail: page(`<div role="contentinfo"><p>C</p></div>`), pass: page() },
  { ruleId: "landmark-main-is-top-level", fail: doc(TITLE, `<aside><main><h1>T</h1></main></aside>`), pass: page() },
  { ruleId: "heading-order", fail: page(`<h3>Too deep</h3>`), pass: page(`<h2>Next</h2>`) },
  { ruleId: "empty-heading", fail: page(`<h2></h2>`), pass: page(`<h2>A heading</h2>`) },
  // Lists and tables
  { ruleId: "list", fail: page(`<ul><p>Not an item</p></ul>`), pass: page(`<ul><li>Item</li></ul>`) },
  { ruleId: "listitem", fail: page(`<li>Alone</li>`), pass: page(`<ul><li>Item</li></ul>`) },
  { ruleId: "definition-list", fail: page(`<dl><p>Not a term</p></dl>`), pass: page(`<dl><dt>Term</dt><dd>Definition</dd></dl>`) },
  { ruleId: "dlitem", fail: page(`<dt>Alone</dt>`), pass: page(`<dl><dt>Term</dt><dd>Definition</dd></dl>`) },
  { ruleId: "td-headers-attr", fail: page(`<table><tr><th id="h">H</th></tr><tr><td headers="nope">1</td></tr></table>`),
    pass: page(`<table><tr><th id="h">H</th></tr><tr><td headers="h">1</td></tr></table>`) },
  { ruleId: "th-has-data-cells", fail: page(`<table><tr><th>A</th><th>B</th></tr></table>`),
    pass: page(`<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>`) },
  { ruleId: "scope-attr-valid", fail: page(`<table><tr><th scope="sideways">A</th></tr><tr><td>1</td></tr></table>`),
    pass: page(`<table><tr><th scope="col">A</th></tr><tr><td>1</td></tr></table>`) },
  { ruleId: "empty-table-header", fail: page(`<table><tr><th></th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>`),
    pass: page(`<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>`) },
  { ruleId: "table-duplicate-name", fail: page(`<table summary="Prices"><caption>Prices</caption><tr><th>A</th></tr><tr><td>1</td></tr></table>`),
    pass: page(`<table><caption>Prices</caption><tr><th>A</th></tr><tr><td>1</td></tr></table>`) },
  // Names
  { ruleId: "image-alt", fail: page(`<img src="a.png">`), pass: page(`<img src="a.png" alt="A">`) },
  { ruleId: "image-redundant-alt", fail: page(`<a href="/a/"><img src="a.png" alt="Home">Home</a>`), pass: page(`<a href="/a/"><img src="a.png" alt="">Home</a>`) },
  { ruleId: "input-image-alt", fail: page(`<form><input type="image" src="go.png"></form>`), pass: page(`<form><input type="image" src="go.png" alt="Go"></form>`) },
  { ruleId: "area-alt", fail: page(`<img src="m.png" alt="Map" usemap="#m"><map name="m"><area href="/a/" shape="rect" coords="0,0,9,9"></map>`),
    pass: page(`<img src="m.png" alt="Map" usemap="#m"><map name="m"><area href="/a/" shape="rect" coords="0,0,9,9" alt="A"></map>`) },
  { ruleId: "role-img-alt", fail: page(`<div role="img"></div>`), pass: page(`<div role="img" aria-label="A"></div>`) },
  { ruleId: "svg-img-alt", fail: page(`<svg role="img"><circle r="1"/></svg>`), pass: page(`<svg role="img" aria-label="A"><circle r="1"/></svg>`) },
  { ruleId: "object-alt", fail: page(`<object data="a.pdf"></object>`), pass: page(`<object data="a.pdf" aria-label="A"></object>`) },
  { ruleId: "server-side-image-map", fail: page(`<a href="/m/"><img src="m.png" alt="Map" ismap></a>`), pass: page(`<a href="/m/"><img src="m.png" alt="Map"></a>`) },
  { ruleId: "link-name", fail: page(`<a href="/a/"></a>`), pass: page(`<a href="/a/">A</a>`) },
  { ruleId: "button-name", fail: page(`<button></button>`), pass: page(`<button>Go</button>`) },
  { ruleId: "input-button-name", fail: page(`<input type="button">`), pass: page(`<input type="button" value="Go">`) },
  { ruleId: "summary-name", fail: page(`<details><summary></summary><p>More</p></details>`), pass: page(`<details><summary>More</summary><p>More</p></details>`) },
  { ruleId: "frame-title", fail: page(`<iframe src="about:blank"></iframe>`), pass: page(`<iframe src="about:blank" title="An example"></iframe>`) },
  { ruleId: "frame-title-unique", fail: page(`<iframe src="/a/" title="Ex"></iframe><iframe src="/b/" title="Ex"></iframe>`),
    pass: page(`<iframe src="/a/" title="Ex A"></iframe><iframe src="/b/" title="Ex B"></iframe>`) },
  // Forms
  { ruleId: "label", fail: page(`<form><input type="text"></form>`), pass: page(`<form><label>Name <input type="text"></label></form>`) },
  { ruleId: "label-title-only", fail: page(`<form><input type="text" title="Name"></form>`), pass: page(`<form><label>Name <input type="text"></label></form>`) },
  { ruleId: "select-name", fail: page(`<form><select><option>A</option></select></form>`), pass: page(`<form><label>Pick <select><option>A</option></select></label></form>`) },
  { ruleId: "form-field-multiple-labels", fail: page(`<form><label for="f">A</label><label for="f">B</label><input id="f" type="text"></form>`),
    pass: page(`<form><label for="f">A</label><input id="f" type="text"></form>`) },
  { ruleId: "autocomplete-valid", fail: page(`<form><label>Name <input type="text" autocomplete="foo"></label></form>`),
    pass: page(`<form><label>Name <input type="text" autocomplete="name"></label></form>`) },
  // Interaction
  { ruleId: "tabindex", fail: page(`<a href="/a/" tabindex="5">A</a>`), pass: page(`<a href="/a/">A</a>`) },
  { ruleId: "accesskeys", fail: page(`<a href="/a/" accesskey="x">A</a><a href="/b/" accesskey="x">B</a>`),
    pass: page(`<a href="/a/" accesskey="x">A</a><a href="/b/" accesskey="y">B</a>`) },
  { ruleId: "nested-interactive", fail: page(`<button><a href="/a/">A</a></button>`), pass: page(`<button>A</button>`) },
  { ruleId: "blink", fail: page(`<blink>Text</blink>`), pass: page(`<span>Text</span>`) },
  // ARIA
  { ruleId: "aria-valid-attr", fail: page(`<div aria-xyz="true">X</div>`), pass: page(`<div>X</div>`) },
  { ruleId: "aria-valid-attr-value", fail: page(`<button aria-pressed="maybe">X</button>`), pass: page(`<button aria-pressed="true">X</button>`) },
  { ruleId: "aria-allowed-attr", fail: page(`<button aria-checked="true">X</button>`), pass: page(`<button aria-pressed="true">X</button>`) },
  { ruleId: "aria-allowed-role", fail: page(`<h2 role="button">X</h2>`), pass: page(`<h2>X</h2>`) },
  { ruleId: "aria-roles", fail: page(`<div role="foo">X</div>`), pass: page(`<div role="note">X</div>`) },
  { ruleId: "aria-deprecated-role", fail: page(`<div role="directory"><p>X</p></div>`), pass: page(`<div role="list"><div role="listitem">X</div></div>`) },
  { ruleId: "aria-required-attr", fail: page(`<div role="checkbox" tabindex="0">C</div>`), pass: page(`<div role="checkbox" aria-checked="false" tabindex="0">C</div>`) },
  { ruleId: "aria-required-children", fail: page(`<div role="list"><span>X</span></div>`), pass: page(`<div role="list"><div role="listitem">X</div></div>`) },
  { ruleId: "aria-required-parent", fail: page(`<div role="listitem">X</div>`), pass: page(`<div role="list"><div role="listitem">X</div></div>`) },
  { ruleId: "aria-prohibited-attr", fail: page(`<div aria-label="X">Text</div>`), pass: page(`<nav aria-label="X"><a href="/a/">A</a></nav>`) },
  { ruleId: "aria-conditional-attr", fail: page(`<form><label>C <input type="checkbox" aria-checked="true"></label></form>`),
    pass: page(`<form><label>C <input type="checkbox"></label></form>`) },
  { ruleId: "aria-roledescription", fail: page(`<div aria-roledescription="thing">X</div>`), pass: page(`<button aria-roledescription="thing">X</button>`) },
  { ruleId: "aria-command-name", fail: page(`<div role="button" tabindex="0"></div>`), pass: page(`<div role="button" tabindex="0">Go</div>`) },
  { ruleId: "aria-input-field-name", fail: page(`<div role="textbox" tabindex="0"></div>`), pass: page(`<div role="textbox" tabindex="0" aria-label="Name"></div>`) },
  { ruleId: "aria-toggle-field-name", fail: page(`<div role="switch" aria-checked="false" tabindex="0"></div>`),
    pass: page(`<div role="switch" aria-checked="false" tabindex="0" aria-label="Dark"></div>`) },
  { ruleId: "aria-meter-name", fail: page(`<div role="meter" aria-valuenow="1" aria-valuemin="0" aria-valuemax="2"></div>`),
    pass: page(`<div role="meter" aria-valuenow="1" aria-valuemin="0" aria-valuemax="2" aria-label="Level"></div>`) },
  { ruleId: "aria-progressbar-name", fail: page(`<div role="progressbar"></div>`), pass: page(`<div role="progressbar" aria-label="Loading"></div>`) },
  { ruleId: "aria-tooltip-name", fail: page(`<div role="tooltip"></div>`), pass: page(`<div role="tooltip">Help</div>`) },
  { ruleId: "aria-dialog-name", fail: page(`<div role="dialog"><p>X</p></div>`), pass: page(`<div role="dialog" aria-label="Settings"><p>X</p></div>`) },
  { ruleId: "aria-treeitem-name", fail: page(`<div role="tree"><div role="treeitem"></div></div>`), pass: page(`<div role="tree"><div role="treeitem">A</div></div>`) },
  { ruleId: "aria-text", fail: page(`<p role="text"><a href="/a/">A</a></p>`), pass: page(`<p role="text">Plain</p>`) },
  { ruleId: "aria-hidden-focus", fail: page(`<div aria-hidden="true"><button>X</button></div>`), pass: page(`<div aria-hidden="true"><p>X</p></div>`) },
  { ruleId: "duplicate-id-aria", fail: page(`<span id="x">A</span><span id="x">B</span><form><input type="text" aria-labelledby="x"></form>`),
    pass: page(`<span id="x">A</span><form><input type="text" aria-labelledby="x"></form>`) },
  { ruleId: "presentation-role-conflict", fail: page(`<img src="a.png" alt="" role="presentation" aria-label="A">`), pass: page(`<img src="a.png" alt="">`) },
  // Expected to need a browser: in the candidate list so the classifier says so, not just leaves them out.
  { ruleId: "color-contrast", fail: page(`<p style="color:#bbb;background:#fff">Low contrast</p>`), pass: page(`<p style="color:#000;background:#fff">Text</p>`) },
];
