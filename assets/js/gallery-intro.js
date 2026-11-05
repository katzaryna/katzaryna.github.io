(() => {
  const gallery = document.querySelector("#gallery.is-intro-fit");
  if (!gallery) return;

  const figures = [...gallery.querySelectorAll(":scope > figure")];
  const singleColumn = window.matchMedia("(max-width: 760px)").matches;
  if (!figures.length || singleColumn || window.scrollY > 2) {
    gallery.classList.remove("is-intro-fit");
    return;
  }

  const images = figures.map(figure => figure.querySelector("img"));
  const originalSizes = images.map(image => image?.getAttribute("sizes"));

  function fitGallery() {
    if (!gallery.classList.contains("is-intro-fit")) return;

    const height = Math.max(0, window.innerHeight - gallery.getBoundingClientRect().top - 12);
    if (!gallery.clientWidth || !height) return;

    gallery.style.height = `${height}px`;

    images.forEach(image => {
      if (!image) return;
      image.loading = "eager";
      image.sizes = `${Math.ceil(image.getBoundingClientRect().width)}px`;
    });
  }

  function releaseIntroLayout() {
    if (!gallery.classList.contains("is-intro-fit")) return;

    const startPositions = figures.map(figure => figure.getBoundingClientRect());
    gallery.classList.remove("is-intro-fit");
    gallery.style.removeProperty("height");
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
