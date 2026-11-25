# Themes

A theme is a set of CSS custom-property values. Components use the properties; each theme gives them
values. The theme picker in the Nav Rail switches the preview between themes without a reload, and the
workbench's own look never changes with it.

## Writing a theme

Put one file per theme in the themes folder (`themes.dir`), named `<name>.theme.scss`:

```scss
// themes/light.theme.scss
[data-theme="light"] {
  --color-surface: #ffffff;
  --color-text: #1b1b1f;
  --color-primary: #0b5cad;
  --color-on-primary: #ffffff;
}
```

```scss
// themes/dark.theme.scss
[data-theme="dark"] {
  --color-surface: #16161a;
  --color-text: #ececf1;
  --color-primary: #7ab8ff;
  --color-on-primary: #0b1b2e;
}
```

Components use the properties, ideally with a fallback so a preview stays readable before a theme applies:

```scss
.button {
  background: var(--color-primary, #0b5cad);
  color: var(--color-on-primary, #ffffff);
}
```

**Every theme must use the same property names, and they must be the names your component CSS reads.**
A theme with differently named properties changes nothing.

Theme files are compiled like any other SCSS, so they can `@use` shared modules by relative path, or
an installed package by its name.

## Configuration

```ts
themes: {
  dir: "./themes",
  default: "light",
  switch: "attribute",
  swatch: { slots: ["--color-surface", "--color-primary", "--color-text"] },
},
```

- **`default`** is the theme a preview starts with, and the one baked into a static build.
- **`order`** is the picker's order (below).
- **`swatch.slots`** lists the properties shown as small colour swatches next to each of your own themes (those in
  `themes.dir`) in the picker. A pattern package's themes show `--bodyBackground`, `--themePrimary` and `--accent`.

## Order

The picker lists the themes sorted by name, wherever their files are: your own and your pattern packages' themes in
one list, the same on every machine. `themes.order` puts the themes you name first, in that order, and the rest
follow, sorted by name:

```ts
themes: {
  dir: "./themes",
  default: "teal",
  order: ["teal", "red", "purple", "orange", "green", "gray", "darkyellow", "darkblue", "blue", "teams.light", "teams.hc", "teams.dark"],
},
```

Names are sorted with numbers by their value, so `teal2` comes before `teal10`. A name in `order` that no theme has is
left out, and `pd dev` warns about it when it starts: `themes.order names "<name>", and no theme has that name: it is
left out of the order`. A theme you add while `pd dev` runs takes its place in the order.

## Switching

`themes.switch` decides how a preview changes theme:

- **`attribute`** (default): every theme stylesheet is linked into the preview, and the picker sets
  `data-theme="<name>"` on the preview's `<body>`. Use it when each theme is scoped to
  `[data-theme="<name>"]`, as above.
- **`stylesheet`**: only the active theme's stylesheet is linked, and the picker swaps it. Use it when
  themes set their properties on `:root` and would override each other if all were linked. The new theme's
  stylesheet loads beside the current one, which goes once the new one has loaded, so the preview is never without
  a theme. A stylesheet that fails to load leaves the current theme in place, and the Console says which theme
  failed. `data-theme` on the `<body>` names the theme in effect in this mode too.

Switching never reloads the preview: only values change, so its scroll position, an open dialog and anything typed
into a form stay as they are. A preview you open while a theme other than `default` is picked comes with that theme
from its first paint.

Theme stylesheets come after the base layer and before the component CSS in every preview; see
[what a preview contains](authoring.md#what-a-preview-contains).

Your own `themes.switch` wins over a pattern package's. Without one, `stylesheet` applies to all themes as soon as a
package needs it. When yours and a package's differ, `pd dev` says so when it starts: `themes.switch is "attribute",
and the pattern package <name> asks for "stylesheet": the project's setting is used`.

## Swatch values from JSON

The picker normally reads swatch colours from the compiled theme CSS, from its `[data-theme="<name>"]` rule. A theme
written on a bare `:root` (as `switch: "stylesheet"` allows) has no such rule, so its swatches stay empty unless it
provides them. A theme can provide them in
a sidecar file, `<name>.theme.json`, next to its `.theme.scss`, keyed by property name without the
leading `--`:

```json
{ "color-surface": "#ffffff", "color-primary": "#0b5cad", "color-text": "#1b1b1f" }
```

When the sidecar exists it is the only source for that theme's swatches; a slot missing from it shows
no colour.

## Themes and the workbench

The theme picker changes only the preview inside the Stage. The Nav Rail, Inspector and Console keep
their own look, and code in the Console follows your operating system's light or dark setting.
