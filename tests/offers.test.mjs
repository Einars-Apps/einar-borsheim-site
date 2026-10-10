import test from "node:test";
import assert from "node:assert/strict";
import {
  addressFromGeonorge,
  alternativeHeading,
  alternativePriceText,
  approvedChoiceSum,
  customerDecisionError,
  customerDecisionPatch,
  drainageOfferFields,
  fikenDraftFromOffer,
  fikenProjectFallback,
  fikenProjectStatus,
  formatOfferSum,
  offerDecisionText,
  offerShareText,
  offerStatus,
  quickOfferFields,
  quickProjectName,
  shareTargets,
} from "../www/js/offers.js";

test("status og pris med mva, inkludert når prisen er 0", () => {
  assert.equal(offerStatus({ approvalRequested: false }), "utkast");
  assert.equal(offerStatus({ approvalRequested: true, approvalStatus: "venter" }), "sendt");
  assert.equal(offerStatus({ approvalRequested: true, approvalStatus: "godkjent" }), "godkjent");
  assert.equal(offerStatus({ approvalRequested: true, approvalStatus: "avslatt" }), "avslatt");
  assert.equal(alternativeHeading({ name: "Standard", priceExVat: 0 }), "Standard – kr 0,00");
  assert.equal(alternativePriceText({ priceExVat: 0 }), "kr 0,00, inkludert");
  assert.match(alternativePriceText({ priceExVat: "2700" }), /kr 2[\s\u00a0]?700,00 eks\. mva/);
  assert.match(alternativePriceText({ priceExVat: 2700 }), /kr 3[\s\u00a0]?375,00 inkl\. mva/);
});

test("godkjent sum tar bare valgt alternativ", () => {
  const items = [
    {
      kind: "tilbud",
      approvalRequested: true,
      approvalStatus: "godkjent",
      selectedAlternativeId: "anbefalt",
      alternatives: [
        { id: "standard", name: "Standard", priceExVat: 0 },
        { id: "anbefalt", name: "Anbefalt løsning", priceExVat: 1000 },
      ],
    },
    {
      kind: "endring",
      approvalRequested: true,
      approvalStatus: "avslatt",
      alternatives: [{ id: "a", name: "Dyrt", priceExVat: 9000 }],
    },
    {
      kind: "tillegg",
      approvalRequested: true,
      approvalStatus: "venter",
      alternatives: [{ id: "a", name: "Venter", priceExVat: 500 }],
    },
  ];
  const sum = approvedChoiceSum(items);
  assert.equal(sum.count, 1);
  assert.equal(sum.exVat, 1000);
  assert.equal(sum.vat, 250);
  assert.equal(sum.incVat, 1250);
  assert.match(formatOfferSum(sum), /1 godkjent post/);
  assert.match(offerDecisionText(items[0]), /Anbefalt løsning/);
  assert.match(offerDecisionText(items[0]), /inkl\. mva/);
});

test("kunden kan bare velge et eksisterende alternativ", () => {
  const item = {
    alternatives: [{ id: "standard", name: "Standard", priceExVat: 0 }],
  };
  assert.equal(customerDecisionError(item, "godkjent", ""), "Velg en løsning først.");
  assert.equal(customerDecisionError(item, "godkjent", "standard"), "");
  assert.equal(customerDecisionError(item, "avslatt", ""), "");
  const patch = customerDecisionPatch(item, "godkjent", "standard");
  assert.deepEqual(Object.keys(patch).sort(), ["approvalStatus", "selectedAlternativeId"]);
  assert.equal(patch.selectedAlternativeId, "standard");
  assert.equal(customerDecisionPatch({ alternatives: [] }, "godkjent", "x").selectedAlternativeId, undefined);
});

test("drenering og hurtigbestilling prefyller alternativer", () => {
  const drainage = drainageOfferFields({ name: "Nordvegg", stretchExVat: 2700, wellExVat: 4500 });
  assert.equal(drainage.alternatives[0].priceExVat, 0);
  assert.equal(drainage.alternatives[1].name, "Anbefalt løsning");
  assert.equal(drainage.alternatives[1].priceExVat, 7200);
  assert.equal(drainage.alternatives[2].name, "Fordrøyningsbrønn");
  assert.equal(drainage.approvalRequested, false);
  const quick = quickOfferFields({ description: "Ny drenering langs veggen", priceExVat: "1500" });
  assert.equal(quick.approvalRequested, true);
  assert.equal(quick.approvalStatus, "venter");
  assert.equal(quick.alternatives[1].priceExVat, 1500);
  assert.equal(quickProjectName({ customerName: "Kari", description: "Ny drenering" }), "Kari: Ny drenering");
});

test("Fiken-linje, deling og adresse", () => {
  const item = {
    kind: "tilbud",
    title: "Nordvegg",
    approvalRequested: true,
    approvalStatus: "godkjent",
    selectedAlternativeId: "anbefalt",
    alternatives: [{ id: "anbefalt", name: "Anbefalt løsning", priceExVat: 450 }],
  };
  const lines = fikenDraftFromOffer(item);
  assert.equal(lines[0].unitPrice, 45000);
  assert.equal(lines[0].vatType, "HIGH");
  assert.equal(fikenDraftFromOffer({ ...item, approvalStatus: "venter" }).length, 0);
  const targets = shareTargets({
    phone: "905 52 065",
    email: "kunde@example.com",
    text: "Hei",
    url: "https://einar-borsheim.com/kunde/?p=1&t=abc",
  });
  assert.equal(targets[0].id, "sms");
  assert.match(targets[0].href, /^sms:90552065\?body=/);
  assert.match(targets[1].href, /^mailto:kunde@example.com/);
  assert.match(offerShareText({ customerName: "Kari", name: "Hagen" }, "https://example.test"), /Kari/);
  assert.equal(addressFromGeonorge({
    adresser: [{ adressetekst: "Lensmannslia 60", postnummer: "1386", poststed: "ASKER" }],
  }), "Lensmannslia 60, 1386 ASKER");
  assert.equal(addressFromGeonorge({ adresser: [] }), "");
  assert.equal(fikenProjectStatus({ ...item, fikenSynced: true }, { fikenProjectName: "Hagen" }), "Lagt til i Fiken-prosjekt Hagen");
  assert.equal(fikenProjectStatus(item, { fikenProjectName: "Hagen" }), "");
  const fallback = fikenProjectFallback({ ...item, approvedByName: "Kari" }, { id: "abc123" });
  assert.match(fallback, /Tilbud: Nordvegg/);
  assert.match(fallback, /Anbefalt løsning/);
  assert.match(fallback, /inkl\. mva/);
  assert.match(fallback, /Kari/);
  assert.match(fallback, /abc123/);
  assert.match(fallback, /Beskrivelse;Antall/);
});
