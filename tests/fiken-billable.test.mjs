import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  appendBillableLine,
  billableLine,
  customerIdFromDraft,
  decisionBecameApproved,
  invoiceDraftBody,
  isBillableOffer,
  itemMarker,
  projectDescription,
  projectName,
  projectNumber,
  statusText,
} from "../functions/fiken-billable.js";

const item = {
  kind: "endring",
  title: "Ny kum",
  approvalStatus: "godkjent",
  selectedAlternativeId: "anbefalt",
  approvedByName: "Kari Nordmann",
  alternatives: [{
    id: "anbefalt",
    name: "Anbefalt løsning",
    description: "Ekstra kum ved innkjørselen.",
    priceExVat: 2700,
  }],
};

function line(overrides = {}) {
  return billableLine({
    item,
    itemId: "item123abc",
    projectId: "proj456def",
    incomeAccount: "3000",
    approvedAt: new Date("2026-10-10T17:11:00Z"),
    ...overrides,
  });
}

test("fakturerbar linje har forklaring, pris i øre og markør innenfor 200 tegn", () => {
  const result = line();
  assert.ok(result.description.length <= 200);
  assert.ok(result.comment.length <= 200);
  assert.match(result.description, /^Endring: Ny kum – Anbefalt løsning/);
  assert.match(result.description, /Ekstra kum/);
  assert.equal(result.comment.startsWith(itemMarker("item123abc")), true);
  assert.match(result.comment, /Internkontroll proj456def/);
  assert.match(result.comment, /eks\. mva/);
  assert.match(result.comment, /inkl\. mva/);
  assert.match(result.comment, /10\.10\.2026/);
  assert.match(result.comment, /19:11/);
  assert.match(result.comment, /Kari Nordmann/);
  assert.equal(result.unitPrice, 270000);
  assert.equal(result.quantity, 1);
  assert.equal(result.vatType, "HIGH");
  assert.equal(result.incomeAccount, "3000");
});

test("kr 0 er en gyldig linje, og lang tekst klippes uten å miste markøren", () => {
  const result = line({
    item: {
      ...item,
      kind: "tillegg",
      title: "T".repeat(180),
      approvedByName: "N".repeat(80),
      alternatives: [{
        id: "anbefalt",
        name: "Inkludert",
        description: "D".repeat(400),
        priceExVat: 0,
      }],
    },
    projectId: "p".repeat(40),
  });
  assert.equal(result.unitPrice, 0);
  assert.ok(result.description.length <= 200);
  assert.ok(result.comment.length <= 200);
  assert.equal(result.comment.startsWith("IK:item123abc"), true);
  assert.match(result.comment, /Internkontroll/);
  assert.match(result.description, /^Tillegg:/);
});

test("samme post legges ikke på utkastet to ganger", () => {
  const result = line();
  const first = appendBillableLine([{
    invoiceishDraftLineId: 99,
    description: "Gammel",
    comment: "uten markør",
    quantity: 1,
    unitPrice: 100,
    vatType: "HIGH",
    incomeAccount: "3000",
  }], result, "item123abc");
  assert.equal(first.added, true);
  assert.equal(first.lines.length, 2);
  assert.equal(first.lines[0].invoiceishDraftLineId, undefined);
  const second = appendBillableLine(first.lines, result, "item123abc");
  assert.equal(second.added, false);
  assert.equal(second.lines.length, 2);
});

test("fakturautkastet peker på prosjektet og er en faktura, ikke et bokført salg", () => {
  const body = invoiceDraftBody({
    customerId: 42,
    projectId: 77,
    internProjectId: "proj456def",
    lines: [line()],
    issueDate: "2026-10-10",
  });
  assert.equal(body.type, "invoice");
  assert.equal(body.projectId, 77);
  assert.equal(body.customerId, 42);
  assert.equal(body.daysUntilDueDate, 14);
  assert.match(body.invoiceText, /proj456def/);
  assert.match(body.ourReference, /proj456def/);
  assert.equal(body.createInvoice, undefined);
  const kept = invoiceDraftBody({
    draft: { daysUntilDueDate: 10, issueDate: "2026-01-02", invoiceText: "Behold", ourReference: "IK behold", currency: "NOK" },
    customerId: 5,
    projectId: 8,
    lines: [],
  });
  assert.equal(kept.issueDate, "2026-01-02");
  assert.equal(kept.invoiceText, "Behold");
  assert.equal(kept.ourReference, "IK behold");
  assert.equal(customerIdFromDraft({ customers: [{ contactId: 15 }] }), 15);
  assert.equal(customerIdFromDraft({ customers: [] }), null);
});

test("prosjektnavn, nummer og når en godkjenning skal synkes", () => {
  assert.equal(projectNumber("abcdefghijklmnop"), "IK-ijklmnop");
  assert.equal(projectName({ name: "Hage", address: "Eriksvei 13" }), "Hage – Eriksvei 13");
  assert.match(projectDescription({ id: "abc", address: "Eriksvei 13" }), /kunde\/\?p=abc/);
  assert.equal(statusText("Hage"), "Lagt til i Fiken-prosjekt Hage");
  assert.equal(isBillableOffer(item), true);
  assert.equal(isBillableOffer({ ...item, approvalStatus: "venter" }), false);
  assert.equal(isBillableOffer({ ...item, kind: "bilde" }), false);
  assert.equal(decisionBecameApproved({ approvalStatus: "venter" }, { approvalStatus: "godkjent" }), true);
  assert.equal(decisionBecameApproved({ approvalStatus: "godkjent" }, { approvalStatus: "godkjent" }), false);
  assert.equal(decisionBecameApproved({ approvalStatus: "venter" }, { approvalStatus: "avslatt" }), false);
});

test("funksjonen kaller ikke bokføring av faktura", () => {
  const source = fs.readFileSync(new URL("../functions/index.js", import.meta.url), "utf8");
  assert.equal(source.includes("createInvoice"), false);
  assert.equal(source.includes("/invoices/drafts"), true);
  assert.equal(source.includes("/projects"), true);
});
