# Katzaryna — Artist portfolio

A responsive Jekyll portfolio for illustrator Katsiaryna Zarouskaya, published
with GitHub Pages. The project is data-driven: project pages and the home-page
gallery are rendered from Markdown files under `projects/`.

## Repository map

- `_config.yml` — Jekyll settings and artist/site content, social links,
  analytics ID, and the home-gallery gap.
- `projects/<slug>/index.md` — one project's metadata, artwork list, and
  optional project-page gallery settings.
- `_layouts/project.html` — project-page template.
- `_includes/` — shared social-links and analytics-consent UI.
- `_includes/site-header.html` — shared responsive header, avatar, and bio
  toggle used on the home page and project pages.
- `index.html` — home page, project-cover selection, and cover ordering.
- `assets/css/styles.css` — shared responsive styles for the header, home
  gallery, project galleries, and artwork viewer.
- `assets/js/` — biography toggle, project-gallery sizing, artwork viewer,
  and consent-gated analytics.
- `config/image_optimization.toml` — responsive image/video conversion
  settings.
- `scripts/generate_image_variants.py` — generates ignored WebP/video
  derivatives and the Jekyll data manifest.
- `scripts/check_project_covers.py` and `scripts/validate_site.py` — checks
  project cover metadata and the generated site's HTML/local URLs.
- `.github/workflows/jekyll-gh-pages.yml` — lint, test, build, validate, and
  deploy to GitHub Pages on pushes to `main`.

Generated files under `assets/optimized/` and
`_data/generated_image_variants.json` are build products; do not edit or commit
them. Original artwork stays in each project's directory.

## How the pages are assembled

Jekyll discovers project pages by their `layout: project` front matter. The
home page selects images explicitly marked `cover: true`, orders each selected
image by its own numeric `gallery_order`, and links it to its project page.
This allows multiple covers from one project to be interleaved with covers
from other projects.
The project layout renders all entries in `images` in their listed order.
`permalink` controls the page URL, not the location of its artwork files.

The home gallery and project galleries by default use CSS multi-column
masonry. Images keep their original aspect ratios and are never cropped;
figures are kept whole when flowing between columns. On desktop galleries use
three columns, on tablet two, and on narrow screens one. CSS columns flow down
each column before continuing to the next, so visual reading order is
top-to-bottom within a column, not row-by-row. A project can opt into a fixed
grid and set its own desktop column count. The `home_gallery.gap` value in
`_config.yml` controls horizontal and vertical spacing on both types of
gallery; the current value is `5px`.

The home page initially fits its selected covers into the remaining viewport
height. JavaScript tries every possible column count and chooses the layout
that gives the images the greatest total displayed area without cropping; it
spreads an incomplete final row across the available width. The first scroll
switches to the normal masonry gallery with a short position-preserving
animation. If JavaScript is unavailable, the page starts directly in masonry.
Project pages use masonry by default; `gallery_columns` or image spans enable
the fixed grid.
Project-page artwork opens in a full-screen lightbox; animated GIFs use
generated video previews when available.

## Add or change a project

Create `projects/<slug>/index.md` and put original artwork in that same
directory. A typical front matter block looks like this:

```yaml
---
layout: project
title: My project
description: A short description for search and sharing.
permalink: /projects/my-project/
images:
  - file: 01.png
    alt: Description of the first image
    caption: Optional caption
    cover: true
    gallery_order: 1
  - file: 02.jpg
    alt: Description of the second image
---
Optional longer project description.
```

Requirements and behavior:

- Mark each home-page cover with `cover: true` and give it a unique positive
  integer `gallery_order`; higher values appear first, starting at the upper
  left of the gallery. Covers from the same
  project can be placed anywhere in the overall sequence. Orders must be unique
  integers from 1 to 9,999,999,999.
- Only entries marked `cover: true` appear in the home gallery. The old
  top-level `cover.file` format is not used. The cover checker warns if a
  project has no selected image and checks that cover orders are unique.
- List all project-page artwork under `images`. `file` is relative to that
  project's directory. Provide meaningful `alt` text; `caption` is optional
  and also serves as a fallback alt-text source.
- `permalink` changes the project page URL only; keep artwork next to
  `index.md` and use the original file name in `images[].file`.
- Project text after the YAML front matter is optional and appears below the
  project title.

### Spanning project images across columns

Masonry is the default for every gallery. To make an image span multiple
columns, set `span_columns` on that image. This automatically switches that
project gallery to the fixed grid layout:

```yaml
gallery_columns: 4
images:
  - file: 01.png
    alt: Wide illustration
    span_columns: 2
```

`gallery_columns` enables the fixed grid and chooses its desktop column count
even when no image has an explicit span. The default is three columns;
`gallery.row_height` sets the grid's row unit. If `span.rows` is omitted,
`assets/js/project-gallery.js` calculates the row span from the image
dimensions. Grid columns adapt to two on tablet and one on narrow phones;
explicit column spans are clamped to the available columns.
`gallery.layout: grid` also enables the grid when you want to configure rows
without setting a column count. `gallery.gap` sets grid spacing; per-image
`gap` values override either direction for that image.

To keep a consecutive set of images together in a row and center them
vertically against the tallest image, give each image the same `row` value:

```yaml
images:
  - file: portrait-01.png
    alt: First portrait
    row: portraits
  - file: portrait-02.png
    alt: Second portrait
    row: portraits
  - file: portrait-03.png
    alt: Third portrait
    row: portraits
```

Grouped images keep their original aspect ratios and stay on one horizontal
line on wide screens. Their configured column spans determine their relative
widths, and they are centered vertically against the tallest image. At tablet
and phone sizes they return to the regular gallery flow. Images in one group
must be consecutive in the `images` list.

The same shared header appears on the home page and project pages, with a
matching bottom divider. On wide screens, the artist's full name and
profession flank the centered site name with a 30px gap, and use matching
Sedan SC typography and color. The centered site name uses Whisper, project
titles use Tenor Sans, and image hover captions use Inter. At
intermediate widths, the two labels move below the site name as
`Katsiaryna Zarouskaya | Commercial Illustrator`; on narrow screens they
disappear, leaving the centered name unobstructed. The avatar is 15% smaller
than its original desktop, tablet, and phone sizes. The three-dot button's
circle scales to 15% of the avatar height while its dots retain their
previous size, and stays anchored to the avatar's lower-right corner.
Clicking the avatar returns to the home page. The black-and-white three-dot
button opens and closes the About me bio panel from the avatar's
upper-right corner.

## Images and animation

Use original JPEG, PNG, or WebP files for static images. The build makes
responsive WebP derivatives at widths in `config/image_optimization.toml`
(currently 480, 960, and 1440 pixels; a source smaller than those widths gets
one derivative at its original width). Templates use the generated responsive
sources where present and fall back to the original file. Original artwork is
also used by the full-screen viewer.

Animated GIFs are converted to WebM and H.264/MP4 previews, plus a WebP poster.
Lightweight animation previews play in the gallery; the full-screen viewer
loads a separate higher-quality version generated up to 1920 pixels wide.
Static full-screen images use the original file, so a derivative cannot
restore detail missing from its source; for sharp Retina-sized viewing, use
original exports with a longest edge of around 2800 pixels or more when the
artwork permits.
The browser selects a supported video source, starts previews near the
viewport, pauses them when they leave it, and does not autoplay when reduced
motion is requested. If video playback is unavailable, the original GIF is
used. Animated WebP files and other formats are served as-is.

After adding, replacing, or removing artwork, run the image generator (or
`make build`) to refresh derivatives and the manifest. The generator removes
stale derivatives. Do not remove or rename an artwork file still referenced
by a project's `images` list.

## Artist settings and behavior

Edit `_config.yml` to update the site title/description, artist name and full
name, profession, bio, portrait and alt text, email, social profile URLs,
copyright year, home-gallery gap, and analytics measurement ID.

Google Analytics loads only after the visitor accepts analytics consent. The
choice is saved in browser local storage. Setting
`analytics.measurement_id` to an empty value disables the consent prompt and
analytics loading.

## Local development and validation

Requirements: Python, Node.js/npm, Ruby with Jekyll, and the dependencies
listed in `requirements-images.txt`, `requirements-dev.txt`, and
`package-lock.json`. Install Python and Node dependencies with:

```sh
make setup
```

Useful commands:

```sh
make lint       # Python, JavaScript, CSS, templates, YAML, Markdown, TOML, images
make test       # Python tests and selected-cover checks
make check      # all linters and tests
make build-fast # Jekyll build only; does not refresh image derivatives
make build      # tests, image generation, Jekyll build, generated-site validation
```

`make build` validates every generated HTML page for missing image alt text
and broken local URLs. `make check` runs the configured linters for Python,
JavaScript, CSS, Liquid/HTML, YAML, Markdown, TOML formatting, and image file
integrity. Tests live under `tests/`.

## Deployment

The GitHub Actions workflow runs on pushes to `main` or by manual dispatch.
It installs pinned Python and Node dependencies, runs `make check`, generates
image derivatives, builds with the GitHub Pages Jekyll action, validates the
generated site, and deploys it. In repository **Settings → Pages**, select
**GitHub Actions** as the deployment source.
