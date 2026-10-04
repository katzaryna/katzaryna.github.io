const portraitBioToggle = document.getElementById("portrait-bio-toggle");
const artistBio = document.getElementById("artist-bio");

if (portraitBioToggle && artistBio) {
  const artistBioText = document.getElementById("artist-bio-text");
  const wordmark = document.querySelector(".site-header .wordmark");
  let bioOpen = false;
  let bioFrame;

  if (wordmark) {
    const updateBioLinkVisibility = () => {
      const wordmarkText = document.createRange();
      wordmarkText.selectNodeContents(wordmark);
      const bioBounds = artistBio.getBoundingClientRect();
      const portraitBounds = portraitBioToggle.getBoundingClientRect();
      const textBounds = Array.from(wordmarkText.getClientRects());
      const overlaps = bounds => textBounds.some(text =>
        text.left < bounds.right &&
        text.right > bounds.left &&
        text.top < bounds.bottom &&
        text.bottom > bounds.top
      );
      const overlapsBio = overlaps(bioBounds);
      const overlapsPortrait = overlaps(portraitBounds);

      artistBio.classList.toggle("is-obscured", overlapsBio);
      artistBio.setAttribute("aria-hidden", String(overlapsBio));
      artistBio.tabIndex = overlapsBio ? -1 : 0;
      portraitBioToggle.classList.toggle("is-obscured", overlapsPortrait);
      portraitBioToggle.setAttribute("aria-hidden", String(overlapsPortrait));
      portraitBioToggle.tabIndex = overlapsPortrait ? -1 : 0;
    };

    const headerObserver = new ResizeObserver(updateBioLinkVisibility);
    headerObserver.observe(wordmark);
    headerObserver.observe(artistBio);
    headerObserver.observe(portraitBioToggle);
    window.addEventListener("resize", updateBioLinkVisibility);
    document.fonts.ready.then(updateBioLinkVisibility);
    updateBioLinkVisibility();
  }

  function setBioOpen(open) {
    if (bioFrame) cancelAnimationFrame(bioFrame);

    const currentHeight = artistBioText.getBoundingClientRect().height;
    artistBioText.style.height = `${currentHeight}px`;
    artistBioText.classList.remove("is-open", "is-closing");
    bioOpen = open;
    portraitBioToggle.setAttribute("aria-expanded", String(open));
    artistBio.setAttribute("aria-expanded", String(open));
    artistBioText.setAttribute("aria-hidden", String(!open));

    if (open) {
      artistBioText.classList.add("is-open");
    } else {
      artistBioText.classList.add("is-closing");
    }

    bioFrame = requestAnimationFrame(() => {
      artistBioText.style.height = open ? `${artistBioText.scrollHeight}px` : "0px";
    });
  }

  const toggleBio = () => setBioOpen(!bioOpen);

  portraitBioToggle.addEventListener("click", toggleBio);
  artistBio.addEventListener("click", toggleBio);
  artistBioText.addEventListener("transitionend", event => {
    if (event.propertyName !== "height") return;
    if (bioOpen) {
      artistBioText.style.height = "auto";
    } else {
      artistBioText.classList.remove("is-closing");
    }
  });
}

const emailContact = document.getElementById("email-contact");

if (emailContact) {
  const emailSummary = emailContact.querySelector("summary");
  const emailAddress = emailContact.querySelector(".email-address");
  const emailCopyButton = emailContact.querySelector(".copy-email");
  const emailCopyStatus = emailContact.querySelector(".copy-email-status");

  emailSummary.addEventListener("click", () => {
    window.setTimeout(() => {
      window.location.href = emailAddress.href;
    }, 0);
  });

  emailCopyButton.addEventListener("click", async () => {
    const email = emailCopyButton.dataset.email;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(email);
      } else {
        const input = document.createElement("textarea");
        input.value = email;
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.append(input);
        input.select();
        const copied = document.execCommand("copy");
        input.remove();
        if (!copied) throw new Error("Clipboard copy command failed");
      }
      emailCopyStatus.textContent = "Copied";
    } catch (error) {
      console.error("Could not copy email address.", error);
      emailCopyStatus.textContent = "Could not copy";
    }
  });
}
