import { formatKr } from "./offers.js";
import { formatQty } from "./cost.js";

function cloneLine(line) {
  return {
    id: line.id,
    label: line.label,
    unit: line.unit || "stk",
    planned: line.planned,
    done: line.done,
    unitPrice: line.unitPrice,
    source: line.source || "",
    manual: line.manual === true,
  };
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

function fikenDateLabel(iso) {
  const match = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return "";
  return `${match[3]}.${match[2]}.${match[1]}`;
}

function offerMoney(doc) {
  const lines = doc?.lines || [];
  const exVat = round2(lines.reduce((sum, line) => sum + (Number(line.planned) || 0) * (Number(line.unitPrice) || 0), 0));
  const vat = round2(exVat * 0.25);
  return { exVat, vat, incVat: round2(exVat + vat) };
}

export function offerDocumentsFromLines(lines) {
  const groups = new Map();
  for (const line of lines || []) {
    const source = String(line?.source || "");
    const match = source.match(/^fra Fiken-tilbud nr (.+)$/);
    if (!match) continue;
    const idMatch = String(line.id || "").match(/^ft-([^-]+)-/);
    const key = idMatch ? `ft-${idMatch[1]}` : `ft-nr-${match[1]}`;
    if (!groups.has(key)) {
      groups.set(key, { key, kind: "tilbud", number: match[1], date: "", lines: [] });
    }
    groups.get(key).lines.push(line);
  }
  return [...groups.values()];
}

export function fikenOfferText(doc) {
  const money = offerMoney(doc);
  const date = fikenDateLabel(doc?.date);
  const title = doc?.kind === "ordre"
    ? `Fiken-ordrebekreftelse nr ${doc?.number || ""}`
    : `Fiken-tilbud nr ${doc?.number || ""}`;
  const parts = [title.trim()];
  if (date) parts.push(`Dato ${date}`);
  parts.push("");
  for (const line of doc?.lines || []) {
    const quantity = Number(line.planned) || 0;
    const unitPrice = Number(line.unitPrice) || 0;
    const sum = round2(quantity * unitPrice);
    parts.push(`${line.label || "Linje"}\n${formatQty(quantity)} ${line.unit || "stk"} à ${formatKr(unitPrice)} eks. mva = ${formatKr(sum)}`);
    parts.push("");
  }
  parts.push(`Sum eks. mva ${formatKr(money.exVat)}`);
  parts.push(`Mva ${formatKr(money.vat)}`);
  parts.push(`Sum inkl. mva ${formatKr(money.incVat)}`);
  return parts.join("\n").slice(0, 4000);
}

export function fikenOfferFields(doc) {
  const money = offerMoney(doc);
  const date = fikenDateLabel(doc?.date);
  const title = (doc?.kind === "ordre"
    ? `Fiken-ordrebekreftelse nr ${doc?.number || ""}`
    : `Fiken-tilbud nr ${doc?.number || ""}`).trim().slice(0, 140);
  return {
    kind: "tilbud",
    title,
    text: fikenOfferText(doc),
    alternatives: [{
      id: "standard",
      name: "Standard",
      description: date ? `Akseptert grunntilbud fra Fiken. Dato ${date}.` : "Akseptert grunntilbud fra Fiken.",
      priceExVat: money.exVat,
    }],
    selectedAlternativeId: "standard",
    approved: true,
    approvalRequested: true,
    approvalStatus: "godkjent",
    fikenSyncKey: String(doc?.key || ""),
    fikenBase: true,
    source: "fiken",
  };
}

function sameOffer(current, fields) {
  const alternative = (current?.alternatives || [])[0] || {};
  const next = fields.alternatives[0];
  return current?.title === fields.title
    && current?.text === fields.text
    && current?.selectedAlternativeId === fields.selectedAlternativeId
    && current?.approvalStatus === fields.approvalStatus
    && current?.fikenBase === true
    && alternative.name === next.name
    && alternative.description === next.description
    && Number(alternative.priceExVat) === Number(next.priceExVat);
}

export function planFikenOfferSync(existingItems, documents, { overwriteManual = false } = {}) {
  const drafts = (documents || []).filter((doc) => doc && doc.kind !== "ordre" && doc.key);
  const actions = [];
  for (const doc of drafts) {
    const fields = fikenOfferFields(doc);
    const current = (existingItems || []).find((item) => item?.fikenSyncKey === doc.key || item?.id === `fiken-${doc.key}`);
    if (!current) {
      actions.push({ op: "create", id: `fiken-${doc.key}`, data: fields });
      continue;
    }
    if (current.fikenManual === true && !overwriteManual) {
      actions.push({ op: "skip", id: current.id, reason: "manual" });
      continue;
    }
    if (sameOffer(current, fields)) {
      actions.push({ op: "skip", id: current.id, reason: "same" });
      continue;
    }
    actions.push({
      op: "update",
      id: current.id,
      data: { ...fields, fikenManual: false },
    });
  }
  return actions;
}
