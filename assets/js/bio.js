const portraitBioToggle = document.getElementById("portrait-bio-toggle");
const artistBio = document.getElementById("artist-bio");

function syncPortraitBioToggle() {
  portraitBioToggle.setAttribute("aria-expanded", String(artistBio.open));
}

portraitBioToggle.addEventListener("click", () => {
  artistBio.open = !artistBio.open;
  syncPortraitBioToggle();
});

artistBio.addEventListener("toggle", syncPortraitBioToggle);
