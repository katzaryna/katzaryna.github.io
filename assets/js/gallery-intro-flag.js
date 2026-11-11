// Runs in <head> before the gallery renders: with JavaScript on, the compact
// start keeps the canvas hidden until gallery-intro.js has scaled it, so it
// never flashes at full size first.
document.documentElement.classList.add("gallery-intro-supported");
