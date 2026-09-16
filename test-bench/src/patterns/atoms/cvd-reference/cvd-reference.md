---
title: CVD reference card
status: stable
visibility: public
---

A fixed colour-reference card — a calibration-chart analogue for the CVD rail simulator.
Load it, scrub the rail's type/severity, and watch confusion pairs collapse.

Four rows, each a verification job:

- **Row A** — red-green confusion line (protan/deutan probe). Adjacent patches a protanope/deuteranope confuses: red, green, orange, olive, brown, pink. Under protanopia/deuteranopia these flatten toward each other.
- **Row B** — blue-yellow confusion line (tritan probe). Blue, teal, yellow, violet, sky, rose. Collapse under tritanopia.
- **Row C** — saturated primaries + secondaries. Unambiguous hue anchors; shows how each pure hue shifts per deficiency.
- **Row D** — neutral ramp (control row). White to black via five grey steps. Must stay a clean neutral monotonic ramp under every filter — no colour cast. Under achromatopsia, the coloured rows should collapse toward this row's luminance.

Patches are **intentionally un-themed** — fixed sRGB values, not design tokens. Switching brand theme leaves the card byte-identical; see the SCSS comment.

A future automated ΔE-under-deficiency check will use this card as its substrate.
