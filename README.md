# Artist website

A simple, responsive, static website. No build step or dependencies required. GitHub Pages can serve `index.html` directly from the repository root. Styles and the optional analytics script are kept in `assets/css/` and `assets/js/`. Each artwork project lives in its own folder under `projects/`, with a page and an `images/` subfolder.

## Publish with GitHub Pages

1. Push the repository to GitHub.
2. Open **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, select `main` and `/ (root)`, then save.

## Google Analytics

To enable GA4, add your Measurement ID (`G-XXXXXXXXXX`) to `GA_MEASUREMENT_ID` in `assets/js/analytics.js`. Analytics loads only after a visitor allows it.

Replace the sample artist name, artwork, and email address with your own details before publishing.

## Add an artwork project

Create a folder under `projects/` with an `index.html` and an `images/` folder. Add images to that folder, then link to the project page from the gallery in the root `index.html`. Gallery images keep their original aspect ratios and scale to the available column width.

The included SVG artworks are sample illustrations; replace them with the artist's images when ready.
