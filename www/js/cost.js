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
      addition: 0,
      done: 0,
      unitPrice: rate != null && rate >= 0 ? round2(rate) : 0,
    };
  }
  return { agreedExVat: 0, lines, fikenLines: [], extras: [] };
}

export function newExtraId() {
  return `ta-${Math.random().toString(36).slice(2, 10)}`;
}

export function customerSeesCost(project) {
  return project?.showCostToCustomer === true;
}

export function normalizeFikenLines(raw) {
  const list = Array.isArray(raw?.fikenLines) ? raw.fikenLines : [];
  const seen = new Set();
  const lines = [];
  for (const line of list) {
    const id = String(line?.id || "").trim().slice(0, 39);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const label = String(line?.label || "Linje").replace(/\s+/g, " ").trim().slice(0, 200) || "Linje";
    lines.push({
      id,
      label,
      unit: String(line?.unit || "stk").trim().slice(0, 12) || "stk",
      planned: clampQty(line?.planned),
      addition: clampQty(line?.addition),
      done: clampQty(line?.done),
      unitPrice: clampQty(line?.unitPrice),
      source: String(line?.source || "").replace(/\s+/g, " ").trim().slice(0, 80),
      manual: line?.manual === true,
      ...finalFields(line),
    });
  }
  return lines;
}

export function normalizeExtras(raw) {
  const list = Array.isArray(raw?.extras) ? raw.extras : [];
  const seen = new Set();
  const extras = [];
  for (const line of list) {
    const id = String(line?.id || "").trim().slice(0, 39);
    if (!id || seen.has(id) || !id.startsWith("ta")) continue;
    seen.add(id);
    const postId = String(line?.postId || "").trim().slice(0, 39);
    const extra = {
      id,
      description: String(line?.description || "").replace(/\s+/g, " ").trim().slice(0, 200),
      unitPrice: clampQty(line?.unitPrice),
      quantity: clampQty(line?.quantity),
    };
    if (postId) extra.postId = postId;
    extras.push(extra);
  }
  return extras;
}

export function normalizeCost(raw, prices = DEFAULT_PRICES) {
  const next = emptyCost(prices);
  next.agreedExVat = clampQty(raw?.agreedExVat);
  for (const [id] of PRICE_LINES) {
    const line = raw?.lines?.[id] || {};
    const storedPrice = parseNumber(line.unitPrice);
    next.lines[id] = {
      planned: clampQty(line.planned),
      addition: clampQty(line.addition),
      done: clampQty(line.done),
      unitPrice: storedPrice != null && storedPrice >= 0 ? round2(storedPrice) : next.lines[id].unitPrice,
      ...finalFields(line),
    };
  }
  next.fikenLines = normalizeFikenLines(raw);
  next.extras = normalizeExtras(raw);
  return next;
}

export function persistableCost(next) {
  const state = normalizeCost(next);
  const lines = {};
  for (const [id, line] of Object.entries(state.lines)) {
    if (line.planned > 0 || line.addition > 0 || line.done > 0 || line.final === true) lines[id] = line;
  }
  return {
    agreedExVat: state.agreedExVat,
    lines,
    fikenLines: state.fikenLines,
    extras: state.extras,
  };
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
    if (!isOfferItem(item) || item.approved === false || item.fikenBase === true) continue;
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
  let doneEx = 0;
  let finalEx = 0;
  let openEx = 0;
  const takeLine = (line, money) => {
    doneEx += money.doneSum;
    if (line.final === true) finalEx += money.doneSum;
    else openEx += money.plannedSum;
  };
  const catalog = PRICE_LINES.map(([id, label, unit]) => {
    const line = state.lines[id];
    const money = lineMoney(line);
    takeLine(line, money);
    return {
      id,
      label,
      unit,
      planned: line.planned,
      addition: money.addition,
      done: line.done,
      unitPrice: line.unitPrice,
      deviation: money.deviation,
      plannedSum: money.plannedSum,
      doneSum: money.doneSum,
      final: line.final === true,
      finalizedAt: line.final === true ? (line.finalizedAt ?? null) : null,
      fromFiken: false,
      source: "",
      manual: false,
    };
  }).filter((line) => line.planned > 0 || line.addition > 0 || line.done > 0 || line.final);
  const fiken = state.fikenLines.map((line) => {
    const money = lineMoney(line);
    takeLine(line, money);
    return {
      ...line,
      addition: money.addition,
      deviation: money.deviation,
      plannedSum: money.plannedSum,
      doneSum: money.doneSum,
      final: line.final === true,
      finalizedAt: line.final === true ? (line.finalizedAt ?? null) : null,
      fromFiken: true,
    };
  });
  const extras = state.extras.map((line) => {
    const sum = round2(line.quantity * line.unitPrice);
    doneEx += sum;
    return { ...line, sum };
  });
  const extrasExVat = round2(extras.reduce((sum, line) => sum + line.sum, 0));
  openEx += extrasExVat;
  const lines = [...catalog, ...fiken];
  const finalBase = round2(finalEx);
  const openBase = round2(state.agreedExVat + offers.approvedExVat + openEx);
  const estimated = withVat(finalBase + openBase);
  const finalized = withVat(finalBase);
  const remaining = withVat(openBase);
  const incurred = withVat(state.agreedExVat + offers.approvedExVat + doneEx);
  const preview = withVat(finalBase + state.agreedExVat + offers.previewExVat + openEx);
  const differenceExVat = round2(estimated.exVat - state.agreedExVat);
  return {
    agreedExVat: state.agreedExVat,
    lines,
    extras,
    extrasExVat,
    offers,
    estimated,
    finalized,
    remaining,
    incurred,
    preview,
    differenceExVat,
    differenceIncVat: round2(differenceExVat * (1 + VAT_RATE)),
    previewDeltaExVat: round2(preview.exVat - estimated.exVat),
  };
}

function finalFields(line) {
  const final = line?.final === true;
  return {
    final,
    finalizedAt: final ? (line.finalizedAt ?? null) : null,
  };
}

function lineMoney(line) {
  const addition = round2(line?.addition) ?? 0;
  const agreedQty = round2((round2(line?.planned) ?? 0) + addition);
  const price = round2(line?.unitPrice) ?? 0;
  return {
    addition,
    agreedQty,
    plannedSum: round2(agreedQty * price),
    doneSum: round2((round2(line?.done) ?? 0) * price),
    deviation: round2((round2(line?.done) ?? 0) - agreedQty),
  };
}

const FIELD_LABEL = {
  planned: "planlagt",
  addition: "avtalt tillegg",
  done: "utført",
  unitPrice: "enhetspris",
  agreedExVat: "avtalt pris",
  quantity: "antall",
};

function applyQtyPatch(target, field, value, patch) {
  if (!target) return false;
  if (field === "final") {
    const on = value === true || value === "true" || value === 1 || value === "1";
    target.final = on;
    target.finalizedAt = on ? (patch.finalizedAt ?? target.finalizedAt ?? null) : null;
    return true;
  }
  if (target.final === true) return false;
  if (field === "planned" || field === "done" || field === "addition" || field === "unitPrice") {
    target[field] = clampQty(value);
    return true;
  }
  return false;
}

export function patchCost(raw, prices, patch = {}) {
  const { lineId, field, value } = patch;
  const next = pricedCost(raw, prices);
  if (field === "agreedExVat") next.agreedExVat = clampQty(value);
  if (field === "planned" || field === "done" || field === "addition" || field === "final") {
    applyQtyPatch(next.lines[lineId], field, value, patch);
  }
  const fiken = next.fikenLines.find((line) => line.id === lineId);
  if (fiken && applyQtyPatch(fiken, field, value, patch)) {
    fiken.manual = true;
  }
  if (patch.addExtra) {
    const id = String(patch.extraId || newExtraId()).slice(0, 39);
    if (id.startsWith("ta") && !next.extras.some((line) => line.id === id)) {
      next.extras.push({ id, description: "", unitPrice: 0, quantity: 0 });
    }
  }
  if (patch.deleteExtraId) {
    next.extras = next.extras.filter((line) => line.id !== patch.deleteExtraId);
  }
  const extra = next.extras.find((line) => line.id === patch.extraId);
  if (extra && field === "description") {
    extra.description = String(value || "").replace(/\s+/g, " ").trim().slice(0, 200);
  }
  if (extra && field === "postId") {
    const postId = String(value || "").trim().slice(0, 39);
    if (postId) extra.postId = postId;
    else delete extra.postId;
  }
  if (extra && (field === "quantity" || field === "unitPrice")) {
    extra[field] = clampQty(value);
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
    if (left.addition !== right.addition) {
      changes.push({ lineId: id, label, field: "addition", from: left.addition, to: right.addition, unit });
    }
    if (left.done !== right.done) {
      changes.push({ lineId: id, label, field: "done", from: left.done, to: right.done, unit });
    }
    if (left.unitPrice !== right.unitPrice) {
      changes.push({ lineId: id, label, field: "unitPrice", from: left.unitPrice, to: right.unitPrice, unit: "kr" });
    }
    pushFinalChange(changes, id, label, left, right);
  }
  const beforeFiken = new Map(before.fikenLines.map((line) => [line.id, line]));
  const afterFiken = new Map(after.fikenLines.map((line) => [line.id, line]));
  for (const id of new Set([...beforeFiken.keys(), ...afterFiken.keys()])) {
    const left = beforeFiken.get(id) || { planned: 0, addition: 0, done: 0, unitPrice: 0, label: "Linje", unit: "stk" };
    const right = afterFiken.get(id) || { planned: 0, addition: 0, done: 0, unitPrice: 0, label: left.label, unit: left.unit };
    const label = String(right.label || left.label).slice(0, 79);
    const unit = right.unit || left.unit || "stk";
    if (left.planned !== right.planned) {
      changes.push({ lineId: id, label, field: "planned", from: left.planned, to: right.planned, unit });
    }
    if ((left.addition || 0) !== (right.addition || 0)) {
      changes.push({ lineId: id, label, field: "addition", from: left.addition || 0, to: right.addition || 0, unit });
    }
    if (left.done !== right.done) {
      changes.push({ lineId: id, label, field: "done", from: left.done, to: right.done, unit });
    }
    if (left.unitPrice !== right.unitPrice) {
      changes.push({ lineId: id, label, field: "unitPrice", from: left.unitPrice, to: right.unitPrice, unit: "kr" });
    }
    pushFinalChange(changes, id, label, left, right);
  }
  const beforeExtra = new Map(before.extras.map((line) => [line.id, line]));
  const afterExtra = new Map(after.extras.map((line) => [line.id, line]));
  for (const id of new Set([...beforeExtra.keys(), ...afterExtra.keys()])) {
    const left = beforeExtra.get(id) || { description: "", quantity: 0, unitPrice: 0 };
    const right = afterExtra.get(id) || { description: left.description, quantity: 0, unitPrice: 0 };
    const label = String(right.description || left.description || "Tillegg").slice(0, 79);
    if (left.quantity !== right.quantity) {
      changes.push({ lineId: id, label, field: "quantity", from: left.quantity, to: right.quantity, unit: "stk" });
    }
    if (left.unitPrice !== right.unitPrice) {
      changes.push({ lineId: id, label, field: "unitPrice", from: left.unitPrice, to: right.unitPrice, unit: "kr" });
    }
  }
  return changes;
}

function pushFinalChange(changes, id, label, left, right) {
  const was = left?.final === true;
  const now = right?.final === true;
  if (was === now) return;
  const basis = now ? right : left;
  const amount = round2((round2(basis?.done) ?? 0) * (round2(basis?.unitPrice) ?? 0));
  changes.push({
    lineId: id,
    label,
    field: "final",
    from: was ? 1 : 0,
    to: now ? 1 : 0,
    unit: "kr",
    amount,
  });
}

export function changeText(change) {
  if (change?.field === "final") {
    if (Number(change.to) === 1) return `Posten er ferdig, endelig pris ${formatKr(change.amount)} eks. mva`;
    return "Posten er åpnet igjen. Prisen er estimert.";
  }
  const what = FIELD_LABEL[change?.field] || "endring";
  const unit = change?.unit ? ` ${change.unit}` : "";
  const label = change?.field === "agreedExVat" ? "Avtalt pris" : (change?.label || "Linje");
  return `${label}, ${what}: ${formatQty(change?.from)} → ${formatQty(change?.to)}${unit}`;
}

export function costReportText(summary, history = []) {
  const lines = [
    "Nåværende kostnad",
    `Avtalt pris ${formatKr(summary?.agreedExVat || 0)} eks. mva.`,
    `Ferdige poster (endelig) ${formatKr(summary?.finalized?.exVat || 0)} eks. mva, ${formatKr(summary?.finalized?.incVat || 0)} inkl. mva.`,
    `Gjenstår (estimert) ${formatKr(summary?.remaining?.exVat || 0)} eks. mva, ${formatKr(summary?.remaining?.incVat || 0)} inkl. mva.`,
    `Totalt ${formatKr(summary?.estimated?.exVat || 0)} eks. mva, ${formatKr(summary?.estimated?.incVat || 0)} inkl. mva.`,
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
    if (!line.planned && !line.done && !line.addition && !line.final) continue;
    const source = line.source ? ` (${line.source})` : "";
    const tillegg = line.addition ? `, avtalt tillegg ${formatQty(line.addition)} ${line.unit}` : "";
    const priceNote = line.final
      ? `Ferdig – endelig pris ${formatKr(line.doneSum)} eks. mva.`
      : `Estimert ${formatKr(line.plannedSum)} eks. mva, påløpt ${formatKr(line.doneSum)} eks. mva.`;
    lines.push(`${line.label}${source}: planlagt ${formatQty(line.planned)} ${line.unit}${tillegg}, utført ${formatQty(line.done)} ${line.unit}, avvik ${signedQty(line.deviation)} ${line.unit}. ${priceNote} Enhetspris ${formatKr(line.unitPrice)}.`);
  }
  lines.push("", "Tilleggsarbeider");
  const extras = (summary?.extras || []).filter((line) => line.description || line.quantity || line.unitPrice);
  if (!extras.length) lines.push("Ingen tilleggsarbeider.");
  for (const line of extras) {
    lines.push(`${line.description || "Tillegg"}: ${formatQty(line.quantity)} à ${formatKr(line.unitPrice)} eks. mva. Linjesum ${formatKr(line.sum)} eks. mva.`);
  }
  if (extras.length) lines.push(`Sum tilleggsarbeider ${formatKr(summary?.extrasExVat || 0)} eks. mva.`);
  lines.push("", "Historikk");
  if (!history.length) lines.push("Ingen endringer er logget.");
  for (const entry of history) {
    const who = entry.byName || "Einar";
    const when = entry.when ? `${entry.when} ` : "";
    lines.push(`${when}${who}: ${entry.text}`);
  }
  return lines.join("\n");
}
