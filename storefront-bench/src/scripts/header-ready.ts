// The header's behaviour script (requireScript in its .md), a test fixture: it marks the header, so a test can
// tell from the rendered page that a script of a layout's composition loaded.
for (const header of document.querySelectorAll<HTMLElement>(".site-header")) header.dataset["ready"] = "true";
