(() => {
  const gallery = document.querySelector("#gallery");
  if (!gallery) return;

  const dialog = document.createElement("dialog");
  dialog.className = "lightbox home-lightbox";
  dialog.setAttribute("aria-label", "Enlarged artwork");
  dialog.tabIndex = -1;
  document.body.append(dialog);

  let activeLink;

  gallery.addEventListener("click", event => {
    const link = event.target.closest(".home-lightbox-link");
    if (!link) return;

    event.preventDefault();
    activeLink = link;

    const image = document.createElement("img");
    if (link.dataset.lightboxSrcset) {
      image.srcset = link.dataset.lightboxSrcset;
      image.sizes = "100vw";
    }
    image.src = link.href;
    image.alt = link.querySelector("img")?.alt ?? "";

    const figure = document.createElement("figure");
    figure.append(image);

    const caption = document.createElement("figcaption");
    caption.textContent = link.dataset.caption ?? "";
    figure.append(caption);

    dialog.replaceChildren(figure);
    dialog.showModal();
    dialog.focus();
  });

  dialog.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => activeLink?.focus());
})();
