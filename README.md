# Katzaryna — Artist portfolio

A responsive Jekyll portfolio for illustrator Katsiaryna Zarouskaya, published
with GitHub Pages. The project is data-driven: project pages and the home-page
gallery are rendered from Markdown files under `projects/`.

## Repository map

- `_config.yml` — Jekyll settings and artist/site content, social links,
  analytics ID, and home-gallery settings.
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
- `site-builder/` and `scripts/site_builder.py` — a local-only visual editor
  for site settings and project galleries.
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
home page selects images explicitly marked `cover: true`; their sequence,
position, dimensions, and crop are stored together in `home_gallery.covers` in
`_config.yml`.
Each entry identifies its project and filename, so covers from different
projects can be interleaved without numeric order fields in project metadata.
The project layout renders all entries in `images` in their listed order.
`permalink` controls the page URL, not the location of its artwork files.

The `home_gallery.compact` setting controls whether the covers initially fit
into the viewport; when disabled, the home page opens directly as a regular
responsive grid. The `home_gallery.single_page` setting controls cover clicks.
When enabled, a cover opens its original image and its `caption` (or the
project title if no caption is set) in a lightbox, while project pages remain
available at their direct URLs. When disabled, covers link to their project
pages as usual. Both settings are in `_config.yml`.

The home gallery uses a free-placement canvas. The white artboard with a grid
is the page itself (12 columns wide); the dashed orange line marks what a
1440×900 window shows without scrolling, and 100% zoom matches that window.
The grey pasteboard around it holds parked covers: they are saved with
`parked: true` but not shown on the site, which is handy while rearranging.

Click a cover to select it, Shift+click or drag a frame to select several, and
drag to move the selection. Hold a cover over another for a moment to swap
their positions and sizes. Drag the corner handle to resize (Shift keeps the
image proportions). Covers snap to neighbouring edges; hold Alt to place them
freely, or turn on snapping to a quarter-column grid. Covers on the page cannot
overlap: an invalid drop is shown in red and undone. With several covers
selected, the side panel aligns edges, spaces them evenly, gives them the same
height, or fits them into one full-width row with equal image heights;
"Плитка по пропорциям" removes empty bands around an image. Covers below a
changed row move down when they would overlap. **Уплотнить** pulls every cover
up to close vertical gaps.

Undo/redo keeps 50 steps. Space+drag pans, ⌘/Ctrl+wheel or a trackpad pinch
zooms, arrows move the selection by one screen pixel (Shift: ten), Delete
removes the selected covers from the home page (⌘Z brings them back), and
Shift+1 shows everything. The **Телефон** view lists the covers in the
single-column order used on phones; drag to reorder it. That order is the
order of `home_gallery.covers`, and its first cover loads first and is used
for link previews. The published canvas scales
responsively while preserving the arrangement. Project galleries retain their
own masonry or fixed-grid layout. The `home_gallery.gap` value in `_config.yml`
controls spacing in both galleries.

When `home_gallery.compact` is enabled, the home grid initially fits into the
remaining viewport height and expands to its regular responsive size on the
first scroll. If JavaScript is unavailable, the gallery uses its regular grid.
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
  - file: 02.jpg
    alt: Description of the second image
---
Optional longer project description.
```

Requirements and behavior:

- Mark each home-page cover with `cover: true` (★ in the builder), then set
  the order, size, and crop on the builder's **Главная** tab. The matching
  `home_gallery.covers` list is the source of the visual sequence.
- Only entries marked `cover: true` appear in the home gallery. The old
  top-level `cover.file` format is not used. The cover checker warns if a
  project has no selected image.
- List all project-page artwork under `images`. `file` is relative to that
  project's directory. Provide meaningful `alt` text; `caption` is optional
  and also serves as a fallback alt-text source.
- Images in a project directory that are not listed under `images` are kept
  in the repository but are not published: the generator skips them, the
  build removes them from `_site`, and `make test` lists them as warnings.
- When a project's URL changes, keep the old link working with a file in
  `redirects/` (`layout: redirect`, the old `permalink`, and `redirect_to`).
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
(currently 480, 960, and 1440 pixels). Each target narrower than the source is
generated, plus one derivative at the source's own width when it falls between
targets, so a 854-pixel source gets 480- and 854-pixel versions. Templates use the generated responsive
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
copyright year, home-gallery compact and single-page modes and gap, and
analytics measurement ID.

Google Analytics loads only after the visitor accepts analytics consent. The
choice is saved in browser local storage. Setting
`analytics.measurement_id` to an empty value disables the consent prompt and
analytics loading.

## Local development and validation

Requirements: Python (version in `.python-version`), Node.js/npm, Ruby with
Bundler (version in `.ruby-version`), and the dependencies listed in
`requirements-images.txt`, `requirements-dev.txt`, `package-lock.json`, and
`Gemfile.lock`. Jekyll is pinned in the `Gemfile` and always runs through
`bundle exec`, so local builds match the deployed site. Install Python, Node,
and Ruby dependencies with:

```sh
make setup
```

Start the local visual site builder from the repository root with:

```sh
make builder
```

Then open `http://127.0.0.1:8765` in a browser. The builder has three tabs:

- **Главная** — the home-page canvas (drag, swap, resize, crop, undo) and the
  home settings: what a cover click does, the gap between covers, and the
  compact start.
- **Проекты** — create, edit, and delete projects; drop files onto a project
  to upload them; drag tiles to reorder; ★ puts an image on the home page;
  select a tile to edit its alt text, caption, grid width, and row.
- **Настройки** — artist details and portrait, contacts, browser title and
  search description, copyright year, and the analytics ID.

All edits stay in the browser until **Сохранить** (or ⌘S/Ctrl+S) writes
`_config.yml` and every changed project together; if any part is invalid,
nothing is written. **Отменить** drops unsaved edits, and the browser warns
before closing a tab with unsaved edits. Every image needs alt text before it
can be saved.

Uploads become color-managed WebP at quality 95, capped at 2560 pixels on the
longest side, with file names transliterated to lowercase Latin and made
unique. Embedded color profiles such as Display P3 are preserved; untagged
images are treated as sRGB. Animated GIFs remain animated. Removing an image
from a project only removes its metadata entry; the file stays in the project
folder. Deleting a project moves its folder to the ignored `.builder-trash/`
directory and removes its home covers.

**Предпросмотр сайта** saves if needed, rebuilds the site, and opens it from a
separate local-only address. The builder is bound to localhost and is excluded
from the published Jekyll site. A full `make build` afterward also runs project
tests and validates the generated site.

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
image derivatives, builds with the bundled Jekyll version, validates the
generated site, and deploys it. In repository **Settings → Pages**, select
**GitHub Actions** as the deployment source.
