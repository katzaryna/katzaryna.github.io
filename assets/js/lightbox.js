const gallery = document.querySelector(".project-works");

if (gallery) {
  const dialog = document.createElement("dialog");
  dialog.className = "lightbox";
  dialog.setAttribute("aria-label", "Enlarged artwork");
  dialog.tabIndex = -1;

  const enlargedImage = document.createElement("img");
  dialog.append(enlargedImage);
  document.body.append(dialog);

  let activeLink;

  function closeLightbox() {
    if (dialog.open) dialog.close();
  }

  gallery.addEventListener("click", event => {
    const link = event.target.closest(".lightbox-link");
    if (!link) return;

    event.preventDefault();
    activeLink = link;
    enlargedImage.src = link.href;
    enlargedImage.alt = link.querySelector("img").alt;
    dialog.showModal();
    dialog.focus();
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && dialog.open) closeLightbox();
  });
  dialog.addEventListener("click", closeLightbox);
  dialog.addEventListener("close", () => activeLink?.focus());
}
