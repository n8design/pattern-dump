# test-bench

A small design system that Pattern Dump runs against during development, and the fixture for the
end-to-end suite (`apps/dev-ui/e2e`). It is not a test suite itself (unit tests live in each package)
and not an example project: some components exist only to exercise edge cases, such as a broken
template, a deliberate handle collision or a component made of variants alone.

Run it from the repository root:

```bash
npm run dev          # pd dev against test-bench → http://localhost:4000
```

Some end-to-end specs write into this tree while they run and restore it afterwards, which is why
Playwright runs with a single worker.

## Fonts and images

| File | What it is | Licence |
|---|---|---|
| `assets/fonts/pd-test.woff2` | Mr Bedfort Regular, version 1.000, by Alejandro Paul ([Sudtipos](http://www.sudtipos.com)), under its open licence | SIL Open Font License 1.1, in `licenses/pd-test-OFL.txt` |
| `assets/images/symbols.svg` | A sprite of two icons, a star and a check, for the sprite and `<use>` specs. Both paths are the same as Feather's `star` and `check` icons; where they were copied from was not recorded | MIT, from [Feather](https://github.com/feathericons/feather), in `THIRD-PARTY-NOTICES.md` |
| `media/tb-sprite.svg` | A sprite of one circle | The repository's MIT licence |

`pd-test.woff2` is the whole font (231 characters, no subset) with the name and licence fields of the font itself.
It is used as it is: no glyph, table or name was changed, so the Reserved Font Name "Mr Bedfort" in the licence is
not in question. Despite its extension the data is TrueType, not WOFF2; the tests only need a font file that is
served and declared with `@font-face`. Where this copy was downloaded from was not recorded when it was added.
The licence text is kept in `licenses/`, not beside the font, because everything in `assets/` is published with
the workbench and with a static build.
