// Blur-up loading. Each artwork link carries a tiny generated preview as its
// background (see generate_image_variants.py), so a blurred version of the
// picture shows at once. Images that are still loading fade in over it; then
// the preview is dropped. Without JavaScript the preview simply stays behind
// the (opaque) image.
(() => {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const FADE_MS = 400; // The opacity transition in styles.css.

  function dropPreview(link) {
    link.classList.remove("has-placeholder");
    link.style.removeProperty("background-image");
  }

  document.querySelectorAll(".has-placeholder").forEach(link => {
    // Animated artwork: the video poster covers the preview.
    const image = link.querySelector(":scope > video") ? null : link.querySelector("img");
    if (!image) return;

    if (image.complete && image.naturalWidth) {
      dropPreview(link);
      return;
    }
    if (!reducedMotion) image.classList.add("is-loading");
    image.addEventListener("load", () => {
      image.classList.remove("is-loading");
      // A timer rather than transitionend, which hidden tabs may never send.
      if (reducedMotion) dropPreview(link);
      else setTimeout(() => dropPreview(link), FADE_MS + 100);
    }, { once: true });
    image.addEventListener("error", () => image.classList.remove("is-loading"), { once: true });
  });
})();
