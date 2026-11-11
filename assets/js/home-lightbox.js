// Cover viewer for the home page in single-page mode: the artwork large on the
// left and, on the right, the project title, the illustration title and its
// description (heading, subheading, text). White like About and Clients, with
// the same close button at the top right; Escape or a click beside the image
// also closes it.
(() => {
  const gallery = document.querySelector("#gallery");
  if (!gallery) return;

  const dialog = document.createElement("dialog");
  dialog.className = "cover-viewer";
  dialog.setAttribute("aria-labelledby", "cover-viewer-project");
  dialog.innerHTML = `
    <button class="info-dialog-close cover-viewer-close" type="button" aria-label="Close">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5l14 14M19 5L5 19"/></svg>
    </button>
    <div class="cover-viewer-image"></div>
    <article class="cover-viewer-text" tabindex="-1">
      <h2 class="cover-viewer-project" id="cover-viewer-project"></h2>
      <p class="cover-viewer-image-title"></p>
      <span class="cover-viewer-rule" aria-hidden="true"></span>
      <p class="cover-viewer-description"></p>
    </article>`;
  document.body.append(dialog);

  const imagePane = dialog.querySelector(".cover-viewer-image");
  const text = dialog.querySelector(".cover-viewer-text");
  const projectTitle = dialog.querySelector(".cover-viewer-project");
  const imageTitle = dialog.querySelector(".cover-viewer-image-title");
  const rule = dialog.querySelector(".cover-viewer-rule");
  const description = dialog.querySelector(".cover-viewer-description");
  let activeLink;

  function show(link) {
    activeLink = link;
    const image = document.createElement("img");
    if (link.dataset.lightboxSrcset) {
      image.srcset = link.dataset.lightboxSrcset;
      image.sizes = "(max-width: 760px) 100vw, 70vw";
    }
    image.src = link.href;
    image.alt = link.querySelector("img")?.alt ?? "";
    imagePane.replaceChildren(image);

    projectTitle.textContent = link.dataset.projectTitle ?? "";
    imageTitle.textContent = link.dataset.imageTitle ?? "";
    imageTitle.hidden = !imageTitle.textContent;
    description.textContent = link.dataset.imageDescription ?? "";
    description.hidden = !description.textContent;
    rule.hidden = description.hidden;

    dialog.showModal();
    text.scrollTop = 0;
    text.focus({ preventScroll: true });
  }

  gallery.addEventListener("click", event => {
    const link = event.target.closest(".home-lightbox-link");
    if (!link) return;
    event.preventDefault();
    show(link);
  });

  dialog.querySelector(".cover-viewer-close").addEventListener("click", () => dialog.close());
  imagePane.addEventListener("click", event => {
    if (event.target === imagePane) dialog.close();
  });
  dialog.addEventListener("close", () => activeLink?.focus());
})();
