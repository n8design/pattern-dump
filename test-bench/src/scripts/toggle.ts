console.log("Toggle loaded and executed");

document.querySelectorAll<HTMLElement>("[data-toggle]").forEach((el) => {
  el.addEventListener("click", () => {
    console.log("Button Clicked 🏴‍☠️");
    const pressed = el.getAttribute("aria-pressed") === "true";
    el.setAttribute("aria-pressed", String(!pressed));
  });
});
document.body.setAttribute("data-script-loaded", "toggle");
