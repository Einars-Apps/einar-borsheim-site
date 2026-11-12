import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  COST_INFO_NOTE,
  ESTIMATE_HELP,
  ROUND_SUM_HELP,
  isRoundSumLine,
  lineAmountText,
  liveCost,
  customerOfferDifference,
  originalOfferLineText,
  originalOfferRows,
  originalOfferTotal,
  scopeChangeText,
} from "../www/js/cost.js";
import { householdAllocation } from "../www/js/households.js";
import { customerOfferStatusLabel, offerShareText } from "../www/js/offers.js";
import { customerRequestStatusLabel } from "../www/js/requests.js";

test("estimert og rund sum skilles, uten å finne på en pris", () => {
  assert.match(ESTIMATE_HELP, /kan fortsatt endre seg/);
  assert.match(ESTIMATE_HELP, /mengde ganger enhetspris/);
  assert.equal(/ikke låst ennå/.test(ESTIMATE_HELP), false);
  assert.match(ROUND_SUM_HELP, /1 er hele det opprinnelige omfanget/);
  assert.match(ROUND_SUM_HELP, /0,5 er halvparten/);
  assert.match(ROUND_SUM_HELP, /Merk Ferdig/);
  assert.match(ROUND_SUM_HELP, /ikke skal gjøres mer/);
  assert.match(ROUND_SUM_HELP, /går ikke over den avtalte summen/);
  assert.equal(/kr\s*\d/.test(ROUND_SUM_HELP), false);
  assert.equal(/arealet/.test(ROUND_SUM_HELP), false);
  assert.match(COST_INFO_NOTE, /ta kontakt med Einar/);
  assert.match(COST_INFO_NOTE, /faktureres etter avtale/);

  assert.equal(isRoundSumLine({ label: "Masseutskifte grøft under nybygg (RS)", unit: "stk" }), true);
  assert.equal(isRoundSumLine({ label: "Forsterkning", unit: "RS" }), true);
  assert.equal(isRoundSumLine({ label: "Rund sum for plen", unit: "stk" }), true);
  assert.equal(isRoundSumLine({ label: "Drenering (meter)", unit: "meter" }), false);

  const summary = liveCost({
    cost: {
      fikenLines: [
        { id: "masse", label: "Masseutskifte (RS)", unit: "stk", planned: 1, done: 2, unitPrice: 1000 },
        { id: "dren", label: "Drenering (meter)", unit: "meter", planned: 10, done: 4, unitPrice: 100 },
      ],
    },
    prices: {},
    items: [],
  });
  const round = summary.lines.find((line) => line.id === "masse");
  const unit = summary.lines.find((line) => line.id === "dren");
  assert.equal(round.plannedSum, 1000);
  assert.equal(round.doneSum, 2000);
  assert.equal(round.countedEx, 1000);
  assert.equal(summary.estimated.exVat, 2000);
  assert.match(lineAmountText(round), /Rund sum kr/);
  assert.match(lineAmountText(round), /øker ikke summen/);
  assert.equal(lineAmountText(unit), "");
  const locked = liveCost({
    cost: {
      fikenLines: [{
        id: "masse",
        label: "Masseutskifte (RS)",
        planned: 1,
        done: 0.5,
        unitPrice: 1000,
        final: true,
        finalNote: "Halve jobben var ikke mulig",
      }],
    },
    prices: {},
    items: [],
  }).lines[0];
  assert.match(lineAmountText(locked), /Ferdig beløp/);
  assert.match(lineAmountText(locked), /Avtalt omfang: Halve jobben var ikke mulig/);
  assert.equal(locked.doneSum, 500);
});

test("kundetekst om tilbud og tillegg er informasjon, ikke bestilling", () => {
  assert.equal(customerOfferStatusLabel("godkjent"), "Avtalt");
  assert.equal(customerOfferStatusLabel("avslatt"), "Ikke tatt med");
  assert.equal(customerOfferStatusLabel("sendt"), "Til informasjon");
  assert.equal(customerRequestStatusLabel({ status: "besvart" }), "Svar fra Einar");
  assert.equal(customerRequestStatusLabel({ status: "godkjent" }), "Tatt med");

  const shared = offerShareText({ customerName: "Kari", name: "Hagen" }, "https://example.test");
  assert.match(shared, /Kari/);
  assert.match(shared, /til informasjon/);
  assert.equal(/godkjenn/i.test(shared), false);

  const portal = readFileSync("kunde/kunde.js", "utf8");
  assert.equal(/Godkjenn|Avslå|Bestill/.test(portal), false);
  assert.equal(portal.includes("function decide"), false);
  assert.equal(portal.includes("onDecide"), false);
  assert.match(portal, /De er til informasjon/);

  const requests = readFileSync("www/js/requests-view.js", "utf8");
  const customer = requests.slice(
    requests.indexOf("export function renderCustomerRequests"),
    requests.indexOf("export function renderAdminRequests"),
  );
  assert.equal(/Godkjenn|Avslå|be om pris/.test(customer), false);
  assert.match(customer, /bare til informasjon/);

  const costView = readFileSync("www/js/cost-view.js", "utf8");
  assert.match(costView, /ESTIMATE_HELP/);
  assert.match(costView, /ROUND_SUM_HELP/);
  assert.match(costView, /COST_INFO_NOTE/);
  assert.equal(costView.includes("Forhåndsvisning hvis du godkjenner valget"), false);
  assert.equal(costView.includes("godkjent av kunden"), false);
  assert.equal(costView.includes("Estimert = ikke låst"), false);
  assert.equal(/Lås opp|Låst sluttpris|låser opp/.test(costView), false);
  assert.match(costView, /Ferdigstilt pris \(ferdige poster\)/);
  assert.match(costView, /Merk som ikke ferdig/);
});

test("rund sum: hel, halv ferdig, uferdig, og ikke stille økning", () => {
  const prices = {};
  const full = liveCost({
    cost: { fikenLines: [{ id: "rs", label: "Masse (RS)", planned: 1, done: 1, unitPrice: 1000, final: true }] },
    prices,
    items: [],
  });
  assert.equal(full.lines[0].countedEx, 1000);
  assert.equal(full.estimated.exVat, 1000);
  assert.equal(full.finalized.exVat, 1000);
  assert.equal(full.remaining.exVat, 0);
  assert.equal(full.budget.changes.length, 0);

  const half = liveCost({
    cost: { fikenLines: [{ id: "rs", label: "Masse (RS)", planned: 1, done: 0.5, unitPrice: 1000, final: true, finalNote: "Halve arealet" }] },
    prices,
    items: [],
  });
  assert.equal(half.lines[0].countedEx, 500);
  assert.equal(half.estimated.exVat, 500);
  assert.equal(half.finalized.exVat, 500);
  assert.equal(half.remaining.exVat, 0);
  assert.equal(half.differenceExVat, -500);
  assert.equal(half.budget.changes.length, 1);
  assert.match(scopeChangeText(half.budget.changes[0]), /planlagt 1, utført 0,5/);
  assert.match(scopeChangeText(half.budget.changes[0]), /−/);
  assert.match(scopeChangeText(half.budget.changes[0]), /Endring i omfang/);
  assert.equal(/rabatt|discount/i.test(scopeChangeText(half.budget.changes[0])), false);
  const homes = householdAllocation({
    households: [
      { id: "a", name: "Første", share: 50 },
      { id: "b", name: "Andre", share: 50 },
    ],
    totalEx: half.estimated.exVat,
    totalInc: half.estimated.incVat,
    payments: [],
  });
  assert.equal(homes.totalEx, 500);
  assert.equal(homes.rows[0].exVat, 250);
  assert.equal(homes.rows[1].exVat, 250);

  const open = liveCost({
    cost: { fikenLines: [{ id: "rs", label: "Masse (RS)", planned: 1, done: 0.5, unitPrice: 1000 }] },
    prices,
    items: [],
  });
  assert.equal(open.lines[0].countedEx, 1000);
  assert.equal(open.estimated.exVat, 1000);
  assert.equal(open.finalized.exVat, 0);
  assert.equal(open.remaining.exVat, 1000);
  assert.equal(open.budget.changes.length, 0);
  assert.match(lineAmountText(open.lines[0]), /endrer ikke rundsummen før posten er merket Ferdig/);

  const overDone = liveCost({
    cost: { fikenLines: [{ id: "rs", label: "Masse (RS)", planned: 1, done: 1.5, unitPrice: 1000, final: true }] },
    prices,
    items: [],
  });
  assert.equal(overDone.lines[0].done, 1.5);
  assert.equal(overDone.lines[0].countedEx, 1000);
  assert.equal(overDone.estimated.exVat, 1000);
  assert.equal(overDone.finalized.exVat, 1000);
  assert.equal(overDone.differenceExVat, 0);
  assert.equal(overDone.budget.changes.length, 0);
  assert.match(lineAmountText(overDone.lines[0]), /øker ikke summen/);

  const agreedMore = liveCost({
    cost: { fikenLines: [{ id: "rs", label: "Masse (RS)", planned: 1, addition: 0.5, done: 1.5, unitPrice: 1000, final: true }] },
    prices,
    items: [],
  });
  assert.equal(agreedMore.lines[0].countedEx, 1500);
  assert.equal(agreedMore.estimated.exVat, 1500);
  assert.equal(agreedMore.budget.changes.length, 1);
  assert.equal(agreedMore.budget.changes[0].deltaEx, 500);

  const unit = liveCost({
    cost: { fikenLines: [{ id: "meter", label: "Drenering (meter)", unit: "meter", planned: 10, done: 12, unitPrice: 100, final: true }] },
    prices,
    items: [],
  });
  assert.equal(unit.lines[0].countedEx, 1200);
  assert.equal(unit.estimated.exVat, 1200);
  assert.equal(unit.differenceExVat, 200);
});

test("opprinnelig tilbud er fiken-linjene, også når en endring er merket avtalt", () => {
  const summary = liveCost({
    cost: {
      fikenLines: [
        { id: "dren", label: "Drenering", unit: "meter", planned: 10, done: 4, unitPrice: 100, source: "Fiken-tilbud nr 42" },
      ],
    },
    prices: {},
    items: [{
      id: "post",
      kind: "endring",
      approved: true,
      approvalRequested: true,
      approvalStatus: "godkjent",
      title: "Tillegg",
    }],
  });
  assert.equal(summary.baseline.kind, "godkjent");
  assert.equal(summary.baseline.exVat, 0);
  const rows = originalOfferRows(summary.lines);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, "Fiken-tilbud nr 42");
  assert.equal(originalOfferTotal(rows), 1000);
  assert.match(originalOfferLineText(rows[0]), /Drenering: 10 meter à/);
  assert.match(originalOfferLineText(rows[0]), /1[\s\u00a0\u202f]*000,00 eks\. mva/);
  assert.equal(originalOfferRows([{ id: "tom", label: "Tom", planned: 0, unitPrice: 100 }]).length, 0);
  assert.equal(summary.differenceExVat, summary.estimated.exVat);
  const compared = customerOfferDifference(summary);
  assert.equal(compared.originalTotal, 1000);
  assert.equal(compared.exVat, 0);
});
