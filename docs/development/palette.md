# Pattern Dump — Design Palette (canonical source of truth)

This file is the **single point of truth** for the shell's design-language colors.
Every shell color anchor is defined here, with its hex, OKLCH, role, and basis. The token layer (`_root.scss` / `_palette.scss`) transcribes these; it
does not invent values. If a color is not here, it is not a shell anchor.

---

## The system — two temperatures

The shell runs on two temperature families with non-overlapping jobs:

- **Cool** (hue ~245–248): structure and text. Surface, ink, the border ladder.
  This is the Braun/Rams plane — the flat field and the Slate Blue ink belong to
  the same cool family, which is why text sits _in_ the plane rather than on it.
- **Warm**: signal and warm structure. One loud accent (the live signal) and one
  quiet structural warm (the sand hairline). Both descend from warm lineages —
  Mirror's Edge Catalyst red for the signal, Braun orange for the structure.

Discipline: **the accent is the sole live color, and it carries state, not
decoration.** Inert is neutral; active/selected/acquired is the accent. This is
Catalyst's own grammar (gray = locked/available, red = purchased/active) and it
is the rule, not a guideline.

---

## Cool family — structure + text

| Token                | Hex                                            | OKLCH (L C h)        | Role                   | Basis                                                                                                                                                                                                                                                                                                  |
| -------------------- | ---------------------------------------------- | -------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--pd-surface`       | `#F4F7FA`                                      | 97.5 · 0.005 · 247.9 | Plane / region fill    | Lightened from prior `#EEF1F4`, cool seam held (L raised, hue/chroma fixed)                                                                                                                                                                                                                            |
| `--pd-ink`           | `#3B4B59`                                      | 40.5 · 0.031 · 245.1 | Primary text           | Slate Blue — the one sourced original anchor                                                                                                                                                                                                                                                           |
| `--pd-ink-muted`     | `color-mix(in srgb, #3B4B59 80%, transparent)` | derived              | Secondary text         | Ink-derived; fades text not element, follows any dark-mode ink swap. **80%** — at 70% muted text on surface is 3.81:1 (fails AA-normal); 80% clears it (~4.9:1) while staying visibly secondary vs the 8.36:1 primary. Backdrop-dependent (it's alpha): valid while muted text sits on `--pd-surface`. |
| `--pd-ink-overlay`   | `color-mix(in srgb, #3B4B59 80%, transparent)` | derived              | Scrim (fullpage close) | Ink-derived at 80% — must be dark enough to keep white glyph legible over **arbitrary** preview content. 80% clears AA over the worst case (white backdrop: 5.15:1). 55% fails (2.79:1). Precompute `rgba(59,75,89,.8)` only if `color-mix` lints.                                                     |
| `--pd-border-rest`   | `#D4DAE0`                                      | ~86 · ~0.01 · ~245   | Region hairline, rest  | Existing cool ladder                                                                                                                                                                                                                                                                                   |
| `--pd-border-hover`  | `#B7C0C8`                                      | ~78 · ~0.01 · ~245   | Region hairline, hover | Existing cool ladder                                                                                                                                                                                                                                                                                   |
| `--pd-border-active` | `#9AA5AE`                                      | ~70 · ~0.01 · ~245   | Region hairline, drag  | Existing cool ladder                                                                                                                                                                                                                                                                                   |

Cool = region boundaries + text. Never carries signal.

---

## Warm family — signal + warm structure

| Token             | Hex       | OKLCH (L C h)       | Role                                       | Basis                                                                                                                                                     |
| ----------------- | --------- | ------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--pd-accent`     | `#CD0B0B` | 53.6 · 0.216 · 28.7 | **Sole live accent — state only**          | Mirror's Edge Catalyst UI active-node red, sampled from the progression screen (the deeper UI red, not the brighter banner red — "does not scream error") |
| `--pd-accent-ink` | `white`   | —                   | Text/glyph placed _on_ the accent          | White clears AA on `#CD0B0B` (5.76:1). Exists as a token so a themed brand color can flip it to dark — see Theming.                                       |
| `--pd-warm-sand`  | `#E0CCC5` | 86 · 0.025 · ~40    | Internal divider hairline (warm structure) | Braun orange desaturated — orange's lineage living quietly in the structure rather than as a second signal                                                |

### Accent contrast (sampled value, on the new surface)

| Pair                   | Ratio  | Gate |
| ---------------------- | ------ | ---- |
| `#CD0B0B` on `#F4F7FA` | 5.35:1 | AA ✓ |
| white on `#CD0B0B`     | 5.76:1 | AA ✓ |

The accent is **text-safe at this value**. A red node may hold a white glyph; a
red button may hold a white label. (The brighter Catalyst banner red `#E40909`,
L57.9, is recorded here as the accent's hot sibling/origin — _not_ a token. Do not
introduce it as a second accent; if a louder emphasis is ever needed it is a
lightness lift of `--pd-accent`, kept on one swap point.)

### Warm-sand origin

`--pd-warm-sand` descends from Braun orange `#E8530E` (L63.7 C0.196 h39.7) by
dropping chroma to ~0.025 and raising L to 86. Braun orange itself is **not** a
token — defining it at full chroma would invite a second loud color and break
sole-accent. Its lineage is present only as the desaturated sand. On-surface
contrast 1.43:1 — a hairline a touch firmer than the cool `--pd-border-rest`
(1.31:1), so warm internal division reads marginally stronger than cool region
edges. Intended.

---

## Theming architecture — the single-accent swap point

Sole-accent-as-state means the entire shell has **one live color**, so company /
tenant brand theming is a one-token override, not a coordination problem. This is
the structural payoff of the discipline and the hook the rail brand-theme-switcher
builds on.

Default ("house" theme) is the Catalyst red above. A brand theme overrides the
accent and its on-accent ink only:

```
:root {
  --pd-brand: #CD0B0B;          /* house default; a brand theme sets this */
  --pd-accent: var(--pd-brand);
  --pd-accent-ink: white;       /* brand theme flips to a dark ink if its
                                   brand color is light (e.g. a yellow brand) */
}
```

Everything that means "active/selected/acquired" resolves through `--pd-accent`,
so one override re-themes the shell. Two hard requirements for any brand override,
because an arbitrary brand color is not guaranteed legible:

1. **`--pd-accent` on `--pd-surface` must clear AA (≥4.5:1)** for the accent to
   carry small UI text/glyphs; ≥3:1 if used only as a non-text state fill.
2. **`--pd-accent-ink` on `--pd-accent` must clear AA.** Light brand colors flip
   this token to a dark ink; dark brand colors keep white.

The brand-theme switcher must verify both on the rendered DOM before accepting a
theme — a brand color that fails contrast is rejected or auto-adjusted, never
shipped silently. (Same verify-on-rendered-DOM gate as everything else.)

---

## Token definitions — for `_root.scss` / a new `_palette.scss`

`light-dark()` stub form, both slots identical (seed state; preserves the
dark-mode seam, consistent with existing tokens). Dark-mode values deferred.

```scss
/* ── Cool family — structure + text ── */
--pd-surface: light-dark(#f4f7fa, #f4f7fa);
--pd-ink: light-dark(#3b4b59, #3b4b59);
--pd-ink-muted: light-dark(
  color-mix(in srgb, #3b4b59 80%, transparent),
  color-mix(in srgb, #3b4b59 80%, transparent)
);
--pd-ink-overlay: light-dark(
  color-mix(in srgb, #3b4b59 80%, transparent),
  color-mix(in srgb, #3b4b59 80%, transparent)
);
/* border ladder unchanged: --pd-border-rest/hover/active */

/* ── Warm family — signal + warm structure ── */
--pd-brand: #cd0b0b; /* theming swap point */
--pd-accent: light-dark(var(--pd-brand), var(--pd-brand));
--pd-accent-ink: light-dark(white, white);
--pd-warm-sand: light-dark(#e0ccc5, #e0ccc5);
```

---

## Invariants

- **One live accent. It carries state.** Inert/locked/available = neutral;
  active/selected/acquired = `--pd-accent`. Never use the accent for everyday
  wayfinding or as a structural divider — gray is the absence of signal.
- **Cool carries structure + text; warm carries signal + warm hairline.** No
  crossover (no cool signal, no warm region edge).
- **Braun orange is not a token.** It exists only as the documented origin of
  `--pd-warm-sand`. Do not add a full-chroma orange.
- **The accent is the only theming override point.** Brand themes set `--pd-brand`
  (+ `--pd-accent-ink` if needed); nothing else.
- **Any themed accent re-verifies contrast on the rendered DOM** against the two
  gates above before it ships.

---

## Status / deferred

- **Unblocks FOUNDATION-B** — warm-sand and accent now have sourced anchors, so
  the previously-blocked tokens can be defined. FOUNDATION-A (ink, surface,
  ink-muted, ink-overlay, fullpage tokenize — all already sourced) can proceed in
  parallel and does not wait on this.
- **Divider → warm-sand wiring** remains a FOUNDATION-B decision (blast radius:
  10 separators + 6 control borders; the token should feed the 10 separator lines
  only — control box-borders are a separate styling choice).
- **Dark-mode values** — stubs only; deferred.
- **OKLCH ramp** (tonal ink step, ladder extension) — deferred to the ramp pass.
- **Exact accent value** — `#CD0B0B` is sampled from the Catalyst progression
  screen. If a binary-extracted value is pulled later it is a one-line swap of
  `--pd-brand`; the basis note updates accordingly.
