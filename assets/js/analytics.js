const GA_MEASUREMENT_ID = "";
const CONSENT_KEY = "artist-site-analytics-consent";
const consentNotice = document.getElementById("analytics-consent");

function loadGoogleAnalytics() {
  if (!/^G-[A-Z0-9]+$/.test(GA_MEASUREMENT_ID)) return;
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
  script.onerror = () => console.error("Could not load Google Analytics.");
  document.head.append(script);
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() { window.dataLayer.push(arguments); };
  window.gtag("js", new Date());
  window.gtag("config", GA_MEASUREMENT_ID);
}

const consent = localStorage.getItem(CONSENT_KEY);
if (consent === "accepted") {
  loadGoogleAnalytics();
} else if (consent !== "rejected" && /^G-[A-Z0-9]+$/.test(GA_MEASUREMENT_ID)) {
  consentNotice.hidden = false;
}

document.getElementById("accept-analytics").addEventListener("click", () => {
  localStorage.setItem(CONSENT_KEY, "accepted");
  consentNotice.hidden = true;
  loadGoogleAnalytics();
});

document.getElementById("reject-analytics").addEventListener("click", () => {
  localStorage.setItem(CONSENT_KEY, "rejected");
  consentNotice.hidden = true;
});
