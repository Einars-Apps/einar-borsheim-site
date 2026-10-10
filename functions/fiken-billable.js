const VAT_RATE = 0.25;
const PORTAL = "https://einar-borsheim.com/kunde/";
const OFFER_KINDS = ["tilbud", "endring", "tillegg"];
const TYPE_LABEL = { tilbud: "Tilbud", endring: "Endring", tillegg: "Tillegg" };

function clip(value, max) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function asDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") {
    const date = value.toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value.seconds === "number") return new Date(value.seconds * 1000);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatKr(value) {
  const text = new Intl.NumberFormat("nb-NO", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);
  return `kr ${text}`;
}

function formatApproved(value) {
  const date = asDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat("nb-NO", {
    timeZone: "Europe/Oslo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function osloDate(value) {
  const date = asDate(value) || new Date();
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Oslo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function itemMarker(itemId) {
  const clean = String(itemId || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40);
  return `IK:${clean || "post"}`;
}

function projectLink(projectId) {
  return `${PORTAL}?p=${encodeURIComponent(String(projectId || ""))}`;
}

function fitParts(parts, max) {
  let text = "";
  for (const part of parts) {
    const piece = String(part || "").replace(/\s+/g, " ").trim();
    if (!piece) continue;
    const next = text ? `${text} · ${piece}` : piece;
    if (next.length <= max) text = next;
  }
  return text;
}

function chosenAlternative(item) {
  const id = item?.selectedAlternativeId;
  if (!id) return null;
  return (item.alternatives || []).find((alternative) => alternative.id === id) || null;
}

function money(value) {
  const number = Number(String(value ?? "").replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.round(number * 100) / 100;
}

function isBillableOffer(item) {
  return OFFER_KINDS.includes(item?.kind) && item?.approvalStatus === "godkjent";
}

function decisionBecameApproved(before, after) {
  return before?.approvalStatus !== after?.approvalStatus && after?.approvalStatus === "godkjent";
}

function projectNumber(projectId) {
  const clean = String(projectId || "").replace(/[^A-Za-z0-9]/g, "");
  return `IK-${(clean || "PROSJEKT").slice(-8)}`;
}

function projectName(project) {
  const name = String(project?.name || "").replace(/\s+/g, " ").trim();
  const address = String(project?.address || "").replace(/\s+/g, " ").trim();
  if (name && address && name !== address) return clip(`${name} – ${address}`, 200);
  return clip(name || address || "Internkontroll", 200);
}

function projectDescription(project) {
  return clip([
    `Internkontroll-prosjekt ${project?.id || ""}.`,
    project?.address || "",
    projectLink(project?.id || ""),
  ].filter(Boolean).join(" "), 1000);
}

function statusText(name) {
  const label = String(name || "").replace(/\s+/g, " ").trim();
  return label ? `Lagt til i Fiken-prosjekt ${label}` : "Lagt til i Fiken-prosjekt";
}

function billableLine({ item, itemId, projectId, incomeAccount, approvedAt }) {
  const alternative = chosenAlternative(item);
  if (!alternative) return null;
  const exVat = money(alternative.priceExVat);
  const incVat = Math.round(exVat * (1 + VAT_RATE) * 100) / 100;
  const kind = TYPE_LABEL[item?.kind] || "Tilbud";
  const title = String(item?.title || kind).replace(/\s+/g, " ").trim();
  const name = String(alternative.name || "Løsning").replace(/\s+/g, " ").trim();
  const about = String(alternative.description || "").replace(/\s+/g, " ").trim();
  const head = `${kind}: ${title} – ${name}`;
  const description = clip(about ? `${head}. ${about}` : head, 200);
  const account = /^\d{3,6}$/.test(String(incomeAccount || "")) ? String(incomeAccount) : "3000";
  const when = formatApproved(approvedAt || item?.approvedAt);
  const who = String(item?.approvedByName || "").replace(/\s+/g, " ").trim();
  const comment = fitParts([
    itemMarker(itemId),
    `Internkontroll ${projectId}`,
    `${formatKr(exVat)} eks. mva, ${formatKr(incVat)} inkl. mva`,
    when ? `godkjent ${when}` : "",
    who ? `av ${who}` : "",
    projectLink(projectId),
  ], 200);
  return {
    description,
    comment,
    quantity: 1,
    unitPrice: Math.round(exVat * 100),
    vatType: "HIGH",
    incomeAccount: account,
  };
}

function lineHasMarker(line, itemId) {
  const marker = itemMarker(itemId);
  return String(line?.comment || "").includes(marker);
}

function requestLine(line) {
  const next = {};
  for (const key of ["description", "comment", "quantity", "unitPrice", "vatType", "incomeAccount", "discount", "productId"]) {
    if (line?.[key] == null || line[key] === "") continue;
    next[key] = line[key];
  }
  return next;
}

function appendBillableLine(existingLines, line, itemId) {
  const lines = (existingLines || []).map(requestLine);
  if (lines.some((entry) => lineHasMarker(entry, itemId))) {
    return { lines, added: false };
  }
  return { lines: [...lines, requestLine(line)], added: true };
}

function customerIdFromDraft(draft) {
  const id = Number(draft?.customers?.[0]?.contactId);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function draftInvoiceText(projectId) {
  return clip(`Godkjente poster fra Internkontroll-prosjekt ${projectId}. ${projectLink(projectId)}`, 500);
}

function invoiceDraftBody({ draft, customerId, projectId, lines, invoiceText, issueDate, internProjectId }) {
  const body = {
    type: "invoice",
    customerId: Number(customerId),
    daysUntilDueDate: Number(draft?.daysUntilDueDate) || 14,
    currency: draft?.currency || "NOK",
    invoiceText: invoiceText || draft?.invoiceText || draftInvoiceText(internProjectId || ""),
    ourReference: draft?.ourReference || clip(`IK ${internProjectId || ""}`, 80),
    projectId: Number(projectId),
    lines,
  };
  if (draft?.issueDate || issueDate) body.issueDate = draft?.issueDate || issueDate;
  return body;
}

module.exports = {
  appendBillableLine,
  billableLine,
  customerIdFromDraft,
  decisionBecameApproved,
  draftInvoiceText,
  invoiceDraftBody,
  isBillableOffer,
  itemMarker,
  lineHasMarker,
  osloDate,
  projectDescription,
  projectLink,
  projectName,
  projectNumber,
  requestLine,
  statusText,
};
