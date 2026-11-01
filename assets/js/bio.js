const artistBio = document.getElementById("artist-bio");

if (artistBio) {
  const artistBioText = document.getElementById("artist-bio-text");
  let bioOpen = false;
  let bioFrame;

  function setBioOpen(open) {
    if (bioFrame) cancelAnimationFrame(bioFrame);

    const currentHeight = artistBioText.getBoundingClientRect().height;
    artistBioText.style.height = `${currentHeight}px`;
    artistBioText.classList.remove("is-open", "is-closing");
    bioOpen = open;
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
