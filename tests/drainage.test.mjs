import test from "node:test";
import assert from "node:assert/strict";
import {
  assessDrainage,
  assessWell,
  buildWhy,
  costCsv,
  costTotals,
  dailyPrecipitation,
  documentFromForm,
  drainageError,
  drainageReportText,
  emptyDrainageForm,
  emptyWell,
  fikenDraftLines,
  formatConductivity,
  frostObservationsUrl,
  frostSourcesUrl,
  hoseFlowLitersPerMinute,
  infiltrationAreaM2,
  infiltrationLitersPerHour,
  inflowLitersPerSecond,
  magazineGrossCubicMeters,
  manningLitersPerSecond,
  measuredFlowLitersPerMinute,
  millimetersPerHour,
  parseFrostSource,
  pricesFromLines,
  rainWindows,
  reportIsPublished,
  resolveFrostClientId,
  soilById,
  suggestWellLines,
  verdictFromRatio,
} from "../www/js/drainage.js";

test("bøttetest og slangeformel", () => {
  assert.equal(measuredFlowLitersPerMinute({ liters: 600, minutes: 4 }), 150);
  const hose = hoseFlowLitersPerMinute({ diameterMm: 13, pressureBar: 3 });
  assert.ok(hose > 110 && hose < 130, hose);
  const form = emptyDrainageForm();
  form.volumeLiters = "600";
  form.minutes = "4";
  form.hoseMm = "13";
  form.pressureBar = "3";
  form.ditchLengthM = "10";
  const assessed = assessDrainage(form);
  assert.equal(assessed.usedSource, "malt");
  assert.equal(assessed.usedLpm, 150);
  assert.equal(assessed.perMeter, 15);
});

test("Manning for 110 mm plastrør og tilrenning", () => {
  const flow = manningLitersPerSecond({ diameterMm: 110, slopePerMille: 10, manningN: 0.011 });
  assert.ok(flow > 7 && flow < 9, flow);
  const inflow = inflowLitersPerSecond({ roofM2: 120, plotM2: 0, roofC: 1, plotC: 0, mmPerHour: 20 });
  assert.ok(Math.abs(inflow * 60 - 40) < 0.01);
  assert.equal(millimetersPerHour({ litersPerSecondPerHectare: 20 / 0.36 }), 20);
});

test("grønn, gul og rød margin", () => {
  assert.equal(verdictFromRatio(1.5), "gronn");
  assert.equal(verdictFromRatio(1.2), "gul");
  assert.equal(verdictFromRatio(0.8), "rod");
  const form = emptyDrainageForm();
  form.name = "Nordvegg";
  form.volumeLiters = "600";
  form.minutes = "4";
  form.ditchLengthM = "10";
  form.roofM2 = "120";
  form.roofC = "1";
  form.plotM2 = "0";
  form.mmPerHour = "20";
  const assessed = assessDrainage(form);
  assert.equal(assessed.verdict, "gronn");
  assert.match(assessed.summary, /600 liter/);
  assert.match(assessed.summary, /4 min/);
  assert.match(assessed.summary, /150 l\/min/);
  assert.match(assessed.summary, /15 l\/min per meter/);
  assert.match(assessed.summary, /40 l\/min/);
  assert.match(assessed.summary, /120 m² tak/);
  assert.match(assessed.summary, /god margin/);
});

test("avvik fra Byggforsk krever begrunnelse", () => {
  const form = emptyDrainageForm();
  form.name = "Mot veien";
  form.deviates = true;
  form.deviationReason = "kort";
  assert.match(drainageError(form), /Byggforsk/);
  form.deviationReason = "Grunnen er tett leire, så jeg la ekstra pukk og større fall.";
  assert.equal(drainageError(form), "");
  const summary = assessDrainage(form).summary;
  assert.match(summary, /Avviker fra Byggforsk-anbefaling/);
});

test("massetyper har omtrentlig og navngitt kilde", () => {
  for (const id of ["leire", "silt", "sand", "grus", "fyllmasse", "morene"]) {
    const soil = soilById(id);
    assert.ok(soil.kMs > 0);
    assert.match(soil.source, /Omtrentlig/);
    assert.match(formatConductivity(soil.kMs), /m\/s/);
  }
  assert.ok(soilById("leire").kMs < soilById("sand").kMs);
  assert.ok(soilById("sand").kMs < soilById("grus").kMs);
});

test("Frost-døgn telles én gang, og klienten kommer fra konfig", () => {
  const days = dailyPrecipitation({
    data: [
      {
        referenceTime: "2026-10-10T00:00:00.000Z",
        observations: [
          { timeOffset: "PT18H", value: 9 },
          { timeOffset: "PT6H", value: 1.2 },
        ],
      },
      {
        referenceTime: "2026-10-09T00:00:00.000Z",
        observations: [{ timeOffset: "PT6H", value: 0 }],
      },
      {
        referenceTime: "2026-10-05T00:00:00.000Z",
        observations: [{ timeOffset: "PT6H", value: 0.2 }],
      },
    ],
  });
  assert.equal(days.get("2026-10-10"), 1.2);
  const windows = rainWindows(days, "2026-10-10");
  assert.equal(windows.selectedMm, 1.2);
  assert.equal(windows.last1Mm, 1.2);
  assert.equal(windows.last3Mm, 1.2);
  assert.equal(windows.last7Mm, 1.4);
  const source = parseFrostSource({
    data: [{ id: "SN19718", name: "ASKER BRANNSTASJON II", distance: 0.374 }],
  });
  assert.equal(source.stationId, "SN19718");
  assert.equal(source.stationName, "ASKER BRANNSTASJON II");
  assert.match(frostSourcesUrl(10.435, 59.833), /precipitation_amount/);
  assert.match(decodeURIComponent(frostObservationsUrl("SN19718", "2026-10-03", "2026-10-11")), /sum\(precipitation_amount P1D\)/);
  assert.equal(resolveFrostClientId("", "fra-innstillinger"), "fra-innstillinger");
  assert.equal(resolveFrostClientId("fra-konfig", ""), "fra-konfig");
  assert.equal(resolveFrostClientId("", ""), "");
});

test("magasinvolum, infiltrasjon og tømming", () => {
  const size = { shape: "sirkel", diameterM: 1, depthM: 0.7 };
  const gross = Math.PI * 0.25 * 0.7;
  const area = Math.PI * 0.25 + Math.PI * 0.7;
  assert.ok(Math.abs(magazineGrossCubicMeters(size) - gross) < 1e-9);
  assert.ok(Math.abs(infiltrationAreaM2(size) - area) < 1e-9);
  const kFlow = 1e-5 * area * 1000 * 3600;
  assert.ok(Math.abs(infiltrationLitersPerHour({ kMs: 1e-5, areaM2: area }) - kFlow) < 1e-6);
  assert.equal(infiltrationLitersPerHour({ kMs: 1e-5, areaM2: area, measuredLph: 200 }), 200);

  const open = assessWell({ ...emptyWell(), depthM: "0.7", diameterM: "1", pore: "1", kind: "betongring", stormHours: "1" }, {
    soilK: 1e-5, roofM2: 20, plotM2: 0, roofC: 1, plotC: 0, mmPerHour: 20,
  });
  assert.ok(Math.abs(open.volumeLiters - gross * 1000) < 0.2);
  assert.ok(Math.abs(open.perHour - kFlow) < 0.2);
  assert.ok(Math.abs(open.perDay - kFlow * 24) < 1);
  assert.ok(Math.abs(open.hoursToEmpty - (gross * 1000) / kFlow) < 0.2);
  assert.equal(open.stormLiters, 400);
  assert.equal(open.verdict, "gronn");
  assert.match(open.summary, /enhetsgradient/);
  assert.match(open.summary, /liter i døgnet/);

  const gravel = assessWell({ ...emptyWell(), depthM: "0.7", diameterM: "1", kind: "pukkmagasin", pore: "0.3", stormHours: "1" }, {
    soilK: 1e-5, roofM2: 20, plotM2: 0, roofC: 1, plotC: 0, mmPerHour: 20,
  });
  assert.ok(Math.abs(gravel.volumeLiters - gross * 300) < 0.2);
  assert.equal(gravel.verdict, "rod");

  const measured = assessWell({ ...emptyWell(), depthM: "0.7", diameterM: "1", pore: "1", measuredLph: "200" }, { soilK: 1e-5 });
  assert.equal(measured.usedMeasure, "malt");
  assert.ok(Math.abs(measured.hoursToEmpty - (gross * 1000) / 200) < 0.2);

  const box = { shape: "rektangel", lengthM: 2, widthM: 1, depthM: 0.5 };
  assert.equal(magazineGrossCubicMeters(box), 1);
  assert.equal(infiltrationAreaM2(box), 5);
});

test("begrunnelsen sammenligner uten å finne på bladnummer", () => {
  const bare = emptyDrainageForm();
  bare.soilId = "leire";
  const missing = buildWhy(bare, assessDrainage(bare));
  assert.match(missing.reference, /Generell beskrivelse/);
  assert.doesNotMatch(JSON.stringify(missing), /blad\s*\d/i);
  assert.equal(missing.rows.find((row) => row.id === "nedbor").verdict, "rod");
  assert.equal(missing.rows.find((row) => row.id === "fall").verdict, "gul");
  assert.equal(missing.rows.find((row) => row.id === "masser").verdict, "gul");

  const flat = emptyDrainageForm();
  flat.slopePerMille = "0";
  assert.equal(buildWhy(flat, assessDrainage(flat)).rows.find((row) => row.id === "fall").verdict, "rod");

  const drained = emptyDrainageForm();
  drained.soilId = "leire";
  drained.pipeDiameterMm = "110";
  drained.slopePerMille = "10";
  drained.rain = { source: "frost", stationName: "ASKER BRANNSTASJON II", distanceKm: 0.37, selectedMm: 1.2, last7Mm: 1.4, date: "2026-10-10" };
  const supported = buildWhy(drained, assessDrainage(drained));
  assert.equal(supported.rows.find((row) => row.id === "masser").verdict, "gronn");
  assert.equal(supported.rows.find((row) => row.id === "fall").verdict, "gronn");
  assert.equal(supported.rows.find((row) => row.id === "nedbor").verdict, "gronn");
  assert.match(supported.rows.find((row) => row.id === "nedbor").einar, /ASKER BRANNSTASJON II/);
  assert.match(supported.conclusion, /støtter|forbehold|rød|Målingene/);
});

test("kostnad med mva og Fiken-linjer i øre", () => {
  const lines = [
    { id: "graving", label: "Graving", unit: "m³", quantity: "2", unitPrice: "450" },
    { id: "drensror", label: "Drensrør", unit: "m", quantity: "10", unitPrice: "180" },
    { id: "bronn", label: "Brønn eller kassett", unit: "stk", quantity: "", unitPrice: "4500" },
  ];
  const totals = costTotals(lines);
  assert.equal(totals.exVat, 2700);
  assert.equal(totals.vat, 675);
  assert.equal(totals.incVat, 3375);
  const draft = fikenDraftLines(lines);
  assert.equal(draft.length, 2);
  assert.equal(draft[0].unitPrice, 45000);
  assert.equal(draft[0].vatType, "HIGH");
  assert.match(costCsv(lines), /Graving;2/);
  assert.match(costCsv(lines), /900/);
  const prices = pricesFromLines(lines);
  assert.equal(prices.gravingM3, 450);
  assert.equal(prices.drensrorM, 180);
  const well = emptyWell();
  well.kind = "pukkmagasin";
  const suggested = suggestWellLines(well, { grossM3: 0.55 }, prices);
  assert.equal(suggested.find((line) => line.id === "bronn").quantity, "1");
  assert.equal(suggested.find((line) => line.id === "pukk").quantity, "0.55");
});

test("lagret strekk tar med begrunnelse, brønn og kostnad i rapportteksten", () => {
  const form = emptyDrainageForm();
  form.name = "Nordvegg";
  form.volumeLiters = "600";
  form.minutes = "4";
  form.ditchLengthM = "10";
  form.roofM2 = "120";
  form.roofC = "1";
  form.plotM2 = "0";
  form.mmPerHour = "20";
  form.pipeLengthM = "12";
  form.wells = [{ ...emptyWell(), depthM: "0.7", diameterM: "1", pore: "1", name: "Brønn ved nedløp" }];
  const stored = documentFromForm(form, assessDrainage(form), []);
  assert.match(stored.why.reference, /Generell beskrivelse/);
  assert.equal(stored.wells.length, 1);
  assert.ok(stored.wells[0].volumeLiters > 500);
  assert.equal(stored.cost.lines.find((line) => line.id === "drensror").quantity, 12);
  const report = drainageReportText(stored);
  assert.match(report, /Hvorfor denne løsningen/);
  assert.match(report, /Brønn ved nedløp/);
  assert.match(report, /Kostnad for strekket/);
  assert.match(report, /god margin/);
});

test("kunden ser drenering i portalen bare når rapporten er publisert", () => {
  assert.equal(reportIsPublished({ status: "aktiv", pdfUrl: "https://x" }), false);
  assert.equal(reportIsPublished({ status: "fullfort" }), false);
  assert.equal(reportIsPublished({ status: "fullfort", pdfPath: "projects/a/rapport/sluttrapport.pdf" }), true);
  assert.equal(reportIsPublished({ status: "done", pdfUrl: "https://x" }), true);
});
