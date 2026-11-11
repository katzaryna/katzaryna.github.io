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
- `scripts/embed_image_metadata.py` — writes the artist's rights metadata
  into the published images after the build.
- `robots.txt` and `tdmrep.json` — the AI-training opt-out for crawlers.
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

The `home_gallery.compact` setting (the builder's «Компактный старт») controls
whether the covers initially fit into the viewport; when disabled, the home
page opens directly at full size. The `home_gallery.single_page` setting controls cover clicks.
When enabled, a cover opens a white full-screen viewer
(`assets/js/home-lightbox.js`): the original image large on the left and, on
the right, the project title, the image's `caption` (its illustration title)
and its `description` as heading, subheading and text. The close button is at
the top right, as in About and Clients; Escape or a click beside the image
also closes it. On phones the
text follows the image. Project pages remain available at their direct URLs. When disabled, covers link to their project
pages as usual. Both settings are in `_config.yml`.

Both artwork viewers (this one and the project-page lightbox) share
`assets/js/artwork-viewer.js`:

- **Opening and closing** use the View Transitions API: the clicked thumbnail
  flies into the large image and back. Browsers without it, and visitors who
  ask for reduced motion, get the plain open and close. Pages also cross-fade
  into each other (`@view-transition` in `styles.css`) in browsers that
  support it.
- **The large image** is sized from the artwork's pixel dimensions before it
  loads (never wider than the file itself), and the already-loaded thumbnail
  shows underneath until the original arrives. In the cover viewer the image
  fits its column with container query units (`cqw`/`cqh`).
- **Links to an artwork:** every artwork has an address made from its
  illustration title (or file name), such as `/#moonlit-lavender` on the home
  page or `/projects/kneipp-bath-oil/#moonlit-lavender`. It is in the URL while
  the artwork is open and opens it straight away when followed; repeated titles
  get `-2`, `-3`. A copy-link button beside the close button copies the
  address, as it does in the About and Clients dialogs (`#about`, `#clients`;
  the copying lives in `bio.js`). Changing a title changes its address.
- **Zoom:** a click or tap on the image zooms it 2x at that point and loads a
  sharper source. The mouse then explores the picture, a finger drags it;
  another click or tap returns to 1x. Because a click on the image zooms, the
  project lightbox has a close button too (Escape and a click on the shade
  also close it; a click on an animation still closes it).

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
controls spacing in both galleries. Pictures sit half a gap inside their cells, so both
galleries reach out by half a gap (at most the page margin): the outer picture
edges line up with the header line, the About/Clients tabs and the footer.
Grouped rows subtract their side margins from the width
`assets/js/project-gallery.js` gives them.

When `home_gallery.compact` is enabled, `assets/js/gallery-intro.js` scales
the whole cover canvas down from its top centre, keeping the arrangement, so
every cover fits on the first screen below the header; the first scroll grows
it back to full size (instantly with reduced motion). The scale is a transform,
so the rest of the page does not move. `gallery-intro-flag.js` in `<head>`
keeps the canvas hidden until it is measured, with a two-second CSS fallback.
Phones (single column) and visits that start scrolled down skip it; without
JavaScript the canvas is shown at full size.
Cover titles appear on a strip when the pointer is over a cover; phones and
tablets cannot hover, so there the titles are hidden.
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
    caption: Optional caption (illustration title)
    description: Optional longer text for the home cover viewer
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
- When a project's URL changes and the old link was shared, keep it working
  with a file in `redirects/` (`layout: redirect`, the old `permalink`, and
  `redirect_to`). There are none at the moment.
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

The same shared header (`_includes/site-header.html`) appears on the home page
and project pages, above a thin divider. The portrait sits in the exact center;
the wordmark is right-aligned to its left and the profession (Sedan SC) to its
right. The wordmark is the image in `artist.wordmark_image` (uploaded in the
builder, kept transparent) or, without one, `artist.name` set in Whisper. The
**About** and **Clients** tabs sit at the bottom left. Below 1100px the tabs
move under the brand; below 760px the profession is hidden, clear of the fixed
contact icons. The portrait is always the centre of the header and the page:
its column never shrinks, the wordmark and profession overflow away from it
when space runs out, and it is drawn above them. The portrait and the wordmark link to
the home page. The portrait is shown in its own colours and is the fallback
link preview. The browser-tab and home-screen icons are made from it by the
image generator: round 32 and 192 px PNGs with transparent corners, and a
180 px `apple-touch-icon` with the circle on white (iOS fills transparent
corners with black), in `assets/optimized/icons/`, listed with a version for
cache busting in the ignored `_data/generated_icons.json`. On phones the About/Clients tabs (18px,
above the builder's size, which shrinks on small screens) and the contact icons
are enlarged for tapping.

**About** and **Clients** open full-screen white dialogs (`assets/js/bio.js`)
with a close button at the top right; Escape also closes them, and `#about` or
`#clients` in the URL opens them directly. About shows the full name,
profession, and `artist.bio` (line breaks kept, text selectable). Clients shows
the `clients` list from `_config.yml` in order: each entry has a `logo` under
`/assets/images/` and an optional `name` caption, which is also the logo's alt
text. The tab is shown when there are clients and it is not switched off on
the builder's **Об авторе** tab (`clients_tab: false` in `_config.yml`; only
"off" is stored, so the logos stay for later).

## Colours

`_data/colors.yml` lists the colours the builder's **Оформление** tab can
change: page background, main and secondary text, lines, the hover strip on
home covers and its text, the cover viewer background, and the shade behind the
full-screen viewer on project pages. Each sets a CSS variable declared with its
default at the top of `assets/css/styles.css` (a test keeps the two in step).
Choices are saved as `colors.<id>` in `_config.yml` (`color` as `#rrggbb`,
`opacity` 0-100 for see-through ones) and become `:root` overrides in
`assets/theme.css`; see-through colours use `color-mix(in srgb, colour N%,
transparent)`.

## Fonts and text styles

Every text on the site that can be styled is a *text place* in
`_data/text_places.yml`: its CSS selector and its default font, size and
alignment (alignment only where it applies). A text shown in several places,
such as the profession in the header and in the About dialog, has a place for
each. The builder's **Текст** tab sets a Google font, a size (px on a wide
screen; it shrinks fluidly to 70% on small screens) and an alignment per place;
choices are saved as `text_styles.<place id>` in `_config.yml`, and only the
values that differ from the defaults. Place ids must not be renamed: saved
choices refer to them. The builder tab is **Оформление** (colours first, then
text). Settings are named `font_size`, not `size`, because
Liquid reads `hash.size` as the number of keys.

Line breaking is set once in `styles.css`: headings and short captions use
`text-wrap: balance` (lines of even length), paragraphs `text-wrap: pretty`
(no lone last word), and long texts hyphenate on phones.

Fonts are self-hosted, never loaded from Google by visitors. `scripts/fonts.py`
downloads a family's regular face (latin and latin-ext WOFF2) into
`assets/fonts/<slug>/` and lists it in `_data/fonts.yml`.
`assets/theme.css` is built by Jekyll from those two data files and
`text_styles`: the `@font-face` rules and the chosen styles, loaded after
`styles.css` so they win. While the wordmark is text, its font is preloaded
(`_includes/stylesheets.html`).

A font is used when a place has it as default or as its choice. Saving in the
builder downloads any used font that is missing (including a default removed
earlier) and deletes fonts and files that nothing uses; the pre-publish check
does the same. `make test` (and so CI) runs `python -m scripts.fonts check`,
which fails on an unused, missing or unlisted font. By hand:

```sh
python -m scripts.fonts install "Lora"   # download and list a font
python -m scripts.fonts prune            # delete unused fonts
python -m scripts.fonts check
```

## Images and animation

Use original JPEG, PNG, or WebP files for static images. The build makes
responsive derivatives at widths in `config/image_optimization.toml`
(currently 480, 720, 1080, and 1440 pixels), each as AVIF (quality 60, with
the rights metadata embedded) and WebP (quality 85) for browsers without AVIF;
`_includes/artwork-picture.html` offers both in a `<picture>`. Each target
narrower than the source is generated, plus one derivative at the source's own
width when it falls between targets, so an 854-pixel source gets 480-, 720-
and 854-pixel versions. Templates use the generated responsive sources where
present and fall back to the original file. Original artwork is also used by
the full-screen viewer. Grid project pages tell the browser each image's share
of the columns (`sizes`), and the first three images of a project and the top
band of home covers load without lazy loading.

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

While artwork loads, a blurred preview stands in for it. The generator makes a
16-pixel WebP of every opaque image (`placeholder` in the manifest, about 200
bytes, converted to sRGB), the templates set it inline as the background of
the artwork's link, and `assets/js/placeholders.js` fades the image in over it
and then drops it. Transparent images get no preview, as it would show
through them.

After adding, replacing, or removing artwork, run the image generator (or
`make build`) to refresh derivatives and the manifest. The generator removes
stale derivatives. Do not remove or rename an artwork file still referenced
by a project's `images` list.

## Page not found

`404.html` is what GitHub Pages shows for a missing address: the header, a
short note and four home covers, all linking to the home page (`noindex`).

## Search engines

- Every page has a canonical URL, Open Graph/Twitter preview tags, and
  schema.org JSON-LD (`_includes/structured-data.html`): the artist as a
  `Person` (full name, Katzaryna as alternate name, profession, bio, portrait,
  Instagram and LinkedIn), the site as a `WebSite`, the home page as her
  `ProfilePage` and each project as a `CreativeWork` with its images.
  `scripts/validate_site.py` fails the build if the JSON does not parse.
- `sitemap.xml` lists the home page and every project page; `robots.txt`
  (built by Jekyll) points to it.
- The browser title of the home page and its search description are the
  builder's **Поиск и статистика** settings; project pages are titled
  "project title — full name". Each project's **Короткое описание** is its
  search snippet and link-preview text (keep it under about 155 characters),
  and its page text is what search engines read most.
- Outside the code: verify the site in Google Search Console and submit
  `https://katzaryna.github.io/sitemap.xml`; link to the site from Instagram,
  LinkedIn and Behance.

## No AI training

The site asks AI companies not to train on the artwork, in the forms they
read, while search engines and AI assistants that link to it stay welcome:

- `robots.txt` sends `Content-Signal: search=yes, ai-input=yes, ai-train=no`
  to everyone and blocks crawlers and tokens used only to collect training
  data (GPTBot, ClaudeBot, CCBot, Google-Extended, Applebot-Extended,
  meta-externalagent and others). Search crawlers are not affected.
- `tdmrep.json` is published at `/.well-known/tdmrep.json` (TDM Reservation
  Protocol), and every page has `<meta name="tdm-reservation" content="1">`
  plus the `noai, noimageai` robots hints (`_includes/head-meta.html`). In the
  EU this is the machine-readable reservation of Article 4(3) of Directive
  2019/790.
- After the build, `scripts/embed_image_metadata.py` writes IPTC/XMP metadata
  into every published project image and derivative in `_site`: creator and
  credit (`artist.full_name`), copyright notice, web statement and licensor
  URL (`url`), usage terms, and IPTC Data Mining set to *prohibited except for
  search engine indexing*. Pixels are copied byte for byte and earlier XMP is
  replaced; files in the repository are not changed. GIFs and videos are left
  as they are.

These are signals, not locks: well-behaved crawlers follow them, others may
not. There is no C2PA (Content Credentials) signature; it would need a signing
certificate.

## Artist settings and behavior

Edit `_config.yml` to update the site title/description, artist name and full
name, profession, bio, portrait and alt text, email, social profile URLs,
home-gallery compact and single-page modes and gap, and analytics measurement
ID. The footer's © year is the year the site was last built
(`site.time`), so it moves on with the first publication of a new year.

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

Then open `http://127.0.0.1:8765` in a browser. When the window is too narrow for all tabs,
they fold into a «Меню» button with a drop-down list. The builder has these tabs:

- **Главная** — the home-page canvas (drag, swap, resize, crop, undo) and the
  home settings: what a cover click does, the gap between covers, and the
  compact start.
- **Проекты** — create, edit, and delete projects; drop files onto a project
  to upload them; drag tiles to reorder; ★ puts an image on the home page;
  select a tile to edit its alt text, illustration title (`caption`),
  illustration description, grid width, and row. **Заменить файл…** swaps
  the file behind an image and keeps all of that, the ★ mark, and the cover's
  place, size and crop on the home page. Under the images, **Не на сайте** lists
  files in the project folder that the project does not list (the same ones
  `make test` warns about): **Добавить в проект** adds one back (it then needs
  alt text), **Удалить…** moves it to `.builder-trash/files/<slug>/`. Files
  still in the saved project or used as a home cover cannot be deleted.
  **Удалённые проекты** under the project list brings back a deleted project
  from `.builder-trash/`.
- **Об авторе** — what the site's About and Clients dialogs show: name, full
  name, profession, biography, contacts, and the clients (whether the Clients
  tab is shown, and client logos with optional captions, in order, up to 800px
  on the longest side). Old `#clients` builder links open this tab.
- **Оформление** — the header portrait and wordmark image (up to 1600px),
  colours, and fonts, sizes and alignment per text place.
- **Поиск и статистика** — browser title, search description, the Google
  Analytics ID and the Google Search Console verification code (the whole
  `<meta name="google-site-verification">` tag may be pasted; only its
  `content` is kept in `search_console.verification` and rendered on every
  page). A short note there explains both, with links.
- **Состояние** — whether everything is in order (`scripts/site_health.py`):
  content checks on this computer (files in project folders that are not on
  the site, missing or too long search texts, artworks without a title or
  description, repeated artwork addresses, originals over 5 MB, missing site
  settings), each with «Открыть» to the place to fix it; the last
  publication's GitHub run and the access key; and, on «Проверить сейчас»,
  the live site: Google PageSpeed scores for phone and computer and the key
  addresses (home page with the Search Console tag, sitemap, robots.txt,
  TDMRep, the 404 page). The tab shows a badge with the number of warnings.
  Without a key PageSpeed shares Google's anonymous daily quota, which is
  often used up; a free personal key can be saved there and is kept only in
  `.builder-cache/pagespeed-key.txt` on that computer.
- **Публикация** — what is not on the live site yet, grouped like these tabs
  with old and new values (`scripts/change_summary.py`), and the
  **Опубликовать на сайт** button; the deployment state on GitHub; the history
  with **Отменить** for each publication; the GitHub access key; and
  a help report to copy when something goes wrong.

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
folder, as does the old file after **Заменить файл…**. The publication summary
reports such a swap as a replacement (a new file in the old one's place with
the same alt text). Deleting a project moves its folder to the ignored `.builder-trash/`
directory and removes its home covers.

**Предпросмотр сайта** saves if needed, rebuilds the site, and opens it from a
separate local-only address. The builder is bound to localhost and is excluded
from the published Jekyll site. A full `make build` afterward also runs project
tests and validates the generated site.

### Publishing from the builder

The status pill in the top bar always says whether the site is up to date.
Publishing commits only site content (`_config.yml`, `projects/`,
`assets/images/`, `redirects/`) straight to `main` and pushes it; GitHub
Actions then checks and deploys it, and the pill follows the run through the
GitHub CLI (`gh`). Other changed files are never published from the builder.

- Changes published from another computer are pulled in on start and every
  few minutes while there are no unsaved edits. If the builder's own code
  changed, it restarts itself and reloads the page.
- If local and remote edits touch the same lines, nothing is merged
  automatically: the local commit stays, a copy is pushed to a `help/<date>`
  branch, and the owner is asked to send the help report.
- Before committing, the builder checks the content (`SiteRepository.check_content`):
  settings and every project parse, listed images exist and have alt text,
  home covers match the ★ marks, and changed images open. Problems are listed
  in plain words and nothing is committed. The full `make check` still runs in
  CI; if it fails, the previous site stays live and the status turns red.
- Project pages are rendered with `render_with_liquid: false` (`defaults` in
  `_config.yml`), so `{{` or `{%` typed in a description shows as text instead
  of breaking the build. Do not put Liquid in project descriptions.
- Tests must not read real artwork (the owner may delete any project); use
  files under `tests/fixtures/`.
- **Отменить** in the history publishes a `git revert` of that publication.
  Only content-only, single-parent commits offer it.
- **Отменить неопубликованные правки** stashes uncommitted content changes
  (`git stash list` shows them), so they can still be recovered.

The logic lives in `scripts/site_publisher.py`; `python -m
scripts.site_publisher status|sync|report` runs it from a terminal.

### Setting up the builder on another Mac

The owner does not need a GitHub account: the builder publishes with an access
token you issue. Create it at **GitHub → Settings → Developer settings →
Personal access tokens → Fine-grained tokens → Generate new token**:

- **Resource owner**: `katzaryna`; **Repository access**: only
  `katzaryna/katzaryna.github.io`.
- **Repository permissions**: *Contents* — Read and write; *Actions* — Read
  (for the deployment status). *Metadata* — Read is added automatically.
- **Expiration**: as long as you are comfortable with. The builder warns two
  weeks before it expires, and a new token is pasted on its **Публикация** tab
  under **Доступ к GitHub**.

Publications are pushed with that token but signed with the name and address
set in the clone's git config (by default the artist's `full_name` and
`site-builder@katzaryna.github.io`).

Then run once in Terminal on that Mac (the macOS account must be an
administrator); it asks for the token:

```sh
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/katzaryna/katzaryna.github.io/main/scripts/mac/setup.sh)"
```

`scripts/mac/setup.sh` installs Homebrew, git, `gh`, Python and Ruby, stores
the token in the macOS keychain through `gh`, checks that it can push, clones
the site to `~/katzaryna-site`, installs the dependencies, and adds a
**Мой сайт** app to the Dock. The app runs `scripts/mac/launch.sh`: it pulls in
remote changes, reinstalls dependencies when their lock files change, starts
the builder in the background, and opens it in the browser (or just opens it
when it is already running). Its log is `.builder-cache/builder.log`. Running
the setup again is safe.

Useful commands:

```sh
make lint       # Python, JavaScript, CSS, templates, YAML, Markdown, TOML, images
make test       # Python tests and selected-cover checks
make check      # all linters and tests
make build-fast # Jekyll build only; does not refresh image derivatives
make build      # tests, image generation, Jekyll build, generated-site validation
```

`make build` embeds the rights metadata in the built images and validates
every generated HTML page for missing image alt text and broken local URLs.
`make check` runs the configured linters for Python,
JavaScript, CSS, Liquid/HTML, YAML, Markdown, TOML formatting, and image file
integrity. Tests live under `tests/`.

## Deployment

The GitHub Actions workflow runs on pushes to `main` or by manual dispatch.
It installs pinned Python and Node dependencies, runs `make check`, generates
image derivatives, builds with the bundled Jekyll version, validates the
generated site, and deploys it. In repository **Settings → Pages**, select
**GitHub Actions** as the deployment source.
