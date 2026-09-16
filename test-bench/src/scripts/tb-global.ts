// Global behaviour script (config.globalScripts) — loaded into EVERY preview, after markup.
// (1) A DOM mutation on load, provable in every preview regardless of component.
document.body.setAttribute("data-tb-global", "loaded");
// (2) Wire a dialog trigger — behaviour, not just loading: click the button → dialog opens.
const trigger = document.querySelector<HTMLElement>("[data-tb-open]");
const dialog = document.querySelector<HTMLDialogElement>("dialog.tb-dialog");
if (trigger && dialog) {
  trigger.addEventListener("click", () => dialog.showModal());
}
