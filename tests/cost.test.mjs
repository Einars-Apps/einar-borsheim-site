import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PRICES } from "../www/js/drainage.js";
import { changeText, costChanges, costReportText, liveCost, patchCost, persistableCost } from "../www/js/cost.js";

const prices = {
  groftM: 350,
  gravingM3: 450,
  drensrorM: 180,
  bronnStk: 4500,
  pukkM3: 550,
  fiberdukM2: 35,
  tilbakefyllingM3: 150,
  maskinTime: 1100,
  mannTime: 750,
  transportTur: 1500,
};

function offer(extra) {
  return {
    id: "post1",
    kind: "endring",
    title: "Ny kum",
    approved: true,
    approvalRequested: true,
    alternatives: [
      { id: "standard", name: "Standard", priceExVat: 0 },
      { id: "anbefalt", name: "Anbefalt løsning", priceExVat: 1000 },
    ],
    ...extra,
  };
}

test("nåværende kostnad summerer avtalt pris, godkjent alternativ og mengder", () => {
  const cost = patchCost({ agreedExVat: 10000 }, prices, { lineId: "groft", field: "planned", value: 40 });
  const withDone = patchCost(cost, prices, { lineId: "groft", field: "done", value: 28 });
  const summary = liveCost({
    cost: withDone,
    prices,
    items: [offer({ approvalStatus: "godkjent", selectedAlternativeId: "anbefalt" })],
  });
  const groft = summary.lines.find((line) => line.id === "groft");
  assert.equal(groft.planned, 40);
  assert.equal(groft.done, 28);
  assert.equal(groft.deviation, -12);
  assert.equal(groft.plannedSum, 14000);
  assert.equal(groft.doneSum, 9800);
  assert.equal(summary.estimated.exVat, 25000);
  assert.equal(summary.estimated.vat, 6250);
  assert.equal(summary.estimated.incVat, 31250);
  assert.equal(summary.incurred.exVat, 20800);
  assert.equal(summary.incurred.incVat, 26000);
  assert.equal(summary.differenceExVat, 15000);
  assert.equal(summary.differenceIncVat, 18750);
});

test("valg før godkjenning er forhåndsvisning, og avslått teller ikke", () => {
  const items = [
    offer({ id: "venter", approvalStatus: "venter" }),
    offer({
      id: "avslatt",
      kind: "tillegg",
      approvalStatus: "avslatt",
      selectedAlternativeId: "anbefalt",
    }),
    offer({ id: "utkast", approvalRequested: false, approvalStatus: "" }),
  ];
  const quiet = liveCost({ cost: { agreedExVat: 5000 }, prices, items, previewChoices: { venter: "anbefalt" } });
  assert.equal(quiet.estimated.exVat, 5000);
  assert.equal(quiet.preview.exVat, 6000);
  assert.equal(quiet.previewDeltaExVat, 1000);
  const chosen = liveCost({
    cost: { agreedExVat: 5000 },
    prices,
    items,
    previewChoices: { venter: "standard", avslatt: "anbefalt" },
  });
  assert.equal(chosen.preview.exVat, 5000);
  assert.equal(chosen.offers.rows.some((row) => row.id === "avslatt"), false);
});

test("etter godkjenning inngår alternativet i totalen, ikke som forhåndsvisning", () => {
  const summary = liveCost({
    cost: { agreedExVat: 0 },
    prices,
    items: [offer({ approvalStatus: "godkjent", selectedAlternativeId: "anbefalt" })],
    previewChoices: { post1: "standard" },
  });
  assert.equal(summary.estimated.exVat, 1000);
  assert.equal(summary.previewDeltaExVat, 0);
  assert.equal(summary.offers.rows[0].status, "godkjent");
});

test("endring logges fra og til, og uendret mengde gir ingen linje", () => {
  const before = { agreedExVat: 1000, lines: { groft: { planned: 40, done: 10, unitPrice: 350 } } };
  const after = patchCost(before, prices, { lineId: "groft", field: "done", value: "28,5" });
  const changes = costChanges(before, after, prices);
  assert.deepEqual(changes.map((change) => change.field), ["done"]);
  assert.equal(changes[0].from, 10);
  assert.equal(changes[0].to, 28.5);
  assert.match(changeText(changes[0]), /Grøft, utført: 10 → 28,5 m/);
  const same = patchCost(before, prices, { lineId: "groft", field: "planned", value: 40 });
  assert.equal(costChanges(before, same, prices).length, 0);
  const report = costReportText(liveCost({ cost: after, prices, items: [] }), [{
    when: "10. okt. 19:40",
    byName: "Einar",
    text: changeText(changes[0]),
  }]);
  assert.match(report, /Estimert total/);
  assert.match(report, /Påløpt hittil/);
  assert.match(report, /planlagt 40 m, utført 28,5 m/);
  assert.match(report, /Einar: Grøft, utført/);
});

test("avtalt tillegg legges på planlagt i estimert og avvik, og mangler feltet er 0", () => {
  const summary = liveCost({
    cost: {
      fikenLines: [
        { id: "dren", label: "Drenering (meter)", unit: "stk", planned: 26, addition: 9, done: 20, unitPrice: 6000 },
        { id: "gammel", label: "Gammel post", unit: "stk", planned: 4, done: 1, unitPrice: 100 },
      ],
    },
    prices,
    items: [],
  });
  const dren = summary.lines.find((line) => line.id === "dren");
  assert.equal(dren.planned, 26);
  assert.equal(dren.addition, 9);
  assert.equal(dren.deviation, -15);
  assert.equal(dren.plannedSum, 210000);
  assert.equal(dren.doneSum, 120000);
  const old = summary.lines.find((line) => line.id === "gammel");
  assert.equal(old.addition, 0);
  assert.equal(old.plannedSum, 400);
  assert.equal(old.deviation, -3);
  const logged = costChanges(
    { fikenLines: [{ id: "dren", label: "Drenering (meter)", planned: 26, done: 20, unitPrice: 6000 }] },
    { fikenLines: [{ id: "dren", label: "Drenering (meter)", planned: 26, addition: 9, done: 20, unitPrice: 6000 }] },
  );
  assert.deepEqual(logged.map((change) => change.field), ["addition"]);
  assert.equal(logged[0].from, 0);
  assert.equal(logged[0].to, 9);
  assert.match(changeText(logged[0]), /avtalt tillegg: 0 → 9/);
});

test("uberørte standardlinjer vises ikke, mengde og Fiken beholdes, grøftpris blir i kalkulatoren", () => {
  assert.equal(DEFAULT_PRICES.groftM, 1000);
  const summary = liveCost({
    cost: {
      agreedExVat: 0,
      lines: {
        groft: { planned: 0, done: 0, unitPrice: 1000 },
        graving: { planned: 3, done: 0, unitPrice: 450 },
        pukk: { planned: 0, done: 1, unitPrice: 550 },
      },
      fikenLines: [{
        id: "ft-1-0",
        label: "Kum",
        planned: 0,
        done: 0,
        unitPrice: 100,
        source: "fra Fiken-tilbud nr 1",
      }],
    },
    prices,
    items: [],
  });
  assert.deepEqual(summary.lines.map((line) => line.id), ["graving", "pukk", "ft-1-0"]);
  const stored = persistableCost({
    agreedExVat: 0,
    lines: {
      groft: { planned: 0, done: 0, unitPrice: 1000 },
      graving: { planned: 3, done: 0, unitPrice: 450 },
      pukk: { planned: 0, done: 1, unitPrice: 550 },
    },
  });
  assert.equal(stored.lines.groft, undefined);
  assert.equal(stored.lines.graving.planned, 3);
  assert.equal(stored.lines.pukk.done, 1);
});

test("tilleggsarbeider summeres inn i nåværende kostnad", () => {
  let cost = patchCost({}, prices, { addExtra: true, extraId: "ta-en" });
  cost = patchCost(cost, prices, { extraId: "ta-en", field: "description", value: "Ekstra kumlokk" });
  cost = patchCost(cost, prices, { extraId: "ta-en", field: "unitPrice", value: "500" });
  cost = patchCost(cost, prices, { extraId: "ta-en", field: "quantity", value: "2" });
  const summary = liveCost({ cost, prices, items: [] });
  assert.equal(summary.extras.length, 1);
  assert.equal(summary.extras[0].sum, 1000);
  assert.equal(summary.extrasExVat, 1000);
  assert.equal(summary.estimated.exVat, 1000);
  assert.equal(summary.incurred.exVat, 1000);
  assert.equal(summary.lines.some((line) => line.id === "groft"), false);
  const changes = costChanges({ extras: [] }, cost, prices);
  assert.deepEqual(changes.map((change) => change.field), ["quantity", "unitPrice"]);
  assert.match(changeText(changes[0]), /Ekstra kumlokk, antall: 0 → 2 stk/);
  const removed = patchCost(cost, prices, { deleteExtraId: "ta-en" });
  assert.equal(removed.extras.length, 0);
  assert.equal(liveCost({ cost: removed, prices, items: [] }).estimated.exVat, 0);
});
