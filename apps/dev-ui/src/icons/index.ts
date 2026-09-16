// Vendored Phosphor Icons (MIT — https://github.com/phosphor-icons/core).
// Single icon registry for the shell. Adding an icon = adding to this file only.
// Regular weight = collapsed/inactive. Fill weight = expanded/active.
// All SVG: aria-hidden="true", fill="currentColor", viewBox="0 0 256 256".

export type IconName =
  | "warning"     // Phosphor Warning           — regular  (disconnect notice)
  | "x"           // Phosphor X                 — regular  (full-page close)
  | "panel"       // Phosphor SquareHalf        — regular  (docs panel collapsed)
  | "panel-fill"  // Phosphor SquareHalf        — fill     (docs panel expanded)
  | "dock"        // Phosphor SquareHalfBottom  — regular  (source dock collapsed)
  | "dock-fill"   // Phosphor SquareHalfBottom  — fill     (source dock expanded)
  // Viewport cluster — regular + fill for presets/disco; regular-only for action.
  | "vp-fit"           // Phosphor CornersIn    — regular  (fit preset inactive)
  | "vp-fit-fill"      // Phosphor CornersIn    — fill     (fit preset active)
  | "vp-content"       // Phosphor FrameCorners — regular  (content preset inactive)
  | "vp-content-fill"  // Phosphor FrameCorners — fill     (content preset active)
  | "vp-mobile"        // Phosphor DeviceMobile — regular  (mobile preset inactive)
  | "vp-mobile-fill"   // Phosphor DeviceMobile — fill     (mobile preset active)
  | "vp-tablet"        // Phosphor DeviceTablet — regular  (tablet preset inactive)
  | "vp-tablet-fill"   // Phosphor DeviceTablet — fill     (tablet preset active)
  | "vp-desktop"       // Phosphor Monitor      — regular  (desktop preset inactive)
  | "vp-desktop-fill"  // Phosphor Monitor      — fill     (desktop preset active)
  | "vp-disco"         // Phosphor DiscoBall    — regular  (disco mode off)
  | "vp-disco-fill"    // Phosphor DiscoBall    — fill     (disco mode on)
  | "vp-fullpage"      // Phosphor CornersOut   — regular  (full-page action)
  // A11y CVD picker — signal carrier in collapsed summary.
  | "a11y"             // Phosphor PersonArmsSpread — regular  (UniversalAccess; primary signal carrier)
  // Custom icons (non-Phosphor) — stroke-based, currentColor, viewBox differs from Phosphor 256x256.
  | "chevron"          // Custom — rounded disclosure caret; stroke-based, currentColor, rotate on open
  | "external-link";   // Custom — box-arrow open-in-new; stroke-based, currentColor (diagnostics "See docs")

const ICONS: Record<IconName, string> = {
  "warning": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="1em" height="1em" aria-hidden="true"><path d="M236.8,188.09,149.35,36.22h0a24.76,24.76,0,0,0-42.7,0L19.2,188.09a23.51,23.51,0,0,0,0,23.72A24.35,24.35,0,0,0,40.55,224h174.9a24.35,24.35,0,0,0,21.33-12.19A23.51,23.51,0,0,0,236.8,188.09ZM222.93,203.8a8.5,8.5,0,0,1-7.48,4.2H40.55a8.5,8.5,0,0,1-7.48-4.2,7.59,7.59,0,0,1,0-7.72L120.52,44.21a8.75,8.75,0,0,1,15,0l87.45,151.87A7.59,7.59,0,0,1,222.93,203.8ZM120,144V104a8,8,0,0,1,16,0v40a8,8,0,0,1-16,0Zm20,36a12,12,0,1,1-12-12A12,12,0,0,1,140,180Z"/></svg>`,

  "x": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="1em" height="1em" aria-hidden="true"><path d="M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z"/></svg>`,

  "panel": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="1em" height="1em" aria-hidden="true"><path d="M200,40H56A16,16,0,0,0,40,56V200a16,16,0,0,0,16,16H200a16,16,0,0,0,16-16V56A16,16,0,0,0,200,40Zm-64,80h64v16H136Zm0-16V88h64v16Zm0,48h64v16H136Zm64-80H136V56h64ZM56,56h64V200H56ZM200,200H136V184h64v16Z"/></svg>`,

  "panel-fill": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="1em" height="1em" aria-hidden="true"><path d="M200,40H56A16,16,0,0,0,40,56V200a16,16,0,0,0,16,16H200a16,16,0,0,0,16-16V56A16,16,0,0,0,200,40ZM56,56h72V200H56Z"/></svg>`,

  "dock": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="1em" height="1em" aria-hidden="true"><path d="M200,40H56A16,16,0,0,0,40,56V200a16,16,0,0,0,16,16H200a16,16,0,0,0,16-16V56A16,16,0,0,0,200,40Zm0,16v64H56V56Zm-96,80v64H88V136Zm16,0h16v64H120Zm32,0h16v64H152Zm-96,0H72v64H56Zm144,64H184V136h16v64Z"/></svg>`,

  "dock-fill": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="1em" height="1em" aria-hidden="true"><path d="M200,40H56A16,16,0,0,0,40,56V200a16,16,0,0,0,16,16H200a16,16,0,0,0,16-16V56A16,16,0,0,0,200,40Zm0,16v72H56V56Z"/></svg>`,

  // ---- Viewport cluster ----

  "vp-fit": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="1em" height="1em" aria-hidden="true"><path d="M152,96V48a8,8,0,0,1,16,0V88h40a8,8,0,0,1,0,16H160A8,8,0,0,1,152,96ZM96,152H48a8,8,0,0,0,0,16H88v40a8,8,0,0,0,16,0V160A8,8,0,0,0,96,152Zm112,0H160a8,8,0,0,0-8,8v48a8,8,0,0,0,16,0V168h40a8,8,0,0,0,0-16ZM96,40a8,8,0,0,0-8,8V88H48a8,8,0,0,0,0,16H96a8,8,0,0,0,8-8V48A8,8,0,0,0,96,40Z"/></svg>`,

  "vp-fit-fill": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="1em" height="1em" aria-hidden="true"><path d="M152,96V48a8,8,0,0,1,13.66-5.66l48,48A8,8,0,0,1,208,104H160A8,8,0,0,1,152,96ZM96,152H48a8,8,0,0,0-5.66,13.66l48,48A8,8,0,0,0,104,208V160A8,8,0,0,0,96,152ZM99.06,40.61a8,8,0,0,0-8.72,1.73l-48,48A8,8,0,0,0,48,104H96a8,8,0,0,0,8-8V48A8,8,0,0,0,99.06,40.61ZM208,152H160a8,8,0,0,0-8,8v48a8,8,0,0,0,13.66,5.66l48-48A8,8,0,0,0,208,152Z"/></svg>`,

  // FrameCorners — bracket marks at four corners; the empty center represents the
  // content that the frame sizes itself to fit. Regular = inactive, fill = active.
  "vp-content": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="1em" height="1em" aria-hidden="true"><path d="M96,48H48V96a8,8,0,0,1-16,0V48A16,16,0,0,1,48,32H96a8,8,0,0,1,0,16ZM216,32H168a8,8,0,0,0,0,16h48V96a8,8,0,0,0,16,0V48A16,16,0,0,0,216,32Zm8,112a8,8,0,0,0-8,8v48H168a8,8,0,0,0,0,16h48a16,16,0,0,0,16-16V152A8,8,0,0,0,224,144ZM96,208H48V160a8,8,0,0,0-16,0v48a16,16,0,0,0,16,16H96a8,8,0,0,0,0-16Z"/></svg>`,

  "vp-content-fill": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="1em" height="1em" aria-hidden="true"><path d="M96,40H48A24,24,0,0,0,24,64v48a8,8,0,0,0,16,0V64a8,8,0,0,1,8-8H96a8,8,0,0,0,0-16ZM232,152a8,8,0,0,0-8,8v32H192a8,8,0,0,0,0,16h32a24,24,0,0,0,24-24V160A8,8,0,0,0,232,152ZM208,40H160a8,8,0,0,0,0,16h32v32a8,8,0,0,0,16,0V64A24,24,0,0,0,208,40ZM64,160a8,8,0,0,0-16,0v32a24,24,0,0,0,24,24H96a8,8,0,0,0,0-16H72Z"/></svg>`,

  "vp-mobile": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="1em" height="1em" aria-hidden="true"><path d="M176,16H80A24,24,0,0,0,56,40V216a24,24,0,0,0,24,24h96a24,24,0,0,0,24-24V40A24,24,0,0,0,176,16ZM72,64H184V192H72Zm8-32h96a8,8,0,0,1,8,8v8H72V40A8,8,0,0,1,80,32Zm96,192H80a8,8,0,0,1-8-8v-8H184v8A8,8,0,0,1,176,224Z"/></svg>`,

  "vp-mobile-fill": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="1em" height="1em" aria-hidden="true"><path d="M176,16H80A24,24,0,0,0,56,40V216a24,24,0,0,0,24,24h96a24,24,0,0,0,24-24V40A24,24,0,0,0,176,16ZM80,32h96a8,8,0,0,1,8,8v8H72V40A8,8,0,0,1,80,32Zm96,192H80a8,8,0,0,1-8-8v-8H184v8A8,8,0,0,1,176,224Z"/></svg>`,

  "vp-tablet": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="1em" height="1em" aria-hidden="true"><path d="M192,24H64A24,24,0,0,0,40,48V208a24,24,0,0,0,24,24H192a24,24,0,0,0,24-24V48A24,24,0,0,0,192,24ZM56,72H200V184H56Zm8-32H192a8,8,0,0,1,8,8v8H56V48A8,8,0,0,1,64,40ZM192,216H64a8,8,0,0,1-8-8v-8H200v8A8,8,0,0,1,192,216Z"/></svg>`,

  "vp-tablet-fill": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="1em" height="1em" aria-hidden="true"><path d="M192,24H64A24,24,0,0,0,40,48V208a24,24,0,0,0,24,24H192a24,24,0,0,0,24-24V48A24,24,0,0,0,192,24ZM64,40H192a8,8,0,0,1,8,8v8H56V48A8,8,0,0,1,64,40ZM192,216H64a8,8,0,0,1-8-8v-8H200v8A8,8,0,0,1,192,216Z"/></svg>`,

  "vp-desktop": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="1em" height="1em" aria-hidden="true"><path d="M208,40H48A24,24,0,0,0,24,64V176a24,24,0,0,0,24,24H208a24,24,0,0,0,24-24V64A24,24,0,0,0,208,40Zm8,136a8,8,0,0,1-8,8H48a8,8,0,0,1-8-8V64a8,8,0,0,1,8-8H208a8,8,0,0,1,8,8Zm-48,48a8,8,0,0,1-8,8H96a8,8,0,0,1,0-16h64A8,8,0,0,1,168,224Z"/></svg>`,

  "vp-desktop-fill": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="1em" height="1em" aria-hidden="true"><path d="M232,64V176a24,24,0,0,1-24,24H48a24,24,0,0,1-24-24V64A24,24,0,0,1,48,40H208A24,24,0,0,1,232,64ZM160,216H96a8,8,0,0,0,0,16h64a8,8,0,0,0,0-16Z"/></svg>`,

  "vp-disco": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="1em" height="1em" aria-hidden="true"><path d="M120,64.37V16a8,8,0,0,0-16,0V64.37a88,88,0,1,0,16,0ZM183.54,144H151.77c-1.51-28.36-10.79-48.36-19.44-61.06A72.16,72.16,0,0,1,183.54,144Zm-95.3,16h47.52c-2,33.52-16.13,52.95-23.76,61.08C104.36,212.93,90.23,193.51,88.24,160Zm0-16c2-33.52,16.13-52.95,23.76-61.08,7.64,8.15,21.77,27.57,23.76,61.08Zm3.43-61.06C83,95.64,73.74,115.64,72.23,144H40.46A72.16,72.16,0,0,1,91.67,82.94ZM40.46,160H72.23c1.51,28.36,10.79,48.36,19.44,61.06A72.16,72.16,0,0,1,40.46,160Zm91.87,61.06c8.65-12.7,17.93-32.7,19.44-61.06h31.77A72.16,72.16,0,0,1,132.33,221.06ZM256,88a8,8,0,0,1-8,8h-8v8a8,8,0,0,1-16,0V96h-8a8,8,0,0,1,0-16h8V72a8,8,0,0,1,16,0v8h8A8,8,0,0,1,256,88ZM152,40a8,8,0,0,1,8-8h16V16a8,8,0,0,1,16,0V32h16a8,8,0,0,1,0,16H192V64a8,8,0,0,1-16,0V48H160A8,8,0,0,1,152,40Z"/></svg>`,

  "vp-disco-fill": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="1em" height="1em" aria-hidden="true"><path d="M120,64.37V16a8,8,0,0,0-16,0V64.37a88,88,0,1,0,16,0ZM183.54,144H151.77c-1.51-28.36-10.79-48.36-19.44-61.06A72.16,72.16,0,0,1,183.54,144Zm-47.78,16c-2,33.52-16.13,52.95-23.76,61.08-7.64-8.15-21.77-27.57-23.76-61.08ZM91.67,82.94C83,95.64,73.74,115.64,72.23,144H40.46A72.16,72.16,0,0,1,91.67,82.94ZM40.46,160H72.23c1.51,28.36,10.79,48.36,19.44,61.06A72.16,72.16,0,0,1,40.46,160ZM256,88a8,8,0,0,1-8,8h-8v8a8,8,0,0,1-16,0V96h-8a8,8,0,0,1,0-16h8V72a8,8,0,0,1,16,0v8h8A8,8,0,0,1,256,88ZM152,40a8,8,0,0,1,8-8h16V16a8,8,0,0,1,16,0V32h16a8,8,0,0,1,0,16H192V64a8,8,0,0,1-16,0V48H160A8,8,0,0,1,152,40Z"/></svg>`,

  "vp-fullpage": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="1em" height="1em" aria-hidden="true"><path d="M216,48V88a8,8,0,0,1-16,0V56H168a8,8,0,0,1,0-16h40A8,8,0,0,1,216,48ZM88,200H56V168a8,8,0,0,0-16,0v40a8,8,0,0,0,8,8H88a8,8,0,0,0,0-16Zm120-40a8,8,0,0,0-8,8v32H168a8,8,0,0,0,0,16h40a8,8,0,0,0,8-8V168A8,8,0,0,0,208,160ZM88,40H48a8,8,0,0,0-8,8V88a8,8,0,0,0,16,0V56H88a8,8,0,0,0,0-16Z"/></svg>`,

  // ---- A11y CVD picker ----

  "a11y": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor" width="1em" height="1em" aria-hidden="true"><path d="M160,40a32,32,0,1,0-32,32A32,32,0,0,0,160,40ZM128,56a16,16,0,1,1,16-16A16,16,0,0,1,128,56ZM231.5,87.71A19.62,19.62,0,0,0,212,72H44a20,20,0,0,0-8.38,38.16l.13,0,50.75,22.35-21,79.72A20,20,0,0,0,102,228.8l26-44.87,26,44.87a20,20,0,0,0,36.4-16.52l-21-79.72,50.75-22.35.13,0A19.64,19.64,0,0,0,231.5,87.71Zm-17.8,7.9-56.93,25.06a8,8,0,0,0-4.51,9.36L175.13,217a7,7,0,0,0,.49,1.35,4,4,0,0,1-5,5.45,4,4,0,0,1-2.25-2.07,6.31,6.31,0,0,0-.34-.63L134.92,164a8,8,0,0,0-13.84,0L88,221.05a6.31,6.31,0,0,0-.34.63,4,4,0,0,1-2.25,2.07,4,4,0,0,1-5-5.45,7,7,0,0,0,.49-1.35L103.74,130a8,8,0,0,0-4.51-9.36L42.3,95.61A4,4,0,0,1,44,88H212a4,4,0,0,1,1.73,7.61Z"/></svg>`,

  // ---- Custom (non-Phosphor) — stroke-based, viewBox 0 0 16 16 ----

  "chevron": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" width="1em" height="1em" aria-hidden="true" shape-rendering="geometricPrecision"><path d="M6 3.5 L10.5 8 L6 12.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,

  // Box-arrow "open in new / external link". Same custom-stroke idiom as chevron: viewBox 0 0 16 16,
  // fill none, currentColor, round caps/joins. Box (open at its top-right) + an arrow escaping to the
  // top-right corner. Slightly lighter stroke (1.5) than the chevron since it carries more detail.
  "external-link": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" width="1em" height="1em" aria-hidden="true" shape-rendering="geometricPrecision"><path d="M12 8.7 V12.5 A1.3 1.3 0 0 1 10.7 13.8 H3.5 A1.3 1.3 0 0 1 2.2 12.5 V5.3 A1.3 1.3 0 0 1 3.5 4 H7.3 M9.8 2.2 H13.8 V6.2 M13.8 2.2 L7.4 8.6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
};

export function svgIcon(name: IconName): string {
  return ICONS[name];
}
