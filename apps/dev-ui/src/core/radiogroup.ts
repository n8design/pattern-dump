// The APG roving-tabindex pattern for a radiogroup.
//
// Lives in core/, not in a region, because it is genuinely shared: the CVD type picker (rail) and
// the viewport toolbar (stage) both use it. Either region owning it would force the other to import
// across a boundary, which the ESLint region rule rejects — and rightly, since this is generic
// keyboard behaviour with no region identity.

// APG radiogroup keyboard pattern: roving tabindex + arrow-key navigation with wrap.
// Space/Enter delegate to click so all state writes stay in one place.
// Reusable: pass any [role="radiogroup"] container; state writes stay in each button's click listener.
export function setupRadiogroupKeyboard(group: HTMLElement): void {
  group.addEventListener("keydown", (e: KeyboardEvent) => {
    const radios = [...group.querySelectorAll<HTMLButtonElement>("[role='radio']")];
    const focused = radios.indexOf(document.activeElement as HTMLButtonElement);
    if (focused === -1) return;
    let next = -1;
    if      (e.key === "ArrowRight" || e.key === "ArrowDown")  { next = (focused + 1) % radios.length; }
    else if (e.key === "ArrowLeft"  || e.key === "ArrowUp")    { next = (focused - 1 + radios.length) % radios.length; }
    else if (e.key === " " || e.key === "Enter") { radios[focused].click(); e.preventDefault(); return; }
    else return;
    e.preventDefault();
    radios[next].focus();
    radios[next].click();
  });
}
