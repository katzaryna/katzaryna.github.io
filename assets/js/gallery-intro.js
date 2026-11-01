(() => {
  const gallery = document.querySelector("#gallery.is-intro-fit");
  if (!gallery) return;

  const figures = [...gallery.querySelectorAll(":scope > figure")];
  if (!figures.length || window.scrollY > 2) {
    gallery.classList.remove("is-intro-fit");
    return;
  }

  const gap = Number.parseFloat(getComputedStyle(gallery).columnGap) || 0;
  const images = figures.map(figure => figure.querySelector("img"));
  const originalSizes = images.map(image => image?.getAttribute("sizes"));

  function fitGallery() {
    if (!gallery.classList.contains("is-intro-fit")) return;

    const width = gallery.clientWidth;
    const height = Math.max(0, window.innerHeight - gallery.getBoundingClientRect().top - 12);
    if (!width || !height) return;

    let bestColumns = 1;
    let bestScore = 0;

    for (let columns = 1; columns <= figures.length; columns += 1) {
      const rows = Math.ceil(figures.length / columns);
      const lastRowItems = figures.length % columns || columns;
      const cellWidth = (width - gap * (columns - 1)) / columns;
      const cellHeight = (height - gap * (rows - 1)) / rows;
      const score = images.reduce((total, image, index) => {
        const imageWidth = image?.naturalWidth || Number(image?.getAttribute("width")) || 1;
        const imageHeight = image?.naturalHeight || Number(image?.getAttribute("height")) || 1;
        const columnSpan = index >= figures.length - lastRowItems ? columns : lastRowItems;
        const itemWidth = cellWidth * columnSpan / lastRowItems;
        const scale = Math.min(itemWidth / imageWidth, cellHeight / imageHeight);
        return total + imageWidth * imageHeight * scale * scale;
      }, 0);

      if (score > bestScore) {
        bestScore = score;
        bestColumns = columns;
      }
    }

    const rows = Math.ceil(figures.length / bestColumns);
    const lastRowItems = figures.length % bestColumns || bestColumns;
    const gridColumns = bestColumns * lastRowItems;
    gallery.style.setProperty("--intro-gallery-columns", bestColumns);
    gallery.style.setProperty("--intro-gallery-rows", rows);
    gallery.style.setProperty("--intro-gallery-grid-columns", gridColumns);
    gallery.style.setProperty("--intro-gallery-height", `${height}px`);
    figures.forEach((figure, index) => {
      const isLastRow = index >= figures.length - lastRowItems;
      figure.style.setProperty("--intro-gallery-column-span", isLastRow ? bestColumns : lastRowItems);
      const image = images[index];
      if (image) {
        image.loading = "eager";
        const cellWidth = (width - gap * (bestColumns - 1)) / bestColumns;
        image.sizes = `${Math.ceil(cellWidth * (isLastRow ? bestColumns : lastRowItems) / lastRowItems)}px`;
      }
    });
  }

  function releaseIntroLayout() {
    if (!gallery.classList.contains("is-intro-fit")) return;

    const startPositions = figures.map(figure => figure.getBoundingClientRect());
    gallery.classList.remove("is-intro-fit");
    figures.forEach(figure => figure.style.removeProperty("--intro-gallery-column-span"));
    window.removeEventListener("scroll", handleScroll);
    window.removeEventListener("resize", fitGallery);
    images.forEach((image, index) => {
      if (!image) return;
      if (originalSizes[index] === null) image.removeAttribute("sizes");
      else image.setAttribute("sizes", originalSizes[index]);
    });
    const endPositions = figures.map(figure => figure.getBoundingClientRect());

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    figures.forEach((figure, index) => {
      const start = startPositions[index];
      const end = endPositions[index];
      figure.style.transition = "none";
      figure.style.transform = `translate(${start.left - end.left}px, ${start.top - end.top}px)`;
    });
    gallery.getBoundingClientRect();

    requestAnimationFrame(() => {
      figures.forEach(figure => {
        figure.style.transition = "transform 650ms cubic-bezier(.2, .75, .25, 1)";
        figure.style.transform = "translate(0, 0)";
        figure.addEventListener("transitionend", () => {
          figure.style.removeProperty("transition");
          figure.style.removeProperty("transform");
        }, { once: true });
      });
    });
  }

  function handleScroll() {
    if (window.scrollY > 2) releaseIntroLayout();
  }

  fitGallery();
  window.addEventListener("resize", fitGallery);
  window.addEventListener("scroll", handleScroll, { passive: true });
})();
