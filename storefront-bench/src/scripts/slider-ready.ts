// The slider's behaviour script (requireScript in its .md), a test fixture: it marks each slider it finds, so a
// test can tell from the rendered page that a placed component's script loaded.
for (const slider of document.querySelectorAll<HTMLElement>(".slider")) slider.dataset["ready"] = "true";
