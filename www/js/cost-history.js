import { changeText, formatQty, signedKr } from "./cost.js";
import { toDate } from "./logic.js";
import {
  alternativePriceText,
  alternativeTotals,
  chosenAlternative,
  formatKr,
  isOfferItem,
  offerStatus,
  offerTypeLabel,
} from "./offers.js";

const OSLO = "Europe/Oslo";
// Kort vindu: feilslag som rettes med en gang (f.eks. 7 100 → 142 000 → 7 100)
// vises ikke som to prisendringer. Hele loggen ligger likevel under «Vis alle detaljer».
const GROUP_WINDOW_MS = 10 * 60 * 1000;

function round2(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.round(number * 100) / 100;
}

function same(left, right) {
  if (left == null || right == null) return false;
  return Math.abs(left - right) < 0.001;
}

const UNIT_WORDS = {
  meter: "meter",
  m: "meter",
  stk: "stk",
  m2: "m²",
  "m²": "m²",
  m3: "m³",
  "m³": "m³",
  time: "timer",
  timer: "timer",
  tur: "turer",
  rs: "RS",
};

export function unitWord(label, fallback = "") {
  const match = String(label || "").match(/\(([^)]+)\)\s*$/);
  const hint = match ? match[1].trim().toLowerCase() : "";
  if (UNIT_WORDS[hint]) return UNIT_WORDS[hint];
  const logged = String(fallback || "").trim().toLowerCase();
  if (!logged || logged === "kr") return hint && hint !== "kr" ? match[1].trim() : "";
  if (UNIT_WORDS[logged]) return UNIT_WORDS[logged];
  return String(fallback || "").trim();
}

export function factsText(facts) {
  const parts = [`Planlagt: ${formatQty(facts.originalQty)}`];
  if (facts.changed) parts.push(`Endret til: ${formatQty(facts.agreedQty)}`);
  if (facts.doneQty != null) parts.push(`Utført: ${formatQty(facts.doneQty)}`);
  return parts.join(" · ");
}

export function customerPostSummary(label, facts) {
  return `${label} — ${factsText(facts)}`;
}

function osloParts(time, options) {
  return new Intl.DateTimeFormat("nb-NO", { ...options, timeZone: OSLO }).format(new Date(time));
}

function dayHeading(time) {
  if (time == null) return "Uten dato";
  return osloParts(time, { day: "2-digit", month: "short", year: "numeric" });
}

function clockText(time) {
  if (time == null) return "";
  return osloParts(time, { hour: "2-digit", minute: "2-digit" });
}

function shortDay(time, now) {
  if (time == null) return "";
  const year = osloParts(time, { year: "numeric" });
  const nowYear = osloParts(now.getTime(), { year: "numeric" });
  const options = { day: "numeric", month: "short" };
  if (year !== nowYear) options.year = "numeric";
  return osloParts(time, options);
}

function whenStamp(value) {
  const date = toDate(value);
  return date ? date.getTime() : null;
}

function formatWhenOslo(value) {
  const time = whenStamp(value);
  if (time == null) return "";
  return `${dayHeading(time)}, ${clockText(time)}`;
}

function actorOf(name) {
  const label = String(name || "Einar").trim() || "Einar";
  if (/^einar$/i.test(label)) return { actor: "einar", actorLabel: "Einar" };
  return { actor: "kunde", actorLabel: label };
}

function measured(entry, index) {
  const from = round2(entry?.from);
  const to = round2(entry?.to);
  if (from == null || to == null) return null;
  return {
    index,
    time: whenStamp(entry.at),
    from,
    to,
    byName: String(entry.byName || "Einar").trim() || "Einar",
    entry,
  };
}

function clusterItems(items) {
  const sorted = [...items].sort((left, right) => {
    if (left.time == null && right.time == null) return left.index - right.index;
    if (left.time == null) return 1;
    if (right.time == null) return -1;
    return left.time - right.time || left.index - right.index;
  });
  const groups = [];
  for (const item of sorted) {
    const last = groups[groups.length - 1];
    const join = last && item.time != null && last.end != null && item.time - last.end <= GROUP_WINDOW_MS;
    if (!join) groups.push({ end: item.time, items: [item] });
    else {
      last.items.push(item);
      last.end = item.time;
    }
  }
  return groups;
}

function netGroup(group) {
  const items = group.items;
  let consistent = true;
  for (let i = 1; i < items.length; i += 1) {
    if (!same(items[i - 1].to, items[i].from)) consistent = false;
  }
  return {
    consistent,
    from: items[0].from,
    to: items[items.length - 1].to,
    time: items[items.length - 1].time ?? items[0].time,
    byName: items[items.length - 1].byName,
    items,
  };
}

function netsOf(entries) {
  const items = [];
  entries.forEach((entry, index) => {
    const item = measured(entry, index);
    if (item) items.push(item);
  });
  const nets = [];
  for (const group of clusterItems(items)) {
    const net = netGroup(group);
    if (!net.consistent) {
      for (const item of net.items) {
        if (!same(item.from, item.to)) {
          nets.push({ from: item.from, to: item.to, time: item.time, byName: item.byName });
        }
      }
      continue;
    }
    if (!same(net.from, net.to)) nets.push(net);
  }
  return nets;
}

function priceAtFactory(entries, currentPrice) {
  const items = [];
  entries.forEach((entry, index) => {
    const item = measured(entry, index);
    if (item) items.push(item);
  });
  const nets = clusterItems(items).map(netGroup);
  if (nets.some((net) => !net.consistent)) return () => null;
  const lasting = nets.filter((net) => !same(net.from, net.to));
  if (!lasting.length) {
    if (nets.length) {
      const stable = nets[nets.length - 1].to;
      return () => stable;
    }
    if (currentPrice == null || currentPrice === "") return () => null;
    return () => round2(currentPrice);
  }
  return (time) => {
    const at = time ?? Number.POSITIVE_INFINITY;
    if (lasting[0].time != null && at < lasting[0].time) return lasting[0].from;
    let value = lasting[0].from;
    for (const net of lasting) {
      if (net.time == null || net.time <= at) value = net.to;
    }
    return value;
  };
}

function qtyAt(nets, time, fallback) {
  if (!nets.length) return fallback;
  const at = time ?? Number.POSITIVE_INFINITY;
  if (nets[0].time != null && at < nets[0].time) return nets[0].from;
  let value = nets[0].from;
  for (const net of nets) {
    if (net.time == null || net.time <= at) value = net.to;
  }
  return value;
}

function moneyText(amount) {
  if (amount == null || same(amount, 0)) return "";
  return ` (${signedKr(amount)} eks. mva)`;
}

export function tilleggText({ delta, unit, dateText, money }) {
  const sign = delta > 0 ? "+" : "−";
  const amount = formatQty(Math.abs(delta));
  const unitBit = unit ? ` ${unit}` : "";
  const when = dateText ? ` avtalt ${dateText}` : " avtalt";
  return `Tillegg: ${sign}${amount}${unitBit}${when}${moneyText(money)}`;
}

function eventShell(net, section, icon, title, lines) {
  const who = actorOf(net?.byName);
  const time = net?.time ?? null;
  const clock = clockText(time);
  return {
    section,
    time,
    day: dayHeading(time),
    icon,
    title,
    lines: lines.filter(Boolean),
    whenText: clock ? `${dayHeading(time)} kl. ${clock}` : dayHeading(time),
    ...who,
    money: null,
  };
}

function analyzeLine(line, entries, now) {
  const plannedEntries = entries.filter((entry) => entry.field === "planned");
  const additionEntries = entries.filter((entry) => entry.field === "addition");
  const doneEntries = entries.filter((entry) => entry.field === "done");
  const priceEntries = entries.filter((entry) => entry.field === "unitPrice");
  const plannedNets = netsOf(plannedEntries);
  const additionNets = netsOf(additionEntries);
  const doneNets = netsOf(doneEntries);
  const priceAt = priceAtFactory(priceEntries, line.unitPrice);
  const unit = unitWord(line.label, line.unit) || "stk";
  const original = round2(line.planned) ?? 0;
  const storedAddition = round2(line.addition) ?? 0;
  const agreed = round2(original + storedAddition);
  const doneQty = round2(line.done) ?? 0;
  const tillegg = additionNets.map((net) => {
    const delta = round2(net.to - net.from);
    const price = priceAt(net.time);
    const money = price == null || delta == null ? null : round2(delta * price);
    return {
      delta,
      money,
      time: net.time,
      text: tilleggText({
        delta,
        unit,
        dateText: shortDay(net.time, now),
        money,
      }),
    };
  });
  const facts = {
    lineId: line.id,
    label: line.label,
    originalQty: original,
    agreedQty: agreed,
    doneQty,
    changed: !same(storedAddition, 0),
    unit,
    tillegg,
  };
  const events = [];
  let created = null;
  for (const net of plannedNets) {
    if (same(net.from, 0)) {
      created = net;
      const price = priceAt(net.time);
      const qty = formatQty(net.to);
      const unitBit = unit ? ` ${unit}` : "";
      const createdLine = price != null && !same(price, 0)
        ? `Lagt inn i tilbudet, ${qty}${unitBit} à ${formatKr(price)}. Det utgjør ${formatKr(round2(net.to * price))} eks. mva.`
        : `Lagt inn i tilbudet, ${qty}${unitBit}.`;
      events.push(eventShell(net, "tilbud", "plus", customerPostSummary(line.label, {
        originalQty: net.to,
        agreedQty: net.to,
        doneQty: null,
        changed: false,
      }), [createdLine]));
      continue;
    }
    const unitBit = unit ? ` ${unit}` : "";
    events.push(eventShell(net, "tilbud", "edit", line.label, [
      `Planlagt endret fra ${formatQty(net.from)} til ${formatQty(net.to)}${unitBit}.`,
    ]));
  }
  for (const net of additionNets) {
    const row = tillegg.find((item) => item.time === net.time && same(item.delta, round2(net.to - net.from)));
    const plannedThen = qtyAt(plannedNets, net.time, original);
    const agreedThen = round2((plannedThen ?? original) + net.to);
    events.push({
      ...eventShell(net, "tilbud", "plus", customerPostSummary(line.label, {
        originalQty: plannedThen ?? original,
        agreedQty: agreedThen,
        doneQty: null,
        changed: !same(net.to, 0),
      }), [row?.text || ""]),
      money: row?.money ?? null,
      kind: "tillegg",
    });
  }
  const lastingPrices = netsOf(priceEntries);
  for (const net of lastingPrices) {
    const withCreation = created && same(net.from, 0) && created.time != null && net.time != null
      && Math.abs(net.time - created.time) <= GROUP_WINDOW_MS;
    if (withCreation) continue;
    const beforeQty = qtyAt(plannedNets, net.time, original);
    const delta = round2(net.to - net.from);
    const effect = beforeQty == null || delta == null ? null : round2(beforeQty * delta);
    const effectLine = effect != null && !same(effect, 0)
      ? `Det er ${signedKr(effect)} eks. mva på tilbudet.`
      : "";
    events.push(eventShell(net, "tilbud", "edit", line.label, [
      `Pris endret fra ${formatKr(net.from)} til ${formatKr(net.to)}.`,
      effectLine,
    ]));
  }
  for (const entry of entries.filter((item) => item.field === "final")) {
    const on = Number(entry.to) === 1;
    const sentence = String(entry.text || "").trim() || (on
      ? "Posten er ferdig, endelig pris er satt."
      : "Posten er åpnet igjen. Prisen er estimert.");
    events.push(eventShell({
      time: whenStamp(entry.at),
      byName: entry.byName,
    }, "tilbud", on ? "check" : "edit", line.label, [sentence]));
  }
  for (const net of doneNets) {
    const plannedThen = qtyAt(plannedNets, net.time, original) ?? original;
    const additionThen = qtyAt(additionNets, net.time, storedAddition) ?? storedAddition;
    const agreedThen = round2(plannedThen + additionThen);
    const price = priceAt(net.time);
    const delta = round2(net.to - net.from);
    const effect = price == null || delta == null ? null : round2(delta * price);
    const unitBit = unit ? ` ${unit}` : "";
    const ofPlanned = `Utført ${formatQty(net.to)} av ${formatQty(agreedThen)}${unitBit}.`;
    const fromLine = `Fra ${formatQty(net.from)} til ${formatQty(net.to)}${unitBit}.`;
    const paid = effect != null && !same(effect, 0) ? `Påløpt: ${signedKr(effect)} eks. mva.` : "";
    events.push(eventShell(net, "utfort", "check", customerPostSummary(line.label, {
      originalQty: plannedThen,
      agreedQty: agreedThen,
      doneQty: net.to,
      changed: !same(additionThen, 0),
    }), [ofPlanned, fromLine, paid]));
  }
  return { facts, events };
}

function kindWord(kind) {
  if (kind === "endring") return "endringen";
  if (kind === "tillegg") return "tillegget";
  return "tilbudet";
}

function offerEvents(item, audience, now) {
  if (!isOfferItem(item) || item.fikenBase === true || item.approved === false) return [];
  const status = offerStatus(item);
  if (audience === "kunde" && status === "utkast") return [];
  const name = item.title || offerTypeLabel(item.kind);
  const quoted = `«${name}»`;
  const word = kindWord(item.kind);
  if (status === "utkast") {
    return [eventShell({
      time: whenStamp(item.createdAt),
      byName: "Einar",
    }, "tilbud", "file", "Utkastet er ikke sendt", [
      `${quoted} er ikke sendt til kunden ennå.`,
    ])];
  }
  const events = [eventShell({
    time: whenStamp(item.createdAt),
    byName: "Einar",
  }, "tilbud", "share", word === "tilbudet" ? "Tilbudet ble sendt" : word === "endringen" ? "Endringen ble sendt" : "Tillegget ble sendt", [
    `Einar sendte ${word} ${quoted} ${audience === "kunde" ? "til deg" : "til kunden"}.`,
  ])];
  if (status !== "godkjent" && status !== "avslatt") return events;
  const who = audience === "kunde" ? "Du" : (String(item.approvedByName || "").trim() || "Kunden");
  const date = shortDay(whenStamp(item.approvedAt), now);
  const verb = status === "godkjent" ? "godkjente" : "avslo";
  const title = date ? `${who} ${verb} ${word} ${date}.` : `${who} ${verb} ${word}.`;
  const lines = [];
  let money = null;
  if (status === "godkjent") {
    const alternative = chosenAlternative(item);
    if (alternative) {
      money = alternativeTotals(alternative).exVat;
      if (item.kind === "endring") lines.push(`Endring lagt til: ${name}. ${alternative.name || "Valgt løsning"}.`);
      else lines.push(`Valgt løsning: ${alternative.name || "Valgt løsning"}. ${alternativePriceText(alternative)}.`);
      lines.push(same(money, 0) ? "kr 0,00, inkludert. Prisen øker ikke." : `(${signedKr(money)} eks. mva)`);
    } else {
      lines.push("Godkjent. Beløpet står ikke på posten, så det legges ikke til en sum.");
    }
  } else {
    lines.push("Prisen ble ikke endret.");
    money = 0;
  }
  events.push({
    ...eventShell({ time: whenStamp(item.approvedAt) ?? whenStamp(item.createdAt), byName: who }, "tilbud", status === "godkjent" ? "check" : "alert", title, lines),
    actor: "kunde",
    actorLabel: who,
    money,
    kind: status === "godkjent" ? "godkjent" : "avslatt",
  });
  return events;
}

function agreedEvents(entries) {
  return netsOf(entries.filter((entry) => entry.field === "agreedExVat")).map((net) => {
    const delta = round2(net.to - net.from);
    return eventShell(net, "tilbud", "edit", "Avtalt pris", [
      `Avtalt pris endret fra ${formatKr(net.from)} til ${formatKr(net.to)}.`,
      delta != null && !same(delta, 0) ? `Det er ${signedKr(delta)} eks. mva.` : "",
      `Avtalt pris er nå ${formatKr(net.to)} eks. mva.`,
    ]);
  });
}

export function extraTilleggText(extra, entries = [], now = new Date()) {
  const name = String(extra?.description || "").trim() || "Tillegg";
  const qty = round2(extra?.quantity) ?? 0;
  const price = round2(extra?.unitPrice) ?? 0;
  const sum = round2(extra?.sum != null ? extra.sum : qty * price) ?? 0;
  const nets = netsOf(entries.filter((entry) => entry.lineId === extra?.id && entry.field === "quantity"));
  const last = nets.length ? nets[nets.length - 1] : null;
  const dated = last && same(last.to, qty) ? shortDay(last.time, now) : "";
  const qtyBit = last && dated && same(last.from, 0) ? `+${formatQty(qty)} stk` : `${formatQty(qty)} stk`;
  const when = dated ? ` avtalt ${dated}` : "";
  return `Tillegg: ${name}, ${qtyBit}${when}${moneyText(sum)}`;
}

function detailLine(entry) {
  const when = formatWhenOslo(entry.at) || String(entry.when || "");
  const who = String(entry.byName || "Einar").trim() || "Einar";
  const text = String(entry.text || "").trim() || (entry.field ? changeText(entry) : "");
  return [when, who, text].filter(Boolean).join(" · ");
}

function sortEvents(events) {
  return [...events].sort((left, right) => {
    if (left.time == null && right.time == null) return 0;
    if (left.time == null) return 1;
    if (right.time == null) return -1;
    return right.time - left.time;
  });
}

function addRunningSums(events) {
  const ordered = [...events].sort((left, right) => (left.time ?? 0) - (right.time ?? 0));
  let tilleggSum = 0;
  let tilleggKnown = true;
  let approvedSum = 0;
  let approvedKnown = true;
  for (const event of ordered) {
    if (event.kind === "tillegg") {
      if (event.money == null) tilleggKnown = false;
      else tilleggSum = round2(tilleggSum + event.money);
      if (tilleggKnown) {
        event.lines.push(`Sum av avtalte mengdeendringer etter dette: ${formatKr(tilleggSum)} eks. mva.`);
      }
    }
    if (event.kind === "godkjent") {
      if (event.money == null) approvedKnown = false;
      else approvedSum = round2(approvedSum + event.money);
      if (approvedKnown) {
        event.lines.push(`Sum godkjente poster er nå ${formatKr(approvedSum)} eks. mva.`);
      }
    }
  }
}

export function buildCustomerHistory({
  entries = [],
  lines = [],
  items = [],
  extras = [],
  audience = "kunde",
  now = new Date(),
} = {}) {
  const list = (entries || []).map((entry, index) => ({ ...entry, index }));
  const byLine = new Map();
  for (const entry of list) {
    const id = String(entry.lineId || "");
    if (!id) continue;
    const bucket = byLine.get(id) || [];
    bucket.push(entry);
    byLine.set(id, bucket);
  }
  const known = new Set((lines || []).map((line) => line.id));
  const extraIds = new Set((extras || []).map((extra) => extra.id));
  const posts = {};
  const events = [];
  for (const line of lines || []) {
    const analyzed = analyzeLine(line, byLine.get(line.id) || [], now);
    posts[line.id] = analyzed.facts;
    events.push(...analyzed.events);
  }
  for (const [id, bucket] of byLine) {
    if (known.has(id) || extraIds.has(id) || id === "avtalt") continue;
    const sample = bucket.find((entry) => entry.label) || bucket[0];
    const planned = netsOf(bucket.filter((entry) => entry.field === "planned"));
    const done = netsOf(bucket.filter((entry) => entry.field === "done"));
    const orphan = {
      id,
      label: sample?.label || "Post",
      unit: sample?.unit || "",
      planned: planned.length ? planned[planned.length - 1].to : 0,
      done: done.length ? done[done.length - 1].to : 0,
      unitPrice: null,
    };
    const analyzed = analyzeLine(orphan, bucket, now);
    events.push(...analyzed.events);
  }
  events.push(...agreedEvents(list));
  for (const extra of extras || []) {
    const bucket = byLine.get(extra.id) || [];
    const quantity = netsOf(bucket.filter((entry) => entry.field === "quantity"));
    for (const net of quantity) {
      const priceEntry = priceAtFactory(bucket.filter((entry) => entry.field === "unitPrice"), extra.unitPrice);
      const price = priceEntry(net.time);
      const delta = round2(net.to - net.from);
      const money = price == null || delta == null ? null : round2(delta * price);
      const text = tilleggText({
        delta,
        unit: "stk",
        dateText: shortDay(net.time, now),
        money,
      });
      const parent = (lines || []).find((line) => line.id === extra.postId);
      events.push({
        ...eventShell(net, "tilbud", "plus", parent?.label || "Andre tillegg", [
          text,
        ]),
        money,
        kind: "tillegg",
      });
    }
  }
  for (const item of items || []) events.push(...offerEvents(item, audience, now));
  for (const entry of list) {
    if (entry.field) continue;
    if (!entry.text) continue;
    events.push(eventShell({
      time: whenStamp(entry.at),
      byName: entry.byName,
    }, "tilbud", "file", "Endring i oversikten", [entry.text]));
  }
  addRunningSums(events);
  const details = [...list].sort((left, right) => {
    const a = whenStamp(left.at);
    const b = whenStamp(right.at);
    if (a == null && b == null) return right.index - left.index;
    if (a == null) return 1;
    if (b == null) return -1;
    return b - a;
  }).map(detailLine);
  const sorted = sortEvents(events);
  return {
    posts,
    tilbud: sorted.filter((event) => event.section === "tilbud"),
    utfort: sorted.filter((event) => event.section === "utfort"),
    details,
  };
}
