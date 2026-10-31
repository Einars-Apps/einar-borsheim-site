function cloneLine(line) {
  const copy = {
    id: line.id,
    label: line.label,
    unit: line.unit || "stk",
    planned: line.planned,
    done: line.done,
    unitPrice: line.unitPrice,
    source: line.source || "",
    manual: line.manual === true,
  };
  const addition = Number(line?.addition);
  if (Number.isFinite(addition) && addition > 0) copy.addition = Math.round(addition * 100) / 100;
  const locked = line?.final === true || line?.final === 1 || line?.final === "1" || line?.final === "true";
  if (locked) {
    copy.final = true;
    if (line.finalizedAt != null) copy.finalizedAt = line.finalizedAt;
  }
  return copy;
}

function differs(current, incoming) {
  return current.label !== incoming.label
    || current.planned !== incoming.planned
    || current.unitPrice !== incoming.unitPrice
    || current.source !== incoming.source;
}

export function mergeFikenLines(existing, incoming, { overwriteManual = false } = {}) {
  const lines = (existing || []).map(cloneLine);
  const byId = new Map(lines.map((line) => [line.id, line]));
  const conflicts = [];
  for (const raw of incoming || []) {
    const incomingLine = cloneLine(raw);
    const current = byId.get(incomingLine.id);
    if (!current) {
      lines.push({ ...incomingLine, done: incomingLine.done || 0, manual: false });
      byId.set(incomingLine.id, lines[lines.length - 1]);
      continue;
    }
    if (!differs(current, incomingLine)) continue;
    if (current.manual && !overwriteManual) {
      conflicts.push({ id: current.id, label: current.label, source: incomingLine.source });
      continue;
    }
    current.label = incomingLine.label;
    current.unit = incomingLine.unit || current.unit;
    current.planned = incomingLine.planned;
    current.unitPrice = incomingLine.unitPrice;
    current.source = incomingLine.source;
    current.manual = false;
  }
  return { lines, conflicts };
}

function round2(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number * 100) / 100;
}

export function fikenDateLabel(iso) {
  const match = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return "";
  return `${match[3]}.${match[2]}.${match[1]}`;
}

function clip(value, max) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function clipBlock(value, max) {
  return String(value || "").replace(/\r\n/g, "\n").trim().slice(0, max);
}

export function fikenQuoteLines(quote) {
  return (Array.isArray(quote?.lines) ? quote.lines : []).slice(0, 80).map((line) => {
    const quantity = round2(line?.quantity ?? line?.planned);
    const unitPrice = round2(line?.unitPrice);
    const net = line?.net == null ? round2(quantity * unitPrice) : round2(line.net);
    const discount = Number(line?.discountPercent);
    return {
      description: clip(line?.description || line?.label, 200) || "Linje",
      comment: clip(line?.comment, 200),
      quantity,
      unitPrice,
      discountPercent: Number.isFinite(discount) && discount > 0 ? discount : null,
      net,
    };
  }).filter((line) => line.description || line.comment || line.quantity || line.unitPrice);
}

export function fikenQuoteFacts(quote) {
  const rows = [];
  const add = (label, value) => {
    const text = String(value ?? "").replace(/\s+/g, " ").trim();
    if (text) rows.push({ label, value: text });
  };
  add("Tilbudsnr", quote?.number);
  add("Dato", fikenDateLabel(quote?.date));
  add("Akseptert", fikenDateLabel(quote?.accepted));
  add("Kunde", quote?.customerName);
  add("E-post", quote?.customerEmail);
  add("Telefon", quote?.customerPhone);
  add("Organisasjonsnummer", quote?.organizationNumber);
  add("Adresse", quote?.address);
  add("Vår referanse", quote?.ourReference);
  add("Kundens referanse", quote?.yourReference);
  add("Ordrereferanse", quote?.orderReference);
  add("Gyldig til", fikenDateLabel(quote?.validUntil));
  if (Number(quote?.daysUntilDueDate) > 0) add("Gyldig i", `${Number(quote.daysUntilDueDate)} dager`);
  return rows;
}

export function fikenQuoteRecord(quote) {
  const pdfUrl = String(quote?.pdfUrl || "");
  const record = {
    key: clip(quote?.key, 40),
    number: clip(quote?.number, 40),
    date: String(quote?.date || "").slice(0, 10),
    accepted: String(quote?.accepted || "").slice(0, 10),
    validUntil: String(quote?.validUntil || "").slice(0, 10),
    customerName: clip(quote?.customerName, 200),
    customerEmail: clip(quote?.customerEmail, 200),
    customerPhone: clip(quote?.customerPhone, 40),
    organizationNumber: clip(quote?.organizationNumber, 40),
    address: clip(quote?.address, 300),
    ourReference: clip(quote?.ourReference, 200),
    yourReference: clip(quote?.yourReference, 200),
    orderReference: clip(quote?.orderReference, 200),
    invoiceText: clipBlock(quote?.invoiceText, 4000),
    comment: clipBlock(quote?.comment, 4000),
    currency: clip(quote?.currency, 3) || "NOK",
    lines: fikenQuoteLines(quote),
    exVat: round2(quote?.exVat),
    vat: round2(quote?.vat),
    incVat: round2(quote?.incVat),
    pdfUrl: pdfUrl.startsWith("https://") ? pdfUrl.slice(0, 2000) : "",
    pdfName: clip(quote?.pdfName, 200),
  };
  const days = Number(quote?.daysUntilDueDate);
  if (Number.isInteger(days) && days > 0) record.daysUntilDueDate = days;
  const discount = round2(quote?.discount);
  if (discount > 0) record.discount = discount;
  return record;
}

export function quotesFromFikenResult(result) {
  const quotes = Array.isArray(result?.quotes)
    ? result.quotes
    : (result?.offers || []).filter((doc) => doc?.kind === "tilbud");
  return quotes.filter((doc) => doc && doc.kind !== "ordre" && doc.key);
}
