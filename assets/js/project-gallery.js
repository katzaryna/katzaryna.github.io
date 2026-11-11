(() => {
  const gallery = document.querySelector(".project-works.is-grid");
  if (!gallery) return;

  function groupImageRows() {
    const figures = [...gallery.querySelectorAll(":scope > figure")];
    let index = 0;
    while (index < figures.length) {
      const rowName = figures[index].dataset.imageRow;
      if (!rowName) {
        index += 1;
        continue;
      }

      let end = index + 1;
      while (end < figures.length && figures[end].dataset.imageRow === rowName) {
        end += 1;
      }

      if (end - index > 1) {
        const row = document.createElement("div");
        row.className = "project-image-row";
        row.dataset.imageRow = rowName;
        figures[index].before(row);
        for (const figure of figures.slice(index, end)) row.append(figure);
      }
      index = end;
    }
  }

  groupImageRows();

  const initialStyle = getComputedStyle(gallery);
  const rowHeight = Number.parseFloat(initialStyle.gridAutoRows);
  const gapY = Number.parseFloat(initialStyle.rowGap);
  const canCalculateRows = Number.isFinite(rowHeight) && rowHeight > 0;
  if (!Number.isFinite(gapY)) {
    console.error("Project gallery requires a valid vertical gap.");
    return;
  }

  // Height of a figure's caption at its current width, so rows leave room for it.
  function captionHeight(figure) {
    const caption = figure.querySelector(":scope > figcaption");
    if (!caption) return 0;
    const style = getComputedStyle(caption);
    return caption.getBoundingClientRect().height
      + (Number.parseFloat(style.marginTop) || 0)
      + (Number.parseFloat(style.marginBottom) || 0);
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
    const columnCount = Math.max(1, Math.min(configuredColumns || 3, columnLimit));
    const gapX = Number.parseFloat(galleryStyle.columnGap);
    const gapY = Number.parseFloat(galleryStyle.rowGap);
    const columnGap = Number.isFinite(gapX) ? gapX : 0;
    const cellWidth = (gallery.clientWidth - columnGap * (columnCount - 1)) / columnCount;

    gallery.querySelectorAll("figure").forEach((figure) => {
      const declaredColumns = Number.parseInt(figure.dataset.imageColumns || "1", 10);
      const columns = Math.max(1, Math.min(declaredColumns || 1, columnCount));
      figure.style.setProperty("--image-columns", columns);
      if (figure.dataset.imageRows || !canCalculateRows) return;

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

      const desiredHeight = imageWidth * height / width + captionHeight(figure);
      const rows = Math.max(1, Math.ceil((desiredHeight + heightAdjustment + gapY) / (rowHeight + gapY)));
      figure.style.setProperty("--image-rows", rows);
    });

    gallery.querySelectorAll(":scope > .project-image-row").forEach((row) => {
      const figures = [...row.querySelectorAll(":scope > figure")];
      const rowSpan = figures.reduce(
        (total, figure) => total + Number.parseInt(figure.style.getPropertyValue("--image-columns") || "1", 10),
        0,
      );
      row.style.setProperty("--gallery-row-span", rowSpan);
      row.style.setProperty("--gallery-row-columns", columnCount);
      // The row's side margins (half a gap each, from styles.css) keep its
      // outer pictures in line with single pictures, which sit inside their cells.
      const rowStyle = getComputedStyle(row);
      const sideMargins = (Number.parseFloat(rowStyle.marginLeft) || 0) + (Number.parseFloat(rowStyle.marginRight) || 0);
      const rowWidth = cellWidth * rowSpan + columnGap * Math.max(0, rowSpan - 1) - sideMargins;
      row.style.width = `${Math.max(0, rowWidth)}px`;

      let tallestImage = 0;
      figures.forEach((figure) => {
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
        const columns = Number.parseInt(figure.style.getPropertyValue("--image-columns") || "1", 10);
        const maxHeight = Number.parseFloat(getComputedStyle(media).maxHeight);
        const imageWidth = cellWidth * columns + columnGap * Math.max(0, columns - 1);
        const desiredHeight = imageWidth * height / width;
        const displayedHeight = Number.isFinite(maxHeight)
          ? Math.min(desiredHeight, maxHeight)
          : desiredHeight;
        tallestImage = Math.max(tallestImage, displayedHeight + captionHeight(figure));
      });

      if (tallestImage > 0 && canCalculateRows) {
        const rows = Math.max(1, Math.ceil((tallestImage + gapY) / (rowHeight + gapY)));
        row.style.setProperty("--image-rows", rows);
      } else {
        row.style.removeProperty("--image-rows");
      }
    });
  }

  updateAutomaticRows();
  window.addEventListener("resize", updateAutomaticRows);
})();
