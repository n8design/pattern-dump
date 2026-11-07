// Live examples' variant switchers. A live example whose component has variants lists them as links,
// each to that variant's preview, which is what a reader without scripting gets. With scripting, each
// link becomes a toggle button: pressing it swaps the example's frame to that variant in place (the page
// stays where it is), marks it pressed, and points the caption's id and workbench link at it.

for (const list of document.querySelectorAll<HTMLUListElement>("figure.doc-example .doc-example-variants")) {
  const figure = list.closest("figure")!;
  const frame = figure.querySelector("iframe")!;
  const id = figure.querySelector(".doc-example-id");
  const workbench = figure.querySelector<HTMLAnchorElement>("figcaption a");

  const buttons = [...list.querySelectorAll<HTMLAnchorElement>("a")].map(link => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = link.textContent;
    button.dataset["src"] = link.getAttribute("href") ?? "";
    button.setAttribute("aria-pressed", String(link.getAttribute("aria-current") === "true"));
    link.replaceWith(button);
    return button;
  });

  for (const button of buttons) {
    button.addEventListener("click", () => {
      const src = button.dataset["src"]!;
      const shown = decodeURIComponent(src.replace(/^\/preview\//, ""));
      frame.src = src;
      frame.title = shown;
      if (id) id.textContent = shown;
      if (workbench) {
        const url = new URL(workbench.href);
        const variant = shown.includes("~") ? shown.slice(shown.indexOf("~") + 1) : "";
        url.hash = variant;
        workbench.href = url.href;
        workbench.textContent = `Open ${shown} in the workbench`;
      }
      for (const other of buttons) other.setAttribute("aria-pressed", String(other === button));
    });
  }
}
