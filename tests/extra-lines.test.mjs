import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  costChanges,
  costReportText,
  extraCustomerText,
  extraLineSum,
  extraParts,
  liveCost,
  patchCost,
  persistableCost,
} from "../www/js/cost.js";
import { householdAllocation } from "../www/js/households.js";

const prices = {};

test("gammel tilleggslinje uten type er antall ganger enhetspris", () => {
  const raw = { extras: [{ id: "ta-gammel", description: "Ekstra masse", unitPrice: 100, quantity: 3 }] };
  const summary = liveCost({ cost: raw, prices, items: [] });
  assert.equal(summary.extras[0].kind, undefined);
  assert.equal(summary.extras[0].hours, undefined);
  assert.equal(summary.extras[0].sum, 300);
  assert.equal(summary.estimated.exVat, 300);
  assert.equal(summary.remaining.exVat, 300);
  assert.match(extraCustomerText(summary.extras[0]), /^Ekstra masse: 3 à kr/);
  assert.match(extraCustomerText(summary.extras[0]), /= kr[\s\u00a0]*300,00 eks\. mva/);
  const stored = persistableCost(raw);
  assert.equal(stored.extras[0].hours, undefined);
  assert.equal(stored.extras[0].goods, undefined);
  assert.equal(stored.extras[0].kind, undefined);
});

test("gamle timer- og varelinjer prises som før og vises i det samlede formatet", () => {
  const summary = liveCost({
    cost: {
      extras: [
        { id: "ta-time", kind: "timer", description: "Graving", quantity: 4, unitPrice: 850 },
        { id: "ta-vare", kind: "vare", description: "Puss", quantity: 0, unitPrice: 1200 },
      ],
    },
    prices,
    items: [],
  });
  const timer = summary.extras.find((line) => line.id === "ta-time");
  const goods = summary.extras.find((line) => line.id === "ta-vare");
  assert.equal(timer.sum, 3400);
  assert.equal(goods.sum, 1200);
  assert.equal(summary.extrasExVat, 4600);
  assert.equal(summary.estimated.exVat, 4600);
  assert.equal(summary.remaining.exVat, 4600);
  assert.equal(extraParts(timer).hours, 4);
  assert.equal(extraParts(timer).timePrice, 850);
  assert.equal(extraParts(timer).quantity, 0);
  assert.equal(extraParts(goods).goods[0].amount, 1200);
  assert.match(extraCustomerText(timer), /Graving: 4 t à kr/);
  assert.match(extraCustomerText(goods), /Puss: varer: Puss kr/);
  const untouched = persistableCost(summary);
  assert.equal(untouched.extras[0].kind, "timer");
  assert.equal(untouched.extras[0].hours, undefined);
  assert.equal(untouched.extras[1].kind, "vare");
  assert.equal(untouched.extras[1].goods, undefined);
  const homes = householdAllocation({
    households: [
      { id: "a", name: "Første", share: 50 },
      { id: "b", name: "Andre", share: 50 },
    ],
    totalEx: summary.estimated.exVat,
    totalInc: summary.estimated.incVat,
    payments: [],
  });
  assert.equal(homes.rows[0].exVat, 2300);
});

test("ett tillegg summerer enhetspris, timer og flere varer", () => {
  let cost = patchCost({}, prices, { addExtra: true, extraId: "ta-en" });
  const blank = cost.extras[0];
  assert.equal(blank.kind, undefined);
  assert.equal(blank.hours, 0);
  assert.equal(blank.timePrice, 0);
  assert.deepEqual(blank.goods, []);
  assert.equal(extraLineSum(blank), 0);
  assert.equal(extraCustomerText(blank), "");
  cost = patchCost(cost, prices, { extraId: "ta-en", field: "description", value: "Pusset ujevnheter på vegg" });
  cost = patchCost(cost, prices, { extraId: "ta-en", field: "quantity", value: "2" });
  cost = patchCost(cost, prices, { extraId: "ta-en", field: "unitPrice", value: "100" });
  cost = patchCost(cost, prices, { extraId: "ta-en", field: "hours", value: "4" });
  cost = patchCost(cost, prices, { extraId: "ta-en", field: "timePrice", value: "850" });
  cost = patchCost(cost, prices, { extraId: "ta-en", field: "goods", value: [
    { id: "v1", description: "Puss", amount: 1200 },
    { id: "v2", description: "Skruer", amount: 0 },
    { id: "v3", description: "List", amount: 80 },
  ] });
  const summary = liveCost({ cost, prices, items: [] });
  const line = summary.extras[0];
  assert.equal(line.sum, 200 + 3400 + 1200 + 80);
  assert.equal(summary.estimated.exVat, line.sum);
  assert.equal(summary.remaining.exVat, line.sum);
  assert.equal(summary.finalized.exVat, 0);
  const text = extraCustomerText(line);
  assert.match(text, /^Pusset ujevnheter på vegg: 2 à kr/);
  assert.match(text, /4 t à kr/);
  assert.match(text, /varer: Puss kr/);
  assert.match(text, /List kr/);
  assert.equal(text.includes("Skruer"), false);
  assert.match(text, /= kr[\s\u00a0]*4[\s\u00a0]*880,00 eks\. mva/);
  assert.match(costReportText(summary, []), /4 t à kr/);
  assert.match(costReportText(summary, []), /Sum tilleggsarbeider/);
  assert.equal(costChanges({}, cost, prices).some((change) => change.field === "hours"), false);
  const homes = householdAllocation({
    households: [
      { id: "a", name: "Første", share: 50 },
      { id: "b", name: "Andre", share: 50 },
    ],
    totalEx: summary.estimated.exVat,
    totalInc: summary.estimated.incVat,
    payments: [],
  });
  assert.equal(homes.totalEx, line.sum);
  assert.equal(homes.rows[0].exVat + homes.rows[1].exVat, line.sum);
});

test("endring av antall på en gammel timerlinje beholder timeprisen", () => {
  const cost = patchCost({
    extras: [{ id: "ta-time", kind: "timer", description: "Graving", quantity: 4, unitPrice: 850 }],
  }, prices, { extraId: "ta-time", field: "quantity", value: "2" });
  const line = cost.extras[0];
  assert.equal(line.kind, undefined);
  assert.equal(line.hours, 4);
  assert.equal(line.timePrice, 850);
  assert.equal(line.quantity, 2);
  assert.equal(extraLineSum(line), 4 * 850);
  const withPrice = patchCost(cost, prices, { extraId: "ta-time", field: "unitPrice", value: "100" });
  assert.equal(extraLineSum(withPrice.extras[0]), 4 * 850 + 2 * 100);
});

test("ferdig tillegg teller i ferdigstilt pris og senker gjenstår", () => {
  const open = liveCost({
    cost: { extras: [{ id: "ta-en", description: "Puss", unitPrice: 100, quantity: 2 }] },
    prices,
    items: [],
  });
  assert.equal(open.estimated.exVat, 200);
  assert.equal(open.finalized.exVat, 0);
  assert.equal(open.remaining.exVat, 200);
  assert.equal(open.extras[0].final, undefined);
  const sentinel = { _methodName: "serverTimestamp" };
  const marked = patchCost(open, prices, {
    extraId: "ta-en",
    field: "final",
    value: true,
    finalizedAt: sentinel,
  });
  assert.equal(marked.extras[0].final, true);
  assert.equal(marked.extras[0].finalizedAt._methodName, undefined);
  assert.equal(typeof marked.extras[0].finalizedAt.seconds, "number");
  const stored = persistableCost(marked);
  assert.equal(stored.extras[0].finalizedAt._methodName, undefined);
  const done = liveCost({ cost: stored, prices, items: [] });
  assert.equal(done.estimated.exVat, 200);
  assert.equal(done.finalized.exVat, 200);
  assert.equal(done.remaining.exVat, 0);
  assert.match(extraCustomerText(done.extras[0]), /Ferdig\.$/);
  const homes = householdAllocation({
    households: [
      { id: "a", name: "Første", share: 50 },
      { id: "b", name: "Andre", share: 50 },
    ],
    totalEx: done.estimated.exVat,
    totalInc: done.estimated.incVat,
    payments: [],
  });
  assert.equal(homes.totalEx, 200);
  const changed = patchCost(stored, prices, { extraId: "ta-en", field: "quantity", value: "9" });
  assert.equal(changed.extras[0].quantity, 2);
  const opened = patchCost(stored, prices, { extraId: "ta-en", field: "final", value: false });
  assert.equal(opened.extras[0].final, undefined);
  assert.equal(opened.extras[0].finalizedAt, undefined);
  const again = liveCost({ cost: opened, prices, items: [] });
  assert.equal(again.finalized.exVat, 0);
  assert.equal(again.remaining.exVat, 200);
  assert.equal(costChanges(stored, opened, prices).some((change) => change.field === "final"), true);
});

test("feltappen har ett samlet tillegg, ikke tre opprett-knapper", () => {
  const view = readFileSync("www/js/cost-view.js", "utf8");
  assert.match(view, /Legg til nytt tillegg/);
  assert.equal(view.includes("Legg til timer"), false);
  assert.equal(view.includes("Legg til varekostnad"), false);
  assert.match(view, /\+ Legg til vare/);
  assert.match(view, /Timepris, kr eks\. mva/);
  assert.match(view, /Enhetspris, kr eks\. mva/);
  assert.match(view, /Merke «\$\{name\}» som ferdig med endelig pris\?/);
  assert.match(view, /Ferdig – endelig pris/);
  assert.match(view, /class: "final-badge" \}, "Ferdig"/);
  const editor = view.slice(view.indexOf("function extraEditor"), view.indexOf("function extraSentence"));
  const portal = view.slice(view.indexOf("function extraSentence"), view.indexOf("function splitExtras"));
  for (const source of [editor, portal]) {
    assert.match(source, /class: "estimate-badge", title: ESTIMATE_HELP \}, "Estimert"/);
    assert.match(source, /class: "meta estimate-help" \}, ESTIMATE_HELP/);
    assert.match(source, /class: "final-badge" \}, "Ferdig"/);
    assert.match(source, /row\.final === true/);
  }
  const app = readFileSync("www/app.js", "utf8");
  const save = app.slice(app.indexOf("const savePatch"), app.indexOf("const applyApproved"));
  assert.match(save, /costDoc = previous/);
  assert.match(save, /firestoreWriteMessage\(error, "Kunne ikke lagre mengden"\)/);
  assert.match(app, /finalizedAt: field === "final" && value === true \? new Date\(\)/);
  const rules = readFileSync("firestore.rules", "utf8");
  const quantities = rules.slice(rules.indexOf("match /quantities/"), rules.indexOf("match /costLog/"));
  assert.match(quantities, /allow create, update, delete: if isAdmin\(\)/);
  assert.equal(quantities.includes("keys().hasOnly"), false);
});
