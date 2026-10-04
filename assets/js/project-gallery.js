(() => {
  const gallery = document.querySelector(".project-works.is-grid");
  if (!gallery) return;

  const initialStyle = getComputedStyle(gallery);
  const rowHeight = Number.parseFloat(initialStyle.gridAutoRows);
  const gapY = Number.parseFloat(initialStyle.rowGap);
  if (!Number.isFinite(rowHeight) || rowHeight <= 0 || !Number.isFinite(gapY)) {
    console.error("Project gallery requires a positive row_height and a valid vertical gap.");
    return;
  }

  function updateAutomaticRows() {
    const configuredColumns = Number.parseInt(
      gallery.style.getPropertyValue("--gallery-columns") || "3",
      10,
    );
    const columnLimit = window.matchMedia("(max-width: 440px)").matches
      ? 1
      : window.matchMedia("(max-width: 760px)").matches
        ? 2
        : configuredColumns;
    gallery.style.setProperty(
      "--gallery-columns-effective",
      Math.max(1, Math.min(configuredColumns || 3, columnLimit)),
    );

    const galleryStyle = getComputedStyle(gallery);
    const columnCount = galleryStyle.gridTemplateColumns.trim().split(/\s+/).length;
    const gapX = Number.parseFloat(galleryStyle.columnGap);
    const gapY = Number.parseFloat(galleryStyle.rowGap);
    const columnGap = Number.isFinite(gapX) ? gapX : 0;
    const cellWidth = (gallery.clientWidth - columnGap * (columnCount - 1)) / columnCount;

    gallery.querySelectorAll(":scope > figure").forEach((figure) => {
      const declaredColumns = Number.parseInt(figure.dataset.imageColumns || "1", 10);
      const columns = Math.max(1, Math.min(declaredColumns || 1, columnCount));
      figure.style.setProperty("--image-columns", columns);
      if (figure.dataset.imageRows) return;

      const figureStyle = getComputedStyle(figure);
      const imageGapX = Number.parseFloat(figureStyle.getPropertyValue("--image-gap-x"));
      const imageGapY = Number.parseFloat(figureStyle.getPropertyValue("--image-gap-y"));
      const widthAdjustment = Number.isFinite(imageGapX) ? imageGapX - columnGap : 0;
      const heightAdjustment = Number.isFinite(imageGapY) ? imageGapY - gapY : 0;
      const imageWidth = cellWidth * columns + columnGap * (columns - 1) - widthAdjustment;
      const media = figure.querySelector("img, video");
      const width = Number.parseFloat(figure.dataset.imageWidth)
        || media?.naturalWidth
        || media?.videoWidth;
      const height = Number.parseFloat(figure.dataset.imageHeight)
        || media?.naturalHeight
        || media?.videoHeight;
      if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
        media?.addEventListener("load", updateAutomaticRows, { once: true });
        return;
      }

      const desiredHeight = imageWidth * height / width;
      const rows = Math.max(1, Math.ceil((desiredHeight + heightAdjustment + gapY) / (rowHeight + gapY)));
      figure.style.setProperty("--image-rows", rows);
    });
  }

  updateAutomaticRows();
  window.addEventListener("resize", updateAutomaticRows);
})();
