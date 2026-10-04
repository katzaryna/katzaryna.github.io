const gallery = document.querySelector(".gallery");

if (gallery) {
  gallery.querySelectorAll("img").forEach(image => {
    const setOrientation = () => {
      image.closest("figure").classList.toggle("is-landscape", image.naturalWidth > image.naturalHeight);
    };

    if (image.complete) {
      setOrientation();
    } else {
      image.addEventListener("load", setOrientation, { once: true });
    }
  });
}
