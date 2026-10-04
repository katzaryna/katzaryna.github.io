(() => {
  const gallery = document.querySelector("#gallery.is-intro-fit");
  if (!gallery) return;

  if (window.scrollY > 2) {
    gallery.classList.remove("is-intro-fit");
    return;
  }

  const figures = [...gallery.querySelectorAll(":scope > figure")];
  if (!figures.length) {
    gallery.classList.remove("is-intro-fit");
    return;
  }

  const gap = 10;
  const idealCellAspectRatio = 1.25;

  function fitGallery() {
    if (!gallery.classList.contains("is-intro-fit")) return;

    const width = gallery.clientWidth;
    const height = Math.max(0, window.innerHeight - gallery.getBoundingClientRect().top - 12);
    const count = figures.length;
    let bestColumns = 1;
    let bestArea = 0;

    for (let columns = 1; columns <= count; columns += 1) {
      const rows = Math.ceil(count / columns);
      const cellWidth = (width - gap * (columns - 1)) / columns;
      const cellHeight = (height - gap * (rows - 1)) / rows;
      const cellArea = cellWidth * cellHeight;
      const aspectPenalty = 1 + Math.abs(Math.log(cellWidth / cellHeight / idealCellAspectRatio));
      const score = cellArea / aspectPenalty;

      if (score > bestArea) {
        bestArea = score;
        bestColumns = columns;
      }
    }

    const rows = Math.ceil(count / bestColumns);
    gallery.style.setProperty("--intro-gallery-columns", bestColumns);
    gallery.style.setProperty("--intro-gallery-rows", rows);
    gallery.style.setProperty("--intro-gallery-height", `${height}px`);
    gallery.querySelectorAll("img").forEach((image) => {
      image.loading = "eager";
    });
  }

  function releaseIntroLayout() {
    if (!gallery.classList.contains("is-intro-fit")) return;

    const startPositions = figures.map((figure) => figure.getBoundingClientRect());
    gallery.classList.remove("is-intro-fit");
    window.removeEventListener("scroll", handleScroll);
    window.removeEventListener("resize", fitGallery);
    const endPositions = figures.map((figure) => figure.getBoundingClientRect());

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    figures.forEach((figure, index) => {
      const start = startPositions[index];
      const end = endPositions[index];
      figure.style.transition = "none";
      figure.style.transform = `translate(${start.left - end.left}px, ${start.top - end.top}px)`;
    });
    gallery.getBoundingClientRect();

    requestAnimationFrame(() => {
      figures.forEach((figure) => {
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
