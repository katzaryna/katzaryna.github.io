const gallery = document.querySelector(".project-works");

if (gallery) {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const dialog = document.createElement("dialog");
  dialog.className = "lightbox";
  dialog.setAttribute("aria-label", "Enlarged artwork");
  dialog.tabIndex = -1;

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

  function openImage(link) {
    const image = document.createElement("img");
    image.src = link.href;
    image.alt = link.querySelector("img")?.alt ?? link.getAttribute("aria-label") ?? "";
    dialog.replaceChildren(image);
    if (!dialog.open) dialog.showModal();
    dialog.focus();
  }

  function openVideo(link) {
    activeVideo = document.createElement("video");
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
    activeVideo.addEventListener("error", () => openImage(link), { once: true });
    dialog.replaceChildren(activeVideo);
    dialog.showModal();
    dialog.focus();
    activeVideo.play().catch(error => {
      if (error.name !== "NotAllowedError" && error.name !== "AbortError") {
        console.error("Could not play animated artwork.", error);
        openImage(link);
      }
    });
  }

  function closeLightbox() {
    if (dialog.open) dialog.close();
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

  dialog.addEventListener("click", event => {
    if (event.target === dialog || event.target.matches("img, video")) closeLightbox();
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
