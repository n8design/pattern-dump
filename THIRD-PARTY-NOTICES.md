# Third-party notices

Pattern Dump is MIT-licensed (see `LICENSE`). It includes code from the projects below, under their own
licences.

## github-slugger 2.0.0

- **Source:** https://github.com/Flet/github-slugger
- **Used in:** `packages/dev-server/src/storefront/slug.ts` (the slugger and its generated regex, ported
  unchanged) and `packages/dev-server/test/fixtures/github-slugger-2.0.0.json` (its test fixtures, copied
  unchanged).
- **Licence:** ISC

```
Copyright (c) 2015, Dan Flettre <fletd01@yahoo.com>

Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is
hereby granted, provided that the above copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE
INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF
USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT
OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

## Fonts in the repository

- **Mr Bedfort**, Alejandro Paul (Sudtipos), version 1.000, with Reserved Font Name "Mr Bedfort".
- **Used in:** `test-bench/assets/fonts/pd-test.woff2`, unmodified; its licence text is
  `test-bench/licenses/pd-test-OFL.txt`, and `test-bench/README.md` says what the file is. Not part of the npm package.
- **Licence:** SIL Open Font License 1.1.

The experimental skin's fonts (Montserrat, Source Serif 4, IBM Plex Mono) are listed, with their sources and
licences, in `skins/experimental/assets/skin-experimental/fonts/README.md`.

## Feather icons

- **Feather**, Cole Bemis: https://github.com/feathericons/feather
- **Used in:** `test-bench/assets/images/symbols.svg`: its `star` and `check` paths are the same as Feather's. Not
  part of the npm package.
- **Licence:** MIT

```
The MIT License (MIT)

Copyright (c) 2013-2017 Cole Bemis

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and
to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of
the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO
THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
IN THE SOFTWARE.
```

## Images in the repository

These files are in the git repository, in test fixtures and benches. They are not part of the npm package.

### Photographs from Unsplash

- **Space Shuttle Challenger**, NASA: https://unsplash.com/photos/dCgbRAQmTQA
- **Used in:** `packages/build/test/fixtures/images/` (`photo.jpg`, `portrait-exif6.jpg` and `alpha.png`, cut from
  it; how, in the README beside them).
- **Licence:** [Unsplash License](https://unsplash.com/license). This is not the MIT licence and not an open-source
  licence: it covers these images only, and the repository's MIT licence does not cover them.

- **Cable cars**, Cody Hiscox: https://unsplash.com/photos/kzb0Mo0YQDw
- **Used in:** `storefront-bench/src/assets/images/cable-cars.jpg` (cropped and scaled; how, in the README beside it).
- **Licence:** [Unsplash License](https://unsplash.com/license), as above: not the MIT licence.

## Phosphor Icons

- **Phosphor Icons**: https://github.com/phosphor-icons/core
- **Used in:** `apps/dev-ui/src/icons/index.ts`: twenty icons of the workbench (regular and fill weights, the
  SVG paths unchanged), which are in the npm package as part of `dist/dev-ui/main.js`. The registry's two other
  icons (the disclosure chevron and the open-in-new-window mark) are not Phosphor's.
- **Licence:** MIT

```
MIT License

Copyright (c) 2023 Phosphor Icons

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and
to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of
the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO
THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
IN THE SOFTWARE.
```

## Monokai Light

- **Monokai Light**, Velichko Konstantin: https://github.com/zoxon/vscode-theme-monokai-light
- **Used in:** `packages/renderer/src/themes/monokai-light.ts`: the syntax theme `pd-monokai-light` takes its
  token colours from the theme's JSON, with two deliberate changes (listed in the file). It is part of the npm
  package (`dist/pd.js`).
- **Licence:** MIT

```
MIT License

Copyright (c) 2017 Velichko Konstantin

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and
to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of
the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO
THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
IN THE SOFTWARE.
```

## Colour vision deficiency matrices

- **Machado, G. M., Oliveira, M. M., Fernandes, L. (2009).** "A Physiologically-based Model for Simulation of Color
  Vision Deficiency". *IEEE Transactions on Visualization and Computer Graphics* 15(6), 1291-1298.
  https://doi.org/10.1109/TVCG.2009.113
- **Used in:** `apps/dev-ui/src/core/cvd-math.ts`: the matrices of the workbench's colour-vision simulation (protanopia,
  deuteranopia, tritanopia, eleven severities each). They are numbers published in that paper: data, not code. The
  achromatopsia table is not from the paper.
- **Licence:** none applies to published data; the paper is cited as its source.

## Dependencies with other licences

The npm package declares its dependencies, and npm installs them with their own licence files; none is bundled into
`dist/` or modified. Almost all are MIT, ISC, BSD or Apache-2.0. Two have terms worth naming:

- **axe-core** (Deque Systems), **MPL-2.0**: https://github.com/dequelabs/axe-core. Used by the accessibility checks
  (`packages/a11y`), as installed.
- **libvips** binaries (`@img/sharp-libvips-*`), **LGPL-3.0-or-later**: https://github.com/lovell/sharp-libvips. Optional
  dependencies of **sharp** (Apache-2.0), which encodes the storefront's images; installed as prebuilt binaries, not
  linked into or copied into this package. An install with `--omit=optional` leaves them out.
