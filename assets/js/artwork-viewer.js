// Shared by the two artwork viewers (home-lightbox.js and lightbox.js).
//
// morph()        The View Transitions API flies the clicked thumbnail into the
//                large image and back. Browsers without it, and visitors who
//                ask for reduced motion, get the viewer's ordinary open/close.
// prepareImage() Gives the large image its final size before it loads and
//                shows the already-loaded thumbnail underneath, so the picture
//                is there at once and sharpens when the original arrives.
// attachZoom()   A click or tap zooms to 2x at that point. The mouse then
//                explores the picture, a finger drags it; another click or tap
//                returns to 1x.
window.artworkViewer = (() => {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const ZOOM = 2;
  const DRAG_THRESHOLD = 6;
  let running = null;
  let runningNames = new Set();

  function canMorph() {
    return typeof document.startViewTransition === "function" && !reducedMotion.matches;
  }

  // update() changes the page (opens or closes a viewer) and returns the
  // element the picture should land on.
  async function morph(from, update) {
    if (!canMorph()) {
      update();
      return;
    }
    running?.skipTransition();
    const root = document.documentElement;
    root.classList.add("is-artwork-transition");
    const named = new Set();
    if (from) {
      from.style.viewTransitionName = "artwork";
      named.add(from);
    }
    const transition = document.startViewTransition(() => {
      from?.style.removeProperty("view-transition-name");
      const to = update();
      if (to) {
        to.style.viewTransitionName = "artwork";
        named.add(to);
      }
    });
    running = transition;
    runningNames = named;
    transition.ready.catch(() => {});
    try {
      await transition.finished;
    } catch {
      // A newer transition replaced this one; the page is already updated.
    } finally {
      const superseded = running !== transition;
      // Leave names that a newer transition has taken over.
      named.forEach(element => {
        if (!superseded || !runningNames.has(element)) element.style.removeProperty("view-transition-name");
      });
      if (!superseded) {
        running = null;
        runningNames = new Set();
        root.classList.remove("is-artwork-transition");
      }
    }
  }

  // Sizes a large image or video from the artwork's pixel dimensions, so the
  // stylesheet can fit it to the viewer before anything has loaded.
  function sizeFrom(element, width, height) {
    if (!(width > 0 && height > 0)) return;
    element.width = width;
    element.height = height;
    element.style.setProperty("--artwork-width", `${width}px`);
    element.style.setProperty("--artwork-ratio", `${width} / ${height}`);
    element.classList.add("has-artwork-size");
  }

  function prepareImage(image, thumbnail) {
    if (!thumbnail) return;
    sizeFrom(image, Number(thumbnail.getAttribute("width")), Number(thumbnail.getAttribute("height")));
    if (thumbnail.complete && thumbnail.naturalWidth && thumbnail.currentSrc) {
      image.style.backgroundImage = `url("${thumbnail.currentSrc.replaceAll('"', "%22")}")`;
      image.addEventListener("load", () => image.style.removeProperty("background-image"), { once: true });
    }
  }

  function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
  }

  function attachZoom(image) {
    let origin = null; // Zoom centre in the image's own (unscaled) pixels.
    let drag = null;
    let suppressClick = false;
    let requestedSize = 0;
    image.classList.add("is-zoomable");

    const isZoomed = () => image.classList.contains("is-zoomed");

    // The image's untransformed box, worked back from the transformed one so it
    // stays right mid-animation and when the viewer scrolls.
    function layoutBox() {
      const box = image.getBoundingClientRect();
      const transform = getComputedStyle(image).transform;
      const scale = transform && transform !== "none" ? new DOMMatrixReadOnly(transform).a : 1;
      const width = box.width / scale;
      const height = box.height / scale;
      const [x, y] = origin ?? [width / 2, height / 2];
      return { left: box.left + (scale - 1) * x, top: box.top + (scale - 1) * y, width, height };
    }

    function setOrigin(x, y, box) {
      origin = [clamp(x, 0, box.width), clamp(y, 0, box.height)];
      image.style.transformOrigin = `${origin[0]}px ${origin[1]}px`;
    }

    function zoomIn(clientX, clientY) {
      const box = layoutBox();
      setOrigin(clientX - box.left, clientY - box.top, box);
      // Ask the browser for a source sharp enough for the zoomed size.
      const wanted = Math.max(Math.ceil(box.width * ZOOM), window.innerWidth);
      if (image.srcset && wanted > requestedSize) {
        requestedSize = wanted;
        image.sizes = `${wanted}px`;
      }
      image.classList.add("is-zoomed");
    }

    image.addEventListener("click", event => {
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      if (isZoomed()) image.classList.remove("is-zoomed");
      else zoomIn(event.clientX, event.clientY);
    });

    image.addEventListener("pointerdown", event => {
      suppressClick = false;
      if (!isZoomed() || event.pointerType === "mouse") return;
      const box = layoutBox();
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, origin: origin ?? [box.width / 2, box.height / 2], moved: false };
      image.setPointerCapture(event.pointerId);
    });

    image.addEventListener("pointermove", event => {
      if (!isZoomed()) return;
      if (event.pointerType === "mouse") {
        const box = layoutBox();
        setOrigin(event.clientX - box.left, event.clientY - box.top, box);
      } else if (drag && event.pointerId === drag.id) {
        const dx = event.clientX - drag.x;
        const dy = event.clientY - drag.y;
        if (Math.hypot(dx, dy) > DRAG_THRESHOLD) drag.moved = true;
        // Moving the centre against the finger moves the picture with it.
        setOrigin(drag.origin[0] - dx / (ZOOM - 1), drag.origin[1] - dy / (ZOOM - 1), layoutBox());
      }
    });

    function endDrag(event) {
      if (!drag || event.pointerId !== drag.id) return;
      suppressClick = drag.moved;
      drag = null;
    }
    image.addEventListener("pointerup", endDrag);
    image.addEventListener("pointercancel", endDrag);
  }

  return { canMorph, morph, sizeFrom, prepareImage, attachZoom };
})();
