import test from "node:test";
import assert from "node:assert/strict";
import { mapFikenSales } from "../functions/fiken-offers.js";
import { mergeFikenLines } from "../www/js/fiken-offers.js";
import { customerSeesCost, liveCost, patchCost } from "../www/js/cost.js";

const offers = [
  {
    offerId: 5,
    offerNumber: 10001,
    date: "2026-04-02",
    projectId: 42,
    contactId: 7,
    lines: [
      { description: "Graving av grøft", quantity: 12.5, unitPrice: 100000 },
      { productName: "Kum", quantity: 2, net: 25000 },
    ],
  },
  {
    offerId: 8,
    offerNumber: 10002,
    projectId: 99,
    contactId: 7,
    lines: [{ description: "Annet prosjekt", quantity: 1, unitPrice: 100 }],
  },
  {
    offerId: 3,
    offerNumber: 10000,
    date: "2026-03-01",
    contactId: 7,
    archived: true,
    lines: [{ description: "Arkivert", quantity: 1, unitPrice: 100 }],
  },
  {
    offerId: 4,
    offerNumber: 999,
    date: "2026-01-01",
    contactId: 7,
    lines: [{ description: "Befaring", quantity: 1, unitPrice: 150000 }],
  },
];

const confirmations = [
  {
    confirmationId: 9,
    confirmationNumber: 44,
    projectId: 42,
    lines: [{ description: "Ordre kum", quantity: 1, unitPrice: 450000 }],
  },
];

test("Fiken-tilbud blir kostnadslinjer med beskrivelse, mengde og pris eks. mva", () => {
  const lines = mapFikenSales({ offers, confirmations, projectId: 42, contactId: 7 });
  assert.deepEqual(lines.map((line) => line.label), ["Befaring", "Graving av grøft", "Kum", "Ordre kum"]);
  const graving = lines[1];
  assert.equal(graving.id, "ft-5-0");
  assert.equal(graving.planned, 12.5);
  assert.equal(graving.unitPrice, 1000);
  assert.equal(graving.done, 0);
  assert.equal(graving.source, "fra Fiken-tilbud nr 10001");
  assert.equal(lines[2].unitPrice, 125);
  assert.equal(lines[2].source, "fra Fiken-tilbud nr 10001");
  assert.equal(lines[0].source, "fra Fiken-tilbud nr 999");
  assert.equal(lines[3].source, "fra Fiken-ordrebekreftelse nr 44");
  assert.equal(lines.some((line) => line.label === "Annet prosjekt" || line.label === "Arkivert"), false);
});

test("ny henting overskriver ikke linjer Einar har endret", () => {
  const incoming = mapFikenSales({
    offers: [offers[0]],
    confirmations: [],
    projectId: 42,
    contactId: 7,
  });
  const existing = [
    { ...incoming[0], planned: 10, done: 4, manual: true },
    { id: "ft-gammel", label: "Ekstra", unit: "stk", planned: 1, done: 0, unitPrice: 50, source: "fra Fiken-tilbud nr 1", manual: false },
  ];
  const kept = mergeFikenLines(existing, incoming, { overwriteManual: false });
  assert.equal(kept.conflicts.length, 1);
  assert.equal(kept.lines.find((line) => line.id === "ft-5-0").planned, 10);
  assert.equal(kept.lines.find((line) => line.id === "ft-5-0").done, 4);
  assert.equal(kept.lines.find((line) => line.id === "ft-5-1").label, "Kum");
  const replaced = mergeFikenLines(existing, incoming, { overwriteManual: true });
  assert.equal(replaced.conflicts.length, 0);
  assert.equal(replaced.lines.find((line) => line.id === "ft-5-0").planned, 12.5);
  assert.equal(replaced.lines.find((line) => line.id === "ft-5-0").done, 4);
  assert.equal(replaced.lines.find((line) => line.id === "ft-5-0").manual, false);
});

test("kostnadslinje fra Fiken inngår i estimatet, og endring merkes som manuell", () => {
  const cost = {
    agreedExVat: 0,
    fikenLines: [{
      id: "ft-5-0",
      label: "Graving av grøft",
      unit: "stk",
      planned: 12.5,
      done: 0,
      unitPrice: 1000,
      source: "fra Fiken-tilbud nr 10001",
      manual: false,
    }],
  };
  const summary = liveCost({ cost, prices: {}, items: [] });
  const line = summary.lines.find((entry) => entry.id === "ft-5-0");
  assert.equal(line.source, "fra Fiken-tilbud nr 10001");
  assert.equal(line.plannedSum, 12500);
  assert.equal(summary.estimated.exVat, 12500);
  const edited = patchCost(cost, {}, { lineId: "ft-5-0", field: "done", value: 3 });
  assert.equal(edited.fikenLines[0].done, 3);
  assert.equal(edited.fikenLines[0].manual, true);
  assert.equal(edited.fikenLines[0].unitPrice, 1000);
});

test("kunden ser kostnad bare når flagget er skrudd på", () => {
  assert.equal(customerSeesCost({}), false);
  assert.equal(customerSeesCost({ showCostToCustomer: false }), false);
  assert.equal(customerSeesCost({ showCostToCustomer: "true" }), false);
  assert.equal(customerSeesCost({ showCostToCustomer: true }), true);
});
