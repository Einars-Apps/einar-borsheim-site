window.dataLayer = window.dataLayer || [];
function gtag() { window.dataLayer.push(arguments); }
window.gtag = gtag;

var stored = "";
try { stored = localStorage.getItem("samtykke") || ""; } catch (error) { stored = ""; }

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
}

gtag("js", new Date());
gtag("config", "G-XCQTBQVK7C");
// Google Ads: lim inn AW-koden her når annonseringen starter.
// gtag("config", "AW-XXXXXXXXXX");
