import test from "node:test";
import assert from "node:assert/strict";
import { mapFikenOffers, mapFikenQuotes, mapFikenSales } from "../functions/fiken-offers.js";
import { fikenQuoteFacts, fikenQuoteRecord, mergeFikenLines, quotesFromFikenResult } from "../www/js/fiken-offers.js";
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

test("Fiken-tilbudet blir en lesbar kopi med tekst, kunde og PDF, ikke et Standard-valg", () => {
  const source = {
    offerId: 5,
    offerNumber: 10001,
    offerDraftUuid: "abc",
    date: "2026-04-02",
    accepted: "2026-04-10",
    projectId: 42,
    contactId: 7,
    contactPersonId: 3,
    comment: "Tilbudet gjelder nordvegg.",
    ourReference: "Einar",
    yourReference: "Kari",
    orderReference: "Bestilling 12",
    net: 1275000,
    vat: 318750,
    gross: 1593750,
    discount: 5000,
    address: { streetAddress: "Kaigaten 1", postCode: "5528", city: "Haugesund" },
    lines: [
      { description: "Graving av grøft", comment: "Inkludert bortkjøring", quantity: 12.5, unitPrice: 100000, net: 1250000 },
      { productName: "Kum", quantity: 2, net: 25000 },
    ],
  };
  const draft = {
    uuid: "abc",
    invoiceText: "Hei Kari.\nDette er tilbudet.",
    daysUntilDueDate: 14,
    ourReference: "Skal ikke overstyre",
    attachments: [
      { filename: "intern.pdf", downloadUrl: "https://api.fiken.no/secret.pdf" },
      {
        filename: "tilbud-10001.pdf",
        downloadUrl: "https://api.fiken.no/files/tilbud.pdf",
        downloadUrlWithFikenNormalUserCredentials: "https://fiken.no/logg-inn/tilbud-10001.pdf",
      },
    ],
  };
  const contact = {
    name: "Kari Nordmann",
    email: "kari@example.com",
    organizationNumber: "999888777",
    phoneNumber: "90000000",
    contactPerson: [{ contactPersonId: 3, name: "Kari", email: "kari@example.com", phoneNumber: "90000000" }],
  };
  const [quote] = mapFikenQuotes({
    offers: [source, { ...source, offerId: 8, projectId: 99, offerDraftUuid: "annet" }],
    drafts: [draft],
    contacts: { 7: contact },
    projectId: 42,
    contactId: 7,
  });
  assert.equal(quote.key, "ft-5");
  assert.equal(quote.number, "10001");
  assert.equal(quote.customerName, "Kari Nordmann");
  assert.equal(quote.customerPhone, "90000000");
  assert.equal(quote.address, "Kaigaten 1, 5528 Haugesund");
  assert.equal(quote.ourReference, "Einar");
  assert.equal(quote.yourReference, "Kari");
  assert.equal(quote.orderReference, "Bestilling 12");
  assert.equal(quote.invoiceText, "Hei Kari.\nDette er tilbudet.");
  assert.equal(quote.comment, "Tilbudet gjelder nordvegg.");
  assert.equal(quote.validUntil, "2026-04-16");
  assert.equal(quote.daysUntilDueDate, 14);
  assert.equal(quote.exVat, 12750);
  assert.equal(quote.vat, 3187.5);
  assert.equal(quote.incVat, 15937.5);
  assert.equal(quote.discount, 50);
  assert.equal(quote.lines[0].description, "Graving av grøft");
  assert.equal(quote.lines[0].comment, "Inkludert bortkjøring");
  assert.equal(quote.lines[1].description, "Kum");
  assert.equal(quote.pdfUrl, "https://fiken.no/logg-inn/tilbud-10001.pdf");
  assert.equal(quote.pdfUrl.includes("api.fiken.no"), false);
  const facts = fikenQuoteFacts(quote);
  assert.equal(facts.find((row) => row.label === "Tilbudsnr").value, "10001");
  assert.equal(facts.find((row) => row.label === "Dato").value, "02.04.2026");
  assert.equal(facts.find((row) => row.label === "Gyldig til").value, "16.04.2026");
  assert.equal(facts.find((row) => row.label === "Akseptert").value, "10.04.2026");
  const stored = fikenQuoteRecord(quote);
  assert.equal(stored.key, "ft-5");
  assert.equal(stored.invoiceText.includes("\n"), true);
  assert.equal(stored.pdfUrl.startsWith("https://"), true);
  const fromOld = quotesFromFikenResult({
    offers: [{ key: "ft-5", kind: "tilbud", number: "10001" }, { key: "fo-9", kind: "ordre" }],
  });
  assert.deepEqual(fromOld.map((doc) => doc.key), ["ft-5"]);
  const summary = liveCost({
    cost: { agreedExVat: 0, fikenLines: mapFikenSales({ offers: [source], confirmations: [], projectId: 42, contactId: 7 }) },
    prices: {},
    items: [{ id: "gammel", kind: "tilbud", fikenBase: true, approved: true, approvalRequested: true, approvalStatus: "godkjent", selectedAlternativeId: "standard", alternatives: [{ id: "standard", name: "Standard", priceExVat: 12750 }] }],
  });
  assert.equal(summary.estimated.exVat, 12750);
  assert.equal(summary.offers.rows.length, 0);
});

test("kunden ser kostnad bare når flagget er skrudd på", () => {
  assert.equal(customerSeesCost({}), false);
  assert.equal(customerSeesCost({ showCostToCustomer: false }), false);
  assert.equal(customerSeesCost({ showCostToCustomer: "true" }), false);
  assert.equal(customerSeesCost({ showCostToCustomer: true }), true);
});
