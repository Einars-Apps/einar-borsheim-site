import test from "node:test";
import assert from "node:assert/strict";
import { changeText, costChanges, costReportText, liveCost, patchCost } from "../www/js/cost.js";

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
