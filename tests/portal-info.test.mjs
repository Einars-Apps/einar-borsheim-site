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
} from "../www/js/cost.js";
import { customerOfferStatusLabel, offerShareText } from "../www/js/offers.js";
import { customerRequestStatusLabel } from "../www/js/requests.js";

test("estimert og rund sum skilles, uten å finne på en pris", () => {
  assert.match(ESTIMATE_HELP, /kan fortsatt endre seg/);
  assert.match(ESTIMATE_HELP, /mengde ganger enhetspris/);
  assert.equal(/ikke låst ennå/.test(ESTIMATE_HELP), false);
  assert.match(ROUND_SUM_HELP, /fast sum/);
  assert.match(ROUND_SUM_HELP, /ikke øke den av seg selv/);
  assert.match(ROUND_SUM_HELP, /bare der mindre omfang er avtalt/);
  assert.equal(/\d/.test(ROUND_SUM_HELP), false);
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
  assert.equal(summary.estimated.exVat, 2000);
  assert.match(lineAmountText(round), /Rund sum kr/);
  assert.match(lineAmountText(round), /øker ikke rundsummen/);
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
  assert.match(lineAmountText(locked), /Låst beløp/);
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
});
