# Images

| File | What it is | Origin | Licence |
|---|---|---|---|
| `bench-blocks.svg` | Blocks of colour, each with only its lower-left corner rounded | Drawn for this bench | The repository's MIT licence |
| `about.png`, `share.png`, `favicon.png` | Plain colour images (200 × 100, 240 × 126, 32 × 32): the bench's link-preview images and favicon | Plain fills made for this bench; no third-party content | The repository's MIT licence |
| `cable-cars.jpg` | A photograph of cable cars, 2400 × 1600: the slide's photo, so that the bench's image variants go up to 1600 px and beyond | [Cable cars](https://unsplash.com/photos/kzb0Mo0YQDw) by Cody Hiscox on Unsplash, cropped to 3:2 and scaled to 2400 × 1600 (below) | [Unsplash License](https://unsplash.com/license), not covered by the repository's MIT licence |

`cable-cars.jpg` was made from the photograph as downloaded from Unsplash (4608 × 3456), with ImageMagick; all
metadata is removed:

```bash
magick cody-hiscox-kzb0Mo0YQDw-unsplash.jpg -auto-orient -resize 2400x1600^ -gravity center -extent 2400x1600 \
  -strip -interlace none -sampling-factor 4:2:0 -quality 80 cable-cars.jpg
```
