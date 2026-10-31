import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFAULT_PRICES } from "../www/js/drainage.js";
import {
  budgetStatusText,
  scopeChangeText,
  changeText,
  costChanges,
  costReportText,
  liveCost,
  nextInstallmentNumber,
  originalOffer,
  partialFinalText,
  patchCost,
  paymentBalance,
  paymentInstallments,
  paymentProgress,
  paymentReportText,
  paymentTotals,
  persistableCost,
} from "../www/js/cost.js";

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

test("ferdig post har endelig pris utført ganger enhetspris, og gamle poster er ikke ferdige", () => {
  const open = liveCost({
    cost: {
      agreedExVat: 1000,
      fikenLines: [
        { id: "dren", label: "Drenering (meter)", unit: "meter", planned: 26, addition: 9, done: 20, unitPrice: 6000 },
        { id: "aapen", label: "Åpen post", unit: "stk", planned: 4, done: 1, unitPrice: 100 },
      ],
    },
    prices,
    items: [],
  });
  assert.equal(open.lines.every((line) => line.final === false), true);
  assert.equal(open.finalized.exVat, 0);
  const stored = {
    fikenLines: [
      { id: "dren", label: "Drenering (meter)", unit: "meter", planned: 26, addition: 9, done: 20, unitPrice: 6000 },
    ],
  };
  const closed = patchCost(stored, prices, { lineId: "dren", field: "final", value: true, finalizedAt: { seconds: 10 } });
  assert.equal(closed.fikenLines[0].final, true);
  assert.equal(closed.fikenLines[0].finalizedAt.seconds, 10);
  const locked = patchCost(closed, prices, { lineId: "dren", field: "done", value: 5 });
  assert.equal(locked.fikenLines[0].done, 20);
  const summary = liveCost({ cost: { ...closed, agreedExVat: 1000, fikenLines: [
    closed.fikenLines[0],
    { id: "aapen", label: "Åpen post", unit: "stk", planned: 4, done: 1, unitPrice: 100 },
  ] }, prices, items: [] });
  const dren = summary.lines.find((line) => line.id === "dren");
  assert.equal(dren.doneSum, 120000);
  assert.equal(summary.finalized.exVat, 120000);
  assert.equal(summary.remaining.exVat, 1000 + 400);
  assert.equal(summary.estimated.exVat, 1000 + 400 + 120000);
  const marked = costChanges(stored, closed, prices);
  const finalChange = marked.find((change) => change.field === "final");
  assert.equal(finalChange.field, "final");
  assert.match(changeText(finalChange), /Posten er ferdig, endelig pris/);
  assert.match(changeText(finalChange), /120[\s\u00a0\u202f]*000,00 eks\. mva/);
  const opened = patchCost(closed, prices, { lineId: "dren", field: "final", value: false });
  assert.equal(opened.fikenLines[0].final, false);
  assert.equal(opened.fikenLines[0].finalizedAt, null);
  assert.match(changeText(costChanges(closed, opened, prices).find((change) => change.field === "final")), /Posten er åpnet igjen/);
  const report = costReportText(summary, []);
  assert.match(report, /Låst sluttpris \(ferdige poster\)/);
  assert.equal(summary.remaining.exVat, summary.estimated.exVat - summary.finalized.exVat);
  assert.match(report, /Gjenstår \(estimert\)/);
  assert.match(report, /Ferdig – endelig pris/);
  assert.match(report, /Betalt hittil/);
  assert.match(report, /Ingen betalinger er registrert/);
  assert.match(changeText(costChanges(closed, opened, prices).find((change) => change.field === "final")), /kan være fakturert/);
});

test("betalinger summeres bare når mva er merket, og gjenstår bruker totalen", () => {
  const summary = liveCost({ cost: { agreedExVat: 10000 }, prices, items: [] });
  const payments = [
    { amount: 1250, vat: "inkl", invoiceNumber: "1042", note: "Maskintransport", when: "15. okt. 2026" },
    { amount: 800, vat: "eks" },
    { amount: 500, vat: "" },
    { amount: -10, vat: "inkl" },
  ];
  const paid = paymentTotals(payments);
  assert.equal(paid.exVat, 1800);
  assert.equal(paid.incVat, 2250);
  const balance = paymentBalance(summary, payments);
  assert.equal(balance.totalEx, 10000);
  assert.equal(balance.totalInc, 12500);
  assert.equal(balance.dueEx, 8200);
  assert.equal(balance.dueInc, 10250);
  const report = costReportText(summary, [], payments);
  assert.match(report, /15\. okt\. 2026: kr .*1[\s\u00a0\u202f]*250,00 inkl\. mva\. Faktura 1042\. Maskintransport/);
  assert.match(report, /kr .*800,00 eks\. mva/);
  assert.match(report, /Mva er ikke merket, så beløpet er ikke med i summen/);
  assert.match(report, /Betalt hittil/);
  assert.match(report, /Totalt \(endelig \+ estimert\)/);
  assert.match(report, /Gjenstår å betale/);
  assert.doesNotMatch(report, /Det er betalt mer enn totalen/);
  const over = paymentBalance(summary, [{ amount: 20000, vat: "eks" }]);
  assert.equal(over.dueEx, -10000);
  assert.match(paymentReportText([{ amount: 20000, vat: "eks" }], summary), /Det er betalt mer enn totalen/);
  const hidden = paymentReportText([{ amount: 800, vat: "eks", when: "1. okt. 2026" }]);
  assert.match(hidden, /Betalt hittil/);
  assert.doesNotMatch(hidden, /Gjenstår å betale/);
  assert.doesNotMatch(hidden, /Totalt \(endelig \+ estimert\)/);
});

test("Fiken-linjer uten avtalt pris er det opprinnelige tilbudet, ikke en rød økning", () => {
  const summary = liveCost({
    cost: {
      agreedExVat: 0,
      fikenLines: [
        { id: "masse", label: "Masseutskifte grøft under nybygg (RS)", unit: "stk", planned: 1, done: 0.5, unitPrice: 1000, source: "fra Fiken-tilbud nr 10102" },
        { id: "rest", label: "Rest", unit: "stk", planned: 10, done: 0, unitPrice: 100, source: "fra Fiken-tilbud nr 10102" },
      ],
    },
    prices,
    items: [],
  });
  assert.equal(summary.baseline.kind, "planlagt");
  assert.equal(summary.baseline.exVat, 2000);
  assert.equal(summary.baseline.label, "Fra Fiken-tilbud 10102");
  assert.equal(summary.estimated.exVat, 2000);
  assert.equal(summary.differenceExVat, 0);
  const withExtra = liveCost({
    cost: {
      fikenLines: [
        { id: "masse", label: "Masseutskifte", planned: 1, addition: 1, done: 0.5, unitPrice: 1000, source: "fra Fiken-tilbud nr 10102" },
      ],
    },
    prices,
    items: [],
  });
  assert.equal(withExtra.differenceExVat, 1000);
  const agreedQuote = liveCost({
    cost: {
      fikenLines: [
        { id: "masse", label: "Masseutskifte", planned: 1, done: 0, unitPrice: 1000, source: "fra Fiken-tilbud nr 10102" },
      ],
    },
    prices,
    items: [],
    quotes: [{ id: "ft-1", number: "10102", exVat: 1000, agreed: true }],
  });
  assert.equal(agreedQuote.baseline.kind, "fiken");
  assert.equal(agreedQuote.baseline.exVat, 1000);
  assert.equal(originalOffer({ agreedExVat: 500, lines: summary.lines, offers: summary.offers }).kind, "manuell");
});

test("utført kan være 0,5 uten å bli endelig, og en ferdig halv post sier det", () => {
  const open = patchCost({
    fikenLines: [{ id: "masse", label: "Masseutskifte grøft under nybygg (RS)", planned: 1, done: 0, unitPrice: 1000 }],
  }, prices, { lineId: "masse", field: "done", value: "0,5" });
  const line = open.fikenLines.find((entry) => entry.id === "masse");
  assert.equal(line.done, 0.5);
  assert.equal(line.final, false);
  assert.equal(partialFinalText(line), "");
  const blocked = patchCost({
    fikenLines: [{ id: "masse", label: "Masseutskifte", planned: 1, done: 0.5, unitPrice: 1000, final: true }],
  }, prices, { lineId: "masse", field: "done", value: 1 });
  assert.equal(blocked.fikenLines[0].done, 0.5);
  assert.equal(blocked.fikenLines[0].final, true);
  const summary = liveCost({ cost: blocked, prices, items: [] });
  const shown = summary.lines.find((entry) => entry.id === "masse");
  assert.equal(partialFinalText(shown), "Endelig: 0,5 av 1");
  assert.match(costReportText(summary, []), /Endelig: 0,5 av 1/);
  assert.equal(summary.differenceExVat, -500);
});

test("gammel betaling er betalt, og en sendt delfaktura får neste nummer", () => {
  const legacy = [{ amount: 1000, vat: "eks", invoiceNumber: "10", paidAt: new Date("2026-10-01") }];
  const rows = paymentInstallments(legacy);
  assert.equal(rows[0].number, 1);
  assert.equal(rows[0].status, "betalt");
  assert.equal(nextInstallmentNumber(legacy), 2);
  const mixed = [
    ...legacy,
    { amount: 500, vat: "eks", status: "sendt", installment: 2 },
  ];
  assert.equal(paymentTotals(mixed).exVat, 1000);
  const progress = paymentProgress(null, mixed);
  assert.equal(progress.paidEx, 1000);
  assert.equal(progress.totalEx, 1500);
  assert.equal(progress.dueEx, 500);
  assert.match(paymentReportText(mixed), /Delfaktura 1/);
  assert.match(paymentReportText(mixed), /Delfaktura 2/);
  assert.match(paymentReportText(mixed), /Sendt/);
  assert.match(paymentReportText(mixed), /Gjenstår/);
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

test("låst sluttmengde flytter totalen, og åpne poster bruker endret mengde", () => {
  const lower = liveCost({
    cost: {
      fikenLines: [
        { id: "masse", label: "Masseutskifting", planned: 1, done: 0.5, unitPrice: 1000, final: 1 },
      ],
    },
    prices,
    items: [],
  });
  const lowerLine = lower.lines.find((line) => line.id === "masse");
  assert.equal(lowerLine.final, true);
  assert.equal(lowerLine.basis, "låst");
  assert.equal(lowerLine.countedEx, 500);
  assert.equal(lower.finalized.exVat, 500);
  assert.equal(lower.estimated.exVat, 500);
  assert.equal(lower.remaining.exVat, 0);
  assert.equal(lower.baseline.exVat, 1000);
  assert.equal(lower.differenceExVat, -500);
  assert.equal(lower.remaining.exVat, lower.estimated.exVat - lower.finalized.exVat);

  const higher = liveCost({
    cost: {
      fikenLines: [
        { id: "transport", label: "Transport maskin", planned: 1, done: 2, unitPrice: 1000, final: true },
      ],
    },
    prices,
    items: [],
  });
  assert.equal(higher.lines[0].countedEx, 2000);
  assert.equal(higher.estimated.exVat, 2000);
  assert.equal(higher.finalized.exVat, 2000);
  assert.equal(higher.remaining.exVat, 0);
  assert.equal(higher.differenceExVat, 1000);

  const openCost = {
    fikenLines: [
      { id: "dren", label: "Drenering", planned: 10, addition: 2, done: 3, unitPrice: 100 },
    ],
  };
  const changed = liveCost({ cost: openCost, prices, items: [] });
  assert.equal(changed.lines[0].basis, "endret");
  assert.equal(changed.lines[0].countedEx, 1200);
  assert.equal(changed.finalized.exVat, 0);
  assert.equal(changed.estimated.exVat, 1200);
  assert.equal(changed.remaining.exVat, 1200);
  assert.equal(changed.baseline.exVat, 1000);
  assert.equal(changed.differenceExVat, 200);
  assert.equal(costReportText(changed, []).includes("Låst sluttpris"), false);

  const withRequests = liveCost({
    cost: openCost,
    prices,
    items: [],
    requests: [
      { id: "ok", status: "godkjent", quantity: 4, unitPrice: 50 },
      { id: "nei", status: "avslatt", quantity: 9, unitPrice: 9000 },
      { id: "venter", status: "besvart", quantity: 3, unitPrice: 100 },
    ],
  });
  assert.equal(withRequests.estimated.exVat, 1200 + 200);
  assert.equal(withRequests.remaining.exVat, withRequests.estimated.exVat);
  const once = liveCost({
    cost: { ...openCost, appliedRequests: ["ok"] },
    prices,
    items: [],
    requests: [{ id: "ok", status: "godkjent", quantity: 4, unitPrice: 50 }],
  });
  assert.equal(once.estimated.exVat, changed.estimated.exVat);
});

test("Fiken-tilbud 10102: to låste poster flytter totalen, gjenstår er total minus låst", () => {
  const summary = liveCost({
    cost: {
      fikenLines: [
        {
          id: "masse",
          label: "Masseutskifting under nybygg",
          planned: 1,
          done: 0.5,
          unitPrice: 172500,
          final: true,
          source: "fra Fiken-tilbud nr 10102",
        },
        {
          id: "transport",
          label: "Transport maskin",
          planned: 1,
          done: 1.2,
          unitPrice: 50000,
          final: true,
          source: "fra Fiken-tilbud nr 10102",
        },
        {
          id: "dren",
          label: "Drenering",
          planned: 100,
          done: 40,
          unitPrice: 1500,
          source: "fra Fiken-tilbud nr 10102",
        },
      ],
    },
    prices,
    items: [{ id: "avslatt", kind: "tillegg", approved: true, approvalRequested: true, approvalStatus: "avslatt", alternatives: [] }],
  });
  const byId = Object.fromEntries(summary.lines.map((line) => [line.id, line]));
  assert.equal(byId.masse.basis, "låst");
  assert.equal(byId.masse.countedEx, 86250);
  assert.equal(byId.transport.basis, "låst");
  assert.equal(byId.transport.countedEx, 60000);
  assert.equal(byId.dren.basis, "planlagt");
  assert.equal(byId.dren.countedEx, 150000);
  assert.equal(summary.baseline.exVat, 372500);
  assert.equal(summary.baseline.label, "Fra Fiken-tilbud 10102");
  assert.equal(summary.finalized.exVat, 146250);
  assert.equal(summary.estimated.exVat, 296250);
  assert.equal(summary.remaining.exVat, 150000);
  assert.equal(summary.remaining.exVat, summary.estimated.exVat - summary.finalized.exVat);
  assert.equal(summary.differenceExVat, -76250);
  assert.equal(summary.incurred.exVat, 206250);
  assert.match(costReportText(summary, []), /Låst sluttpris \(ferdige poster\)/);
});

test("budsjettrom kommer bare fra låste poster, minus godkjent tillegg", () => {
  const lines = [
    { id: "transport", label: "Transport maskin (stk)", planned: 1, done: 1, unitPrice: 5000, final: true, source: "fra Fiken-tilbud nr 10102" },
    { id: "dren", label: "Drenering (meter)", planned: 26, done: 20, unitPrice: 6000, source: "fra Fiken-tilbud nr 10102" },
    { id: "masse", label: "Masseutskifte grøft under nybygg (RS)", planned: 1, done: 0.5, unitPrice: 142000, final: true, source: "fra Fiken-tilbud nr 10102" },
    { id: "forsterk", label: "Forsterkningsmasse vei (RS)", planned: 1, done: 0, unitPrice: 12000, source: "fra Fiken-tilbud nr 10102" },
  ];
  const under = liveCost({ cost: { fikenLines: lines }, prices, items: [] });
  assert.equal(under.budget.direction, "under");
  assert.equal(under.budget.signedEx, 71000);
  assert.equal(under.budget.exVat, 71000);
  assert.equal(under.budget.incVat, 88750);
  assert.equal(under.estimated.exVat, 244000);
  assert.equal(under.finalized.exVat, 76000);
  assert.equal(under.remaining.exVat, 168000);
  assert.equal(under.remaining.exVat, under.estimated.exVat - under.finalized.exVat);
  assert.notEqual(under.remaining.exVat, 372500);
  assert.equal(under.budget.changes.length, 1);
  assert.match(scopeChangeText(under.budget.changes[0]), /Masseutskifte grøft under nybygg \(RS\): planlagt 1, utført 0,5 – kr −71[\s\u00a0\u202f]*000,00 eks\. mva/);
  assert.match(budgetStatusText(under.budget), /Under tilbudet så langt: kr 71[\s\u00a0\u202f]*000,00 eks\. mva \(kr 88[\s\u00a0\u202f]*750,00 inkl\. mva\)\. Ved ønske om ekstra arbeid kan du sende en forespørsel\./);
  const noted = patchCost({ fikenLines: lines }, prices, { lineId: "masse", field: "finalNote", value: "Halve jobben var ikke mulig å utføre" });
  const withNote = liveCost({ cost: noted, prices, items: [] });
  assert.equal(withNote.budget.changes[0].note, "Halve jobben var ikke mulig å utføre");
  assert.match(costReportText(under, []), /Under tilbudet så langt/);
  assert.equal(under.lines.find((line) => line.id === "dren").final, false);

  const withTillegg = liveCost({
    cost: {
      fikenLines: lines.map((line) => line.id === "dren" ? { ...line, addition: 1 } : line),
    },
    prices,
    items: [],
    requests: [
      { id: "nei", status: "avslatt", quantity: 10, unitPrice: 9000 },
      { id: "ok", status: "godkjent", quantity: 2, unitPrice: 500 },
    ],
  });
  assert.equal(withTillegg.budget.signedEx, 71000 - 6000 - 1000);
  assert.equal(withTillegg.budget.direction, "under");

  const over = liveCost({
    cost: {
      fikenLines: [
        { id: "transport", label: "Transport maskin", planned: 1, done: 3, unitPrice: 5000, final: true },
      ],
    },
    prices,
    items: [],
  });
  assert.equal(over.budget.direction, "over");
  assert.equal(over.budget.exVat, 10000);
  assert.match(budgetStatusText(over.budget), /^Over tilbudet så langt: kr 10[\s\u00a0\u202f]*000,00 eks\. mva/);
  assert.match(budgetStatusText(over.budget), /avtalt tillegg og avvik på ferdige poster/);
  assert.equal(budgetStatusText({ direction: "even", exVat: 0, incVat: 0 }), "");

  const view = readFileSync("www/js/cost-view.js", "utf8");
  assert.match(view, /class: "final-badge" \}, "Ferdig"/);
  assert.match(view, /budgetStatusText\(summary\.budget\)/);
  assert.match(view, /Send en forespørsel/);
  assert.match(readFileSync("kunde/kunde.js", "utf8"), /requestHref:/);
  assert.match(readFileSync("www/app.js", "utf8"), /requestHref: "#seksjon-foresporsler"/);
});
