window.dataLayer = window.dataLayer || [];
function gtag() { window.dataLayer.push(arguments); }
window.gtag = gtag;

// Google Ads-konverteringer. Etikettene ligger samlet her.
window.ADS_ID = "AW-18535455222";
window.ADS_CONVERSIONS = {
  telefon: "AW-18535455222/rEGGCLPcxqsdEPazsoZF",
  epost: "AW-18535455222/ZqFTCLbcxqsdEPazsoZF",
  skjema: "AW-18535455222/gOXVCLDcxqsdEPazsoZF",
};

var adsKonfigurert = false;

function samtykkeValg() {
  try { return localStorage.getItem("samtykke") || ""; } catch (error) { return ""; }
}

window.konfigurerGoogleAds = function () {
  if (adsKonfigurert || samtykkeValg() !== "godtatt") return;
  adsKonfigurert = true;
  gtag("config", window.ADS_ID);
};

window.adsKonvertering = function (nokkel) {
  if (samtykkeValg() !== "godtatt") return;
  var sendTo = window.ADS_CONVERSIONS && window.ADS_CONVERSIONS[nokkel];
  var prefix = window.ADS_ID + "/";
  if (!sendTo || sendTo.indexOf(prefix) !== 0) return;
  if (!sendTo.slice(prefix.length)) return;
  gtag("event", "conversion", { send_to: sendTo, value: 1.0, currency: "NOK" });
};

var stored = samtykkeValg();

gtag("consent", "default", {
  ad_storage: "denied",
  ad_user_data: "denied",
  ad_personalization: "denied",
  analytics_storage: "denied",
  wait_for_update: 500,
});

if (stored === "godtatt") {
  gtag("consent", "update", {
    ad_storage: "granted",
    ad_user_data: "granted",
    ad_personalization: "granted",
    analytics_storage: "granted",
  });
  window.konfigurerGoogleAds();
}

gtag("js", new Date());
gtag("config", "G-XCQTBQVK7C");
