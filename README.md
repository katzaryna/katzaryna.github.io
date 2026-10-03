# Artist website

A simple, responsive portfolio website. GitHub Pages builds the site with its built-in Jekyll support. Shared project-page code lives in `_layouts/project.html`; each project folder contains only images and a small `index.md` data file.

## Publish with GitHub Pages

1. Push the repository to GitHub.
2. Open **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, select `main` and `/ (root)`, then save.

## Google Analytics

To enable GA4, add your Measurement ID (`G-XXXXXXXXXX`) to `GA_MEASUREMENT_ID` in `assets/js/analytics.js`. Analytics loads only after a visitor allows it.

Replace the sample portrait, artist name, artwork, email address, and social profile links with your own details before publishing.

## Add an artwork project

Create a folder under `projects/`, put the project images directly in it, and add an `index.md` file with this format:

```yaml
---
layout: project
title: My project
description: A short description.
permalink: /projects/my-project/
images:
  - file: cover.png
    alt: Description of the image
    caption: Optional caption
  - file: 01.png
    alt: Another image
---
Optional longer project description.
```

The project page and home-page gallery are generated automatically from these files. Image paths are relative to the project folder. Use `cover.png`, `01.png`, `02.png`, etc. (SVG and other browser-supported image formats also work). The home page uses a responsive masonry gallery; project images fit within the viewport height and open in a full-screen viewer when selected.

The included SVG artworks are sample illustrations; replace them with the artist's images when ready.
