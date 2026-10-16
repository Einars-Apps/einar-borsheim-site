function text(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function kronerFromOre(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.round(number) / 100;
}

function quantityOf(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.round(number * 100) / 100;
}

function matchesSale(doc, projectId, contactId) {
  if (!doc || doc.archived === true) return false;
  const wanted = Number(projectId);
  const docProject = Number(doc.projectId);
  if (Number.isInteger(docProject) && docProject > 0) return docProject === wanted;
  const wantedContact = Number(contactId);
  if (!Number.isInteger(wantedContact) || wantedContact <= 0) return false;
  return Number(doc.contactId) === wantedContact;
}

function mapOfferLine(line, { id, source }) {
  const label = text(line?.description || line?.productName || line?.comment).slice(0, 200);
  const quantity = quantityOf(line?.quantity);
  let unitPrice = kronerFromOre(line?.unitPrice);
  if (unitPrice == null && quantity > 0) {
    const net = kronerFromOre(line?.net);
    unitPrice = net == null ? 0 : Math.round((net / quantity) * 100) / 100;
  }
  if (unitPrice == null) unitPrice = 0;
  if (!label && !quantity && !unitPrice) return null;
  return {
    id: String(id).slice(0, 39),
    label: label || "Linje",
    unit: "stk",
    planned: quantity,
    done: 0,
    unitPrice,
    source: text(source).slice(0, 80),
    manual: false,
  };
}

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

function sortedSales(documents, projectId, contactId) {
  return (documents || [])
    .filter((doc) => matchesSale(doc, projectId, contactId))
    .slice()
    .sort((a, b) => String(a.date || "").localeCompare(String(b.date || ""))
      || Number(a.offerNumber || a.confirmationNumber || 0) - Number(b.offerNumber || b.confirmationNumber || 0));
}

function mapOneDocument(doc, kind) {
  const docId = kind === "ordre" ? doc.confirmationId : doc.offerId;
  if (docId == null || docId === "") return null;
  const number = kind === "ordre"
    ? (doc.confirmationNumber || docId)
    : (doc.offerNumber || docId);
  const source = kind === "ordre"
    ? `fra Fiken-ordrebekreftelse nr ${number}`
    : `fra Fiken-tilbud nr ${number}`;
  const prefix = kind === "ordre" ? "fo" : "ft";
  const lines = [];
  (doc.lines || []).forEach((line, index) => {
    const mapped = mapOfferLine(line, { id: `${prefix}-${docId}-${index}`, source });
    if (mapped) lines.push(mapped);
  });
  if (!lines.length) return null;
  const exVat = round2(lines.reduce((sum, line) => sum + line.planned * line.unitPrice, 0));
  const vat = round2(exVat * 0.25);
  return {
    key: `${prefix}-${docId}`,
    kind,
    number: String(number),
    date: text(doc.date).slice(0, 10),
    lines,
    exVat,
    vat,
    incVat: round2(exVat + vat),
  };
}

function mapFikenOffers({ offers, confirmations, projectId, contactId } = {}) {
  return [
    ...sortedSales(offers, projectId, contactId).map((doc) => mapOneDocument(doc, "tilbud")),
    ...sortedSales(confirmations, projectId, contactId).map((doc) => mapOneDocument(doc, "ordre")),
  ].filter(Boolean);
}

function mapFikenSales(input) {
  return mapFikenOffers(input).flatMap((doc) => doc.lines);
}

function clip(value, max) {
  return text(value).slice(0, max);
}

function clipBlock(value, max) {
  return String(value || "").replace(/\r\n/g, "\n").trim().slice(0, max);
}

function moneyOre(value) {
  return kronerFromOre(value);
}

function addIsoDays(iso, days) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
  if (!match || !Number.isInteger(days)) return "";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function formatAddress(address) {
  if (!address || typeof address !== "object") return "";
  const street = [address.streetAddress, address.streetAddressLine2].map((part) => text(part)).filter(Boolean).join(", ");
  const city = [text(address.postCode), text(address.city)].filter(Boolean).join(" ");
  return [street, city, text(address.country)].filter(Boolean).join(", ");
}

function discountPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || number > 100) return null;
  if (number <= 1) return Math.round(number * 10000) / 100;
  return Math.round(number * 100) / 100;
}

function detailLine(line) {
  const description = clip(line?.description || line?.productName, 200);
  const comment = clip(line?.comment, 200);
  const quantity = quantityOf(line?.quantity);
  let unitPrice = kronerFromOre(line?.unitPrice);
  if (unitPrice == null && quantity > 0) {
    const net = kronerFromOre(line?.net);
    unitPrice = net == null ? 0 : Math.round((net / quantity) * 100) / 100;
  }
  if (unitPrice == null) unitPrice = 0;
  if (!description && !comment && !quantity && !unitPrice) return null;
  const net = moneyOre(line?.net);
  return {
    description: description || "Linje",
    comment: comment && comment !== description ? comment : "",
    quantity,
    unitPrice,
    discountPercent: discountPercent(line?.discount),
    net: net == null ? round2(quantity * unitPrice) : net,
  };
}

function pdfLink(attachments) {
  const list = Array.isArray(attachments) ? attachments : [];
  const withLogin = list.filter((item) => text(item?.downloadUrlWithFikenNormalUserCredentials).startsWith("https://"));
  const pdf = withLogin.find((item) => /\.pdf$/i.test(String(item?.filename || ""))) || withLogin[0];
  if (!pdf) return { pdfUrl: "", pdfName: "" };
  return {
    pdfUrl: text(pdf.downloadUrlWithFikenNormalUserCredentials).slice(0, 2000),
    pdfName: clip(pdf.filename, 200),
  };
}

function customerOf(offer, draft, contact) {
  const fromDraft = Array.isArray(draft?.customers) ? draft.customers[0] : null;
  const personId = Number(offer?.contactPersonId);
  const people = Array.isArray(contact?.contactPerson) ? contact.contactPerson : [];
  const person = people.find((entry) => Number(entry?.contactPersonId) === personId) || null;
  const source = fromDraft || contact || {};
  return {
    customerName: clip(source.name || contact?.name, 200),
    customerEmail: clip(source.email || contact?.email || person?.email, 200),
    customerPhone: clip(contact?.phoneNumber || person?.phoneNumber || source.phoneNumber, 40),
    organizationNumber: clip(source.organizationNumber || contact?.organizationNumber, 40),
    address: formatAddress(offer?.address) || formatAddress(source.address) || formatAddress(contact?.address),
  };
}

function mapFikenQuote(doc, { draft, contact } = {}) {
  if (!doc || doc.archived === true || doc.offerId == null || doc.offerId === "") return null;
  const lines = (doc.lines || []).map(detailLine).filter(Boolean);
  const net = moneyOre(doc.net);
  const vat = moneyOre(doc.vat);
  const gross = moneyOre(doc.gross);
  const exVat = net == null ? round2(lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0)) : net;
  const vatAmount = vat == null ? round2(exVat * 0.25) : vat;
  const days = Number(draft?.daysUntilDueDate);
  const validDays = Number.isInteger(days) && days > 0 ? days : null;
  const pdf = pdfLink(draft?.attachments);
  const discount = moneyOre(doc.discount);
  return {
    key: `ft-${doc.offerId}`,
    kind: "tilbud",
    number: String(doc.offerNumber || doc.offerId),
    date: text(doc.date).slice(0, 10),
    accepted: text(doc.accepted).slice(0, 10),
    validUntil: validDays ? addIsoDays(doc.date, validDays) : "",
    daysUntilDueDate: validDays,
    invoiceText: clipBlock(draft?.invoiceText, 4000),
    comment: clipBlock(doc.comment, 4000),
    ourReference: clip(doc.ourReference || draft?.ourReference, 200),
    yourReference: clip(doc.yourReference || draft?.yourReference, 200),
    orderReference: clip(doc.orderReference || draft?.orderReference, 200),
    currency: text(doc.currency || "NOK").slice(0, 3) || "NOK",
    discount: discount != null && discount > 0 ? discount : null,
    ...customerOf(doc, draft, contact),
    lines,
    exVat,
    vat: vatAmount,
    incVat: gross == null ? round2(exVat + vatAmount) : gross,
    pdfUrl: pdf.pdfUrl,
    pdfName: pdf.pdfName,
  };
}

function mapFikenQuotes({ offers, drafts, contacts, projectId, contactId } = {}) {
  const draftByUuid = new Map();
  for (const draft of drafts || []) {
    if (draft?.uuid) draftByUuid.set(String(draft.uuid), draft);
  }
  return sortedSales(offers, projectId, contactId)
    .map((doc) => mapFikenQuote(doc, {
      draft: draftByUuid.get(String(doc.offerDraftUuid || "")) || null,
      contact: (contacts && (contacts[doc.contactId] || contacts[String(doc.contactId)])) || null,
    }))
    .filter(Boolean);
}

module.exports = {
  mapFikenOffers,
  mapFikenQuotes,
  mapFikenSales,
  matchesSale,
};
