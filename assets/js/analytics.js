const GA_MEASUREMENT_ID = document.currentScript?.dataset.measurementId ?? "";
const CONSENT_KEY = "artist-site-analytics-consent";
const consentNotice = document.getElementById("analytics-consent");
const acceptButton = document.getElementById("accept-analytics");
const rejectButton = document.getElementById("reject-analytics");
const analyticsEnabled = /^G-[A-Z0-9]+$/.test(GA_MEASUREMENT_ID);
let analyticsLoaded = false;

// Storage can be unavailable (private browsing, blocked site data); treat that as "not decided".
function readConsent() {
  try {
    return localStorage.getItem(CONSENT_KEY);
  } catch {
    return null;
  }
}

function writeConsent(value) {
  try {
    localStorage.setItem(CONSENT_KEY, value);
  } catch {
    // The choice still applies to this page view.
  }
}

function loadGoogleAnalytics() {
  if (analyticsLoaded || !analyticsEnabled) return;
  analyticsLoaded = true;
  window[`ga-disable-${GA_MEASUREMENT_ID}`] = false;
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

function stopGoogleAnalytics() {
  window[`ga-disable-${GA_MEASUREMENT_ID}`] = true;
  const domains = ["", location.hostname, `.${location.hostname}`];
  document.cookie.split(";").map(cookie => cookie.split("=")[0].trim()).filter(name => name.startsWith("_ga")).forEach(name => {
    domains.forEach(domain => {
      document.cookie = `${name}=; Max-Age=0; path=/${domain ? `; domain=${domain}` : ""}`;
    });
  });
}

function showNotice() {
  if (!consentNotice || !analyticsEnabled) return;
  consentNotice.hidden = false;
  (readConsent() === "accepted" ? rejectButton : acceptButton)?.focus();
}

const consent = readConsent();
if (consent === "accepted") loadGoogleAnalytics();
else if (consent !== "rejected") showNotice();

acceptButton?.addEventListener("click", () => {
  writeConsent("accepted");
  consentNotice.hidden = true;
  loadGoogleAnalytics();
});

rejectButton?.addEventListener("click", () => {
  writeConsent("rejected");
  consentNotice.hidden = true;
  stopGoogleAnalytics();
});

document.querySelectorAll("[data-open-consent]").forEach(button => {
  button.hidden = !analyticsEnabled;
  button.addEventListener("click", showNotice);
});
