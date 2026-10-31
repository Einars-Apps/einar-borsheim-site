import test from "node:test";
import assert from "node:assert/strict";
import { signedKr } from "../www/js/cost.js";
import { formatKr } from "../www/js/offers.js";
import {
  buildCustomerHistory,
  customerPostSummary,
  extraTilleggText,
  factsText,
} from "../www/js/cost-history.js";
import { liveCost, patchCost, persistableCost } from "../www/js/cost.js";

const now = new Date("2026-10-31T12:00:00Z");

function at(iso) {
  return { seconds: Math.floor(Date.parse(iso) / 1000) };
}

function entry(partial) {
  return {
    byName: "Einar",
    unit: "stk",
    text: "",
    ...partial,
  };
}

test("posten viser Planlagt, Endret til og Utført, og tillegget er mengden ganger enhetspris", () => {
  const history = buildCustomerHistory({
    now,
    lines: [{
      id: "dren",
      label: "Drenering (meter)",
      unit: "stk",
      planned: 26,
      addition: 9,
      done: 20,
      unitPrice: 180,
    }],
    entries: [
      entry({
        at: at("2026-10-31T00:43:00Z"),
        lineId: "dren",
        label: "Drenering (meter)",
        field: "addition",
        from: 0,
        to: 9,
        text: "Drenering (meter), avtalt tillegg: 0 → 9 stk",
      }),
      entry({
        at: at("2026-10-31T00:43:00Z"),
        lineId: "dren",
        label: "Drenering (meter)",
        field: "done",
        from: 0,
        to: 20,
        text: "Drenering (meter), utført: 0 → 20 stk",
      }),
    ],
  });
  const facts = history.posts.dren;
  assert.equal(customerPostSummary(facts.label, facts), "Drenering (meter) — Planlagt: 26 · Endret til: 35 · Utført: 20");
  assert.equal(factsText(facts), "Planlagt: 26 · Endret til: 35 · Utført: 20");
  assert.equal(facts.tillegg.length, 1);
  assert.equal(facts.tillegg[0].delta, 9);
  assert.equal(facts.tillegg[0].money, 1620);
  assert.equal(facts.tillegg[0].text, `Tillegg: +9 meter avtalt 31. okt. (${signedKr(1620)} eks. mva)`);
  const agreed = history.tilbud.find((row) => row.title.includes("Drenering"));
  const done = history.utfort.find((row) => row.title.includes("Drenering"));
  assert.match(agreed.title, /Planlagt: 26/);
  assert.match(agreed.title, /Endret til: 35/);
  assert.match(done.title, /Utført: 20/);
  assert.match(done.title, /Planlagt: 26 · Endret til: 35 · Utført: 20/);
  assert.ok(done.lines.some((line) => line.includes("Utført 20 av 35 meter")));
  assert.equal(history.details.length, 2);
});

test("ny post fra 0 er Planlagt, ikke et tillegg", () => {
  const history = buildCustomerHistory({
    now,
    lines: [{
      id: "bort",
      label: "Bortkjøring av overskuddsmasser (stk)",
      unit: "stk",
      planned: 7,
      done: 2,
      unitPrice: 4500,
    }],
    entries: [
      entry({
        at: at("2026-10-16T15:21:00Z"),
        lineId: "bort",
        label: "Bortkjøring av overskuddsmasser (stk)",
        field: "planned",
        from: 0,
        to: 7,
      }),
      entry({
        at: at("2026-10-16T15:21:00Z"),
        lineId: "bort",
        label: "Bortkjøring av overskuddsmasser (stk)",
        field: "unitPrice",
        from: 0,
        to: 4500,
        unit: "kr",
      }),
      entry({
        at: at("2026-10-31T00:45:00Z"),
        lineId: "bort",
        label: "Bortkjøring av overskuddsmasser (stk)",
        field: "done",
        from: 0,
        to: 2,
      }),
    ],
  });
  const facts = history.posts.bort;
  assert.equal(factsText(facts), "Planlagt: 7 · Utført: 2");
  assert.equal(facts.changed, false);
  assert.equal(facts.tillegg.length, 0);
  const created = history.tilbud.find((row) => row.lines.some((line) => line.startsWith("Lagt inn")));
  assert.ok(created);
  assert.match(created.lines[0], /7 stk/);
  assert.match(created.lines[0], new RegExp(formatKr(4500).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(created.lines[0], new RegExp(formatKr(31500).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(history.tilbud.some((row) => row.lines.some((line) => line.startsWith("Pris endret"))), false);
  const done = history.utfort[0];
  assert.match(done.lines.join(" "), /Påløpt:/);
  assert.match(done.lines.join(" "), /9[\s\u00a0\u202f]*000,00/);
});

test("senere mengdeøkning blir +2 stk og bruker enhetsprisen som ligger på posten", () => {
  const history = buildCustomerHistory({
    now,
    lines: [{
      id: "transport",
      label: "Transport maskin (stk)",
      unit: "stk",
      planned: 1,
      addition: 2,
      done: 1,
      unitPrice: 1500,
    }],
    entries: [
      entry({
        at: at("2026-10-16T15:21:00Z"),
        lineId: "transport",
        label: "Transport maskin (stk)",
        field: "planned",
        from: 0,
        to: 1,
      }),
      entry({
        at: at("2026-10-31T00:43:00Z"),
        lineId: "transport",
        label: "Transport maskin (stk)",
        field: "addition",
        from: 0,
        to: 2,
      }),
    ],
  });
  const facts = history.posts.transport;
  assert.equal(factsText(facts), "Planlagt: 1 · Endret til: 3 · Utført: 1");
  assert.equal(facts.tillegg.length, 1);
  assert.equal(facts.tillegg[0].delta, 2);
  assert.equal(facts.tillegg[0].money, 3000);
  assert.match(facts.tillegg[0].text, /^Tillegg: \+2 stk avtalt 31\. okt\./);
});

test("prisen utelates når enhetspris ikke finnes", () => {
  const history = buildCustomerHistory({
    now,
    lines: [{
      id: "dren",
      label: "Drenering (meter)",
      unit: "m",
      planned: 26,
      addition: 9,
      done: 0,
      unitPrice: null,
    }],
    entries: [
      entry({
        at: at("2026-10-31T00:43:00Z"),
        lineId: "dren",
        label: "Drenering (meter)",
        field: "addition",
        from: 0,
        to: 9,
        unit: "m",
      }),
    ],
  });
  assert.equal(history.posts.dren.tillegg[0].money, null);
  assert.equal(history.posts.dren.tillegg[0].text.includes("kr"), false);
  assert.match(history.posts.dren.tillegg[0].text, /Tillegg: \+9 meter avtalt 31\. okt\./);
});

test("feilslag i pris innen kort tid slås sammen, men blir liggende i detaljene", () => {
  const history = buildCustomerHistory({
    now,
    lines: [{
      id: "masse",
      label: "Masseutskifte grøft under nybygg (RS)",
      unit: "stk",
      planned: 1,
      done: 0.5,
      unitPrice: 7100,
    }],
    entries: [
      entry({
        at: at("2026-10-31T00:44:00Z"),
        lineId: "masse",
        label: "Masseutskifte grøft under nybygg (RS)",
        field: "unitPrice",
        from: 7100,
        to: 142000,
        unit: "kr",
        text: "Masseutskifte grøft under nybygg (RS), enhetspris: 7 100 → 142 000 kr",
      }),
      entry({
        at: at("2026-10-31T00:44:10Z"),
        lineId: "masse",
        label: "Masseutskifte grøft under nybygg (RS)",
        field: "unitPrice",
        from: 142000,
        to: 7100,
        unit: "kr",
        text: "Masseutskifte grøft under nybygg (RS), enhetspris: 142 000 → 7 100 kr",
      }),
      entry({
        at: at("2026-10-31T00:45:00Z"),
        lineId: "masse",
        label: "Masseutskifte grøft under nybygg (RS)",
        field: "done",
        from: 0,
        to: 0.5,
        text: "Masseutskifte grøft under nybygg (RS), utført: 0 → 0,5 stk",
      }),
    ],
  });
  assert.equal(history.tilbud.some((row) => row.lines.some((line) => String(line).includes("142"))), false);
  assert.equal(factsText(history.posts.masse).includes("Endret til"), false);
  const done = history.utfort[0];
  assert.match(done.title, /Utført: 0,5/);
  assert.ok(done.lines.some((line) => line.includes(formatKr(3550)) || line.includes("3")));
  assert.match(done.lines.join("\n"), /Påløpt:/);
  assert.equal(done.lines.some((line) => line.includes("142")), false);
  assert.equal(history.details.length, 3);
  assert.ok(history.details.some((line) => line.includes("142 000")));
  assert.ok(history.details.some((line) => line.includes("7 100")));
});

test("poster som endres samtidig blandes ikke", () => {
  const history = buildCustomerHistory({
    now,
    lines: [
      { id: "a", label: "Skjære asfalt (RS)", unit: "stk", planned: 1, done: 0, unitPrice: 6000 },
      { id: "b", label: "Bortkjøring asfalt (stk)", unit: "stk", planned: 1, done: 0, unitPrice: 5000 },
    ],
    entries: [
      entry({ at: at("2026-10-16T15:21:00Z"), lineId: "a", label: "Skjære asfalt (RS)", field: "planned", from: 0, to: 1 }),
      entry({ at: at("2026-10-16T15:21:00Z"), lineId: "b", label: "Bortkjøring asfalt (stk)", field: "planned", from: 0, to: 1 }),
    ],
  });
  assert.equal(history.tilbud.length, 2);
  assert.ok(history.tilbud.some((row) => row.title.startsWith("Skjære asfalt")));
  assert.ok(history.tilbud.some((row) => row.title.startsWith("Bortkjøring asfalt")));
});

test("gammel logglinje uten felt vises fortsatt", () => {
  const history = buildCustomerHistory({
    now,
    entries: [{
      at: at("2020-01-01T09:00:00Z"),
      byName: "Einar",
      text: "Grøft, utført: 10 → 28,5 m",
    }],
  });
  assert.equal(history.details.length, 1);
  assert.match(history.details[0], /Grøft, utført: 10 → 28,5 m/);
  assert.ok(history.tilbud.some((row) => row.lines.includes("Grøft, utført: 10 → 28,5 m")));
});

test("kunden ser godkjenning i klarspråk, og utkast skjules", () => {
  const item = {
    id: "post1",
    kind: "tilbud",
    title: "Drenering av hagen",
    approved: true,
    approvalRequested: true,
    approvalStatus: "godkjent",
    approvedAt: at("2026-10-12T10:00:00Z"),
    approvedByName: "Kari",
    createdAt: at("2026-10-01T08:00:00Z"),
    selectedAlternativeId: "anbefalt",
    alternatives: [
      { id: "standard", name: "Standard", priceExVat: 0 },
      { id: "anbefalt", name: "Anbefalt løsning", priceExVat: 1000 },
    ],
  };
  const draft = { ...item, id: "draft", title: "Utkast", approvalRequested: false, approvalStatus: "", selectedAlternativeId: "" };
  const history = buildCustomerHistory({ now, items: [item, draft], audience: "kunde" });
  assert.ok(history.tilbud.some((row) => row.title === "Tilbudet ble sendt"));
  assert.ok(history.tilbud.some((row) => row.title.startsWith("Du godkjente tilbudet 12. okt.")));
  assert.equal(history.tilbud.some((row) => row.title.includes("Utkast")), false);
  const approved = history.tilbud.find((row) => row.kind === "godkjent");
  assert.match(approved.lines.join(" "), /Sum godkjente poster er nå/);
  const einar = buildCustomerHistory({ now, items: [draft], audience: "einar" });
  assert.ok(einar.tilbud.some((row) => row.lines.some((line) => line.includes("ikke sendt"))));
});

test("tillegg uten post samles, og kobling endrer ikke prisen", () => {
  const prices = { groftM: 350 };
  let cost = patchCost({}, prices, { addExtra: true, extraId: "ta-en" });
  cost = patchCost(cost, prices, { extraId: "ta-en", field: "description", value: "Ekstra kumlokk" });
  cost = patchCost(cost, prices, { extraId: "ta-en", field: "unitPrice", value: "500" });
  cost = patchCost(cost, prices, { extraId: "ta-en", field: "quantity", value: "2" });
  const before = liveCost({ cost, prices, items: [] }).estimated.exVat;
  cost = patchCost(cost, prices, { extraId: "ta-en", field: "postId", value: "dren" });
  const after = liveCost({ cost, prices, items: [] });
  assert.equal(after.estimated.exVat, before);
  assert.equal(after.extras[0].postId, "dren");
  assert.equal(after.extras[0].sum, 1000);
  const stored = persistableCost(cost);
  assert.equal(stored.extras[0].postId, "dren");
  const cleared = persistableCost(patchCost(cost, prices, { extraId: "ta-en", field: "postId", value: "" }));
  assert.equal(cleared.extras[0].postId, undefined);
  const text = extraTilleggText(after.extras[0], [], now);
  assert.match(text, /^Tillegg: Ekstra kumlokk, 2 stk/);
  assert.match(text, /eks\. mva/);
});

test("gammelt tillegg uten postId leses som før", () => {
  const summary = liveCost({
    cost: { extras: [{ id: "ta-gammel", description: "Ekstra masse", unitPrice: 100, quantity: 3 }] },
    prices: {},
    items: [],
  });
  assert.equal(summary.extras[0].postId, undefined);
  assert.equal(summary.extras[0].sum, 300);
  assert.equal(summary.estimated.exVat, 300);
});
