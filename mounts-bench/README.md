# Mounts bench

The fixture for site mounts (`site.mounts`): a small site in `site/`, and four folders beside it that stand for
another tool's finished files, each published at a route of the site.

| Folder | Published at | What it stands for |
|---|---|---|
| `tool/` | `/tool/` | A tool's built output: pages, CSS, a script, an image and its own `sitemap.xml` |
| `other/` | `/other/` | A second tool's output |
| `root/` | `/` | Files a site needs at its root: a favicon, a web manifest, a font provider's CSS at `/123456/x.css` |
| `assets-css/` | `/assets/css/` | A stylesheet published under `/assets/`, where the site serves no project asset of that name |

The mount folders sit beside the project (`from: "../tool"`), outside it, as built documentation usually does.

## Images

`tool/logo.png` and `root/favicon.ico` are not committed: `make-images.ts` writes them, and the specs run it on
their copies of this folder. Both are plain fills drawn by that script (a 4 x 4 PNG; the ICO holds the same PNG), with
no third-party content, under the repository's MIT licence.
