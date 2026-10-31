import { customerSeesCost } from "./cost.js";
import { isOfferItem } from "./offers.js";

// Nåværende kostnad gjenbruker showCostToCustomer og er skjult når feltet mangler.
// De andre seksjonene er synlige når feltet mangler, så eksisterende prosjekter oppfører seg som før.
export const PORTAL_SECTIONS = [
  { id: "tilbud", label: "Tilbud" },
  { id: "tilbudEndringer", label: "Tilbud og endringer" },
  { id: "kostnad", label: "Nåværende kostnad" },
  { id: "betalinger", label: "Betalinger" },
  { id: "bilder", label: "Bilder" },
  { id: "endringer", label: "Endringer og avvik" },
  { id: "dokumentasjon", label: "Dokumentasjon og rapport" },
  { id: "grunnlag", label: "Grunnlag fra deg" },
  { id: "meldinger", label: "Meldinger" },
  { id: "foresporsler", label: "Forespørsler" },
  { id: "hms", label: "HMS" },
  { id: "vurdering", label: "Vurdering" },
];

const DEFAULT_VISIBLE = {
  tilbud: true,
  tilbudEndringer: true,
  kostnad: false,
  betalinger: true,
  bilder: true,
  endringer: true,
  dokumentasjon: true,
  grunnlag: true,
  meldinger: true,
  foresporsler: true,
  hms: true,
  vurdering: true,
};

export const PORTAL_JUMPS = [
  { id: "seksjon-betalinger", label: "Betalinger" },
  { id: "seksjon-tilbud-endringer", label: "Tilbud og endringer" },
  { id: "cost-slot", label: "Nåværende kostnad" },
  { id: "seksjon-bilder", label: "Bilder" },
  { id: "seksjon-foresporsler", label: "Forespørsler" },
  { id: "seksjon-tilbud", label: "Tilbud" },
  { id: "seksjon-endringer", label: "Endringer" },
  { id: "seksjon-avvik", label: "Avvik" },
  { id: "seksjon-grunnlag", label: "Grunnlag fra deg" },
  { id: "seksjon-meldinger", label: "Meldinger" },
  { id: "seksjon-dokumentasjon", label: "Dokumentasjon og rapport" },
  { id: "hms", label: "HMS" },
  { id: "seksjon-vurdering", label: "Vurdering" },
];

export function portalSectionVisible(project, id) {
  if (id === "kostnad") return customerSeesCost(project);
  if (!Object.prototype.hasOwnProperty.call(DEFAULT_VISIBLE, id)) return false;
  const stored = project?.portalSections?.[id];
  if (stored === true || stored === false) return stored;
  return DEFAULT_VISIBLE[id] === true;
}

export function portalSectionPatch(id, visible) {
  const on = visible === true;
  if (id === "kostnad") return { showCostToCustomer: on };
  if (!Object.prototype.hasOwnProperty.call(DEFAULT_VISIBLE, id) || id === "kostnad") return {};
  return { [`portalSections.${id}`]: on };
}

export function portalAllSectionsPatch(visible) {
  const on = visible === true;
  const patch = { showCostToCustomer: on };
  for (const section of PORTAL_SECTIONS) {
    if (section.id === "kostnad") continue;
    patch[`portalSections.${section.id}`] = on;
  }
  return patch;
}

export function clonePortalVisibility(project) {
  return {
    showCostToCustomer: project?.showCostToCustomer === true,
    portalSections: { ...(project?.portalSections || {}) },
  };
}

export function applyPortalPatch(project, patch) {
  if (!project || !patch) return project;
  if (Object.prototype.hasOwnProperty.call(patch, "showCostToCustomer")) {
    project.showCostToCustomer = patch.showCostToCustomer === true;
  }
  for (const [key, value] of Object.entries(patch)) {
    if (!key.startsWith("portalSections.")) continue;
    const id = key.slice("portalSections.".length);
    project.portalSections = { ...(project.portalSections || {}), [id]: value === true };
  }
  return project;
}

export function restorePortalVisibility(project, snapshot) {
  if (!project || !snapshot) return project;
  project.showCostToCustomer = snapshot.showCostToCustomer === true;
  project.portalSections = { ...(snapshot.portalSections || {}) };
  return project;
}

export function offerSendNote(items) {
  const posts = (items || []).filter((item) => isOfferItem(item) && item.fikenBase !== true);
  const sent = posts.filter((item) => item.approvalRequested === true).length;
  const drafts = posts.length - sent;
  if (!posts.length) return "Ingen poster ennå. Utkast vises ikke for kunden. Send posten når den er klar.";
  if (!sent) {
    return drafts === 1
      ? "Ett utkast. Kunden ser det ikke før du sender posten."
      : `${drafts} utkast. Kunden ser dem ikke før du sender posten.`;
  }
  if (!drafts) return sent === 1 ? "Én post er sendt til kunden." : `${sent} poster er sendt til kunden.`;
  const sentText = sent === 1 ? "Én post er sendt." : `${sent} poster er sendt.`;
  const draftText = drafts === 1 ? "Ett utkast er skjult." : `${drafts} utkast er skjult.`;
  return `${sentText} ${draftText}`;
}
