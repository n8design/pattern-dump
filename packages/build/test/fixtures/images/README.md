# Image fixtures

The images the encoder's tests run on. The hashes of their WebP encodings are in `expected-webp.json`
(see `image-determinism.spec.ts`): changing a file here changes its hashes, so the hashes are recorded again
with it.

| File | What it is | Origin | Licence |
|---|---|---|---|
| `photo.jpg` | A photograph, 480 × 320 | [Space Shuttle Challenger, NASA](https://unsplash.com/photos/dCgbRAQmTQA) on Unsplash, scaled to fill 480 × 320 | [Unsplash License](https://unsplash.com/license), not covered by the repository's MIT licence |
| `portrait-exif6.jpg` | A portrait stored sideways, with EXIF orientation 6 (shown 320 × 480) | A crop of the same photograph, made as below | Unsplash License, as above |
| `alpha.png` | A PNG that fades to transparent, 320 × 214, 128 colours | A crop of the same photograph, made as below | Unsplash License, as above |
| `flat.png` | A flat drawing of solid shapes, 480 × 300 | Drawn for these tests; no photographic or third-party content | The repository's MIT licence |

## How the photograph's three files were made

From the photograph as downloaded from Unsplash (6097 × 3510), with ImageMagick and ExifTool. All metadata is
removed, except the orientation tag the portrait exists to carry.

```bash
SRC=nasa-dCgbRAQmTQA-unsplash.jpg

# photo.jpg: the whole frame, scaled and cropped to 480 x 320
magick "$SRC" -auto-orient -resize 480x320^ -gravity center -extent 480x320 \
  -strip -interlace none -sampling-factor 4:2:0 -quality 80 photo.jpg

# portrait-exif6.jpg: an upright 2:3 crop around the shuttle, turned onto its side, then tagged
# "rotate 90 CW" so that it is shown upright
magick "$SRC" -auto-orient -gravity NorthWest -crop 2340x3510+2000+0 +repage -resize 320x480! -rotate -90 \
  -strip -interlace none -sampling-factor 4:2:0 -quality 80 portrait-exif6.jpg
exiftool -overwrite_original -Orientation#=6 portrait-exif6.jpg

# alpha.png: a 3:2 crop of the launch, fading to transparent from the left
magick "$SRC" -auto-orient -gravity NorthWest -crop 5265x3510+700+0 +repage -resize 320x214! \
  \( -size 320x214 gradient:white-black -rotate 90 \) -alpha off -compose CopyOpacity -composite \
  -strip -colors 128 PNG8:alpha.png
```
