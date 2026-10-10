import { DEFAULT_PRICES, PRICE_LINES, VAT_RATE, parseNumber } from "./drainage.js";
import {
  alternativeTotals,
  chosenAlternative,
  formatKr,
  isOfferItem,
  offerStatus,
  offerTypeLabel,
} from "./offers.js";

function round2(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number * 100) / 100;
}

function clampQty(value) {
  const number = parseNumber(value);
  if (number == null || number < 0) return 0;
  return round2(number);
}

function withVat(exVat) {
  const ex = round2(exVat);
  const vat = round2(ex * VAT_RATE);
  return { exVat: ex, vat, incVat: round2(ex + vat) };
}

export function formatQty(value) {
  return new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 2 }).format(round2(value));
}

export function signedKr(value) {
  const number = round2(value);
  if (number > 0) return `+ ${formatKr(number)}`;
  if (number < 0) return `− ${formatKr(Math.abs(number))}`;
  return formatKr(0);
}

export function signedQty(value) {
  const number = round2(value);
  if (number > 0) return `+ ${formatQty(number)}`;
  if (number < 0) return `− ${formatQty(Math.abs(number))}`;
  return formatQty(0);
}

export function emptyCost(prices = DEFAULT_PRICES) {
  const lines = {};
  for (const [id, , , key] of PRICE_LINES) {
    const rate = parseNumber(prices?.[key]);
    lines[id] = {
      planned: 0,
      done: 0,
      unitPrice: rate != null && rate >= 0 ? round2(rate) : 0,
    };
  }
  return { agreedExVat: 0, lines };
}

export function normalizeCost(raw, prices = DEFAULT_PRICES) {
  const next = emptyCost(prices);
  next.agreedExVat = clampQty(raw?.agreedExVat);
  for (const [id] of PRICE_LINES) {
    const line = raw?.lines?.[id] || {};
    const storedPrice = parseNumber(line.unitPrice);
    next.lines[id] = {
      planned: clampQty(line.planned),
      done: clampQty(line.done),
      unitPrice: storedPrice != null && storedPrice >= 0 ? round2(storedPrice) : next.lines[id].unitPrice,
    };
  }
  return next;
}

export function pricedCost(raw, prices = DEFAULT_PRICES) {
  const next = normalizeCost(raw, prices);
  for (const [id, , , key] of PRICE_LINES) {
    const rate = parseNumber(prices?.[key]);
    if (rate != null && rate >= 0) next.lines[id].unitPrice = round2(rate);
  }
  return next;
}

function choiceExVat(item) {
  const alternative = chosenAlternative(item);
  return alternative ? alternativeTotals(alternative).exVat : 0;
}

export function offerContribution(items, previewChoices = null) {
  let approvedExVat = 0;
  let previewExVat = 0;
  const rows = [];
  for (const item of items || []) {
    if (!isOfferItem(item) || item.approved === false) continue;
    const status = offerStatus(item);
    if (status === "godkjent") {
      const exVat = choiceExVat(item);
      approvedExVat += exVat;
      previewExVat += exVat;
      const alternative = chosenAlternative(item);
      rows.push({
        id: item.id,
        title: item.title || offerTypeLabel(item.kind),
        name: alternative?.name || "",
        status: "godkjent",
        exVat,
      });
      continue;
    }
    if (status !== "sendt" || !previewChoices) continue;
    const picked = previewChoices[item.id];
    if (!picked) continue;
    const alternative = (item.alternatives || []).find((entry) => entry.id === picked);
    if (!alternative) continue;
    const exVat = alternativeTotals(alternative).exVat;
    previewExVat += exVat;
    rows.push({
      id: item.id,
      title: item.title || offerTypeLabel(item.kind),
      name: alternative.name || "",
      status: "forhandsvisning",
      exVat,
    });
  }
  return {
    approvedExVat: round2(approvedExVat),
    previewExVat: round2(previewExVat),
    rows,
  };
}

export function liveCost({ cost, prices = DEFAULT_PRICES, items, previewChoices = null } = {}) {
  const state = normalizeCost(cost, prices);
  const offers = offerContribution(items, previewChoices);
  let plannedEx = 0;
  let doneEx = 0;
  const lines = PRICE_LINES.map(([id, label, unit]) => {
    const line = state.lines[id];
    const plannedSum = round2(line.planned * line.unitPrice);
    const doneSum = round2(line.done * line.unitPrice);
    plannedEx += plannedSum;
    doneEx += doneSum;
    return {
      id,
      label,
      unit,
      planned: line.planned,
      done: line.done,
      unitPrice: line.unitPrice,
      deviation: round2(line.done - line.planned),
      plannedSum,
      doneSum,
    };
  });
  const estimated = withVat(state.agreedExVat + offers.approvedExVat + plannedEx);
  const incurred = withVat(state.agreedExVat + offers.approvedExVat + doneEx);
  const preview = withVat(state.agreedExVat + offers.previewExVat + plannedEx);
  const differenceExVat = round2(estimated.exVat - state.agreedExVat);
  return {
    agreedExVat: state.agreedExVat,
    lines,
    offers,
    estimated,
    incurred,
    preview,
    differenceExVat,
    differenceIncVat: round2(differenceExVat * (1 + VAT_RATE)),
    previewDeltaExVat: round2(preview.exVat - estimated.exVat),
  };
}

const FIELD_LABEL = {
  planned: "planlagt",
  done: "utført",
  unitPrice: "enhetspris",
  agreedExVat: "avtalt pris",
};

export function patchCost(raw, prices, { lineId, field, value } = {}) {
  const next = pricedCost(raw, prices);
  if (field === "agreedExVat") next.agreedExVat = clampQty(value);
  if ((field === "planned" || field === "done") && next.lines[lineId]) {
    next.lines[lineId][field] = clampQty(value);
  }
  return next;
}

export function costChanges(beforeRaw, afterRaw, prices = DEFAULT_PRICES) {
  const before = normalizeCost(beforeRaw, prices);
  const after = normalizeCost(afterRaw, prices);
  const changes = [];
  if (before.agreedExVat !== after.agreedExVat) {
    changes.push({
      lineId: "avtalt",
      label: "Avtalt pris",
      field: "agreedExVat",
      from: before.agreedExVat,
      to: after.agreedExVat,
      unit: "kr",
    });
  }
  for (const [id, label, unit] of PRICE_LINES) {
    const left = before.lines[id];
    const right = after.lines[id];
    if (left.planned !== right.planned) {
      changes.push({ lineId: id, label, field: "planned", from: left.planned, to: right.planned, unit });
    }
    if (left.done !== right.done) {
      changes.push({ lineId: id, label, field: "done", from: left.done, to: right.done, unit });
    }
    if (left.unitPrice !== right.unitPrice) {
      changes.push({ lineId: id, label, field: "unitPrice", from: left.unitPrice, to: right.unitPrice, unit: "kr" });
    }
  }
  return changes;
}

export function changeText(change) {
  const what = FIELD_LABEL[change?.field] || "endring";
  const unit = change?.unit ? ` ${change.unit}` : "";
  const label = change?.field === "agreedExVat" ? "Avtalt pris" : (change?.label || "Linje");
  return `${label}, ${what}: ${formatQty(change?.from)} → ${formatQty(change?.to)}${unit}`;
}

export function costReportText(summary, history = []) {
  const lines = [
    "Nåværende kostnad",
    `Avtalt pris ${formatKr(summary?.agreedExVat || 0)} eks. mva.`,
    `Estimert total ${formatKr(summary?.estimated?.exVat || 0)} eks. mva, ${formatKr(summary?.estimated?.incVat || 0)} inkl. mva.`,
    `Påløpt hittil ${formatKr(summary?.incurred?.exVat || 0)} eks. mva, ${formatKr(summary?.incurred?.incVat || 0)} inkl. mva.`,
    `Differanse mot opprinnelig tilbud: ${signedKr(summary?.differenceExVat || 0)} eks. mva, ${signedKr(summary?.differenceIncVat || 0)} inkl. mva.`,
    "",
    "Godkjente alternativer",
  ];
  const approved = (summary?.offers?.rows || []).filter((row) => row.status === "godkjent");
  if (!approved.length) lines.push("Ingen godkjente poster.");
  for (const row of approved) {
    lines.push(`${row.title}${row.name ? `: ${row.name}` : ""} ${formatKr(row.exVat)} eks. mva.`);
  }
  lines.push("", "Mengder");
  for (const line of summary?.lines || []) {
    if (!line.planned && !line.done) continue;
    lines.push(`${line.label}: planlagt ${formatQty(line.planned)} ${line.unit}, utført ${formatQty(line.done)} ${line.unit}, avvik ${signedQty(line.deviation)} ${line.unit}. Estimert ${formatKr(line.plannedSum)} eks. mva, påløpt ${formatKr(line.doneSum)} eks. mva. Enhetspris ${formatKr(line.unitPrice)}.`);
  }
  lines.push("", "Historikk");
  if (!history.length) lines.push("Ingen endringer er logget.");
  for (const entry of history) {
    const who = entry.byName || "Einar";
    const when = entry.when ? `${entry.when} ` : "";
    lines.push(`${when}${who}: ${entry.text}`);
  }
  return lines.join("\n");
}
