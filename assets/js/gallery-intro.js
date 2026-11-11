// Compact start (home_gallery.compact): the cover canvas first appears scaled
// down as a whole, keeping its arrangement, so that every cover fits on the
// first screen below the header. The first scroll grows it to its full size.
// Scaling is a transform, so the page layout (and the footer) never moves.
// Phones show covers in one column and skip this.
(() => {
  const gallery = document.querySelector("#gallery.is-intro-fit");
  if (!gallery) return;

  const singleColumn = window.matchMedia("(max-width: 760px)");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const SPACE_BELOW = 16;

  function release(animate) {
    if (!gallery.classList.contains("is-intro-fit")) return;
    window.removeEventListener("scroll", handleScroll);
    window.removeEventListener("resize", fit);
    if (animate && !reducedMotion.matches) {
      gallery.classList.add("is-intro-releasing");
      gallery.addEventListener("transitionend", () => gallery.classList.remove("is-intro-releasing"), { once: true });
    }
    gallery.classList.remove("is-intro-fit", "is-intro-ready");
    gallery.style.removeProperty("--intro-scale");
  }

  function fit() {
    if (singleColumn.matches) {
      release(false);
      return;
    }
    // Layout size, unaffected by the current scale.
    const available = window.innerHeight - gallery.getBoundingClientRect().top - SPACE_BELOW;
    const scale = Math.min(1, available / gallery.offsetHeight);
    if (!(scale > 0) || scale > 0.97) {
      release(false);
      return;
    }
    gallery.style.setProperty("--intro-scale", scale.toFixed(4));
    gallery.classList.add("is-intro-ready");
    // Every cover is on screen at once, so none should wait for lazy loading.
    gallery.querySelectorAll("img[loading='lazy']").forEach(image => { image.loading = "eager"; });
  }

  function handleScroll() {
    if (window.scrollY > 2) release(true);
  }

  if (window.scrollY > 2) {
    release(false);
    return;
  }
  fit();
  window.addEventListener("resize", fit);
  window.addEventListener("scroll", handleScroll, { passive: true });
})();
