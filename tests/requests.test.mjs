import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { liveCost } from "../www/js/cost.js";
import {
  applyApprovedRequest,
  requestStatusLabel,
  requestTotal,
  requestTotalText,
} from "../www/js/requests.js";

const require = createRequire(import.meta.url);
const serverApply = require("../functions/request-apply.js").applyApprovedRequest;

const wish = {
  id: "abc123",
  status: "godkjent",
  postName: "Ekstra drenering",
  unit: "meter",
  quantity: 9,
  unitPrice: 180,
};

test("summen er antall ganger enhetspris, og statusene er Ny, Besvart, Godkjent, Avslått", () => {
  assert.equal(requestTotal(9, 180), 1620);
  assert.equal(requestTotal("2,5", "100"), 250);
  assert.match(requestTotalText(9, 180), /eks\. mva/);
  assert.equal(requestStatusLabel({ status: "ny" }), "Ny");
  assert.equal(requestStatusLabel({ status: "besvart" }), "Besvart");
  assert.equal(requestStatusLabel({ status: "godkjent" }), "Godkjent");
  assert.equal(requestStatusLabel({ status: "avslatt" }), "Avslått");
  assert.equal(applyApprovedRequest({}, { ...wish, status: "besvart" }).ok, false);
});

test("godkjent ønske uten post blir en ny post med Planlagt lik antallet", () => {
  const result = applyApprovedRequest({}, wish);
  assert.equal(result.appliedAs, "ny");
  assert.equal(result.cost.fikenLines[0].planned, 9);
  assert.equal(result.cost.fikenLines[0].done, 0);
  assert.equal(result.cost.fikenLines[0].unitPrice, 180);
  assert.equal(result.cost.fikenLines[0].unit, "meter");
  const summary = liveCost({ cost: result.cost, prices: {}, items: [] });
  assert.equal(summary.estimated.exVat, 1620);
  const again = applyApprovedRequest(result.cost, wish);
  assert.equal(again.already, true);
  assert.equal(again.cost.fikenLines.length, 1);
  assert.deepEqual(serverApply({}, wish).changes, result.changes);
});

test("samme enhetspris øker avtalt tillegg, og planlagt blir stående", () => {
  const result = applyApprovedRequest({
    fikenLines: [{ id: "dren", label: "Drenering (meter)", unit: "meter", planned: 26, done: 20, unitPrice: 180 }],
  }, { ...wish, postId: "dren", postName: "Drenering (meter)" });
  assert.equal(result.appliedAs, "linje");
  assert.equal(result.cost.fikenLines[0].planned, 26);
  assert.equal(result.cost.fikenLines[0].addition, 9);
  assert.equal(result.cost.fikenLines[0].unitPrice, 180);
  assert.deepEqual(result.changes.map((change) => change.field), ["addition"]);
  assert.equal(result.changes[0].from, 0);
  assert.equal(result.changes[0].to, 9);
  const summary = liveCost({ cost: result.cost, prices: {}, items: [] });
  const line = summary.lines.find((item) => item.id === "dren");
  assert.equal(line.planned, 26);
  assert.equal(line.addition, 9);
  assert.equal(line.deviation, 20 - 35);
  assert.equal(line.plannedSum, 35 * 180);
  assert.equal(summary.estimated.exVat, 35 * 180);
  const again = applyApprovedRequest(result.cost, { ...wish, postId: "dren" });
  assert.equal(again.already, true);
  assert.equal(again.cost.fikenLines[0].addition, 9);
});

test("annen enhetspris blir et tillegg på posten, uten å endre postens pris", () => {
  const result = applyApprovedRequest({
    fikenLines: [{ id: "dren", label: "Drenering (meter)", unit: "meter", planned: 26, done: 20, unitPrice: 180 }],
  }, { ...wish, postId: "dren", unitPrice: 200 });
  assert.equal(result.appliedAs, "tillegg");
  assert.equal(result.cost.fikenLines[0].planned, 26);
  assert.equal(result.cost.fikenLines[0].unitPrice, 180);
  assert.equal(result.cost.extras[0].postId, "dren");
  assert.equal(result.cost.extras[0].quantity, 9);
  assert.equal(result.cost.extras[0].unitPrice, 200);
  const summary = liveCost({ cost: result.cost, prices: {}, items: [] });
  assert.equal(summary.estimated.exVat, 26 * 180 + 9 * 200);
  assert.equal(summary.extras[0].postId, "dren");
});
