// About and Clients open as full-screen dialogs; #about and #clients link straight to them.
// Also: copying the email address, and every copy-link button on the site
// ([data-copy-page-link], in these dialogs and the artwork viewers), which
// copies the current address, #about, #clients or #an-artwork included.

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const input = document.createElement("textarea");
  input.value = text;
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.append(input);
  input.select();
  const copied = document.execCommand("copy");
  input.remove();
  if (!copied) throw new Error("Clipboard copy command failed");
}

document.addEventListener("click", async event => {
  const button = event.target.closest("[data-copy-page-link]");
  if (!button) return;
  const status = button.nextElementSibling?.matches(".share-link-status") ? button.nextElementSibling : null;
  try {
    await copyText(location.href);
    if (status) status.textContent = "Link copied";
  } catch (error) {
    console.error("Could not copy the link.", error);
    if (status) status.textContent = "Could not copy";
  }
  if (status) {
    window.clearTimeout(status.hideTimer);
    status.hideTimer = window.setTimeout(() => { status.textContent = ""; }, 2000);
  }
});
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
      await copyText(email);
      emailCopyStatus.textContent = "Copied";
    } catch (error) {
      console.error("Could not copy email address.", error);
      emailCopyStatus.textContent = "Could not copy";
    }
  });
}
