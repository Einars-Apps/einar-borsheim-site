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

module.exports = {
  mapFikenOffers,
  mapFikenSales,
  matchesSale,
};
