const year = document.getElementById("year");
if (year) year.textContent = new Date().getFullYear();

document.addEventListener("click", (event) => {
  const link = event.target.closest?.("a[href]");
  if (!link || typeof gtag !== "function") return;
  const href = link.getAttribute("href") || "";
  if (href.startsWith("tel:")) {
    gtag("event", "klikk_telefon", { link_url: href });
    if (href.replace(/\D/g, "").endsWith("90552065") && typeof adsKonvertering === "function") adsKonvertering("telefon");
  }
  if (href.startsWith("mailto:")) {
    gtag("event", "klikk_epost", { link_url: href });
    if (/^mailto:post@einar-borsheim\.com(?:\?|$)/i.test(href) && typeof adsKonvertering === "function") adsKonvertering("epost");
  }
});

const consentKey = "samtykke";

function readConsent() {
  try { return localStorage.getItem(consentKey) || ""; } catch (error) { return ""; }
}

function showConsentBanner() {
  if (document.querySelector(".consent")) return;

  const banner = document.createElement("div");
  banner.className = "consent";
  banner.setAttribute("role", "dialog");
  banner.setAttribute("aria-label", "Informasjonskapsler");
  const text = document.createElement("p");
  text.append("Informasjonskapsler for analyse settes bare hvis du godtar. Uten samtykke settes ingen slike kapsler, og det sendes bare anonyme signaler uten informasjonskapsler. ");
  const privacy = document.createElement("a");
  privacy.href = "/personvern/";
  privacy.textContent = "Les om personvern";
  text.append(privacy, ".");
  const actions = document.createElement("div");
  actions.className = "consent-actions";
  const deny = document.createElement("button");
  deny.type = "button";
  deny.className = "btn btn-ghost";
  deny.textContent = "Avslå";
  const allow = document.createElement("button");
  allow.type = "button";
  allow.className = "btn btn-primary";
  allow.textContent = "Godta";
  actions.append(deny, allow);
  banner.tabIndex = -1;
  banner.append(text, actions);
  document.body.append(banner);
  banner.focus({ preventScroll: true });

  function choose(value) {
    try { localStorage.setItem(consentKey, value); } catch (error) { /* valget gjelder bare dette besøket */ }
    const granted = value === "godtatt";
    const state = granted ? "granted" : "denied";
    if (typeof gtag === "function") {
      gtag("consent", "update", {
        ad_storage: state,
        ad_user_data: state,
        ad_personalization: state,
        analytics_storage: state,
      });
      if (granted && typeof konfigurerGoogleAds === "function") konfigurerGoogleAds();
    }
    banner.remove();
  }
  deny.addEventListener("click", () => choose("avslatt"));
  allow.addEventListener("click", () => choose("godtatt"));
}

if (!readConsent()) showConsentBanner();

document.addEventListener("click", (event) => {
  const trigger = event.target.closest?.("[data-endre-samtykke]");
  if (!trigger) return;
  event.preventDefault();
  showConsentBanner();
});
