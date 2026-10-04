# Katzaryna — Artist portfolio

A responsive Jekyll portfolio hosted on GitHub Pages. Project pages and the
home-page cover gallery are generated from the Markdown files in `projects/`.
Keep original artwork in those project folders; the build automatically
creates ignored, responsive WebP derivatives for supported static images.

## Publish with GitHub Pages

The GitHub Actions workflow builds the site, prepares responsive image
derivatives, and deploys the result. In **Settings → Pages**, choose **GitHub
Actions** as the build and deployment source.

## Local development

Install the image-processing dependencies once, then generate and validate
the site:

```sh
python3 -m pip install -r requirements-images.txt
python3 scripts/generate_image_variants.py
jekyll build
python3 scripts/validate_site.py --site-dir _site
```

The generated files in `assets/optimized/` and their temporary Jekyll data
manifest are git-ignored. Re-run the generator after adding, replacing, or
removing project images. It also removes stale derivatives.

## Artist information and analytics

Update `_config.yml` to change the artist name, bio, portrait, email, social
profile links, site description, and copyright year.

GA4 is configured in `_config.yml` under `analytics.measurement_id`. Analytics
loads only after a visitor allows it. Clear the ID to disable analytics.

## Add a project

Create a directory under `projects/`, put the original images in it, and add
an `index.md` file:

```yaml
---
layout: project
title: My project
description: A short description.
permalink: /projects/my-project/
cover:
  file: cover.png
  alt: Description of the project cover
images:
  - file: 01.png
    alt: Description of the first image
    caption: Optional caption
  - file: 02.jpg
    alt: Description of the second image
---
Optional longer project description.
```

The `images` list controls display order. Add an optional `gallery` block to
set the project layout, column count, gaps, and (for a grid) the height of one
grid row:

```yaml
gallery:
  layout: grid
  columns: 3
  row_height: 8px
  gap:
    horizontal: 24px
    vertical: 18px
images:
  - file: 01.png
    alt: Wide illustration
    span:
      columns: 2
    gap:
      horizontal: 12px
      vertical: 10px
```

Omit `gallery.layout: grid` to keep the default masonry-style columns. In grid
mode, `span.columns` and `span.rows` set an image's grid size; if `rows` is
omitted, its row span is calculated from the source image proportions.
`row_height` sets the grid's row unit and is only used in grid mode.
`gallery.gap` sets the project's horizontal and vertical spacing, while an
image's optional `gap` values override either direction for that image. Grid
column spans adapt down to two columns on tablet and one on narrow phones;
explicit row spans are automatically relaxed on phones.
Per-image gaps are applied around each image; when neighboring images specify
different gaps, their half-gaps combine at the shared edge.

`permalink` sets only the project page URL. Keep image files in the project
directory: the templates resolve original image URLs from that directory, so
changing a project's permalink does not move its images.

Use the original filename in `cover.file` and `images[].file`. Static JPEG,
PNG, and WebP images are automatically converted into responsive WebP
derivatives at widths configured in `config/image_optimization.toml` for the
home-page cover gallery and project page. Original files are retained and
used in the full-screen artwork viewer. Animated GIFs are converted to WebM
and H.264/MP4 previews with WebP posters; originals remain as no-JavaScript/
browser fallbacks and are preserved in the project folders. Browsers download
only a supported video format. Previews autoplay only when near the viewport
and when reduced motion is not requested. Animated WebP files are left
untouched. Other formats are served as-is.

The GitHub Actions build installs the pinned image dependencies, generates
derivatives, builds with Jekyll, and checks generated HTML for missing image
alt text and broken local links. Run the same validation command locally after
building; it catches missing image files and other broken local URLs before
deployment.

The home page shows project covers only. Landscape covers span two gallery
columns on wider screens; the gallery adapts to smaller screens. Project
artwork opens in a full-screen viewer when selected.
