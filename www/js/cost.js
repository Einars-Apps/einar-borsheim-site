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

export function partialFinalText(line) {
  if (line?.final !== true) return "";
  const target = round2((round2(line.planned) || 0) + (round2(line.addition) || 0));
  const done = round2(line.done) || 0;
  if (!(target > done)) return "";
  return `Endelig: ${formatQty(done)} av ${formatQty(target)}`;
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

export const COST_INFO_NOTE = "Oversikten viser utført og avtalt arbeid. Ønsker du noe ekstra, ta kontakt med Einar – arbeid utover tilbudslinjene faktureres etter avtale.";
export const ESTIMATE_HELP = "Estimert: posten er ikke ferdig. Summen er mengde ganger enhetspris, og den kan fortsatt endre seg til posten er ferdig.";
export const ROUND_SUM_HELP = "Rund sum: 1 er hele det opprinnelige omfanget, og 0,5 er halvparten. Merk Ferdig når det ikke skal gjøres mer på posten. Sluttprisen blir den andelen som er ført inn, og den går ikke over den avtalte summen av seg selv.";

export function isRoundSumLine(line) {
  const unit = String(line?.unit || "").replace(/\s+/g, " ").trim().toLowerCase();
  if (unit === "rs" || unit === "rund sum" || unit === "rundsum") return true;
  const label = String(line?.label || "");
  return /\(\s*rs\s*\)/i.test(label) || /\brund\s+sum\b/i.test(label);
}

export function roundSumPrice(line) {
  const planned = round2(line?.planned) || 0;
  const addition = round2(line?.addition) || 0;
  const agreedQty = round2(planned + addition);
  const done = round2(line?.done) || 0;
  const price = round2(line?.unitPrice) || 0;
  const final = line?.final === true;
  const countedQty = final ? round2(Math.min(done, agreedQty)) : agreedQty;
  return {
    planned,
    addition,
    agreedQty,
    done,
    price,
    agreedEx: round2(agreedQty * price),
    countedQty,
    countedEx: round2(countedQty * price),
    final,
    capped: done > agreedQty,
  };
}

export function lineAmountText(line) {
  if (!isRoundSumLine(line)) return "";
  const rs = roundSumPrice(line);
  if (line?.final === true) {
    const partial = partialFinalText(line);
    const note = String(line?.finalNote || "").replace(/\s+/g, " ").trim();
    const cap = rs.capped ? ` Utført ${formatQty(rs.done)} er over avtalt omfang og øker ikke summen.` : "";
    return [
      partial,
      `Ferdig beløp ${formatKr(rs.countedEx)} eks. mva.${cap}`,
      note ? `Avtalt omfang: ${note}.` : "",
    ].filter(Boolean).join(" ");
  }
  if (rs.capped) {
    return `Rund sum ${formatKr(rs.agreedEx)} eks. mva. Utført ${formatQty(rs.done)} er over avtalt omfang og øker ikke summen.`;
  }
  return `Rund sum ${formatKr(rs.agreedEx)} eks. mva. Utført ${formatQty(rs.done)} endrer ikke rundsummen før posten er merket Ferdig.`;
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
      ...noteField(line),
    });
  }
  return lines;
}

export function extraKind(line) {
  return line?.kind === "timer" || line?.kind === "vare" ? line.kind : "";
}

export function legacyTimerExtra(line) {
  return extraKind(line) === "timer" && line?.hours == null && line?.timePrice == null;
}

export function legacyVareExtra(line) {
  return extraKind(line) === "vare" && !Array.isArray(line?.goods);
}

export function normalizeGoods(list) {
  const seen = new Set();
  const goods = [];
  for (const item of list || []) {
    let id = String(item?.id || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 20);
    if (!id || seen.has(id)) id = `v${goods.length + 1}`;
    if (seen.has(id)) continue;
    seen.add(id);
    goods.push({
      id,
      description: String(item?.description || "").replace(/\s+/g, " ").trim().slice(0, 120),
      amount: clampQty(item?.amount),
    });
    if (goods.length >= 30) break;
  }
  return goods;
}

export function extraParts(line) {
  const description = String(line?.description || "").replace(/\s+/g, " ").trim();
  if (legacyTimerExtra(line)) {
    return {
      description,
      quantity: 0,
      unitPrice: 0,
      hours: round2(line?.quantity) || 0,
      timePrice: round2(line?.unitPrice) || 0,
      goods: [],
    };
  }
  if (legacyVareExtra(line)) {
    return {
      description,
      quantity: 0,
      unitPrice: 0,
      hours: line?.hours == null ? 0 : (round2(line.hours) || 0),
      timePrice: line?.timePrice == null ? 0 : (round2(line.timePrice) || 0),
      goods: [{ id: "legacy", description, amount: round2(line?.unitPrice) || 0 }],
    };
  }
  return {
    description,
    quantity: round2(line?.quantity) || 0,
    unitPrice: round2(line?.unitPrice) || 0,
    hours: line?.hours == null ? 0 : (round2(line.hours) || 0),
    timePrice: line?.timePrice == null ? 0 : (round2(line.timePrice) || 0),
    goods: Array.isArray(line?.goods) ? normalizeGoods(line.goods) : [],
  };
}

export function extraLineSum(line) {
  const parts = extraParts(line);
  const goods = parts.goods.reduce((sum, item) => sum + (round2(item.amount) || 0), 0);
  return round2(parts.quantity * parts.unitPrice + parts.hours * parts.timePrice + goods);
}

export function extraCustomerText(line) {
  const parts = extraParts(line);
  const bits = [];
  if (parts.quantity > 0 && parts.unitPrice > 0) {
    bits.push(`${formatQty(parts.quantity)} à ${formatKr(parts.unitPrice)}`);
  }
  if (parts.hours > 0 && parts.timePrice > 0) {
    bits.push(`${formatQty(parts.hours)} t à ${formatKr(parts.timePrice)}`);
  }
  const goods = parts.goods.filter((item) => (round2(item.amount) || 0) > 0);
  if (goods.length) {
    const list = goods.map((item) => `${item.description || "Vare"} ${formatKr(item.amount)}`).join(", ");
    bits.push(`varer: ${list}`);
  }
  const name = parts.description || "Tillegg";
  if (!bits.length) return isFinal(line) ? `${name}: Ferdig.` : "";
  const sentence = `${name}: ${bits.join(" + ")} = ${formatKr(extraLineSum(line))} eks. mva`;
  return isFinal(line) ? `${sentence} Ferdig.` : sentence;
}

export function extraReportLine(line) {
  return extraCustomerText(line);
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
    const kind = extraKind(line);
    if (kind) extra.kind = kind;
    if (line?.hours != null) extra.hours = clampQty(line.hours);
    if (line?.timePrice != null) extra.timePrice = clampQty(line.timePrice);
    if (Array.isArray(line?.goods)) extra.goods = normalizeGoods(line.goods);
    if (isFinal(line)) {
      extra.final = true;
      const when = storedTimestamp(line.finalizedAt);
      if (when != null) extra.finalizedAt = when;
    }
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
      ...noteField(line),
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

function plannedLineExVat(line) {
  return round2((round2(line?.planned) || 0) * (round2(line?.unitPrice) || 0));
}

function fikenOfferNumbers(lines) {
  const numbers = [];
  for (const line of lines || []) {
    const match = String(line?.source || "").match(/Fiken-tilbud nr\s+(\S+)/i);
    if (!match) continue;
    const number = match[1].replace(/[.,;:]+$/, "");
    if (number && !numbers.includes(number)) numbers.push(number);
  }
  return numbers;
}

function quoteAgreed(quote) {
  return quote?.agreed === true || String(quote?.accepted || "").trim().length > 0;
}

export function originalOffer({ agreedExVat = 0, lines = [], offers, quotes = [] } = {}) {
  const manual = round2(agreedExVat);
  if (manual > 0) {
    return { exVat: manual, kind: "manuell", label: "Skrevet inn som avtalt pris", number: "" };
  }
  const approved = (offers?.rows || []).some((row) => row.status === "godkjent");
  if (approved) {
    return { exVat: 0, kind: "godkjent", label: "Godkjente poster i Tilbud og endringer", number: "" };
  }
  const numbers = fikenOfferNumbers(lines);
  const planned = round2((lines || []).reduce((sum, line) => sum + plannedLineExVat(line), 0));
  const quote = (quotes || []).find((entry) => quoteAgreed(entry) && round2(entry?.exVat) > 0);
  if (quote) {
    const number = String(quote.number || numbers[0] || "").trim();
    return {
      exVat: round2(quote.exVat),
      kind: "fiken",
      label: number ? `Fra Fiken-tilbud ${number}` : "Fra Fiken-tilbud",
      number,
    };
  }
  if (planned > 0) {
    const number = numbers.join(", ");
    return {
      exVat: planned,
      kind: "planlagt",
      label: number ? `Fra Fiken-tilbud ${number}` : "Planlagt mengde ganger enhetspris",
      number,
    };
  }
  return { exVat: 0, kind: "ingen", label: "", number: "" };
}

function requestKey(id) {
  return String(id || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 30);
}

function unappliedApprovedEx(requests, rawCost, state) {
  const applied = new Set(Array.isArray(rawCost?.appliedRequests) ? rawCost.appliedRequests.map((id) => String(id)) : []);
  const known = new Set([
    ...Object.keys(state.lines || {}),
    ...(state.fikenLines || []).map((line) => line.id),
    ...(state.extras || []).map((line) => line.id),
  ]);
  let extra = 0;
  for (const request of requests || []) {
    if (request?.status !== "godkjent") continue;
    const id = String(request.id || "");
    if (id && applied.has(id)) continue;
    const key = requestKey(id);
    const lineId = `rq-${key || "post"}`.slice(0, 39);
    const extraId = `ta${key || "onske"}`.slice(0, 39);
    if (known.has(lineId) || known.has(extraId)) continue;
    const quantity = round2(request.quantity);
    const price = round2(request.unitPrice);
    if (quantity == null || quantity <= 0 || price == null || price < 0) continue;
    extra += round2(quantity * price);
  }
  return round2(extra);
}

export function liveCost({ cost, prices = DEFAULT_PRICES, items, previewChoices = null, quotes = null, requests = null } = {}) {
  const state = normalizeCost(cost, prices);
  const offers = offerContribution(items, previewChoices);
  let doneEx = 0;
  let finalEx = 0;
  let openEx = 0;
  const takeLine = (line, money, described) => {
    if (isRoundSumLine(described)) {
      const rs = roundSumPrice(described);
      doneEx += round2(Math.min(rs.done, rs.agreedQty) * rs.price);
      if (described.final === true) finalEx += rs.countedEx;
      else openEx += rs.agreedEx;
      return rs.countedEx;
    }
    doneEx += money.doneSum;
    // Ferdig post: utført mengde × pris. Åpen post: planlagt + avtalt tillegg.
    if (line.final === true) finalEx += money.doneSum;
    else openEx += money.plannedSum;
    return line.final === true ? money.doneSum : money.plannedSum;
  };
  const catalog = PRICE_LINES.map(([id, label, unit]) => {
    const line = state.lines[id];
    const money = lineMoney(line);
    const countedEx = takeLine(line, money, { ...line, label, unit });
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
      countedEx,
      basis: line.final === true ? "låst" : (money.addition ? "endret" : "planlagt"),
      finalNote: line.finalNote || "",
      fromFiken: false,
      source: "",
      manual: false,
    };
  }).filter((line) => line.planned > 0 || line.addition > 0 || line.done > 0 || line.final);
  const fiken = state.fikenLines.map((line) => {
    const money = lineMoney(line);
    const countedEx = takeLine(line, money, line);
    return {
      ...line,
      addition: money.addition,
      deviation: money.deviation,
      plannedSum: money.plannedSum,
      doneSum: money.doneSum,
      final: line.final === true,
      finalizedAt: line.final === true ? (line.finalizedAt ?? null) : null,
      countedEx,
      basis: line.final === true ? "låst" : (money.addition ? "endret" : "planlagt"),
      finalNote: line.finalNote || "",
      fromFiken: true,
    };
  });
  let extrasOpen = 0;
  let extrasFinal = 0;
  const extras = state.extras.map((line) => {
    const sum = extraLineSum(line);
    doneEx += sum;
    if (line.final === true) extrasFinal += sum;
    else extrasOpen += sum;
    return { ...line, sum };
  });
  const extrasExVat = round2(extrasOpen + extrasFinal);
  const requestEx = unappliedApprovedEx(requests, cost, state);
  openEx += round2(extrasOpen);
  finalEx += round2(extrasFinal);
  openEx += requestEx;
  const lines = [...catalog, ...fiken];
  const finalBase = round2(finalEx);
  const openBase = round2(state.agreedExVat + offers.approvedExVat + openEx);
  const totalEx = round2(finalBase + openBase);
  const estimated = withVat(totalEx);
  const finalized = withVat(finalBase);
  const remaining = withVat(round2(totalEx - finalBase));
  const incurred = withVat(state.agreedExVat + offers.approvedExVat + doneEx);
  const preview = withVat(finalBase + state.agreedExVat + offers.previewExVat + openEx);
  const baseline = originalOffer({
    agreedExVat: state.agreedExVat,
    lines,
    offers,
    quotes,
  });
  const differenceExVat = round2(estimated.exVat - baseline.exVat);
  const budget = budgetRoom({ lines, extrasExVat, approvedOfferEx: offers.approvedExVat, requestEx });
  return {
    agreedExVat: state.agreedExVat,
    baseline,
    lines,
    extras,
    extrasExVat,
    offers,
    estimated,
    finalized,
    remaining,
    incurred,
    preview,
    budget,
    differenceExVat,
    differenceIncVat: round2(differenceExVat * (1 + VAT_RATE)),
    previewDeltaExVat: round2(preview.exVat - estimated.exVat),
  };
}

function scopeKr(value) {
  const number = round2(value);
  const body = formatKr(Math.abs(number)).replace(/^kr[\s\u00a0\u202f]*/, "");
  if (number < 0) return `kr −${body}`;
  if (number > 0) return `kr +${body}`;
  return `kr ${body}`;
}

export function scopeChangeText(change) {
  return `${change.label}: planlagt ${formatQty(change.planned)}, utført ${formatQty(change.done)} – ${scopeKr(change.deltaEx)} eks. mva`;
}

function budgetRoom({ lines, extrasExVat, approvedOfferEx, requestEx }) {
  const changes = [];
  let lockedGap = 0;
  let tillegg = round2((extrasExVat || 0) + (approvedOfferEx || 0) + (requestEx || 0));
  for (const line of lines || []) {
    const planned = round2(line?.planned) || 0;
    const done = round2(line?.done) || 0;
    const price = round2(line?.unitPrice) || 0;
    const addition = round2(line?.addition) || 0;
    if (isRoundSumLine(line)) {
      const rs = roundSumPrice(line);
      if (line?.final !== true) {
        tillegg += round2(rs.addition * rs.price);
        continue;
      }
      const deltaEx = round2((rs.countedQty - rs.planned) * rs.price);
      lockedGap += round2((rs.planned - rs.countedQty) * rs.price);
      if (Math.abs(deltaEx) >= 0.001) {
        changes.push({
          id: line.id,
          label: line.label,
          planned: rs.planned,
          done: rs.countedQty,
          deltaEx,
          note: String(line.finalNote || "").trim(),
        });
      }
      continue;
    }
    tillegg += round2(addition * price);
    if (line?.final !== true || planned === done) continue;
    const deltaEx = round2((done - planned) * price);
    lockedGap += round2((planned - done) * price);
    changes.push({
      id: line.id,
      label: line.label,
      planned,
      done,
      deltaEx,
      note: String(line.finalNote || "").trim(),
    });
  }
  const signedEx = round2(lockedGap - tillegg);
  const amount = withVat(Math.abs(signedEx));
  return {
    direction: signedEx > 0 ? "under" : signedEx < 0 ? "over" : "even",
    exVat: amount.exVat,
    incVat: amount.incVat,
    signedEx,
    changes,
  };
}

export function budgetStatusText(budget) {
  if (!budget || budget.direction === "even" || !(budget.exVat > 0)) return "";
  const money = `${formatKr(budget.exVat)} eks. mva (${formatKr(budget.incVat)} inkl. mva)`;
  if (budget.direction === "under") {
    return `Under tilbudet så langt: ${money}.`;
  }
  return `Over tilbudet så langt: ${money}. Det kommer av avtalt tillegg og avvik på ferdige poster.`;
}

function isFinal(line) {
  const value = line?.final;
  return value === true || value === 1 || value === "1" || value === "true";
}

function noteField(line) {
  const note = String(line?.finalNote || "").replace(/\s+/g, " ").trim().slice(0, 200);
  return note ? { finalNote: note } : {};
}

// serverTimestamp() er et FieldValue-merke. Firestore avviser det inni en array,
// og fikenLines er en array. Et vanlig tidspunkt (Date, Timestamp eller { seconds }) er lov.
export function storedTimestamp(value, now = new Date()) {
  if (value == null || value === false) return null;
  if (typeof value._methodName === "string") {
    const ms = now.getTime();
    return { seconds: Math.floor(ms / 1000), nanoseconds: (ms % 1000) * 1e6 };
  }
  if (typeof value.toDate === "function" || value instanceof Date) return value;
  if (typeof value.seconds === "number" && Number.isFinite(value.seconds)) {
    const nanos = Number(value.nanoseconds);
    return { seconds: value.seconds, nanoseconds: Number.isFinite(nanos) ? nanos : 0 };
  }
  return null;
}

function finalFields(line, now = new Date()) {
  const final = isFinal(line);
  return {
    final,
    finalizedAt: final ? storedTimestamp(line.finalizedAt, now) : null,
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
  if (field === "finalNote") {
    const note = String(value || "").replace(/\s+/g, " ").trim().slice(0, 200);
    if (note) target.finalNote = note;
    else delete target.finalNote;
    return true;
  }
  if (field === "final") {
    const on = value === true || value === "true" || value === 1 || value === "1";
    target.final = on;
    target.finalizedAt = on ? storedTimestamp(patch.finalizedAt ?? target.finalizedAt ?? null) : null;
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
  if (field === "planned" || field === "done" || field === "addition" || field === "final" || field === "finalNote") {
    applyQtyPatch(next.lines[lineId], field, value, patch);
  }
  const fiken = next.fikenLines.find((line) => line.id === lineId);
  if (fiken && applyQtyPatch(fiken, field, value, patch)) {
    fiken.manual = true;
  }
  if (patch.addExtra) {
    const id = String(patch.extraId || newExtraId()).slice(0, 39);
    if (id.startsWith("ta") && !next.extras.some((line) => line.id === id)) {
      const extra = { id, description: "", unitPrice: 0, quantity: 0, hours: 0, timePrice: 0, goods: [] };
      const kind = extraKind({ kind: patch.extraKind });
      if (kind) {
        extra.kind = kind;
        delete extra.hours;
        delete extra.timePrice;
        delete extra.goods;
      }
      next.extras.push(extra);
    }
  }
  if (patch.deleteExtraId) {
    next.extras = next.extras.filter((line) => line.id !== patch.deleteExtraId);
  }
  const extra = next.extras.find((line) => line.id === patch.extraId);
  const locked = extra?.final === true && field !== "final";
  if (extra && !locked && field === "description") {
    extra.description = String(value || "").replace(/\s+/g, " ").trim().slice(0, 200);
  }
  if (extra && !locked && field === "postId") {
    const postId = String(value || "").trim().slice(0, 39);
    if (postId) extra.postId = postId;
    else delete extra.postId;
  }
  if (extra && !locked && field === "hours") {
    if (legacyTimerExtra(extra)) extra.quantity = clampQty(value);
    else {
      if (legacyVareExtra(extra)) promoteVareExtra(extra);
      extra.hours = clampQty(value);
    }
  }
  if (extra && !locked && field === "timePrice") {
    if (legacyTimerExtra(extra)) extra.unitPrice = clampQty(value);
    else {
      if (legacyVareExtra(extra)) promoteVareExtra(extra);
      extra.timePrice = clampQty(value);
    }
  }
  if (extra && !locked && field === "quantity") {
    if (legacyTimerExtra(extra)) promoteTimerExtra(extra);
    if (legacyVareExtra(extra)) promoteVareExtra(extra);
    extra.quantity = clampQty(value);
  }
  if (extra && !locked && field === "unitPrice") {
    if (legacyTimerExtra(extra)) promoteTimerExtra(extra);
    if (legacyVareExtra(extra)) promoteVareExtra(extra);
    extra.unitPrice = clampQty(value);
  }
  if (extra && !locked && field === "goods") {
    if (legacyTimerExtra(extra)) promoteTimerExtra(extra);
    if (legacyVareExtra(extra)) {
      extra.quantity = 0;
      extra.unitPrice = 0;
      delete extra.kind;
    }
    extra.goods = normalizeGoods(value);
  }
  if (extra && field === "final") {
    const on = value === true || value === "true" || value === 1 || value === "1";
    if (on) {
      extra.final = true;
      extra.finalizedAt = storedTimestamp(patch.finalizedAt) || storedTimestamp(new Date());
    } else {
      delete extra.final;
      delete extra.finalizedAt;
    }
  }
  return next;
}

function promoteTimerExtra(extra) {
  extra.hours = clampQty(extra.quantity);
  extra.timePrice = clampQty(extra.unitPrice);
  extra.quantity = 0;
  extra.unitPrice = 0;
  delete extra.kind;
}

function promoteVareExtra(extra) {
  extra.goods = normalizeGoods([{
    id: "legacy",
    description: extra.description || "",
    amount: extra.unitPrice,
  }]);
  extra.quantity = 0;
  extra.unitPrice = 0;
  delete extra.kind;
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
    const leftParts = extraParts(left);
    const rightParts = extraParts(right);
    const label = String(rightParts.description || leftParts.description || "Tillegg").slice(0, 79);
    if (leftParts.quantity !== rightParts.quantity) {
      changes.push({ lineId: id, label, field: "quantity", from: leftParts.quantity, to: rightParts.quantity, unit: "stk" });
    }
    if (leftParts.unitPrice !== rightParts.unitPrice) {
      changes.push({ lineId: id, label, field: "unitPrice", from: leftParts.unitPrice, to: rightParts.unitPrice, unit: "kr" });
    }
    if ((left.final === true) !== (right.final === true)) {
      const priced = right.final === true ? right : left;
      changes.push({
        lineId: id,
        label,
        field: "final",
        from: left.final === true ? 1 : 0,
        to: right.final === true ? 1 : 0,
        unit: "kr",
        amount: extraLineSum(priced),
      });
    }
  }
  return changes;
}

function pushFinalChange(changes, id, label, left, right) {
  const was = left?.final === true;
  const now = right?.final === true;
  if (was === now) return;
  const basis = now ? right : left;
  const described = { ...basis, label };
  const amount = isRoundSumLine(described)
    ? roundSumPrice(described).countedEx
    : round2((round2(basis?.done) ?? 0) * (round2(basis?.unitPrice) ?? 0));
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
    return "Posten er åpnet igjen. Den var merket ferdig med endelig pris og kan være fakturert. Prisen er estimert.";
  }
  const what = change?.kind === "timer" && change.field === "quantity"
    ? "timer"
    : change?.kind === "timer" && change.field === "unitPrice"
      ? "timepris"
      : change?.kind === "vare" && change.field === "unitPrice"
        ? "beløp"
        : (FIELD_LABEL[change?.field] || "endring");
  const unit = change?.unit ? ` ${change.unit}` : "";
  const label = change?.field === "agreedExVat" ? "Avtalt pris" : (change?.label || "Linje");
  return `${label}, ${what}: ${formatQty(change?.from)} → ${formatQty(change?.to)}${unit}`;
}

export function paymentStatus(payment) {
  return payment?.status === "sendt" ? "sendt" : "betalt";
}

export function paymentStatusLabel(status) {
  return status === "sendt" ? "Sendt" : "Betalt";
}

function storedInstallment(payment) {
  const number = Number(payment?.installment);
  if (!Number.isInteger(number) || number < 1 || number > 500) return 0;
  return number;
}

function paymentMoment(payment) {
  const paid = payment?.paidAt;
  const created = payment?.createdAt;
  const paidMs = paid?.toDate?.()?.getTime?.() || (paid instanceof Date ? paid.getTime() : 0) || 0;
  const createdMs = created?.toDate?.()?.getTime?.() || (created instanceof Date ? created.getTime() : 0) || 0;
  return paidMs || createdMs || 0;
}

function addVatAmount(bucket, payment) {
  const amount = Number(payment?.amount);
  if (!Number.isFinite(amount) || amount < 0) return false;
  if (payment.vat === "inkl") {
    bucket.incVat += amount;
    bucket.exVat += amount / (1 + VAT_RATE);
    return true;
  }
  if (payment.vat === "eks") {
    bucket.exVat += amount;
    bucket.incVat += amount * (1 + VAT_RATE);
    return true;
  }
  return false;
}

export function paymentInstallments(payments = []) {
  const rows = [];
  (payments || []).forEach((payment, index) => {
    const amount = Number(payment?.amount);
    if (!Number.isFinite(amount) || amount < 0) return;
    rows.push({ payment, index });
  });
  const used = new Set();
  for (const row of rows) {
    const number = storedInstallment(row.payment);
    if (number) used.add(number);
  }
  const ordered = [...rows].sort((a, b) => paymentMoment(a.payment) - paymentMoment(b.payment) || a.index - b.index);
  let cursor = 1;
  const numbered = ordered.map((row) => {
    let number = storedInstallment(row.payment);
    if (!number) {
      while (used.has(cursor)) cursor += 1;
      number = cursor;
      used.add(number);
      cursor += 1;
    }
    return {
      ...row.payment,
      number,
      status: paymentStatus(row.payment),
    };
  });
  numbered.sort((a, b) => a.number - b.number);
  return numbered;
}

export function nextInstallmentNumber(payments = []) {
  const rows = paymentInstallments(payments);
  return rows.reduce((max, row) => Math.max(max, row.number), 0) + 1;
}

export function paymentTotals(payments = []) {
  const bucket = { exVat: 0, incVat: 0 };
  for (const payment of payments || []) {
    if (paymentStatus(payment) !== "betalt") continue;
    addVatAmount(bucket, payment);
  }
  return { exVat: round2(bucket.exVat), incVat: round2(bucket.incVat) };
}

export function paymentInvoicedTotals(payments = []) {
  const bucket = { exVat: 0, incVat: 0 };
  for (const payment of payments || []) addVatAmount(bucket, payment);
  return { exVat: round2(bucket.exVat), incVat: round2(bucket.incVat) };
}

export function paymentProgress(summary, payments = []) {
  const paid = paymentTotals(payments);
  const invoiced = paymentInvoicedTotals(payments);
  if (summary) {
    const balance = paymentBalance(summary, payments);
    return {
      paidInc: paid.incVat,
      paidEx: paid.exVat,
      totalInc: balance.totalInc,
      totalEx: balance.totalEx,
      dueInc: balance.dueInc,
      dueEx: balance.dueEx,
      hasTotal: true,
    };
  }
  return {
    paidInc: paid.incVat,
    paidEx: paid.exVat,
    totalInc: invoiced.incVat,
    totalEx: invoiced.exVat,
    dueInc: round2(invoiced.incVat - paid.incVat),
    dueEx: round2(invoiced.exVat - paid.exVat),
    hasTotal: false,
  };
}

export function paymentBalance(summary, payments = []) {
  const paid = paymentTotals(payments);
  const totalEx = round2(summary?.estimated?.exVat || 0);
  const totalInc = round2(summary?.estimated?.incVat || 0);
  return {
    paid,
    totalEx,
    totalInc,
    dueEx: round2(totalEx - paid.exVat),
    dueInc: round2(totalInc - paid.incVat),
  };
}

function paymentReportLines(payments = [], summary = null) {
  const lines = [];
  let labeled = 0;
  let unlabeled = 0;
  for (const payment of paymentInstallments(payments)) {
    const amount = Number(payment.amount);
    const when = payment.when ? `${payment.when}: ` : "";
    const invoice = payment.invoiceNumber ? ` Faktura ${payment.invoiceNumber}.` : "";
    const note = payment.note ? ` ${payment.note}` : "";
    const head = `Delfaktura ${payment.number}. ${when}`;
    if (payment.vat === "inkl" || payment.vat === "eks") {
      labeled += 1;
      const vatLabel = payment.vat === "inkl" ? "inkl. mva" : "eks. mva";
      const state = payment.status === "sendt" ? " Sendt." : " Betalt.";
      lines.push(`${head}${formatKr(amount)} ${vatLabel}.${invoice}${note}${state}`.trim());
    } else {
      unlabeled += 1;
      lines.push(`${head}${formatKr(amount)}. Mva er ikke merket, så beløpet er ikke med i summen.${invoice}${note}`.trim());
    }
  }
  if (!labeled && !unlabeled) lines.push("Ingen betalinger er registrert.");
  const balance = paymentBalance(summary, payments);
  const progress = paymentProgress(summary, payments);
  if (progress.totalInc > 0 || progress.paidInc > 0) {
    lines.push(`Betalt ${formatKr(progress.paidInc)} av ${formatKr(progress.totalInc)}.`);
  }
  lines.push(`Betalt hittil ${formatKr(balance.paid.incVat)} inkl. mva, ${formatKr(balance.paid.exVat)} eks. mva.`);
  if (summary) {
    lines.push(`Totalt (endelig + estimert) ${formatKr(balance.totalInc)} inkl. mva, ${formatKr(balance.totalEx)} eks. mva.`);
    const over = balance.dueInc < 0 || balance.dueEx < 0;
    lines.push(`Gjenstår å betale ${formatKr(balance.dueInc)} inkl. mva, ${formatKr(balance.dueEx)} eks. mva.${over ? " Det er betalt mer enn totalen." : ""}`);
  } else if (progress.dueInc > 0 || progress.dueEx > 0) {
    lines.push(`Gjenstår ${formatKr(progress.dueInc)} inkl. mva, ${formatKr(progress.dueEx)} eks. mva.`);
  }
  return lines;
}

export function paymentReportText(payments = [], summary = null) {
  return ["Betalinger", ...paymentReportLines(payments, summary)].join("\n");
}

export function costReportText(summary, history = [], payments = []) {
  const lines = [
    "Nåværende kostnad",
    ...(summary?.budget?.changes || []).flatMap((change) => [
      scopeChangeText(change),
      change.note || "",
    ]),
    budgetStatusText(summary?.budget),
    `Avtalt pris ${formatKr(summary?.agreedExVat || 0)} eks. mva.`,
    summary?.baseline?.label
      ? `Opprinnelig tilbud ${formatKr(summary.baseline.exVat)} eks. mva. ${summary.baseline.label}.`
      : "",
    (summary?.finalized?.exVat || summary?.finalized?.incVat)
      ? `Ferdigstilt pris (ferdige poster) ${formatKr(summary?.finalized?.exVat || 0)} eks. mva, ${formatKr(summary?.finalized?.incVat || 0)} inkl. mva.`
      : "",
    `Gjenstår (estimert) ${formatKr(summary?.remaining?.exVat || 0)} eks. mva, ${formatKr(summary?.remaining?.incVat || 0)} inkl. mva.`,
    `Totalt ${formatKr(summary?.estimated?.exVat || 0)} eks. mva, ${formatKr(summary?.estimated?.incVat || 0)} inkl. mva.`,
    `Estimert total ${formatKr(summary?.estimated?.exVat || 0)} eks. mva, ${formatKr(summary?.estimated?.incVat || 0)} inkl. mva.`,
    `Påløpt hittil ${formatKr(summary?.incurred?.exVat || 0)} eks. mva, ${formatKr(summary?.incurred?.incVat || 0)} inkl. mva.`,
    `Differanse mot opprinnelig tilbud: ${signedKr(summary?.differenceExVat || 0)} eks. mva, ${signedKr(summary?.differenceIncVat || 0)} inkl. mva.`,
    "",
    "Avtalte poster",
  ];
  const approved = (summary?.offers?.rows || []).filter((row) => row.status === "godkjent");
  if (!approved.length) lines.push("Ingen avtalte poster.");
  for (const row of approved) {
    lines.push(`${row.title}${row.name ? `: ${row.name}` : ""} ${formatKr(row.exVat)} eks. mva.`);
  }
  lines.push("", "Mengder");
  for (const line of summary?.lines || []) {
    if (!line.planned && !line.done && !line.addition && !line.final) continue;
    const source = line.source ? ` (${line.source})` : "";
    const tillegg = line.addition ? `, avtalt tillegg ${formatQty(line.addition)} ${line.unit}` : "";
    const partial = partialFinalText(line);
    const priceNote = isRoundSumLine(line)
      ? `${lineAmountText(line)} ${ROUND_SUM_HELP}`
      : line.final
        ? `${partial ? `${partial}. ` : ""}Ferdig – endelig pris ${formatKr(line.doneSum)} eks. mva.`
        : `Estimert ${formatKr(line.plannedSum)} eks. mva, påløpt ${formatKr(line.doneSum)} eks. mva. ${ESTIMATE_HELP}`;
    lines.push(`${line.label}${source}: planlagt ${formatQty(line.planned)} ${line.unit}${tillegg}, utført ${formatQty(line.done)} ${line.unit}, avvik ${signedQty(line.deviation)} ${line.unit}. ${priceNote} Enhetspris ${formatKr(line.unitPrice)}.`);
  }
  lines.push("", "Tilleggsarbeider");
  const extras = (summary?.extras || []).map((line) => extraCustomerText(line)).filter(Boolean);
  if (!extras.length) lines.push("Ingen tilleggsarbeider.");
  for (const line of extras) lines.push(line);
  if (extras.length) lines.push(`Sum tilleggsarbeider ${formatKr(summary?.extrasExVat || 0)} eks. mva.`);
  lines.push("", ...paymentReportText(payments, summary).split("\n"));
  lines.push("", "Historikk");
  if (!history.length) lines.push("Ingen endringer er logget.");
  for (const entry of history) {
    const who = entry.byName || "Einar";
    const when = entry.when ? `${entry.when} ` : "";
    lines.push(`${when}${who}: ${entry.text}`);
  }
  return lines.join("\n");
}
