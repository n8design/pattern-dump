# graph-properties

The custom properties in the graph (`uses-property`, `declares`), on a project shaped like hTWOo where it matters:

- `src/styles/organisms/_cards.scss` holds two components' rules (the document card's and the tile's), so its file
  name maps to neither and its classes are owned by the base layer. A use reaches the component through the class
  its template writes, never through the stylesheet's name.
- `src/styles/base/_colors.scss` has a Sass variable holding a `var()`, and `_mixins.scss` a mixin that writes one:
  both are read from the compiled rule that uses them.
- `.pp-doccard .pp-avatar` styles the avatar only inside the document card: a use in context.
- `themes/blue.theme.scss` is a bare `:root` theme and `themes/red.theme.scss` a `[data-theme]` one; `--pp-focus` is
  declared only in red.
- `atoms/grid` sets `--pp-cols` in its own `style` attribute, as hTWOo's checkbox group sets `--cols-desk`.
- `--pp-undeclared` is declared nowhere, and `--pp-runtime` is set by a script (the ignore list in the specs).

Used by `graph-properties.spec.ts`. Nothing here is copied from anywhere: every file is written for this fixture.
