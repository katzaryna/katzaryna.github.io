const gallery = document.querySelector(".project-works");

if (gallery) {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const viewer = window.artworkViewer;
  const dialog = document.createElement("dialog");
  dialog.className = "lightbox";
  dialog.setAttribute("aria-label", "Enlarged artwork");
  dialog.tabIndex = -1;

  // A click on the image zooms it, so closing needs its own button.
  const closeButton = document.createElement("button");
  closeButton.className = "info-dialog-close lightbox-close";
  closeButton.type = "button";
  closeButton.setAttribute("aria-label", "Close");
  closeButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5l14 14M19 5L5 19"/></svg>';

  document.body.append(dialog);

  let activeLink;
  let activeVideo;
  const visiblePreviews = new Set();
  const previews = [...gallery.querySelectorAll(".artwork-motion")];

  function replacePreviewWithOriginal(video) {
    const link = video.closest(".motion-link");
    if (!link) return;

    const image = document.createElement("img");
    image.className = "artwork-motion-fallback";
    image.src = link.href;
    image.alt = video.getAttribute("aria-label") ?? "";
    image.width = video.width;
    image.height = video.height;
    video.replaceWith(image);
    visiblePreviews.delete(video);
  }

  previews.forEach(video => {
    video.addEventListener("error", () => replacePreviewWithOriginal(video), { once: true });
  });

  function syncPreviewPlayback() {
    previews.forEach(video => {
      if (visiblePreviews.has(video) && !reducedMotion.matches && !dialog.open) {
        video.play().catch(error => {
          if (error.name !== "NotAllowedError" && error.name !== "AbortError") {
            console.error("Could not play animated artwork preview.", error);
            replacePreviewWithOriginal(video);
          }
        });
      } else {
        video.pause();
      }
    });
  }

  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) visiblePreviews.add(entry.target);
        else visiblePreviews.delete(entry.target);
      });
      syncPreviewPlayback();
    }, { rootMargin: "100px", threshold: 0.1 });
    previews.forEach(video => observer.observe(video));
  } else {
    previews.forEach(video => visiblePreviews.add(video));
    syncPreviewPlayback();
  }
  reducedMotion.addEventListener("change", syncPreviewPlayback);

  // The gallery element the viewer flies out of and back into.
  function thumbnailOf(link) {
    // An animation's <video> holds a fallback <img>, so look for the video first.
    return link?.querySelector(":scope > video") ?? link?.querySelector("img");
  }

  function show(content, thumbnail) {
    dialog.classList.toggle("is-morphed", viewer.canMorph());
    viewer.morph(thumbnail, () => {
      dialog.replaceChildren(closeButton, content);
      if (!dialog.open) dialog.showModal();
      dialog.focus();
      return content;
    });
  }

  // animate: false when an animation that failed to play is swapped for its
  // still image inside the open viewer.
  function openImage(link, animate = true) {
    const thumbnail = link.querySelector("img");
    const image = document.createElement("img");
    if (link.dataset.lightboxSrcset) {
      image.srcset = link.dataset.lightboxSrcset;
      image.sizes = "100vw";
    }
    image.src = link.href;
    image.alt = thumbnail?.alt ?? link.getAttribute("aria-label") ?? "";
    viewer.prepareImage(image, thumbnail);
    viewer.attachZoom(image);
    if (animate) {
      show(image, thumbnail);
    } else {
      dialog.replaceChildren(closeButton, image);
      if (!dialog.open) dialog.showModal();
      dialog.focus();
    }
  }

  function openVideo(link) {
    const preview = thumbnailOf(link);
    activeVideo = document.createElement("video");
    viewer.sizeFrom(activeVideo, preview?.width, preview?.height);
    activeVideo.autoplay = true;
    activeVideo.loop = true;
    activeVideo.muted = true;
    activeVideo.playsInline = true;
    activeVideo.setAttribute("aria-label", link.getAttribute("aria-label") ?? "");
    activeVideo.poster = link.querySelector("video")?.poster ?? "";

    const source = document.createElement("source");
    source.src = link.dataset.lightboxVideo;
    source.type = "video/webm";
    activeVideo.append(source);
    const mp4Source = document.createElement("source");
    mp4Source.src = link.dataset.lightboxMp4;
    mp4Source.type = "video/mp4";
    activeVideo.append(mp4Source);
    activeVideo.addEventListener("error", () => openImage(link, false), { once: true });
    const video = activeVideo;
    show(video, preview);
    video.play().catch(error => {
      if (error.name !== "NotAllowedError" && error.name !== "AbortError") {
        console.error("Could not play animated artwork.", error);
        openImage(link, false);
      }
    });
  }

  function closeLightbox() {
    if (!dialog.open) return;
    viewer.morph(dialog.querySelector("img, video"), () => {
      dialog.close();
      return thumbnailOf(activeLink);
    });
  }

  gallery.addEventListener("click", event => {
    const link = event.target.closest(".lightbox-link");
    if (!link) return;

    event.preventDefault();
    activeLink = link;
    previews.forEach(video => video.pause());
    if (link.dataset.lightboxVideo) openVideo(link);
    else openImage(link);
  });

  closeButton.addEventListener("click", closeLightbox);
  dialog.addEventListener("click", event => {
    if (event.target === dialog || event.target.matches("video")) closeLightbox();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && dialog.open) {
      event.preventDefault();
      closeLightbox();
    }
  });
  dialog.addEventListener("close", () => {
    if (activeVideo) {
      activeVideo.pause();
      activeVideo.removeAttribute("src");
      activeVideo.replaceChildren();
      activeVideo = null;
    }
    activeLink?.focus();
    syncPreviewPlayback();
  });
}
