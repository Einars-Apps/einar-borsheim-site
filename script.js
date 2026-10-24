const year = document.getElementById("year");
if (year) year.textContent = new Date().getFullYear();

document.addEventListener("click", (event) => {
  const link = event.target.closest?.("a[href]");
  if (!link || typeof gtag !== "function") return;
  const href = link.getAttribute("href") || "";
  if (href.startsWith("tel:")) gtag("event", "klikk_telefon", { link_url: href });
  if (href.startsWith("mailto:")) gtag("event", "klikk_epost", { link_url: href });
});

const consentKey = "samtykke";
let consentChoice = "";
try { consentChoice = localStorage.getItem(consentKey) || ""; } catch (error) { consentChoice = ""; }

if (!consentChoice) {
  const banner = document.createElement("div");
  banner.className = "consent";
  banner.setAttribute("role", "dialog");
  banner.setAttribute("aria-label", "Informasjonskapsler");
  const text = document.createElement("p");
  text.append("Vi bruker analyse bare hvis du godtar. ");
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
  banner.append(text, actions);
  document.body.append(banner);

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
    }
    banner.remove();
  }
  deny.addEventListener("click", () => choose("avslatt"));
  allow.addEventListener("click", () => choose("godtatt"));
}
