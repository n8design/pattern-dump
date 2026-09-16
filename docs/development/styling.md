# Styling Guide — `apps/dev-ui` shell

> The working guide for how the **dev-tool shell** is styled. The preview contract in
> [CONTRIBUTING.md](../../CONTRIBUTING.md) is the hard rule; this is the _how_ and the _why_. It governs the shell's own markup only — it does
> **not** change how a documented design system (e.g. hTWOo's `hoo-` classes) is authored; that lives
> inside the preview iframe and is the design system's business, not ours.

## The model in one breath

OOCSS **object classes** for structure + **bare adjective classes** for app-only state; **modular SCSS**
in folders-by-layer; **state read from the DOM** (native → legitimate ARIA → `data-*`), never duplicated
into bookkeeping classes; **cascade controlled by `@layer`**, not specificity hacks. No BEM, no `is-`
prefix, no web components, no shadow DOM.

---

## 1. SCSS architecture (folders by layer)

Authored in `.scss`, compiled to one stylesheet via the module system — **`@use` / `@forward`, never
`@import`**. Folders by layer, each with an `_index.scss` that `@forward`s its partials; a thin entry
(`shell.scss`) `@use`s the layers in order:

- **`abstracts/`** — `$variables`, functions, mixins. **Emits no CSS.** Compile-time only, so it is _not_
  a cascade layer. Shared patterns (`resizable`, `scroll-region`) live here as mixins.
- **`base/`** — `:root` custom properties, element defaults, reset. Authored at **zero specificity**
  (wrap resets/defaults in `:where()`) so everything downstream wins without effort.
- **`layout/`** — the arranging grids only (`.app`, `.main`) — track definitions, grid-areas, the
  region scaffolding. No cosmetic detail.
- **`regions/`** — one partial per object/region (`.sidebar`, `.toolbar`, `.preview`, `.dock`,
  `.panel`, …). The bulk of the cosmetics.

No hand-authored `.css`, no monolithic stylesheet, no flat dumping-ground partial.

### Cascade layers map onto the emitting folders

```scss
@layer base, layout, regions;
```

Declare the order **once**, up front, so source order inside files stops mattering and you never reach
for `!important`. `base` is lowest, `regions` highest. (`abstracts/` emits nothing, so it isn't in the
list.) A future `theme`/`overrides` layer can be appended on the right when the shell skin arrives.

---

## 2. Naming — OOCSS, never BEM

- **Objects** name structure: `.sidebar`, `.sidebar-list`, `.toolbar`, `.preview`, `.dock`, `.panel`.
  Reusable, single-purpose, composable.
- **Bare adjective classes** name _app-only_ state: `active`, `collapsed`, `dragging` — **no `is-`
  prefix**, no `block__element--modifier`. These are the _case-3_ state hook (see §3) — used only when
  the state has no DOM/native/ARIA representation.
- Never encode in a class anything the DOM already says (selection, expansion, disabled, hidden) — see
  the state ladder below.

---

## 3. State — the selector ladder (the important one)

Read state from what the DOM already exposes, in **priority order**. Reach for the next rung only when
the one above doesn't apply.

**(1) Native HTML state — first choice.**
The platform already tracks it; style off the pseudo-class / native attribute.

- `:disabled`, `:checked`, `:required`, `:user-invalid`, `:placeholder-shown`
- `[open]` / `:open` on `<details>` (the nav tree's expand state)
- `[hidden]` (inactive tab panels)
- `:focus-visible`, `:focus-within`
  > _No ARIA is better than bad ARIA._ If a native element/attribute expresses the state, don't add ARIA.

**(2) Legitimate, already-present ARIA — second choice.**
Where the component genuinely has an accessibility semantic and the attribute is there for AT reasons,
style **off that attribute** — it welds the visual and accessible state together so they cannot drift.

- `[aria-selected="true"]` — the active dock tab (not a separate `.active`)
- `[aria-current="page"]` / `[aria-current="true"]` — the selected tree node
- `[aria-expanded="true"]` — a disclosure toggle
  > This is the whole point of the ladder: a tab styled via `[aria-selected]` **cannot** look selected
  > without _being_ selected to a screen reader. The single most common a11y bug — `.active` class out of
  > sync with ARIA — becomes structurally impossible.

**(3) `data-*` or a bare adjective class — last choice.**
For app/visual-only state that means **nothing** to assistive tech.

- `data-visibility="private"` for the internals toggle's hidden components (app state, not an AT
  semantic → `data-*`, not ARIA)
- `.collapsed` on a region the user shrank, `.dragging` during a splitter drag

**The hard rule: never add an `aria-*` attribute purely as a styling hook.** ARIA lands in the
accessibility tree and is announced. Inventing `aria-*` for a CSS selector misinforms screen-reader
users. If the state isn't a real accessibility semantic, it's a `data-*` (rung 3), full stop.

---

## 4. Selectors over bookkeeping classes

Prefer relational/structural selectors to classes that merely mirror the DOM:

- **`:has()`** — parent-reflects-child. `figcaption:has(.notes-marker)` styles a caption _because_ it
  contains a marker; no `.has-notes` class. Style the marker itself if that's all you need — its
  presence is the signal.
- **`:empty`** — empty states without a flag. `.console:empty::after { content: "No output"; … }`.
- **`:nth-child` / `:first-child` / `:last-child` / `:only-child`** — position-driven rules (list
  dividers, first/last spacing) without marker classes.
- **`:is()` / `:where()`** — group selectors; `:where()` contributes **zero specificity** (ideal for
  base/reset and theme defaults so region classes always win), `:is()` keeps the specificity of its
  most specific argument.
- **`:focus-within`** — light a region when something inside it has focus, no JS, no `.has-focus`.

---

## 5. Cascade & specificity

- **`@layer base, layout, regions`** declared once (see §1) — deterministic order, no `!important`.
- **`:where()`** for resets/defaults → zero specificity, so authored region styles win cleanly.
- Keep selectors shallow; lean on layers + `:where()` rather than long descendant chains.
- **`@scope`** (donut scoping) is the _eventual_ per-region encapsulation — **not used until the skin
  arrives** (forward-looking, §9). Until then, OOCSS + layers are the encapsulation.

---

## 6. Units & sizing

In short (also summarised in [architecture.md](architecture.md#conventions)):

- **Type & text-spacing → `rem`/`em`** (respects the user's font-size setting).
- **Grid structure → `fr` / `auto` / `%` / `min-content` / `max-content`**.
- **Layout/chrome dimensions → `vw` (widths) / `vh` (heights)**, including `min`/`max` bounds.
- **Hairline borders → `px`**. `px` otherwise **only** inside media/container _query conditions_.
- **`clamp()` / `min()` / `max()`** for fluid bounds — the resize splitter writes a `vw`/`vh` track
  value bounded by `clamp()`; never authors or stores `px` for layout.
- **Grid/flex scroll fix:** give scrolling grid/flex children `min-height: 0` / `min-width: 0` so they
  actually shrink-and-scroll instead of overflowing the IDE panes.

---

## 7. Responsiveness — container queries, not viewport

The shell is a resizable IDE: the panel, the dock, the preview figure, and the gallery items change size
because the user dragged a divider, **not** because the window changed. So component-local responsiveness
should react to the **container**, not the viewport:

- **`@container`** (size queries) for region/component-local breakpoints — the panel reflows on _its_
  width, the gallery switches columns on _its_ width.
- **media queries** only for genuinely viewport/device concerns.
- `px` is allowed in both kinds of _query conditions_ (breakpoints are pixel-thinking) — see §6.

---

## 8. Theming

Three independent systems (don't conflate them):

1. **Shell theme** — the dev tool's own light/dark. **Post-alpha** (TBD). When built: `:root {
color-scheme: light dark }`, design tokens as custom properties, and **`light-dark()`** for token
   values so you avoid duplicate `[data-theme]` blocks.
2. **Component theme** — `data-theme` on the preview `<body>` _inside the iframe_ (persisted in
   sessionStorage). This is the documented design system's theming; the shell sets the attribute but
   does not style its internals.
3. **Shiki syntax theme** — the highlighted source follows the OS via `prefers-color-scheme`.

Always-on, cheap, do now:

- **`color-scheme: light dark`** on `:root` so native controls (the variant `<select>`, scrollbars,
  focus rings) match the active scheme in both modes.

---

## 9. Accessibility hooks (a11y is asserted from day 1 — axe in E2E)

- **`:focus-visible`** for keyboard focus rings (don't kill outlines; restyle them).
- **`prefers-reduced-motion`** — gate transitions/animations (and any splitter snap/transition) behind
  it; honor "reduce".
- **`forced-colors` / `prefers-contrast`** — don't rely on color alone; keep focus and selection visible
  under Windows High Contrast / forced-colors.
- ARIA id wiring (labelledby/controls/owns) must cross component boundaries — **one more reason there is
  no shadow DOM** in the shell.

---

## 10. Hygiene

- **Logical properties** — `margin-inline`, `padding-block`, `inset`, `border-inline` — direction-
  independent by default.
- **`gap`** for spacing inside flex/grid, not margin hacks.
- One purpose per object class; compose, don't subclass.

---

## 11. Forward-looking (NOT alpha — note, don't mandate)

Reach for these when the relevant feature arrives (mostly the shell skin and future menus/overlays);
support is newer, so they stay out of the alpha:

- **`@scope`** — per-region donut encapsulation when the skin lands (§5).
- **`inert`** — disable + remove-from-AT a background subtree behind an overlay, instead of a manual
  focus-trap dance.
- **Popover API (`popover` + `::backdrop`)** — native menus/tooltips without JS state classes.
- **`<dialog>`** — modal/non-modal with built-in focus management.
- **CSS anchor positioning** (`anchor()` / `position-anchor`) — tether popovers/tooltips to triggers
  without JS positioning math.
- **Container _style_ queries** (`@container style(--x: y)`) — react to a custom-property "state" (pairs
  with the splitter's `--pd-*` props); support still maturing.

---

## 12. Enforcement — who checks what

Not everything here can be a lint rule. Stylelint owns the mechanical, CSS-source rules (deterministic,
runs in the green gate); **axe** (in the Playwright E2E) validates ARIA at runtime; a few "must exist /
must be ordered" items need a small **custom plugin** or stay **review**. The split:

| Guide rule                                                          | Checker                               | How                                                                                                                           |
| ------------------------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| No `@import` (§1)                                                   | **Stylelint**                         | `at-rule-disallowed-list: ["import"]`                                                                                         |
| No `!important` (§5)                                                | **Stylelint**                         | `declaration-no-important`                                                                                                    |
| OOCSS kebab classes; no `is-`/`has-`, no BEM (§2)                   | **Stylelint**                         | `selector-class-pattern` (negative lookahead)                                                                                 |
| No `px` for layout/type; rem for type (§6, #9)                      | **Stylelint**                         | `unit-disallowed-list` (border/outline/radius/shadow + query-condition exceptions) + `declaration-property-unit-allowed-list` |
| Low specificity so layers win (§5)                                  | **Stylelint** (warn)                  | `selector-max-specificity: 0,4,0`                                                                                             |
| Banning _named_ mirror classes, e.g. a stray `.active` (§3/§4)      | **Stylelint** (opt)                   | `selector-disallowed-list`                                                                                                    |
| ARIA is _valid_ (refs resolve, roles have required states) (§3)     | **axe**                               | runtime, in the E2E suite                                                                                                     |
| Native state first; ARIA _legitimate_, not a styling hook (§3)      | **review**                            | intent — CSS can't judge it; axe catches only broken ARIA                                                                     |
| `:has()`/structural over bookkeeping classes (§4)                   | **review**                            | intent (named offenders → `selector-disallowed-list`)                                                                         |
| `@layer base, layout, regions` declared in order (§1/§5)            | **custom plugin** / review            | Stylelint disallows, it doesn't _require_ a declaration                                                                       |
| `:root { color-scheme: light dark }` present (§8)                   | **custom plugin** / review            | same — "must exist" needs custom                                                                                              |
| Container query vs viewport appropriateness (§7)                    | **review**                            | intent                                                                                                                        |
| Modular folders-by-layer, no monolith (§1)                          | **CI script** / review                | file/folder structure, not CSS content                                                                                        |
| `min-height: 0` scroll fix; `prefers-reduced-motion` gating (§6/§9) | **review**                            | coverage/intent                                                                                                               |
| `:focus-visible` rings; `forced-colors` safe (§9)                   | **review** (+ axe for focus presence) |                                                                                                                               |
| No web components / shadow DOM (§1)                                 | **review** / ESLint                   | not a CSS concern                                                                                                             |

Rule of thumb: if a violation is visible in the stylesheet text, Stylelint should catch it; if it's about
_markup semantics or intent_, it's axe or a human. Don't ask the manual audit to do the machine's job.

### Including a variant by handle

A variant handle contains `~` (e.g. `atoms-badge~info`). When you include one as a partial,
**quote it**:

    {{> "atoms-badge~info" }}    ✓ resolves
    {{> atoms-badge~info }}      ✗ ~ is read as whitespace control, mis-parses

`~` is Handlebars' whitespace-control character (`{{~`, `~}}`), so an unquoted `~` inside a
partial name is consumed by the parser before resolution ever runs. Quoting makes it a literal
string. This is standard Handlebars behaviour for any partial whose name contains non-identifier
characters — not a Pattern Dump rule.

Base handles need no quotes (`{{> atoms-badge }}`); only variant handles do. The `~` is the
variant marker everywhere it appears — id `atoms/badge~info`, handle, and route — and the quotes
are simply how Handlebars' include syntax accepts it. Both variant kinds (own-markup
`name~variant.hbs` and data-overlay `name~variant.json`) are included the same way, by handle.

## Quick do / don't

**Do**

- Style the active tab via `[aria-selected="true"]`, the open node via `details[open]`, the disabled
  control via `:disabled`.
- Use `:has()` / `:empty` / `:focus-within` instead of mirror classes.
- Declare `@layer base, layout, regions` once; use `:where()` for resets.
- Size chrome in `vw`/`vh`, type in `rem`; respond with `@container`.

**Don't**

- Add `aria-*` to get a CSS hook.
- Write `.is-active`, `.has-notes`, `block__el--mod`.
- Use `@import`, a monolithic stylesheet, or `!important` to win a fight `@layer` should settle.
- Make components respond to the _viewport_ when they should respond to their _container_.
- Reach for shadow DOM.

---

_Companion to [CONTRIBUTING.md](../../CONTRIBUTING.md) and [architecture.md](architecture.md)._
