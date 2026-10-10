import { VAT_RATE, fikenDraftLines } from "./drainage.js";

export const OFFER_KINDS = ["tilbud", "endring", "tillegg"];

const TYPE_LABEL = {
  tilbud: "Tilbud",
  endring: "Endring",
  tillegg: "Tillegg",
};

const STATUS_LABEL = {
  utkast: "Utkast",
  sendt: "Sendt",
  godkjent: "Godkjent",
  avslatt: "Avslått",
};

function parseMoney(value) {
  if (value == null || value === "") return 0;
  const number = Number(String(value).trim().replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.round(number * 100) / 100;
}

function newId() {
  return `alt-${Math.random().toString(36).slice(2, 10)}`;
}

export function isOfferItem(item) {
  return OFFER_KINDS.includes(item?.kind);
}

export function offerTypeLabel(kind) {
  return TYPE_LABEL[kind] || "Tilbud";
}

export function offerStatus(item) {
  if (!item?.approvalRequested) return "utkast";
  if (item.approvalStatus === "godkjent") return "godkjent";
  if (item.approvalStatus === "avslatt") return "avslatt";
  return "sendt";
}

export function offerStatusLabel(status) {
  return STATUS_LABEL[status] || "Utkast";
}

export function formatKr(value) {
  const number = Number.isFinite(value) ? value : 0;
  const text = new Intl.NumberFormat("nb-NO", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(number);
  return `kr ${text}`;
}

export function alternativeTotals(alternative) {
  const exVat = parseMoney(alternative?.priceExVat);
  const vat = Math.round(exVat * VAT_RATE * 100) / 100;
  return { exVat, vat, incVat: Math.round((exVat + vat) * 100) / 100 };
}

export function alternativeHeading(alternative) {
  const totals = alternativeTotals(alternative);
  const name = alternative?.name || "Alternativ";
  if (totals.exVat === 0) return `${name} – kr 0,00`;
  return `${name} – ${formatKr(totals.exVat)}`;
}

export function alternativePriceText(alternative) {
  const totals = alternativeTotals(alternative);
  if (totals.exVat === 0) return "kr 0,00, inkludert";
  return `${formatKr(totals.exVat)} eks. mva, ${formatKr(totals.incVat)} inkl. mva`;
}

export function normalizeAlternatives(list) {
  return (list || []).slice(0, 8).map((alternative) => ({
    id: String(alternative.id || newId()).trim().slice(0, 40),
    name: String(alternative.name || "").trim().slice(0, 120),
    description: String(alternative.description || "").trim().slice(0, 1000),
    priceExVat: parseMoney(alternative.priceExVat),
  })).filter((alternative) => alternative.id && alternative.name);
}

export function blankOfferFields() {
  return {
    kind: "tilbud",
    title: "",
    text: "",
    alternatives: normalizeAlternatives([
      { id: "standard", name: "Standard", description: "Inkludert i oppdraget.", priceExVat: 0 },
      { id: "anbefalt", name: "Anbefalt løsning", description: "", priceExVat: 0 },
    ]),
    approvalRequested: false,
    approvalStatus: "",
  };
}

export function chosenAlternative(item) {
  const id = item?.selectedAlternativeId;
  if (!id) return null;
  return (item.alternatives || []).find((alternative) => alternative.id === id) || null;
}

export function approvedChoiceSum(items) {
  const chosen = (items || []).filter((item) => isOfferItem(item) && offerStatus(item) === "godkjent");
  const exVat = Math.round(chosen.reduce((sum, item) => {
    const alternative = chosenAlternative(item);
    return sum + (alternative ? alternativeTotals(alternative).exVat : 0);
  }, 0) * 100) / 100;
  const vat = Math.round(exVat * VAT_RATE * 100) / 100;
  return {
    count: chosen.length,
    exVat,
    vat,
    incVat: Math.round((exVat + vat) * 100) / 100,
  };
}

export function formatOfferSum(sum) {
  const count = sum?.count || 0;
  const posts = count === 1 ? "1 godkjent post" : `${count} godkjente poster`;
  return `${posts}. Sum eks. mva ${formatKr(sum?.exVat || 0)}. Mva ${formatKr(sum?.vat || 0)}. Sum inkl. mva ${formatKr(sum?.incVat || 0)}.`;
}

export function offerDecisionText(item) {
  const lines = [`${offerTypeLabel(item?.kind)}. ${offerStatusLabel(offerStatus(item))}.`];
  const alternative = chosenAlternative(item);
  if (offerStatus(item) === "godkjent" && alternative) {
    lines.push(`Valgt løsning: ${alternativeHeading(alternative)}. ${alternativePriceText(alternative)}.`);
    if (alternative.description) lines.push(alternative.description);
  }
  if (offerStatus(item) === "avslatt") lines.push("Kunden har avslått posten.");
  return lines.join("\n");
}

export function fikenLinesFromOffer(item) {
  const alternative = chosenAlternative(item);
  if (offerStatus(item) !== "godkjent" || !alternative) return [];
  return [{
    label: `${item.title || offerTypeLabel(item.kind)}: ${alternative.name}`,
    unit: "stk",
    quantity: 1,
    unitPrice: alternative.priceExVat,
  }];
}

export function fikenDraftFromOffer(item) {
  return fikenDraftLines(fikenLinesFromOffer(item));
}

export function customerDecisionError(item, status, alternativeId) {
  if (status !== "godkjent") return "";
  const alternatives = item?.alternatives || [];
  if (!alternatives.length) return "";
  if (!alternatives.some((alternative) => alternative.id === alternativeId)) return "Velg en løsning først.";
  return "";
}

export function customerDecisionPatch(item, status, alternativeId) {
  const patch = { approvalStatus: status };
  if (status === "godkjent" && (item?.alternatives || []).length) patch.selectedAlternativeId = alternativeId;
  if (status === "avslatt" && item?.selectedAlternativeId) patch.selectedAlternativeId = "";
  return patch;
}

export function drainageOfferFields({ name, description, stretchExVat = 0, wellExVat = 0 } = {}) {
  const stretch = parseMoney(stretchExVat);
  const well = parseMoney(wellExVat);
  const recommended = Math.round((stretch + well) * 100) / 100;
  const alternatives = [
    { id: "standard", name: "Standard", description: "Inkludert i oppdraget.", priceExVat: 0 },
    {
      id: "anbefalt",
      name: "Anbefalt løsning",
      description: well > 0 ? "Strekket og fordrøyningsbrønnen." : "Løsningen fra befaringen.",
      priceExVat: recommended,
    },
  ];
  if (stretch > 0 && well > 0) {
    alternatives.push({
      id: "bronn",
      name: "Fordrøyningsbrønn",
      description: "Bare fordrøyningsbrønnen.",
      priceExVat: well,
    });
  }
  return {
    kind: "tilbud",
    title: String(name || "Drenering").trim().slice(0, 140),
    text: String(description || "").trim().slice(0, 4000),
    alternatives: normalizeAlternatives(alternatives),
    approvalRequested: false,
    approvalStatus: "",
  };
}

export function quickProjectName({ customerName, address, description } = {}) {
  const who = String(customerName || address || "Ny kunde").trim();
  const what = String(description || "").split("\n")[0].trim().slice(0, 60);
  const name = what ? `${who}: ${what}` : `Tilbud til ${who}`;
  return name.slice(0, 140);
}

export function quickOfferFields({ description, priceExVat } = {}) {
  const text = String(description || "").trim().slice(0, 4000);
  return {
    kind: "tilbud",
    title: (text.split("\n")[0] || "Tilbud").trim().slice(0, 140),
    text,
    alternatives: normalizeAlternatives([
      { id: "standard", name: "Standard", description: "Inkludert i oppdraget.", priceExVat: 0 },
      { id: "anbefalt", name: "Anbefalt løsning", description: text, priceExVat },
    ]),
    approvalRequested: true,
    approvalStatus: "venter",
  };
}

export function offerShareText(project, url) {
  const who = project?.customerName ? ` ${project.customerName}` : "";
  return `Hei${who}! Her er tilbudet for «${project?.name || "oppdraget"}». Velg løsning og godkjenn her: ${url}`;
}

export function shareTargets({ phone, email, text, url, subject = "Tilbud" } = {}) {
  const body = [text, url].filter(Boolean).join("\n");
  const targets = [];
  const digits = String(phone || "").replace(/[^\d+]/g, "");
  if (digits) {
    targets.push({ id: "sms", label: "Send SMS", href: `sms:${digits}?body=${encodeURIComponent(body)}` });
  }
  const mail = String(email || "").trim();
  if (mail.includes("@")) {
    targets.push({
      id: "email",
      label: "Send e-post",
      href: `mailto:${mail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
    });
  }
  return targets;
}

export function addressFromGeonorge(payload) {
  const hit = payload?.adresser?.[0];
  if (!hit) return "";
  const street = String(hit.adressetekst || "").trim();
  const post = [hit.postnummer, hit.poststed].filter(Boolean).join(" ");
  return [street, post].filter(Boolean).join(", ");
}
