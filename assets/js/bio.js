// About and Clients open as full-screen dialogs; #about and #clients link straight to them.
const dialogTriggers = document.querySelectorAll("[data-open-dialog]");

function openInfoDialog(dialog) {
  if (!dialog || dialog.open) return;
  dialog.showModal();
  dialog.scrollTop = 0;
  const hash = `#${dialog.id.replace(/-dialog$/, "")}`;
  if (location.hash !== hash) history.replaceState(null, "", hash);
}

dialogTriggers.forEach(trigger => {
  const dialog = document.getElementById(trigger.dataset.openDialog);
  trigger.addEventListener("click", () => openInfoDialog(dialog));
});

document.querySelectorAll(".info-dialog").forEach(dialog => {
  dialog.querySelector("[data-close-dialog]")?.addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    if (location.hash === `#${dialog.id.replace(/-dialog$/, "")}`) {
      history.replaceState(null, "", location.pathname + location.search);
    }
    document.querySelector(`[data-open-dialog="${dialog.id}"]`)?.focus();
  });
});

function openDialogFromHash() {
  const name = location.hash.slice(1);
  if (name === "about" || name === "clients") openInfoDialog(document.getElementById(`${name}-dialog`));
}
openDialogFromHash();
window.addEventListener("hashchange", openDialogFromHash);

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
