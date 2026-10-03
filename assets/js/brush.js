const brushCursor = document.createElement("div");
brushCursor.className = "brush-cursor";
brushCursor.setAttribute("aria-hidden", "true");
brushCursor.innerHTML = `
  <svg viewBox="0 0 122.88 102.66">
    <path id="brush-bristles" fill="#793535" fill-rule="evenodd" clip-rule="evenodd" d="M0,0c10.38,7.43,27.02-0.55,33.56,12.4c1.74,3.43,2.11,8.13,0.55,11.86c-0.63,1.5-1.56,2.84-2.82,3.86 c-0.56,0.45-1.18,0.85-1.87,1.19c-8.54,4.24-17.44-1.69-22.16-8.85C2.91,13.87,1.02,5.64,0,0L0,0z"/>
    <path id="brush-handle" fill="#c49228" fill-rule="evenodd" clip-rule="evenodd" d="M52.65,56.81 c5.78-4.62,10.27-9.93,13.32-16.02l53.72,50.94c2.81,2.66,4.4,4.91,2.04,8.99c-1.17,1.2-2.41,1.84-3.71,1.93 c-1.3,0.09-2.66-0.38-4.09-1.41L52.65,56.81L52.65,56.81z"/>
    <path id="brush-ferrule" fill="#2b99bd" fill-rule="evenodd" clip-rule="evenodd" d="M33.03,34.05c2.5-1.35,5.94-4.66,6.75-8.27l23.29,12.78 c-3.36,6.69-7.64,12.42-13.51,16.48C43.44,46.82,40,41.86,33.03,34.05L33.03,34.05z"/>
  </svg>
`;
document.body.append(brushCursor);

const dialogsWithCloseHandler = new WeakSet();

function placeBrushOverlays(element) {
  const dialog = element?.closest("dialog[open]");
  const overlayParent = dialog || document.body;

  if (dialog && !dialogsWithCloseHandler.has(dialog)) {
    dialogsWithCloseHandler.add(dialog);
    dialog.addEventListener("close", () => {
      placeBrushOverlays(null);
      brushCursor.classList.remove("is-visible");
    });
  }

  if (brushCursor.parentElement !== overlayParent) overlayParent.append(brushCursor);
}

document.addEventListener("pointermove", event => {
  placeBrushOverlays(event.target);

  brushCursor.style.transform = `translate(${event.clientX}px, ${event.clientY}px)`;
  brushCursor.classList.add("is-visible");
});

window.addEventListener("pointerout", event => {
  if (!event.relatedTarget) brushCursor.classList.remove("is-visible");
});
