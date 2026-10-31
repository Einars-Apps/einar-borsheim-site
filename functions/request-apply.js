"use strict";

// Samme utregning som www/js/requests.js. Kunden godkjenner, og dette legger
// beløpet inn i kostnaden uten å finne på en annen pris.

function round2(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.round(number * 100) / 100;
}

function requestUnitId(value) {
  const id = String(value || "").trim().toLowerCase();
  if (id === "m" || id === "meter") return "meter";
  if (id === "m2" || id === "m²") return "m2";
  if (id === "m3" || id === "m³") return "m3";
  if (id === "time" || id === "timer") return "time";
  return "stk";
}

function requestUnitLabel(value) {
  const id = requestUnitId(value);
  if (id === "m2") return "m²";
  if (id === "m3") return "m³";
  return id;
}

function requestLineId(id) {
  const clean = String(id || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 30);
  return `rq-${clean || "post"}`.slice(0, 39);
}

function requestExtraId(id) {
  const clean = String(id || "").replace(/[^A-Za-z0-9]/g, "").slice(0, 30);
  return `ta${clean || "onske"}`.slice(0, 39);
}

function cloneCost(raw) {
  const lines = {};
  for (const [id, line] of Object.entries(raw?.lines || {})) lines[id] = { ...line };
  return {
    ...(raw || {}),
    agreedExVat: raw?.agreedExVat || 0,
    lines,
    fikenLines: (raw?.fikenLines || []).map((line) => ({ ...line })),
    extras: (raw?.extras || []).map((line) => ({ ...line })),
  };
}

function change(lineId, label, field, from, to, unit) {
  return {
    lineId: String(lineId).slice(0, 39),
    label: String(label || "Linje").slice(0, 79),
    field,
    from,
    to,
    unit: String(unit || "").slice(0, 19),
  };
}

function applyApprovedRequest(rawCost, request) {
  if (!request || request.status !== "godkjent") return { ok: false, reason: "ikke godkjent" };
  const qty = round2(request.quantity);
  const price = round2(request.unitPrice);
  if (qty == null || qty <= 0 || price == null || price < 0) return { ok: false, reason: "mangler pris" };
  const name = String(request.postName || "Tillegg").replace(/\s+/g, " ").trim().slice(0, 200) || "Tillegg";
  const unit = requestUnitLabel(request.unit);
  const cost = cloneCost(rawCost);
  const seen = new Set(Array.isArray(cost.appliedRequests) ? cost.appliedRequests : []);
  const lineId = requestLineId(request.id);
  const extraId = requestExtraId(request.id);
  if ((request.id && seen.has(request.id))
    || cost.fikenLines.some((line) => line.id === lineId)
    || cost.extras.some((line) => line.id === extraId)) {
    return { ok: true, already: true, cost, changes: [], appliedAs: "finnes" };
  }
  if (request.id) cost.appliedRequests = [...seen, String(request.id)].slice(-200);
  const postId = String(request.postId || "").trim();
  const fiken = postId ? cost.fikenLines.find((line) => line.id === postId) : null;
  const catalog = postId ? cost.lines[postId] : null;
  if (fiken || catalog) {
    const target = fiken || catalog;
    const currentPrice = round2(target.unitPrice) ?? 0;
    const planned = round2(target.planned) ?? 0;
    const addition = round2(target.addition) ?? 0;
    const done = round2(target.done) ?? 0;
    const samePrice = Math.abs(currentPrice - price) < 0.001;
    const empty = planned === 0 && addition === 0 && done === 0;
    if (samePrice || empty) {
      const nextAddition = round2(addition + qty);
      const changes = [change(postId, target.label || name, "addition", addition, nextAddition, target.unit || unit)];
      target.addition = nextAddition;
      if (empty && Math.abs(currentPrice - price) >= 0.001) {
        changes.push(change(postId, target.label || name, "unitPrice", currentPrice, price, "kr"));
        target.unitPrice = price;
      }
      if (fiken) fiken.manual = true;
      return { ok: true, already: false, cost, changes, appliedAs: "linje" };
    }
    cost.extras.push({
      id: extraId,
      description: name,
      unitPrice: price,
      quantity: qty,
      postId: postId.slice(0, 39),
    });
    const changes = [change(extraId, name, "quantity", 0, qty, "stk")];
    if (price > 0) changes.push(change(extraId, name, "unitPrice", 0, price, "kr"));
    return { ok: true, already: false, cost, changes, appliedAs: "tillegg" };
  }
  cost.fikenLines.push({
    id: lineId,
    label: name,
    unit,
    planned: qty,
    done: 0,
    unitPrice: price,
    source: "Fra ønsket",
    manual: true,
  });
  const changes = [change(lineId, name, "planned", 0, qty, unit)];
  if (price > 0) changes.push(change(lineId, name, "unitPrice", 0, price, "kr"));
  return { ok: true, already: false, cost, changes, appliedAs: "ny" };
}

module.exports = { applyApprovedRequest };
