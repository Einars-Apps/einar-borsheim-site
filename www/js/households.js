import { VAT_RATE } from "./drainage.js";

export const MAX_HOUSEHOLDS = 8;

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function parseShare(value) {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0 || value > 100) return null;
    return Math.round(value * 100) / 100;
  }
  const text = String(value ?? "").trim().replace(/\s/g, "").replace("%", "").replace(",", ".");
  if (!text) return null;
  const number = Number(text);
  if (!Number.isFinite(number) || number < 0 || number > 100) return null;
  return Math.round(number * 100) / 100;
}

export function formatShare(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  return new Intl.NumberFormat("nb-NO", { maximumFractionDigits: 2 }).format(number);
}

export function evenShares(count) {
  const size = Math.floor(Number(count));
  if (!Number.isFinite(size) || size <= 0) return [];
  const total = 10000;
  const base = Math.floor(total / size);
  let rest = total - base * size;
  const units = Array.from({ length: size }, () => base);
  for (let index = 0; index < units.length && rest > 0; index += 1) {
    units[index] += 1;
    rest -= 1;
  }
  return units.map((unit) => unit / 100);
}

export function withEvenShares(households) {
  const shares = evenShares((households || []).length);
  return (households || []).map((row, index) => ({ ...row, share: shares[index] }));
}

export function newHouseholdId() {
  const alphabet = "abcdefghijkmnopqrstuvwxyz23456789";
  const bytes = new Uint8Array(8);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  }
  let out = "h";
  for (let index = 0; index < bytes.length; index += 1) out += alphabet[bytes[index] % alphabet.length];
  return out;
}

export function blankHousehold(index, id = newHouseholdId()) {
  return {
    id,
    name: `Husstand ${index}`,
    contact: "",
    email: "",
    share: 0,
  };
}

export function householdEmailError(email) {
  const mail = String(email || "").trim();
  if (!mail) return "";
  if (mail.length > 200 || !EMAIL_PATTERN.test(mail)) return "E-postadressen ser ikke riktig ut.";
  return "";
}

export function shareSum(households) {
  const units = (households || []).reduce((sum, row) => {
    const share = parseShare(row?.share);
    return sum + (share == null ? 0 : Math.round(share * 100));
  }, 0);
  return units / 100;
}

export function householdShareError(households) {
  const list = households || [];
  if (!list.length) return "";
  if (list.length > MAX_HOUSEHOLDS) return "Du kan ha opptil 8 husstander.";
  for (const row of list) {
    const name = String(row?.name || "").trim();
    if (!name) return "Hver husstand trenger et navn.";
    if (name.length > 80) return "Navnet er for langt.";
    if (String(row?.contact || "").trim().length > 120) return "Kontakten er for lang.";
    const emailError = householdEmailError(row?.email);
    if (emailError) return emailError;
    if (parseShare(row?.share) == null) return "Andelen må være et tall mellom 0 og 100.";
  }
  const units = list.reduce((sum, row) => sum + Math.round(parseShare(row.share) * 100), 0);
  if (units !== 10000) {
    return `Andelene er ${formatShare(units / 100)} %. De må bli 100 %.`;
  }
  return "";
}

export function householdsForSave(list) {
  return (list || []).slice(0, MAX_HOUSEHOLDS).map((row) => {
    const share = parseShare(row?.share);
    const id = String(row?.id || "").trim().slice(0, 40) || newHouseholdId();
    return {
      id,
      name: String(row?.name || "").trim().slice(0, 80),
      contact: String(row?.contact || "").trim().slice(0, 120),
      email: String(row?.email || "").trim().slice(0, 200),
      share: share == null ? 0 : share,
    };
  });
}

export function normalizeHouseholds(value) {
  if (!Array.isArray(value)) return [];
  const rows = [];
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const id = String(row.id || "").trim().slice(0, 40);
    const name = String(row.name || "").trim().slice(0, 80);
    if (!id || !name) continue;
    const share = parseShare(row.share);
    rows.push({
      id,
      name,
      contact: String(row.contact || "").trim().slice(0, 120),
      email: String(row.email || "").trim().slice(0, 200),
      share: share == null ? 0 : share,
    });
    if (rows.length >= MAX_HOUSEHOLDS) break;
  }
  return rows;
}

function toOre(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number * 100);
}

function fromOre(ore) {
  return ore / 100;
}

export function allocateOre(totalOre, weights) {
  const total = Math.round(Number(totalOre) || 0);
  const clean = (weights || []).map((weight) => Math.max(0, Math.round(Number(weight) || 0)));
  const size = clean.length;
  if (!size) return [];
  if (total === 0) return clean.map(() => 0);
  const sum = clean.reduce((acc, weight) => acc + weight, 0);
  const used = sum > 0 ? clean : clean.map(() => 1);
  const usedSum = used.reduce((acc, weight) => acc + weight, 0);
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const exact = used.map((weight) => (abs * weight) / usedSum);
  const floors = exact.map((value) => Math.floor(value));
  let left = abs - floors.reduce((acc, value) => acc + value, 0);
  const order = exact
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac || a.index - b.index);
  const out = floors.slice();
  let guard = 0;
  while (left > 0 && guard < abs + size + 2) {
    out[order[guard % size].index] += 1;
    left -= 1;
    guard += 1;
  }
  return out.map((value) => value * sign);
}

function shareWeights(rows) {
  return rows.map((row) => Math.max(0, Math.round(Number(row.share) * 100)));
}

function countedPaymentOre(payment) {
  if (!payment || payment.status === "sendt") return null;
  const amount = Number(payment.amount);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (payment.vat === "inkl") {
    return { ex: toOre(amount / (1 + VAT_RATE)), inc: toOre(amount) };
  }
  if (payment.vat === "eks") {
    return { ex: toOre(amount), inc: toOre(amount * (1 + VAT_RATE)) };
  }
  return null;
}

export function householdAllocation({
  households = [],
  totalEx = 0,
  totalInc = 0,
  payments = [],
} = {}) {
  const rows = normalizeHouseholds(households);
  if (!rows.length) return null;
  const weights = shareWeights(rows);
  const shareEx = allocateOre(toOre(totalEx), weights);
  const shareInc = allocateOre(toOre(totalInc), weights);
  const paidEx = rows.map(() => 0);
  const paidInc = rows.map(() => 0);
  for (const payment of payments || []) {
    const money = countedPaymentOre(payment);
    if (!money) continue;
    const householdId = String(payment.householdId || "");
    const index = rows.findIndex((row) => row.id === householdId);
    if (index >= 0) {
      paidEx[index] += money.ex;
      paidInc[index] += money.inc;
      continue;
    }
    const partsEx = allocateOre(money.ex, weights);
    const partsInc = allocateOre(money.inc, weights);
    for (let cursor = 0; cursor < rows.length; cursor += 1) {
      paidEx[cursor] += partsEx[cursor];
      paidInc[cursor] += partsInc[cursor];
    }
  }
  return {
    totalEx: fromOre(toOre(totalEx)),
    totalInc: fromOre(toOre(totalInc)),
    rows: rows.map((row, index) => ({
      ...row,
      exVat: fromOre(shareEx[index]),
      incVat: fromOre(shareInc[index]),
      paidEx: fromOre(paidEx[index]),
      paidInc: fromOre(paidInc[index]),
      dueEx: fromOre(shareEx[index] - paidEx[index]),
      dueInc: fromOre(shareInc[index] - paidInc[index]),
    })),
  };
}

export function householdShareText(project, household, url) {
  const who = household?.name ? ` ${household.name}` : "";
  return `Hei${who}! Her kan du følge prosjektet «${project?.name || "oppdraget"}», se rapporten og sende inn bilder og info: ${url}`;
}
