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

Theme files are compiled like any other SCSS, so they can `@use` shared modules by relative path.

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
- **`swatch.slots`** lists the properties shown as small colour swatches next to each theme in the
  picker.

## Switching

`themes.switch` decides how a preview changes theme:

- **`attribute`** (default): every theme stylesheet is linked into the preview, and the picker sets
  `data-theme="<name>"` on the preview's `<body>`. Use it when each theme is scoped to
  `[data-theme="<name>"]`, as above.
- **`stylesheet`**: only the active theme's stylesheet is linked, and the picker swaps it. Use it when
  themes set their properties on `:root` and would override each other if all were linked.

Theme stylesheets come after the base layer and before the component CSS in every preview; see
[what a preview contains](authoring.md#what-a-preview-contains).

When pattern packages are used and any of them needs `stylesheet`, it applies to all themes.

## Swatch values from JSON

The picker normally reads swatch colours from the compiled theme CSS. A theme can instead provide them in
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
