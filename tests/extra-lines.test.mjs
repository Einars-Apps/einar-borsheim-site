import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  changeText,
  costChanges,
  costReportText,
  extraLineSum,
  liveCost,
  patchCost,
  persistableCost,
} from "../www/js/cost.js";
import { extraTilleggText } from "../www/js/cost-history.js";
import { householdAllocation } from "../www/js/households.js";

const prices = {};

test("gammel tilleggslinje uten type er antall ganger enhetspris", () => {
  const summary = liveCost({
    cost: { extras: [{ id: "ta-gammel", description: "Ekstra masse", unitPrice: 100, quantity: 3 }] },
    prices,
    items: [],
  });
  assert.equal(summary.extras[0].kind, undefined);
  assert.equal(summary.extras[0].sum, 300);
  assert.equal(summary.extrasExVat, 300);
  assert.equal(summary.estimated.exVat, 300);
  assert.equal(summary.remaining.exVat, 300);
  assert.match(extraTilleggText(summary.extras[0], []), /^Tillegg: Ekstra masse, 3 stk/);
});

test("timer er timer ganger timepris, og varekostnad er beløpet", () => {
  let cost = patchCost({}, prices, { addExtra: true, extraId: "ta-time", extraKind: "timer" });
  let hours = cost.extras[0];
  assert.equal(hours.kind, "timer");
  assert.equal(hours.quantity, 0);
  assert.equal(hours.unitPrice, 0);
  assert.equal(extraLineSum(hours), 0);
  cost = patchCost(cost, prices, { extraId: "ta-time", field: "quantity", value: "4" });
  cost = patchCost(cost, prices, { extraId: "ta-time", field: "unitPrice", value: "850" });
  cost = patchCost(cost, prices, { extraId: "ta-time", field: "description", value: "Graving" });
  cost = patchCost(cost, prices, { addExtra: true, extraId: "ta-vare", extraKind: "vare" });
  assert.equal(cost.extras[1].kind, "vare");
  assert.equal(cost.extras[1].unitPrice, 0);
  cost = patchCost(cost, prices, { extraId: "ta-vare", field: "unitPrice", value: "1200" });
  cost = patchCost(cost, prices, { extraId: "ta-vare", field: "description", value: "Puss" });
  const summary = liveCost({ cost, prices, items: [] });
  const timer = summary.extras.find((line) => line.id === "ta-time");
  const goods = summary.extras.find((line) => line.id === "ta-vare");
  assert.equal(timer.sum, 3400);
  assert.equal(goods.sum, 1200);
  assert.equal(summary.extrasExVat, 4600);
  assert.equal(summary.estimated.exVat, 4600);
  assert.equal(summary.remaining.exVat, 4600);
  assert.equal(summary.finalized.exVat, 0);
  const homes = householdAllocation({
    households: [
      { id: "a", name: "Første", share: 50 },
      { id: "b", name: "Andre", share: 50 },
    ],
    totalEx: summary.estimated.exVat,
    totalInc: summary.estimated.incVat,
    payments: [],
  });
  assert.equal(homes.totalEx, 4600);
  assert.equal(homes.rows[0].exVat, 2300);
  assert.equal(homes.rows[1].exVat, 2300);
  assert.match(extraTilleggText(timer, []), /^Timer: 4 t à kr/);
  assert.match(extraTilleggText(timer, []), /Graving/);
  assert.match(extraTilleggText(goods, []), /^Varekostnad: Puss, kr/);
  const report = costReportText(summary, []);
  assert.match(report, /Timer: 4 t à kr/);
  assert.match(report, /Varekostnad: Puss, kr/);
  assert.match(report, /Sum tilleggsarbeider/);
  const stored = persistableCost(cost);
  assert.equal(stored.extras[0].kind, "timer");
  assert.equal(stored.extras[1].kind, "vare");
  assert.equal(stored.extras[0].unitPrice, 850);
  const again = liveCost({ cost: stored, prices, items: [] });
  assert.equal(again.estimated.exVat, 4600);
  const changes = costChanges({}, cost, prices);
  const hourChange = changes.find((change) => change.lineId === "ta-time" && change.field === "quantity");
  const rateChange = changes.find((change) => change.lineId === "ta-time" && change.field === "unitPrice");
  const goodsChange = changes.find((change) => change.lineId === "ta-vare" && change.field === "unitPrice");
  assert.equal(hourChange.unit, "t");
  assert.match(changeText(rateChange), /timepris/);
  assert.match(changeText(goodsChange), /beløp/);
  assert.equal(goodsChange.field, "unitPrice");
});

test("feltappen har knapper for timer og varekostnad", () => {
  const view = readFileSync("www/js/cost-view.js", "utf8");
  assert.match(view, /Legg til nytt tillegg/);
  assert.match(view, /Legg til timer/);
  assert.match(view, /Legg til varekostnad/);
  assert.match(view, /Timepris, kr eks\. mva/);
  assert.match(view, /Beløp, kr eks\. mva/);
});
